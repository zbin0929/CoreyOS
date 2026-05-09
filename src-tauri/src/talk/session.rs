//! Continuous-listening Talk session (B-8 v1 task 7 — Phase A).
//!
//! Wires `cpal` audio capture → `Vad` state machine → Tauri events
//! the frontend subscribes to. Replaces the v0 push-to-talk
//! `voice_record` round-trip with a single long-running session
//! that emits utterance-sized WAVs whenever the VAD reports
//! `SpeechEnd`.
//!
//! Lifecycle:
//!
//! ```text
//!   talk_session_start ─► Session::start()
//!                          ├─ open default mic (cpal)
//!                          ├─ spawn audio thread (cpal::Stream is !Send)
//!                          └─ spawn orchestrator thread
//!                              │   on every sample batch:
//!                              │     · mix to mono
//!                              │     · feed `Vad::frame_size()` chunks
//!                              │     · emit `talk:level` (RMS)
//!                              │     · on SpeechStart: emit + start buffering
//!                              │     · on SpeechEnd: encode WAV → emit utterance
//!                              ▼
//!   talk_session_stop  ─► Session::stop() flips an AtomicBool; both
//!                         threads notice and exit cleanly.
//! ```
//!
//! VAD selection: we use `EnergyVad` by default so the loop demos
//! on machines that haven't downloaded silero yet. When
//! `talk-local` is on AND the silero model exists, callers can
//! plug in `SileroVad` via `Session::start_with_vad`.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::Emitter;

use super::aec::NlmsFilter;
use super::backend::{Vad, VadDecision};
use super::vad::EnergyVad;

#[cfg(feature = "talk-local")]
fn create_vad(sample_rate: u32) -> Box<dyn Vad> {
    use super::paths::silero_vad_model;
    match silero_vad_model() {
        Ok(path) if path.exists() => match SileroVad::load(&path) {
            Ok(s) => {
                tracing::info!(target: "talk.session", "Silero VAD loaded ({}Hz)", sample_rate);
                Box::new(ResamplingSileroVad::new(s, sample_rate))
            }
            Err(e) => {
                tracing::warn!(target: "talk.session", "silero-vad load failed: {e:#}, using EnergyVad");
                Box::new(EnergyVad::new(sample_rate))
            }
        },
        _ => {
            tracing::info!(target: "talk.session", "silero-vad model not found, using EnergyVad");
            Box::new(EnergyVad::new(sample_rate))
        }
    }
}

#[cfg(not(feature = "talk-local"))]
fn create_vad(sample_rate: u32) -> Box<dyn Vad> {
    Box::new(EnergyVad::new(sample_rate))
}

#[cfg(feature = "talk-local")]
use super::vad::ResamplingSileroVad;

#[cfg(feature = "talk-local")]
use super::vad::SileroVad;

#[cfg(feature = "talk-local")]
use sherpa_onnx::OnlineRecognizer;

pub const EVT_LEVEL: &str = "talk:level";
pub const EVT_SPEECH_START: &str = "talk:speech-start";
pub const EVT_SPEECH_END: &str = "talk:speech-end";
pub const EVT_ERROR: &str = "talk:error";
pub const EVT_PARTIAL_TRANSCRIPT: &str = "talk:partial-transcript";

static TTS_REFERENCE: parking_lot::Mutex<Vec<f32>> = parking_lot::Mutex::new(Vec::new());

pub fn feed_tts_reference(pcm: &[f32]) {
    let mut buf = TTS_REFERENCE.lock();
    buf.extend_from_slice(pcm);
    const MAX_REF_SAMPLES: usize = 480_000;
    if buf.len() > MAX_REF_SAMPLES {
        let drain = buf.len() - MAX_REF_SAMPLES;
        buf.drain(..drain);
    }
}

fn drain_tts_reference() -> Vec<f32> {
    let mut buf = TTS_REFERENCE.lock();
    std::mem::take(&mut *buf)
}

/// Emit `talk:level` at most once every N audio frames so we don't
/// flood the frontend bus. At 32 ms frames a stride of 3 ≈ 10 Hz —
/// plenty smooth for a VU bar without hammering IPC.
const LEVEL_EMIT_STRIDE: u32 = 3;

#[derive(Debug, Clone, Serialize)]
pub struct SpeechEndPayload {
    pub wav_base64: String,
    pub sample_rate: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LevelPayload {
    pub rms: f32,
    pub speaking: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PartialTranscriptPayload {
    pub text: String,
    pub is_final: bool,
}

// ─────────────────────── Singleton handle ───────────────────────

/// Only one talk session is meaningful at a time (a second mic
/// stream would either fail to open or fight the first for samples).
/// We park the live session behind a global mutex; `start` rejects
/// re-entry and `stop` is idempotent.
static ACTIVE: Mutex<Option<Arc<SessionInner>>> = Mutex::new(None);

struct SessionInner {
    active: AtomicBool,
}

/// Returns true if a session is currently running. Used by the
/// `talk_session_start` IPC to short-circuit duplicate starts.
pub fn is_active() -> bool {
    ACTIVE
        .lock()
        .as_ref()
        .map(|s| s.active.load(Ordering::SeqCst))
        .unwrap_or(false)
}

/// Stop the active session if any. Safe to call when nothing is
/// running. The audio + orchestrator threads notice the flag and
/// exit on their own; we don't `.join()` them because cpal's stream
/// drop already blocks until the audio thread settles.
pub fn stop() {
    let prev = ACTIVE.lock().take();
    if let Some(inner) = prev {
        inner.active.store(false, Ordering::SeqCst);
    }
}

/// Spin up the talk session. Returns the (sample_rate, frame_size)
/// the orchestrator settled on so the IPC layer can echo it back to
/// the frontend (used by the VU meter for accurate timing).
pub fn start(app: tauri::AppHandle) -> anyhow::Result<(u32, usize)> {
    if is_active() {
        anyhow::bail!("talk session already active");
    }

    // ── Open default input device & native config ──
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow::anyhow!("no default input device"))?;
    let supported = device
        .default_input_config()
        .map_err(|e| anyhow::anyhow!("default_input_config: {e}"))?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let sample_format = supported.sample_format();
    let stream_config: cpal::StreamConfig = supported.into();

    let vad: Box<dyn Vad> = create_vad(sample_rate);
    let frame_size = vad.frame_size();

    // ── Active flag (shared with audio thread + orchestrator) ──
    let inner = Arc::new(SessionInner {
        active: AtomicBool::new(true),
    });
    *ACTIVE.lock() = Some(inner.clone());

    // ── mpsc bridge from cpal callback → orchestrator ──
    // f32 samples (mono after mix-down). Using mpsc::sync_channel
    // would back-pressure the audio callback if the orchestrator
    // stalls; a plain channel keeps audio real-time and trades
    // memory for liveness. The orchestrator drains as fast as it
    // can (< 1 ms per frame).
    let (tx, rx) = mpsc::channel::<Vec<f32>>();

    // ── Audio thread: cpal::Stream is !Send so it must own its
    //    OS thread; the channel + active flag are the only escape
    //    hatches. We spawn it before the orchestrator so any
    //    immediate stream-build error surfaces in `start`.
    let audio_inner = inner.clone();
    let audio_app = app.clone();
    thread::spawn(move || {
        if let Err(e) = run_audio_thread(
            &device,
            &stream_config,
            sample_format,
            channels,
            tx,
            audio_inner,
        ) {
            tracing::warn!(target: "talk.session", "audio thread: {e:#}");
            let _ = audio_app.emit(
                EVT_ERROR,
                ErrorPayload {
                    message: format!("audio thread: {e}"),
                },
            );
        }
    });

    // ── Optional streaming STT recognizer ──
    let online_stt = create_online_recognizer();

    // ── Orchestrator thread: VAD-drives the loop, emits events.
    let orch_inner = inner.clone();
    let orch_app = app.clone();
    thread::spawn(move || {
        run_orchestrator(
            orch_app,
            rx,
            Box::new(vad),
            sample_rate,
            frame_size,
            orch_inner,
            online_stt,
        );
    });

    Ok((sample_rate, frame_size))
}

#[cfg(feature = "talk-local")]
fn create_online_recognizer() -> Option<sherpa_onnx::OnlineRecognizer> {
    use crate::talk::online_stt::ZipformerStt;
    match ZipformerStt::try_load() {
        Ok(stt) => {
            tracing::info!(target: "talk.session", "streaming STT attached to session");
            Some(stt.into_recognizer())
        }
        Err(e) => {
            tracing::info!(target: "talk.session", "streaming STT not available: {e:#}");
            None
        }
    }
}

#[cfg(not(feature = "talk-local"))]
fn create_online_recognizer() -> Option<()> {
    None
}

// ───────────────────────── Audio thread ─────────────────────────

fn run_audio_thread(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    channels: usize,
    tx: mpsc::Sender<Vec<f32>>,
    inner: Arc<SessionInner>,
) -> anyhow::Result<()> {
    let err_inner = inner.clone();
    let err_fn = move |err| {
        tracing::warn!(target: "talk.session", "cpal stream error: {err}");
        // Don't tear the session down on transient errors; cpal
        // recovers from most underruns automatically. If the device
        // truly went away the next sample callback will be dropped
        // and the orchestrator will time out after silence.
        let _ = err_inner; // keep flag alive for cancellation logic
    };

    // Build the right callback for the device's native sample
    // format. We always mix down to mono f32 in-callback — the
    // orchestrator only deals with one shape.
    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let tx = tx.clone();
            device.build_input_stream(
                config,
                move |data: &[f32], _| {
                    let mono = mix_to_mono_f32(data, channels);
                    let _ = tx.send(mono);
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let tx = tx.clone();
            device.build_input_stream(
                config,
                move |data: &[i16], _| {
                    let f: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                    let mono = mix_to_mono_f32(&f, channels);
                    let _ = tx.send(mono);
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let tx = tx.clone();
            device.build_input_stream(
                config,
                move |data: &[u16], _| {
                    let f: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)
                        .collect();
                    let mono = mix_to_mono_f32(&f, channels);
                    let _ = tx.send(mono);
                },
                err_fn,
                None,
            )
        }
        fmt => anyhow::bail!("unsupported sample format: {fmt}"),
    }
    .map_err(|e| anyhow::anyhow!("build_input_stream: {e}"))?;

    stream
        .play()
        .map_err(|e| anyhow::anyhow!("stream play: {e}"))?;

    // Park until the orchestrator flips the active flag. cpal
    // drives the callback on its own thread; we just need to
    // keep `stream` alive so dropping it stops capture cleanly.
    while inner.active.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(50));
    }
    drop(stream);
    Ok(())
}

fn mix_to_mono_f32(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    let frames = data.len() / channels;
    let mut out = Vec::with_capacity(frames);
    for i in 0..frames {
        let mut acc = 0.0_f32;
        for c in 0..channels {
            acc += data[i * channels + c];
        }
        out.push(acc / channels as f32);
    }
    out
}

// ───────────────────────── Orchestrator ─────────────────────────

fn run_orchestrator(
    app: tauri::AppHandle,
    rx: mpsc::Receiver<Vec<f32>>,
    mut vad: Box<dyn Vad>,
    sample_rate: u32,
    frame_size: usize,
    inner: Arc<SessionInner>,
    #[cfg(feature = "talk-local")] online_stt: Option<OnlineRecognizer>,
    #[cfg(not(feature = "talk-local"))] online_stt: Option<()>,
) {
    let mut accumulator: Vec<f32> = Vec::with_capacity(frame_size * 4);
    let mut speech_buffer: Vec<f32> = Vec::new();
    let mut emit_counter: u32 = 0;
    let mut speaking = false;
    let mut aec = NlmsFilter::new(256, 0.3);

    #[cfg(feature = "talk-local")]
    let mut stt_stream = online_stt.as_ref().map(|r| r.create_stream());
    #[cfg(not(feature = "talk-local"))]
    let _ = &online_stt;

    while inner.active.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(batch) => accumulator.extend_from_slice(&batch),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        let ref_samples = drain_tts_reference();
        if !ref_samples.is_empty() {
            aec.push_reference_batch(&ref_samples);
        }

        while accumulator.len() >= frame_size {
            let mut frame: Vec<f32> = accumulator.drain(..frame_size).collect();
            aec.process_frame(&mut frame);
            let decision = vad.process_frame(&frame);

            let rms = rms(&frame);

            if speaking {
                speech_buffer.extend_from_slice(&frame);
            }

            #[cfg(feature = "talk-local")]
            if speaking {
                if let (Some(ref recognizer), Some(ref mut stream)) =
                    (online_stt.as_ref(), stt_stream.as_mut())
                {
                    let resampled = super::stt::linear_resample(&frame, sample_rate, 16_000);
                    stream.accept_waveform(16_000, &resampled);
                    while recognizer.is_ready(stream) {
                        recognizer.decode(stream);
                    }
                    let partial_emit_stride: u32 = 6;
                    if emit_counter % partial_emit_stride == 0 {
                        if let Some(result) = recognizer.get_result(stream) {
                            let text = result.text.trim().to_string();
                            if !text.is_empty() {
                                let _ = app.emit(
                                    EVT_PARTIAL_TRANSCRIPT,
                                    PartialTranscriptPayload {
                                        text,
                                        is_final: false,
                                    },
                                );
                            }
                        }
                    }
                }
            }

            match decision {
                VadDecision::Silence => {}
                VadDecision::SpeechStart => {
                    speaking = true;
                    speech_buffer.clear();
                    speech_buffer.extend_from_slice(&frame);
                    #[cfg(feature = "talk-local")]
                    if let (Some(ref recognizer), Some(ref mut stream)) =
                        (online_stt.as_ref(), stt_stream.as_mut())
                    {
                        recognizer.reset(stream);
                    }
                    let _ = app.emit(EVT_SPEECH_START, ());
                }
                VadDecision::SpeechContinue => {}
                VadDecision::SpeechEnd => {
                    speaking = false;
                    #[cfg(feature = "talk-local")]
                    if let (Some(ref recognizer), Some(ref mut stream)) =
                        (online_stt.as_ref(), stt_stream.as_mut())
                    {
                        stream.input_finished();
                        while recognizer.is_ready(stream) {
                            recognizer.decode(stream);
                        }
                        if let Some(result) = recognizer.get_result(stream) {
                            let text = result.text.trim().to_string();
                            if !text.is_empty() {
                                let _ = app.emit(
                                    EVT_PARTIAL_TRANSCRIPT,
                                    PartialTranscriptPayload {
                                        text,
                                        is_final: true,
                                    },
                                );
                            }
                        }
                    }
                    if let Some(payload) = encode_wav(&speech_buffer, sample_rate) {
                        let _ = app.emit(EVT_SPEECH_END, payload);
                    }
                    speech_buffer.clear();
                }
            }

            emit_counter = emit_counter.wrapping_add(1);
            if emit_counter % LEVEL_EMIT_STRIDE == 0 {
                let _ = app.emit(EVT_LEVEL, LevelPayload { rms, speaking });
            }
        }
    }
}

fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let s: f32 = frame.iter().map(|v| v * v).sum();
    (s / frame.len() as f32).sqrt()
}

fn encode_wav(samples: &[f32], sample_rate: u32) -> Option<SpeechEndPayload> {
    if samples.is_empty() {
        return None;
    }
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = Cursor::new(Vec::<u8>::new());
    {
        let mut w = hound::WavWriter::new(&mut buf, spec).ok()?;
        for &s in samples {
            let val = (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32);
            w.write_sample(val as i16).ok()?;
        }
        w.finalize().ok()?;
    }
    let bytes = buf.into_inner();
    let duration_ms = (samples.len() as u64 * 1000) / u64::from(sample_rate.max(1));
    let wav_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(SpeechEndPayload {
        wav_base64,
        sample_rate,
        duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_zero_on_silence() {
        let zeros = vec![0.0_f32; 256];
        assert_eq!(rms(&zeros), 0.0);
    }

    #[test]
    fn rms_handles_empty_buffer() {
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn mix_to_mono_passthrough_when_already_mono() {
        let data = vec![0.1, 0.2, 0.3];
        assert_eq!(mix_to_mono_f32(&data, 1), data);
    }

    #[test]
    fn mix_to_mono_averages_stereo() {
        // L=1.0 R=-1.0 → 0.0; L=0.5 R=0.5 → 0.5
        let stereo = vec![1.0, -1.0, 0.5, 0.5];
        let mono = mix_to_mono_f32(&stereo, 2);
        assert_eq!(mono, vec![0.0, 0.5]);
    }

    #[test]
    fn encode_wav_round_trip() {
        // Encode a short tone and verify the WAV reads back the
        // sample count we expect.
        let samples: Vec<f32> = (0..1600).map(|i| (i as f32 * 0.1).sin() * 0.3).collect();
        let payload = encode_wav(&samples, 16_000).expect("encode");
        assert_eq!(payload.sample_rate, 16_000);
        assert_eq!(payload.duration_ms, 100);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&payload.wav_base64)
            .expect("decode b64");
        // RIFF header → first 4 bytes "RIFF"
        assert_eq!(&bytes[..4], b"RIFF");
        let cursor = Cursor::new(bytes);
        let reader = hound::WavReader::new(cursor).expect("read wav");
        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.duration(), 1600);
    }

    #[test]
    fn encode_wav_empty_returns_none() {
        assert!(encode_wav(&[], 16_000).is_none());
    }
}
