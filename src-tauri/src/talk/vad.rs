//! Voice-activity detection.
//!
//! `NoopVad` is the always-silent stub for cloud-only / push-to-talk
//! builds. `SileroVad` (behind `talk-local`) wraps silero-vad v5
//! ONNX via the `ort` crate. Splitting the two means the default
//! (cloud-only) build doesn't need to ship onnxruntime.
//!
//! Common parameters across all impls:
//!
//! - **Sample rate**: 16 kHz mono f32 in [-1.0, 1.0].
//! - **Frame size**: 512 samples (= 32 ms at 16 kHz). silero-vad
//!   was trained at exactly this granularity; bigger frames get
//!   chunked, smaller frames are rejected.
//! - **Trailing-silence threshold**: 700 ms (≈ 22 frames). Anything
//!   shorter mistakes natural pauses for end-of-utterance; anything
//!   longer makes the talk loop feel sluggish. Matches the value
//!   used in the v0.4.0 Talk Mode plan and OpenClaw's `talk` node.
//! - **Speech onset threshold**: probability ≥ 0.5 for one frame.

use super::backend::{Vad, VadDecision};

pub const TALK_SAMPLE_RATE: u32 = 16_000;
pub const TALK_FRAME_SIZE: usize = 512;
/// Trailing silence required to flip `SpeechContinue` → `SpeechEnd`,
/// expressed in frames (32 ms each). 22 frames ≈ 704 ms.
pub const TRAILING_SILENCE_FRAMES: usize = 22;

/// Diagnostic stub used when the local voice pack isn't installed.
/// Always reports silence so the talk state machine stays in `idle`
/// and the auto-listening UI shows a "Local voice pack required"
/// banner. The real silero-vad lives in `SileroVad`
/// (Task 2, behind `talk-local` feature).
pub struct NoopVad;

impl Vad for NoopVad {
    fn sample_rate(&self) -> u32 {
        TALK_SAMPLE_RATE
    }

    fn frame_size(&self) -> usize {
        TALK_FRAME_SIZE
    }

    fn process_frame(&mut self, _pcm: &[f32]) -> VadDecision {
        VadDecision::Silence
    }

    fn reset(&mut self) {}
}

/// Default speech-onset probability threshold. silero-vad's
/// authors recommend 0.5 as a balanced default (lower = more
/// false-positives, higher = clipped utterances). Exposed as a
/// constant so Settings → Voice can offer an "aggressive / balanced
/// / conservative" preset later without changing the model.
pub const DEFAULT_SPEECH_THRESHOLD: f32 = 0.5;

// ─────────────────── EnergyVad (always available) ───────────────────

/// Default RMS threshold for `EnergyVad`. -34 dBFS — quiet office
/// background hovers around -50 dBFS; a normal-volume mic-on
/// speaker sits at -20 to -10 dBFS. The threshold sits midway with
/// some headroom, biased towards "miss when truly silent" rather
/// than "trigger on HVAC noise".
pub const DEFAULT_ENERGY_THRESHOLD: f32 = 0.02;

/// Pure-Rust energy-based VAD — no ONNX, no models, no feature
/// flag. Used as the default detector before the user downloads
/// the local voice pack (silero-vad). Quality is noticeably worse
/// than silero in noisy environments (HVAC, fans), but it's a
/// usable demo on a quiet desk and lets Talk Mode's auto-listening
/// loop run on every machine out of the box.
///
/// Construction is sample-rate-aware so the audio thread can hand
/// frames straight from cpal without resampling: the 32 ms target
/// frame size is `rate * 32 / 1000` samples (e.g. 1408 at 44.1 kHz,
/// 1536 at 48 kHz, 512 at 16 kHz).
pub struct EnergyVad {
    sample_rate: u32,
    frame_size: usize,
    threshold: f32,
    silence_frames_threshold: usize,
    silence_count: usize,
    speaking: bool,
}

impl EnergyVad {
    pub fn new(sample_rate: u32) -> Self {
        let frame_size = ((sample_rate as usize) * 32 / 1000).max(64);
        // Trailing silence is 700 ms regardless of sample rate, so
        // the frame count scales inversely with frame duration.
        let silence_frames_threshold = TRAILING_SILENCE_FRAMES;
        Self {
            sample_rate,
            frame_size,
            threshold: DEFAULT_ENERGY_THRESHOLD,
            silence_frames_threshold,
            silence_count: 0,
            speaking: false,
        }
    }

    pub fn with_threshold(mut self, threshold: f32) -> Self {
        self.threshold = threshold.clamp(0.001, 0.5);
        self
    }

    fn rms(pcm: &[f32]) -> f32 {
        if pcm.is_empty() {
            return 0.0;
        }
        let sum_sq: f32 = pcm.iter().map(|&s| s * s).sum();
        (sum_sq / pcm.len() as f32).sqrt()
    }
}

impl Vad for EnergyVad {
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn frame_size(&self) -> usize {
        self.frame_size
    }

    fn process_frame(&mut self, pcm: &[f32]) -> VadDecision {
        // Tolerant of small frame-size drift — cpal sometimes
        // hands buffers a few samples shy of the requested size,
        // and rejecting them would silence the loop.
        if pcm.is_empty() {
            return VadDecision::Silence;
        }
        let energy = Self::rms(pcm);
        let is_speech = energy >= self.threshold;

        match (self.speaking, is_speech) {
            (false, false) => VadDecision::Silence,
            (false, true) => {
                self.speaking = true;
                self.silence_count = 0;
                VadDecision::SpeechStart
            }
            (true, true) => {
                self.silence_count = 0;
                VadDecision::SpeechContinue
            }
            (true, false) => {
                self.silence_count = self.silence_count.saturating_add(1);
                if self.silence_count >= self.silence_frames_threshold {
                    self.speaking = false;
                    self.silence_count = 0;
                    VadDecision::SpeechEnd
                } else {
                    VadDecision::SpeechContinue
                }
            }
        }
    }

    fn reset(&mut self) {
        self.silence_count = 0;
        self.speaking = false;
    }
}

// ─────────────── silero-vad (talk-local feature) ────────────────

#[cfg(feature = "talk-local")]
mod silero {
    use std::path::Path;

    use anyhow::Context;
    use ndarray::{Array2, Array3};

    use super::{
        Vad, VadDecision, DEFAULT_SPEECH_THRESHOLD, TALK_FRAME_SIZE, TALK_SAMPLE_RATE,
        TRAILING_SILENCE_FRAMES,
    };

    /// silero-vad v5 wrapper.
    ///
    /// Model contract (v5, 16 kHz):
    /// - inputs:
    ///     - `input` f32 `[1, 512]` — 32 ms PCM frame
    ///     - `state` f32 `[2, 1, 128]` — LSTM hidden state, zero on first call
    ///     - `sr`    i64 scalar — sample rate (16000)
    /// - outputs:
    ///     - `output` f32 `[1, 1]` — speech probability
    ///     - `stateN` f32 `[2, 1, 128]` — next LSTM state
    ///
    /// State is carried internally across calls; the talk loop just
    /// hands frames in and reads `VadDecision`s out. `reset()` zeroes
    /// the state and silence counter between turns so the next
    /// utterance starts clean.
    pub struct SileroVad {
        session: ort::session::Session,
        state: Array3<f32>,
        speech_threshold: f32,
        silence_frames: usize,
        speaking: bool,
    }

    impl SileroVad {
        /// Load the model from disk. Returns a clear error when the
        /// file is missing — Task 8's downloader UI surfaces that as
        /// "Local voice pack not installed" with a one-click action.
        pub fn load(model_path: &Path) -> anyhow::Result<Self> {
            if !model_path.exists() {
                anyhow::bail!(
                    "silero-vad model not found at {} — install the local voice pack first (Settings › Voice › Download)",
                    model_path.display()
                );
            }

            let session = ort::session::Session::builder()
                .map_err(|e| anyhow::anyhow!("ort session builder: {e}"))?
                .with_intra_threads(1)
                .map_err(|e| anyhow::anyhow!("intra threads: {e}"))?
                .commit_from_file(model_path)
                .with_context(|| format!("load silero-vad model from {}", model_path.display()))?;

            Ok(Self {
                session,
                state: Array3::<f32>::zeros((2, 1, 128)),
                speech_threshold: DEFAULT_SPEECH_THRESHOLD,
                silence_frames: 0,
                speaking: false,
            })
        }

        pub fn with_threshold(mut self, threshold: f32) -> Self {
            self.speech_threshold = threshold.clamp(0.05, 0.95);
            self
        }

        /// Run one ONNX inference on a 512-sample frame and update
        /// `self.state` with the returned LSTM hidden state.
        fn infer(&mut self, pcm: &[f32]) -> anyhow::Result<f32> {
            let input_arr = Array2::from_shape_vec((1, pcm.len()), pcm.to_vec())
                .map_err(|e| anyhow::anyhow!("input shape: {e}"))?;
            let sr_arr = ndarray::Array1::<i64>::from(vec![i64::from(TALK_SAMPLE_RATE)]);

            let input_tensor = ort::value::TensorRef::from_array_view(input_arr.view())
                .map_err(|e| anyhow::anyhow!("input tensor: {e}"))?;
            let state_tensor = ort::value::TensorRef::from_array_view(self.state.view())
                .map_err(|e| anyhow::anyhow!("state tensor: {e}"))?;
            let sr_tensor = ort::value::TensorRef::from_array_view(sr_arr.view())
                .map_err(|e| anyhow::anyhow!("sr tensor: {e}"))?;

            let outputs = self
                .session
                .run(ort::inputs![
                    "input" => input_tensor,
                    "state" => state_tensor,
                    "sr" => sr_tensor,
                ])
                .map_err(|e| anyhow::anyhow!("vad inference: {e}"))?;

            let (_prob_shape, prob_data) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| anyhow::anyhow!("extract prob: {e}"))?;
            let prob = prob_data
                .first()
                .copied()
                .ok_or_else(|| anyhow::anyhow!("empty vad output"))?;

            let (_state_shape, state_data) = outputs[1]
                .try_extract_tensor::<f32>()
                .map_err(|e| anyhow::anyhow!("extract state: {e}"))?;
            if state_data.len() != 2 * 128 {
                anyhow::bail!(
                    "unexpected silero-vad state size: {} (want 256)",
                    state_data.len()
                );
            }
            self.state = Array3::from_shape_vec((2, 1, 128), state_data.to_vec())
                .map_err(|e| anyhow::anyhow!("state shape: {e}"))?;

            Ok(prob)
        }
    }

    impl Vad for SileroVad {
        fn sample_rate(&self) -> u32 {
            TALK_SAMPLE_RATE
        }

        fn frame_size(&self) -> usize {
            TALK_FRAME_SIZE
        }

        fn process_frame(&mut self, pcm: &[f32]) -> VadDecision {
            if pcm.len() != TALK_FRAME_SIZE {
                tracing::warn!(
                    target: "talk.vad",
                    "silero-vad frame size mismatch: got {} want {}",
                    pcm.len(),
                    TALK_FRAME_SIZE
                );
                return VadDecision::Silence;
            }

            let prob = match self.infer(pcm) {
                Ok(p) => p,
                Err(e) => {
                    // Soft-fail: log + treat as silence so a flaky
                    // ONNX run doesn't lock the talk loop in
                    // mid-utterance. The talk state machine will
                    // notice repeated silence and fall back to
                    // push-to-talk if the user re-presses Space.
                    tracing::warn!(target: "talk.vad", "silero-vad inference: {e:#}");
                    return VadDecision::Silence;
                }
            };

            let is_speech = prob >= self.speech_threshold;

            match (self.speaking, is_speech) {
                (false, false) => VadDecision::Silence,
                (false, true) => {
                    self.speaking = true;
                    self.silence_frames = 0;
                    VadDecision::SpeechStart
                }
                (true, true) => {
                    self.silence_frames = 0;
                    VadDecision::SpeechContinue
                }
                (true, false) => {
                    self.silence_frames = self.silence_frames.saturating_add(1);
                    if self.silence_frames >= TRAILING_SILENCE_FRAMES {
                        self.speaking = false;
                        self.silence_frames = 0;
                        VadDecision::SpeechEnd
                    } else {
                        VadDecision::SpeechContinue
                    }
                }
            }
        }

        fn reset(&mut self) {
            self.state.fill(0.0);
            self.silence_frames = 0;
            self.speaking = false;
        }
    }
}

#[cfg(feature = "talk-local")]
#[allow(unused_imports)]
pub use silero::SileroVad;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noop_always_silent() {
        let mut v = NoopVad;
        assert_eq!(v.sample_rate(), 16_000);
        assert_eq!(v.frame_size(), 512);
        let frame = vec![0.0_f32; 512];
        for _ in 0..50 {
            assert_eq!(v.process_frame(&frame), VadDecision::Silence);
        }
        v.reset();
    }

    #[test]
    fn energy_vad_full_state_machine() {
        let mut v = EnergyVad::new(16_000).with_threshold(0.05);
        let frame_size = v.frame_size();
        assert_eq!(frame_size, 512);

        let silence = vec![0.0_f32; frame_size];
        // Loud sine at amplitude 0.3 — RMS ≈ 0.21, well above 0.05.
        let speech: Vec<f32> = (0..frame_size)
            .map(|i| (0.3_f32) * (i as f32 * 0.5).sin())
            .collect();

        // 1) Idle silence frames stay Silent.
        assert_eq!(v.process_frame(&silence), VadDecision::Silence);
        assert_eq!(v.process_frame(&silence), VadDecision::Silence);

        // 2) First loud frame fires SpeechStart.
        assert_eq!(v.process_frame(&speech), VadDecision::SpeechStart);

        // 3) Subsequent loud frames are SpeechContinue.
        assert_eq!(v.process_frame(&speech), VadDecision::SpeechContinue);
        assert_eq!(v.process_frame(&speech), VadDecision::SpeechContinue);

        // 4) During the trailing-silence window, frames are still
        //    "in speech" (Continue) until the threshold is hit.
        for _ in 0..(TRAILING_SILENCE_FRAMES - 1) {
            assert_eq!(v.process_frame(&silence), VadDecision::SpeechContinue);
        }

        // 5) The threshold-th silent frame flips to SpeechEnd.
        assert_eq!(v.process_frame(&silence), VadDecision::SpeechEnd);

        // 6) After SpeechEnd we're back at idle Silence.
        assert_eq!(v.process_frame(&silence), VadDecision::Silence);
    }

    #[test]
    fn energy_vad_handles_short_buffers() {
        // cpal sometimes hands < frame_size buffers. The detector
        // should treat them as silence rather than panic on the
        // RMS divide.
        let mut v = EnergyVad::new(16_000);
        assert_eq!(v.process_frame(&[]), VadDecision::Silence);
        assert_eq!(v.process_frame(&[0.0; 8]), VadDecision::Silence);
    }

    #[test]
    fn energy_vad_frame_size_scales_with_rate() {
        // 32 ms windows across the three rates cpal commonly hands
        // us on macOS / Windows hardware.
        assert_eq!(EnergyVad::new(16_000).frame_size(), 512);
        assert_eq!(EnergyVad::new(44_100).frame_size(), 1411);
        assert_eq!(EnergyVad::new(48_000).frame_size(), 1536);
    }

    #[test]
    fn frame_constants_match_silero_v5() {
        // silero-vad v5 16 kHz model expects exactly 512-sample
        // frames. If we ever bump to a different model these
        // constants must move with it; this test is a tripwire so
        // that change is intentional.
        assert_eq!(TALK_SAMPLE_RATE, 16_000);
        assert_eq!(TALK_FRAME_SIZE, 512);
        // 22 frames × 32 ms = 704 ms — within the 600-800 ms band
        // recommended by the silero-vad authors for "natural pause"
        // semantics.
        let ms = TRAILING_SILENCE_FRAMES as f32 * 32.0;
        assert!(
            (600.0..=800.0).contains(&ms),
            "trailing silence {ms}ms outside natural-pause band"
        );
    }

    /// When the local voice pack is not installed, `SileroVad::load`
    /// must surface a clear, action-oriented error so the frontend
    /// can route the user to the downloader UI rather than a raw
    /// onnxruntime failure.
    #[cfg(feature = "talk-local")]
    #[test]
    fn silero_load_errors_clearly_when_model_missing() {
        // `expect_err` would require `SileroVad: Debug`, which we
        // can't derive (ort's `Session` doesn't impl Debug). Match
        // on the result instead so the assertion stays Debug-free.
        let bogus = std::path::PathBuf::from("/tmp/does-not-exist-silero.onnx");
        let err = match SileroVad::load(&bogus) {
            Ok(_) => panic!("expected load to fail when model is missing"),
            Err(e) => e,
        };
        let msg = format!("{err:#}");
        assert!(
            msg.contains("install the local voice pack"),
            "error should hint at recovery action, got: {msg}"
        );
    }
}
