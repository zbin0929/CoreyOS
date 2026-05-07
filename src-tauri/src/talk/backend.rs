//! Trait surface for Talk Mode backends.
//!
//! Three independent traits — `Stt`, `Tts`, `Vad` — let us mix
//! providers freely (e.g. silero-vad + whisper.cpp + sherpa-onnx,
//! or silero-vad + cloud-Whisper + sherpa-onnx, or fully cloud)
//! without a combinatorial explosion of backend types. The
//! `TalkBackend` bundle is the runtime selection that the talk
//! state machine consults; it's deliberately a struct of
//! `Arc<dyn Trait>` rather than a generic so callers can swap
//! pieces at runtime when the user toggles "Local (whisper.cpp +
//! sherpa-onnx)" vs cloud in Settings.

use std::sync::Arc;

use async_trait::async_trait;

/// Result of running silero-vad over one short audio frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadDecision {
    /// Silence — no speech detected and silence threshold not yet
    /// reached (still inside leading-silence window or an utterance
    /// gap shorter than the trailing-silence threshold).
    Silence,
    /// First frame that flips into speech. Caller starts buffering
    /// PCM for STT and, if the AI is currently speaking, cancels
    /// playback (interrupt-on-speech).
    SpeechStart,
    /// Still hearing speech. Caller keeps appending PCM.
    SpeechContinue,
    /// Trailing-silence threshold (default 700 ms) reached — caller
    /// stops the recorder and feeds buffered PCM to STT.
    SpeechEnd,
}

/// Voice-activity detector. Drives the "no button, just talk" loop.
///
/// One `Vad` instance is owned per active session; it carries
/// internal state (LSTM hidden state for silero-vad, silence-frame
/// counter for the threshold, leading vs trailing window flags). The
/// talk loop calls `process_frame` on every fixed-size frame of
/// captured PCM.
pub trait Vad: Send + Sync {
    /// Sample rate the detector was trained for / configured at
    /// (silero-vad ships 8 kHz and 16 kHz models; we standardise
    /// on 16 kHz to match whisper.cpp's input without resampling).
    fn sample_rate(&self) -> u32;

    /// Frame size in samples expected by `process_frame`. silero-vad
    /// at 16 kHz wants 512 samples (32 ms).
    fn frame_size(&self) -> usize;

    /// Run inference on one frame of mono f32 PCM in [-1.0, 1.0].
    /// Returns the state transition for this frame.
    ///
    /// `&mut self` because the silero-vad ONNX session carries an
    /// LSTM hidden state across calls; the no-op stub also tracks
    /// a frame counter so unit tests can simulate transitions.
    fn process_frame(&mut self, pcm: &[f32]) -> VadDecision;

    /// Reset the detector — clears LSTM state and the silence
    /// counter. Called between turns so the next utterance starts
    /// from a clean baseline.
    fn reset(&mut self);
}

/// Speech-to-text. Inputs a complete utterance (16 kHz mono WAV bytes)
/// and returns the transcript.
///
/// Streaming variants (whisper.cpp's `--stream`) are out of scope for
/// v1; we run STT after `SpeechEnd` because the whole-utterance path
/// is simpler and sherpa-onnx TTS first-byte latency is short enough
/// that integrating partial-transcript streaming wouldn't visibly
/// improve turn-around time.
#[async_trait]
pub trait Stt: Send + Sync {
    /// Stable identifier for diagnostics / audit log
    /// (e.g. `"whisper-cpp"`, `"cloud-openai"`, `"cloud-zhipu"`).
    fn name(&self) -> &str;

    /// Transcribe one utterance. `wav` is a complete 16 kHz mono WAV
    /// file (with header) — the same shape `voice_transcribe`
    /// already produces from `voice_record`.
    async fn transcribe(&self, wav: &[u8]) -> anyhow::Result<String>;
}

/// Text-to-speech.
#[async_trait]
pub trait Tts: Send + Sync {
    /// Stable identifier for diagnostics / audit log.
    fn name(&self) -> &str;

    /// Synthesize `text` and return playable audio bytes plus the
    /// MIME type the frontend `<audio>` element should claim. v1
    /// emits whole-utterance audio; v1.2 will add a streaming
    /// trait method for Matcha-TTS / Kokoro chunk-level playback.
    async fn synthesize(&self, text: &str) -> anyhow::Result<TtsAudio>;
}

#[derive(Debug, Clone)]
pub struct TtsAudio {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

/// Runtime bundle the talk state machine consults. Constructed once
/// per session; pieces are independent so e.g. mixing local-VAD with
/// cloud-STT and cloud-TTS is valid on machines that haven't yet
/// downloaded the whisper + sherpa-onnx model bundles.
///
/// `vad` is `Option` because cloud-only setups don't need a VAD —
/// push-to-talk fallback (the v0 path) drives the loop manually.
/// The `Vad` trait takes `&mut self`, so the field stores a
/// `Box<dyn Vad>` behind a `parking_lot::Mutex`; the talk state
/// machine acquires the mutex once per frame on the audio thread
/// and inference takes < 1 ms so contention is irrelevant.
#[derive(Clone)]
pub struct TalkBackend {
    pub vad: Option<Arc<parking_lot::Mutex<Box<dyn Vad>>>>,
    pub stt: Arc<dyn Stt>,
    pub tts: Arc<dyn Tts>,
}

impl TalkBackend {
    pub fn new(stt: Arc<dyn Stt>, tts: Arc<dyn Tts>) -> Self {
        Self {
            vad: None,
            stt,
            tts,
        }
    }

    pub fn with_vad(mut self, vad: Box<dyn Vad>) -> Self {
        self.vad = Some(Arc::new(parking_lot::Mutex::new(vad)));
        self
    }
}
