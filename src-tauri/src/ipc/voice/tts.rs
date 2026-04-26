//! T8.2 — TTS handler. Split out of `mod.rs` so the file stays under
//! the project's size guideline; the multi-provider switch is the
//! bulk of the file.

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

use super::provider::{parse_provider, VoiceProvider};
use super::recorder::pcm_to_wav;
use super::{load_config, write_audit, VoiceTtsResult};

// ───────────────────────── T8.2: TTS ─────────────────────────

#[tauri::command]
pub async fn voice_tts(_state: State<'_, AppState>, text: String) -> IpcResult<VoiceTtsResult> {
    let cfg = load_config();
    let provider = parse_provider(&cfg.tts_provider, VoiceProvider::Openai);
    let default_ep = provider.default_tts_endpoint().map(str::to_owned);
    let endpoint = cfg.tts_endpoint.or(default_ep).unwrap_or_default();
    if endpoint.is_empty() {
        return Err(IpcError::Internal {
            message: "TTS is not available for the selected provider. Switch to OpenAI or Zhipu in Settings › Voice.".into(),
        });
    }
    let api_key = cfg.tts_api_key.unwrap_or_default();
    if api_key.is_empty() && !matches!(provider, VoiceProvider::Edge) {
        return Err(IpcError::Internal {
            message: "TTS API key not configured. Open Settings › Voice to set it.".into(),
        });
    }
    let auth_header = if api_key.is_empty() {
        None
    } else {
        Some(format!("Bearer {api_key}"))
    };

    let start = std::time::Instant::now();

    let voice = if provider.tts_voices().contains(&cfg.tts_voice.as_str()) {
        cfg.tts_voice.clone()
    } else {
        provider.default_voice().to_owned()
    };
    let speed = if cfg.tts_speed < 0.5 || cfg.tts_speed > 2.0 {
        1.0
    } else {
        cfg.tts_speed
    };

    let body = match provider {
        VoiceProvider::Zhipu => {
            #[derive(Serialize)]
            struct ZhipuTtsReq {
                model: String,
                input: String,
                voice: String,
                speed: f32,
                response_format: String,
            }
            serde_json::to_value(ZhipuTtsReq {
                model: provider.tts_model().to_owned(),
                input: text,
                voice,
                speed,
                response_format: "pcm".into(),
            })
            .map_err(|e| IpcError::Internal {
                message: format!("TTS serialize: {e}"),
            })?
        }
        _ => {
            #[derive(Serialize)]
            struct OpenaiTtsReq {
                model: String,
                input: String,
                voice: String,
                speed: f32,
            }
            serde_json::to_value(OpenaiTtsReq {
                model: provider.tts_model().to_owned(),
                input: text,
                voice,
                speed,
            })
            .map_err(|e| IpcError::Internal {
                message: format!("TTS serialize: {e}"),
            })?
        }
    };

    let client = reqwest::Client::new();
    let mut req = client.post(&endpoint);
    if let Some(ref h) = auth_header {
        req = req.header("Authorization", h);
    }
    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("TTS request failed: {e}"),
        })?;

    let status = resp.status();
    let duration = start.elapsed().as_millis() as u64;

    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        write_audit("voice.tts", provider.as_str(), duration, false);
        return Err(IpcError::Internal {
            message: format!(
                "TTS API error {}: {}",
                status,
                &err_body[..err_body.len().min(500)]
            ),
        });
    }

    let audio_bytes = resp.bytes().await.map_err(|e| IpcError::Internal {
        message: format!("TTS read body: {e}"),
    })?;

    let ext = match provider {
        VoiceProvider::Zhipu => "wav",
        _ => "mp3",
    };
    let cache_dir = std::env::temp_dir().join("corey-tts");
    std::fs::create_dir_all(&cache_dir).map_err(|e| IpcError::Internal {
        message: format!("create tts cache dir: {e}"),
    })?;

    let filename = format!("tts_{}.{ext}", chrono::Utc::now().timestamp_millis());
    let audio_path = cache_dir.join(&filename);
    std::fs::write(&audio_path, &audio_bytes).map_err(|e| IpcError::Internal {
        message: format!("write tts audio: {e}"),
    })?;

    let audio_bytes = match provider {
        VoiceProvider::Zhipu => pcm_to_wav(&audio_bytes).unwrap_or_else(|_| audio_bytes.to_vec()),
        _ => audio_bytes.to_vec(),
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&audio_bytes);
    let mime = match provider {
        VoiceProvider::Zhipu => "audio/wav",
        _ => "audio/mpeg",
    };
    let audio_base64 = format!("data:{mime};base64,{b64}");

    write_audit("voice.tts", provider.as_str(), duration, true);

    Ok(VoiceTtsResult {
        audio_path: audio_path.to_string_lossy().to_string(),
        audio_base64,
        duration_ms: Some(duration),
    })
}
