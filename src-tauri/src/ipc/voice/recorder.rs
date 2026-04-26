//! System-level microphone capture (Phase 8 push-to-talk).
//!
//! `voice_record` opens the default input device via `cpal`, streams
//! samples for up to N seconds (or until `voice_record_stop` flips the
//! flag), and returns a base64-encoded WAV. The recording loop runs on
//! a dedicated thread because `cpal::Stream` is `!Send` and would
//! poison Tokio's executor; the result is shipped back via a oneshot.
//!
//! `pcm_to_wav` lives here too because Zhipu's TTS returns raw PCM
//! that we have to wrap in a WAV header before the frontend `<audio>`
//! tag can play it.

use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::error::{IpcError, IpcResult};

static RECORDING_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn voice_record(duration_secs: Option<u64>) -> IpcResult<String> {
    let secs = duration_secs.unwrap_or(30).min(120);
    RECORDING_ACTIVE.store(true, Ordering::SeqCst);
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let flag = &RECORDING_ACTIVE;

    std::thread::spawn(move || {
        let result = record_audio_blocking(secs, flag);
        let _ = tx.send(result);
    });

    let wav_bytes = rx
        .await
        .map_err(|e| {
            RECORDING_ACTIVE.store(false, Ordering::SeqCst);
            IpcError::Internal {
                message: format!("recording thread panicked: {e}"),
            }
        })?
        .map_err(|msg| {
            RECORDING_ACTIVE.store(false, Ordering::SeqCst);
            IpcError::Internal { message: msg }
        })?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&wav_bytes);
    Ok(b64)
}

#[tauri::command]
pub async fn voice_record_stop() -> IpcResult<()> {
    RECORDING_ACTIVE.store(false, Ordering::SeqCst);
    Ok(())
}

fn record_audio_blocking(secs: u64, active: &AtomicBool) -> Result<Vec<u8>, String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("no_input_device")?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("input_config:{e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as u16;

    let (rec_tx, rec_rx) = std::sync::mpsc::channel();
    let err_tx = rec_tx.clone();

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let samples: Vec<f32> = data.to_vec();
                let _ = rec_tx.send(samples);
            },
            move |err| {
                let _ = err_tx.send(vec![]);
                let _ = std::io::stderr().write_all(format!("audio err: {err}").as_bytes());
            },
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let samples: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                let _ = rec_tx.send(samples);
            },
            move |err| {
                let _ = err_tx.send(vec![]);
                let _ = std::io::stderr().write_all(format!("audio err: {err}").as_bytes());
            },
            None,
        ),
        fmt => return Err(format!("unsupported_format:{fmt}")),
    }
    .map_err(|e| format!("stream_build:{e}"))?;

    stream.play().map_err(|e| format!("stream_play:{e}"))?;

    let start = std::time::Instant::now();
    let mut all_samples: Vec<f32> = Vec::new();
    while active.load(Ordering::SeqCst) && start.elapsed().as_secs() < secs {
        match rec_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(samples) => all_samples.extend_from_slice(&samples),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(stream);
    active.store(false, Ordering::SeqCst);

    if all_samples.is_empty() {
        return Err("no_audio_captured".into());
    }

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut wav_buf = std::io::Cursor::new(Vec::new());
    {
        let mut writer =
            hound::WavWriter::new(&mut wav_buf, spec).map_err(|e| format!("wav_writer:{e}"))?;
        for &s in &all_samples {
            let val = (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32);
            writer
                .write_sample(val as i16)
                .map_err(|e| format!("wav_write:{e}"))?;
        }
        writer.finalize().map_err(|e| format!("wav_finalize:{e}"))?;
    }

    Ok(wav_buf.into_inner())
}

/// Wrap raw 16-bit PCM @ 24 kHz mono in a WAV header. Used by the
/// Zhipu TTS path which returns headerless PCM.
pub(super) fn pcm_to_wav(raw: &[u8]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut writer =
            hound::WavWriter::new(&mut buf, spec).map_err(|e| format!("pcm_to_wav write: {e}"))?;
        for chunk in raw.chunks(2) {
            let lo = chunk[0] as u16;
            let hi = if chunk.len() > 1 { chunk[1] as u16 } else { 0 };
            let sample = ((hi << 8) | lo) as i16;
            writer
                .write_sample(sample)
                .map_err(|e| format!("pcm_to_wav sample: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("pcm_to_wav finalize: {e}"))?;
    }
    Ok(buf.into_inner())
}
