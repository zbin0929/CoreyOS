//! Voice IPC — T8.1 (ASR) + T8.2 (TTS) + T8.5 (audit log).
//!
//! Push-to-talk flow:
//!   1. Frontend captures audio via MediaRecorder → base64
//!   2. `voice_transcribe` IPC sends audio to configured ASR endpoint
//!   3. Returns transcribed text → user confirms → sends as chat message
//!
//! TTS flow:
//!   1. `voice_tts` IPC sends text to configured TTS endpoint
//!   2. Returns audio bytes → frontend plays via <audio> element
//!
//! Audit: every voice IPC call logs to changelog.jsonl for privacy transparency.

use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::fs_atomic;
use crate::state::AppState;

// ───────────────────────── Types ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct VoiceTranscribeResult {
    pub text: String,
    pub language: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceTtsResult {
    pub audio_path: String,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceConfig {
    pub asr_endpoint: Option<String>,
    pub asr_api_key_set: bool,
    pub tts_endpoint: Option<String>,
    pub tts_api_key_set: bool,
    pub tts_voice: String,
    pub tts_speed: f32,
    pub hotkey: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VoiceConfigUpdate {
    pub asr_endpoint: Option<String>,
    pub asr_api_key: Option<String>,
    pub tts_endpoint: Option<String>,
    pub tts_api_key: Option<String>,
    pub tts_voice: Option<String>,
    pub tts_speed: Option<f32>,
    pub hotkey: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceAuditEntry {
    pub event_type: String,
    pub timestamp: i64,
    pub provider: String,
    pub duration_ms: u64,
    pub success: bool,
}

// ───────────────────────── Config ─────────────────────────

fn voice_config_path() -> std::io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no HOME"))?;
    Ok(PathBuf::from(home).join(".hermes").join("voice.json"))
}

fn audit_dir() -> std::io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no HOME"))?;
    let dir = PathBuf::from(home).join(".hermes").join("voice_audit");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct VoiceConfigFile {
    #[serde(default)]
    asr_endpoint: Option<String>,
    #[serde(default)]
    asr_api_key: Option<String>,
    #[serde(default)]
    tts_endpoint: Option<String>,
    #[serde(default)]
    tts_api_key: Option<String>,
    #[serde(default = "default_voice")]
    tts_voice: String,
    #[serde(default = "default_speed")]
    tts_speed: f32,
    #[serde(default = "default_hotkey")]
    hotkey: String,
}

fn default_voice() -> String {
    "alloy".into()
}

fn default_speed() -> f32 {
    1.0
}

fn default_hotkey() -> String {
    "Meta+Space".into()
}

fn load_config() -> VoiceConfigFile {
    let path = match voice_config_path() {
        Ok(p) => p,
        Err(_) => return VoiceConfigFile::default(),
    };
    if !path.exists() {
        return VoiceConfigFile::default();
    }
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_config(cfg: &VoiceConfigFile) -> std::io::Result<()> {
    let path = voice_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_string_pretty(cfg)?;
    fs_atomic::atomic_write(&path, data.as_bytes(), None)?;
    Ok(())
}

fn write_audit(event_type: &str, provider: &str, duration_ms: u64, success: bool) {
    let now = chrono::Utc::now().timestamp();
    let entry = VoiceAuditEntry {
        event_type: event_type.into(),
        timestamp: now,
        provider: provider.into(),
        duration_ms,
        success,
    };
    if let Ok(dir) = audit_dir() {
        let filename = format!("{}.jsonl", chrono::Utc::now().format("%Y-%m-%d"));
        let line = match serde_json::to_string(&entry) {
            Ok(s) => s,
            Err(_) => return,
        };
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(filename))
        {
            let _ = writeln!(f, "{}", line);
        }
    }
}

// ───────────────────────── T8.1: ASR ─────────────────────────

#[tauri::command]
pub async fn voice_transcribe(
    _state: State<'_, AppState>,
    audio_base64: String,
    mime: String,
) -> IpcResult<VoiceTranscribeResult> {
    let cfg = load_config();
    let endpoint = cfg.asr_endpoint.unwrap_or_else(|| {
        "https://api.openai.com/v1/audio/transcriptions".into()
    });
    let api_key = cfg.asr_api_key.unwrap_or_default();
    if api_key.is_empty() {
        return Err(IpcError::Internal {
            message: "ASR API key not configured. Open Settings › Voice to set it.".into(),
        });
    }

    let start = std::time::Instant::now();
    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64)
        .map_err(|e| IpcError::Internal {
            message: format!("base64 decode: {e}"),
        })?;

    let client = reqwest::Client::new();
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("audio.webm")
        .mime_str(&mime)
        .map_err(|e| IpcError::Internal {
            message: format!("mime: {e}"),
        })?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-1")
        .text("response_format", "verbose_json");

    let resp = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {api_key}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("ASR request failed: {e}"),
        })?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| IpcError::Internal {
        message: format!("ASR read body: {e}"),
    })?;

    let duration = start.elapsed().as_millis() as u64;

    if !status.is_success() {
        write_audit("voice.transcribe", &endpoint, duration, false);
        return Err(IpcError::Internal {
            message: format!("ASR API error {}: {}", status, &body[..body.len().min(500)]),
        });
    }

    #[derive(Deserialize)]
    struct WhisperResponse {
        text: String,
        language: Option<String>,
        duration: Option<f64>,
    }

    let parsed: WhisperResponse = serde_json::from_str(&body).map_err(|e| IpcError::Internal {
        message: format!("ASR parse: {e}"),
    })?;

    write_audit("voice.transcribe", &endpoint, duration, true);

    Ok(VoiceTranscribeResult {
        text: parsed.text,
        language: parsed.language,
        duration_ms: parsed.duration.map(|d| (d * 1000.0) as u64),
    })
}

// ───────────────────────── T8.2: TTS ─────────────────────────

#[tauri::command]
pub async fn voice_tts(
    _state: State<'_, AppState>,
    text: String,
) -> IpcResult<VoiceTtsResult> {
    let cfg = load_config();
    let endpoint = cfg.tts_endpoint.unwrap_or_else(|| {
        "https://api.openai.com/v1/audio/speech".into()
    });
    let api_key = cfg.tts_api_key.unwrap_or_default();
    if api_key.is_empty() {
        return Err(IpcError::Internal {
            message: "TTS API key not configured. Open Settings › Voice to set it.".into(),
        });
    }

    let start = std::time::Instant::now();

    #[derive(Serialize)]
    struct TtsRequest {
        model: String,
        input: String,
        voice: String,
        speed: f32,
    }

    let body = TtsRequest {
        model: "tts-1".into(),
        input: text,
        voice: cfg.tts_voice.clone(),
        speed: cfg.tts_speed,
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {api_key}"))
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
        write_audit("voice.tts", &endpoint, duration, false);
        return Err(IpcError::Internal {
            message: format!("TTS API error {}: {}", status, &err_body[..err_body.len().min(500)]),
        });
    }

    let audio_bytes = resp.bytes().await.map_err(|e| IpcError::Internal {
        message: format!("TTS read body: {e}"),
    })?;

    let cache_dir = std::env::temp_dir().join("corey-tts");
    std::fs::create_dir_all(&cache_dir).map_err(|e| IpcError::Internal {
        message: format!("create tts cache dir: {e}"),
    })?;

    let filename = format!("tts_{}.mp3", chrono::Utc::now().timestamp_millis());
    let audio_path = cache_dir.join(&filename);
    std::fs::write(&audio_path, &audio_bytes).map_err(|e| IpcError::Internal {
        message: format!("write tts audio: {e}"),
    })?;

    write_audit("voice.tts", &endpoint, duration, true);

    Ok(VoiceTtsResult {
        audio_path: audio_path.to_string_lossy().to_string(),
        duration_ms: Some(duration),
    })
}

// ───────────────────────── Config CRUD ─────────────────────────

#[tauri::command]
pub async fn voice_get_config() -> IpcResult<VoiceConfig> {
    let cfg = load_config();
    Ok(VoiceConfig {
        asr_endpoint: cfg.asr_endpoint,
        asr_api_key_set: !cfg.asr_api_key.unwrap_or_default().is_empty(),
        tts_endpoint: cfg.tts_endpoint,
        tts_api_key_set: !cfg.tts_api_key.unwrap_or_default().is_empty(),
        tts_voice: cfg.tts_voice,
        tts_speed: cfg.tts_speed,
        hotkey: cfg.hotkey,
    })
}

#[tauri::command]
pub async fn voice_set_config(args: VoiceConfigUpdate) -> IpcResult<()> {
    let mut cfg = load_config();
    if let Some(v) = args.asr_endpoint {
        cfg.asr_endpoint = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = args.asr_api_key {
        cfg.asr_api_key = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = args.tts_endpoint {
        cfg.tts_endpoint = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = args.tts_api_key {
        cfg.tts_api_key = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = args.tts_voice {
        cfg.tts_voice = v;
    }
    if let Some(v) = args.tts_speed {
        cfg.tts_speed = v;
    }
    if let Some(v) = args.hotkey {
        cfg.hotkey = v;
    }
    save_config(&cfg).map_err(|e| IpcError::Internal {
        message: format!("save voice config: {e}"),
    })
}

// ───────────────────────── T8.5: Audit log ─────────────────────────

#[tauri::command]
pub async fn voice_audit_log(
    _state: State<'_, AppState>,
    limit: Option<u32>,
) -> IpcResult<Vec<VoiceAuditEntry>> {
    let lim = limit.unwrap_or(50).min(200) as usize;
    let dir = match audit_dir() {
        Ok(d) => d,
        Err(_) => return Ok(Vec::new()),
    };

    let mut entries = Vec::new();
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();

    files.sort_by_key(|b| std::cmp::Reverse(b.file_name()));

    for file in files {
        if entries.len() >= lim {
            break;
        }
        if let Ok(content) = std::fs::read_to_string(file.path()) {
            for line in content.lines().rev() {
                if entries.len() >= lim {
                    break;
                }
                if let Ok(entry) = serde_json::from_str::<VoiceAuditEntry>(line) {
                    entries.push(entry);
                }
            }
        }
    }

    entries.sort_by_key(|b| std::cmp::Reverse(b.timestamp));
    entries.truncate(lim);
    Ok(entries)
}
