//! IPC commands for B-8 Talk Mode v1 — Phase A (continuous
//! listening loop).
//!
//! The frontend's `useTalkMode` hook calls these to swap the v0
//! push-to-talk recorder for the new VAD-driven session. The
//! session itself lives in [`crate::talk::session`]; this module
//! is a thin adapter that maps the Tauri command surface onto it
//! and converts internal `anyhow` errors into the project's
//! `IpcError` envelope.
//!
//! Surface:
//! - `talk_session_start` — open mic, return `(sample_rate,
//!   frame_size)`. Subsequent utterances arrive via
//!   `talk:speech-end` events.
//! - `talk_session_stop` — flip the active flag; both audio and
//!   orchestrator threads exit at their next polling tick.
//! - `talk_session_status` — quick "is anything live?" probe so
//!   the frontend can recover after a renderer reload without
//!   double-starting the mic.

use std::path::PathBuf;

use base64::Engine;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::error::{IpcError, IpcResult};
use crate::talk::backend::Stt;
// `Tts` is imported in-scope (`use ... as _`) inside the two
// helpers that need it (`try_sherpa` + the macos `say` fallback)
// so different cfg paths don't fight over a single top-level
// import that any one of them might consider unused.
use crate::talk::stt::WhisperCppStt;
use crate::talk::tts::SherpaTts;
use crate::talk::{download, session};

#[cfg(feature = "talk-local")]
use crate::talk::online_stt::ZipformerStt;

#[derive(Debug, Clone, Serialize)]
pub struct TalkSessionStarted {
    pub sample_rate: u32,
    pub frame_size: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TalkSessionStatus {
    pub active: bool,
}

#[tauri::command]
pub async fn talk_session_start(app: tauri::AppHandle) -> IpcResult<TalkSessionStarted> {
    let (sample_rate, frame_size) = session::start(app).map_err(|e| IpcError::Internal {
        message: format!("talk session start: {e:#}"),
    })?;
    Ok(TalkSessionStarted {
        sample_rate,
        frame_size,
    })
}

#[tauri::command]
pub async fn talk_session_stop() -> IpcResult<()> {
    session::stop();
    Ok(())
}

#[tauri::command]
pub async fn talk_session_status() -> IpcResult<TalkSessionStatus> {
    Ok(TalkSessionStatus {
        active: session::is_active(),
    })
}

#[tauri::command]
pub async fn talk_tts_reference(audio_base64: String) -> IpcResult<()> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| IpcError::Internal {
            message: format!("base64 decode: {e}"),
        })?;
    let cursor = std::io::Cursor::new(&bytes);
    let reader = hound::WavReader::new(cursor).map_err(|e| IpcError::Internal {
        message: format!("wav parse: {e}"),
    })?;
    let pcm: Vec<f32> = reader
        .into_samples::<i16>()
        .filter_map(|s| s.ok())
        .map(|s| s as f32 / i16::MAX as f32)
        .collect();
    if !pcm.is_empty() {
        crate::talk::session::feed_tts_reference(&pcm);
    }
    Ok(())
}

// ──────────────────── Local voice pack (Task 8) ────────────────────

#[tauri::command]
pub async fn talk_models_status() -> IpcResult<download::TalkModelsStatus> {
    download::status().map_err(|e| IpcError::Internal {
        message: format!("talk_models_status: {e}"),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct TalkModelsDownloadResult {
    /// Per-spec audit log: which mirror URL ended up serving each
    /// file. `<cached>` means the file was already on disk and we
    /// didn't touch the network. Surfaced verbatim in the UI so
    /// users can see whether the China-mirror chain kicked in.
    pub used_mirrors: Vec<(String, String)>,
}

#[tauri::command]
pub async fn talk_models_download(app: tauri::AppHandle) -> IpcResult<TalkModelsDownloadResult> {
    // Cancellation hook — currently always live (no UI cancel
    // button yet), but the field is in place so a future "Cancel"
    // affordance lands without changing the IPC shape.
    let cancel = CancellationToken::new();
    let used_mirrors =
        download::download_all(&app, cancel)
            .await
            .map_err(|e| IpcError::Internal {
                message: format!("talk model download: {e:#}"),
            })?;
    Ok(TalkModelsDownloadResult { used_mirrors })
}

#[derive(Debug, Clone, Serialize)]
pub struct TalkModelsImportResult {
    pub imported: usize,
}

#[tauri::command]
pub async fn talk_models_import_zip(zip_path: String) -> IpcResult<TalkModelsImportResult> {
    let path = PathBuf::from(&zip_path);
    let imported = download::import_offline_zip(&path).map_err(|e| IpcError::Internal {
        message: format!("import_offline_zip: {e:#}"),
    })?;
    Ok(TalkModelsImportResult { imported })
}

// ──────────────── Local STT/TTS route (Tasks 5+6) ────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TalkLocalReadiness {
    /// Both whisper-cli + ggml model present on disk.
    pub stt_ready: bool,
    /// True when *some* local TTS engine is usable: sherpa-onnx
    /// binary + model on disk, or `/usr/bin/say` (macOS only).
    pub tts_ready: bool,
}

/// Quick disk-probe so the frontend knows whether to route a
/// turn through `talk_local_transcribe` / `talk_local_tts` or
/// fall back to the cloud `voice_*` IPCs.
#[tauri::command]
pub async fn talk_local_status() -> IpcResult<TalkLocalReadiness> {
    // tts_ready is "any local TTS engine present". On macOS the
    // OS-bundled `say` covers the case where the sherpa-onnx
    // model files haven't downloaded yet, so a fresh install
    // still gets working voice the first time the user opens
    // Talk Mode. On Linux/Windows we require sherpa-onnx — they
    // don't have a free OS-level fallback (espeak-ng quality is
    // unacceptable; v1.2 will add `WindowsSapiTts` for Win).
    //
    // Notes on the arch-mismatch detection that used to live
    // here: it was needed for Piper's macOS arm64 prebuilt that
    // was secretly x86_64. Sherpa-onnx ships native binaries for
    // every triple we target and verifies arch in CI, so this
    // entire failure mode just disappears with the migration —
    // see git log of `ipc/talk.rs` for the v1.0 detection code.
    #[cfg(target_os = "macos")]
    let tts_ready = crate::talk::tts::SherpaTts::ready() || crate::talk::tts::MacosSayTts::ready();
    #[cfg(not(target_os = "macos"))]
    let tts_ready = crate::talk::tts::SherpaTts::ready();
    Ok(TalkLocalReadiness {
        stt_ready: stt_ready(),
        tts_ready,
    })
}

fn stt_ready() -> bool {
    #[cfg(feature = "talk-local")]
    {
        if ZipformerStt::ready() {
            return true;
        }
    }
    WhisperCppStt::ready()
}

#[derive(Debug, Clone, Serialize)]
pub struct TalkLocalTranscribeResult {
    pub text: String,
}

#[tauri::command]
pub async fn talk_local_transcribe(wav_base64: String) -> IpcResult<TalkLocalTranscribeResult> {
    let wav = base64::engine::general_purpose::STANDARD
        .decode(wav_base64.as_bytes())
        .map_err(|e| IpcError::Internal {
            message: format!("decode wav b64: {e}"),
        })?;
    let stt: Box<dyn Stt> = match resolve_stt() {
        Ok(s) => s,
        Err(e) => return Err(IpcError::Internal { message: format!("{e:#}") }),
    };
    let text = stt.transcribe(&wav).await.map_err(|e| IpcError::Internal {
        message: format!("{} transcribe: {e:#}", stt.name()),
    })?;
    Ok(TalkLocalTranscribeResult { text })
}

fn resolve_stt() -> anyhow::Result<Box<dyn Stt>> {
    #[cfg(feature = "talk-local")]
    {
        if let Ok(z) = ZipformerStt::try_load() {
            tracing::info!(target: "talk.stt", "using zipformer-online STT");
            return Ok(Box::new(z));
        }
        tracing::info!(target: "talk.stt", "zipformer not available, falling back to whisper-cpp");
    }
    WhisperCppStt::try_load().map(|w| Box::new(w) as Box<dyn Stt>)
}

#[derive(Debug, Clone, Serialize)]
pub struct TalkLocalTtsResult {
    pub audio_base64: String,
    pub mime: String,
}

/// Helper extracted from `talk_local_tts` so the macOS fallback
/// branch can choose to try Sherpa first and fall through to
/// `MacosSayTts` cleanly without nested `?` matching.
async fn try_sherpa(text: &str) -> anyhow::Result<crate::talk::backend::TtsAudio> {
    use crate::talk::backend::Tts as _;
    #[cfg(feature = "talk-local")]
    {
        use crate::talk::tts_engine::SherpaEngine;
        static ENGINE: once_cell::sync::Lazy<anyhow::Result<SherpaEngine>> =
            once_cell::sync::Lazy::new(|| match SherpaEngine::try_load() {
                Ok(e) => {
                    tracing::info!(target: "talk.tts_engine", "in-process sherpa engine ready");
                    Ok(e)
                }
                Err(e) => {
                    tracing::warn!(target: "talk.tts_engine", error = %format!("{e:#}"), "in-process engine load failed");
                    Err(e)
                }
            });
        if let Ok(engine) = ENGINE.as_ref() {
            let speed = crate::ipc::voice::load_config().tts_speed;
            let speed = if speed < 0.5 || speed > 2.0 {
                1.0
            } else {
                speed
            };
            return engine.synthesize_with_speed(text, speed).await;
        }
    }
    let sherpa = SherpaTts::try_load()?;
    sherpa.synthesize(text).await
}

/// Run the platform's TTS fallback. macOS uses `/usr/bin/say`;
/// other platforms have no fallback — they expect Sherpa to work.
async fn fallback_synthesize(text: &str) -> IpcResult<crate::talk::backend::TtsAudio> {
    #[cfg(target_os = "macos")]
    {
        use crate::talk::backend::Tts as _;
        use crate::talk::tts::MacosSayTts;
        let say = MacosSayTts::new();
        say.synthesize(text).await.map_err(|e2| {
            tracing::warn!(
                target: "talk.tts",
                error = %format!("{e2:#}"),
                "macos-say fallback also failed"
            );
            IpcError::Internal {
                message: format!("sherpa failed and macos-say fallback also failed: {e2:#}"),
            }
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err(IpcError::Internal {
            message: "sherpa synthesize failed and no platform fallback available".into(),
        })
    }
}

#[tauri::command]
pub async fn talk_local_tts(text: String) -> IpcResult<TalkLocalTtsResult> {
    // Entry log so when the frontend says "TTS isn't playing"
    // we can immediately tell whether the IPC was reached at
    // all (vs. bailing on the JS side because localRoute.tts
    // was false / the sentence queue never enqueued / etc.).
    tracing::info!(
        target: "talk.tts",
        text_len = text.chars().count(),
        text_preview = %text.chars().take(40).collect::<String>(),
        "talk_local_tts invoked"
    );
    // Try Sherpa first when available; on macOS, fall back to the
    // OS-bundled `say` command if Sherpa fails. The first failure
    // flips a sticky flag so subsequent turns skip Sherpa entirely
    // — saves a 10s timeout per sentence on machines where the
    // model isn't installed yet (or some other persistent failure
    // mode like a corrupted ONNX file).
    let try_sherpa_path = !crate::talk::tts::sherpa_is_known_broken();
    let audio = if try_sherpa_path {
        match try_sherpa(&text).await {
            Ok(a) => a,
            Err(e) => {
                tracing::warn!(
                    target: "talk.tts",
                    error = %format!("{e:#}"),
                    text_len = text.chars().count(),
                    "sherpa synthesize failed; marking sherpa broken for the rest of this session and falling back to OS TTS"
                );
                crate::talk::tts::mark_sherpa_broken();
                fallback_synthesize(&text).await?
            }
        }
    } else {
        // Sherpa already known to be broken this session — go
        // straight to the fallback so the user doesn't eat
        // another 10s timeout per sentence.
        fallback_synthesize(&text).await?
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&audio.bytes);
    Ok(TalkLocalTtsResult {
        audio_base64: b64,
        mime: audio.mime.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `talk_session_status` must be safe to call before any
    /// session has ever been opened — this is the path the
    /// frontend hits on every renderer reload.
    #[tokio::test]
    async fn status_returns_inactive_on_cold_start() {
        let s = talk_session_status().await.expect("status");
        assert!(!s.active);
    }

    /// `talk_session_stop` is idempotent.
    #[tokio::test]
    async fn stop_is_safe_when_inactive() {
        talk_session_stop().await.expect("stop");
        talk_session_stop().await.expect("stop again");
    }
}
