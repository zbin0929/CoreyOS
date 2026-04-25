//! Voice IPC — T8.1 (ASR) + T8.2 (TTS) + T8.5 (audit log).
//!
//! Multi-provider support: OpenAI, Zhipu (智谱), Groq.
//! The user picks a provider in Settings → Voice; the backend routes
//! to the correct endpoint and adapts the request/response format.

use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::fs_atomic;
use crate::state::AppState;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};

// ───────────────────────── Provider ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VoiceProvider {
    #[default]
    Openai,
    Zhipu,
    Groq,
    Edge,
}

impl VoiceProvider {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Zhipu => "zhipu",
            Self::Groq => "groq",
            Self::Edge => "edge",
        }
    }

    fn all() -> &'static [Self] {
        &[Self::Openai, Self::Zhipu, Self::Groq, Self::Edge]
    }

    fn default_asr_endpoint(&self) -> &'static str {
        match self {
            Self::Openai => "https://api.openai.com/v1/audio/transcriptions",
            Self::Zhipu => "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions",
            Self::Groq => "https://api.groq.com/openai/v1/audio/transcriptions",
            Self::Edge => "",
        }
    }

    fn default_tts_endpoint(&self) -> Option<&'static str> {
        match self {
            Self::Openai => Some("https://api.openai.com/v1/audio/speech"),
            Self::Zhipu => Some("https://open.bigmodel.cn/api/paas/v4/audio/speech"),
            Self::Groq => None,
            Self::Edge => Some("http://localhost:5050/v1/audio/speech"),
        }
    }

    fn asr_model(&self) -> &'static str {
        match self {
            Self::Openai => "whisper-1",
            Self::Zhipu => "glm-asr-2512",
            Self::Groq => "whisper-large-v3",
            Self::Edge => "",
        }
    }

    fn tts_model(&self) -> &'static str {
        match self {
            Self::Openai => "tts-1",
            Self::Zhipu => "glm-tts",
            Self::Groq => "",
            Self::Edge => "tts-1",
        }
    }

    fn tts_voices(&self) -> &'static [&'static str] {
        match self {
            Self::Openai => &["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
            Self::Zhipu => &["tongtong", "xiaochen", "chuichui", "jamka", "zidou", "jiluo"],
            Self::Groq => &[],
            Self::Edge => &[
                "zh-CN-XiaoxiaoNeural",
                "zh-CN-YunyangNeural",
                "zh-CN-YunxiNeural",
                "zh-CN-XiaohanNeural",
                "en-US-AvaNeural",
                "en-US-AndrewNeural",
            ],
        }
    }

    fn default_voice(&self) -> &'static str {
        match self {
            Self::Openai => "alloy",
            Self::Zhipu => "tongtong",
            Self::Groq => "",
            Self::Edge => "zh-CN-XiaoxiaoNeural",
        }
    }

    fn has_asr(&self) -> bool {
        !matches!(self, Self::Edge)
    }

    fn has_tts(&self) -> bool {
        !matches!(self, Self::Groq)
    }
}

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
    pub audio_base64: String,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceConfig {
    pub asr_provider: String,
    pub tts_provider: String,
    pub asr_endpoint: Option<String>,
    pub asr_api_key_set: bool,
    pub tts_endpoint: Option<String>,
    pub tts_api_key_set: bool,
    pub tts_voice: String,
    pub tts_speed: f32,
    pub hotkey: String,
    pub available_asr_providers: Vec<String>,
    pub available_tts_providers: Vec<String>,
    pub asr_voices: Vec<String>,
    pub tts_voices: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VoiceConfigUpdate {
    pub asr_provider: Option<String>,
    pub asr_endpoint: Option<String>,
    pub asr_api_key: Option<String>,
    pub tts_provider: Option<String>,
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
    asr_provider: Option<String>,
    #[serde(default)]
    asr_endpoint: Option<String>,
    #[serde(default)]
    asr_api_key: Option<String>,
    #[serde(default)]
    tts_provider: Option<String>,
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

fn parse_provider(s: &Option<String>, fallback: VoiceProvider) -> VoiceProvider {
    match s.as_deref() {
        Some("zhipu") => VoiceProvider::Zhipu,
        Some("groq") => VoiceProvider::Groq,
        Some("edge") => VoiceProvider::Edge,
        Some("openai") => VoiceProvider::Openai,
        _ => fallback,
    }
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
    let provider = parse_provider(&cfg.asr_provider, VoiceProvider::Openai);
    let endpoint = cfg
        .asr_endpoint
        .unwrap_or_else(|| provider.default_asr_endpoint().to_owned());
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
    let file_name = if mime.contains("wav") {
        "audio.wav"
    } else if mime.contains("mp3") || mime.contains("mpeg") {
        "audio.mp3"
    } else {
        "audio.webm"
    };

    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(file_name)
        .mime_str(&mime)
        .map_err(|e| IpcError::Internal {
            message: format!("mime: {e}"),
        })?;

    let model = provider.asr_model().to_owned();

    let form = match provider {
        VoiceProvider::Zhipu => reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", model),
        _ => reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", model)
            .text("response_format", "verbose_json"),
    };

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
        write_audit("voice.transcribe", provider.as_str(), duration, false);
        return Err(IpcError::Internal {
            message: format!("ASR API error {}: {}", status, &body[..body.len().min(500)]),
        });
    }

    let text = match provider {
        VoiceProvider::Zhipu => {
            #[derive(Deserialize)]
            struct ZhipuAsrResponse {
                text: Option<String>,
                choices: Option<Vec<ZhipuChoice>>,
            }
            #[derive(Deserialize)]
            struct ZhipuChoice {
                message: ZhipuMessage,
            }
            #[derive(Deserialize)]
            struct ZhipuMessage {
                content: String,
            }
            let parsed: ZhipuAsrResponse =
                serde_json::from_str(&body).map_err(|e| IpcError::Internal {
                    message: format!("ASR parse (zhipu): {e}"),
                })?;
            if let Some(t) = parsed.text {
                t
            } else {
                parsed
                    .choices
                    .unwrap_or_default()
                    .into_iter()
                    .next()
                    .map(|c| c.message.content)
                    .unwrap_or_default()
            }
        }
        _ => {
            #[derive(Deserialize)]
            struct WhisperResponse {
                text: String,
            }
            let parsed: WhisperResponse =
                serde_json::from_str(&body).map_err(|e| IpcError::Internal {
                    message: format!("ASR parse: {e}"),
                })?;
            parsed.text
        }
    };

    write_audit("voice.transcribe", provider.as_str(), duration, true);

    Ok(VoiceTranscribeResult {
        text,
        language: None,
        duration_ms: Some(duration),
    })
}

// ───────────────────────── T8.2: TTS ─────────────────────────

#[tauri::command]
pub async fn voice_tts(
    _state: State<'_, AppState>,
    text: String,
) -> IpcResult<VoiceTtsResult> {
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
    let speed = if cfg.tts_speed <= 0.0 || cfg.tts_speed > 4.0 {
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
                response_format: "mp3".into(),
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
            message: format!("TTS API error {}: {}", status, &err_body[..err_body.len().min(500)]),
        });
    }

    let audio_bytes = resp.bytes().await.map_err(|e| IpcError::Internal {
        message: format!("TTS read body: {e}"),
    })?;

    let ext = match provider {
        VoiceProvider::Zhipu => "mp3",
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

    let b64 = base64::engine::general_purpose::STANDARD.encode(&audio_bytes);
    let mime = match provider {
        VoiceProvider::Zhipu => "audio/mpeg",
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

// ───────────────────────── Config CRUD ─────────────────────────

#[tauri::command]
pub async fn voice_get_config() -> IpcResult<VoiceConfig> {
    let cfg = load_config();
    let asr_p = parse_provider(&cfg.asr_provider, VoiceProvider::Openai);
    let tts_p = parse_provider(&cfg.tts_provider, VoiceProvider::Openai);
    let tts_voice = if tts_p.tts_voices().contains(&cfg.tts_voice.as_str()) {
        cfg.tts_voice.clone()
    } else {
        tts_p.default_voice().to_owned()
    };
    let tts_speed = if cfg.tts_speed <= 0.0 || cfg.tts_speed > 4.0 {
        1.0
    } else {
        cfg.tts_speed
    };
    Ok(VoiceConfig {
        asr_provider: asr_p.as_str().to_owned(),
        tts_provider: tts_p.as_str().to_owned(),
        asr_endpoint: cfg.asr_endpoint,
        asr_api_key_set: !cfg.asr_api_key.unwrap_or_default().is_empty(),
        tts_endpoint: cfg.tts_endpoint,
        tts_api_key_set: !cfg.tts_api_key.unwrap_or_default().is_empty(),
        tts_voice,
        tts_speed,
        hotkey: cfg.hotkey,
        available_asr_providers: VoiceProvider::all()
            .iter()
            .filter(|p| p.has_asr())
            .map(|p| p.as_str().to_owned())
            .collect(),
        available_tts_providers: VoiceProvider::all()
            .iter()
            .filter(|p| p.has_tts())
            .map(|p| p.as_str().to_owned())
            .collect(),
        asr_voices: Vec::new(),
        tts_voices: tts_p.tts_voices().iter().map(|s| s.to_string()).collect(),
    })
}

#[tauri::command]
pub async fn voice_set_config(args: VoiceConfigUpdate) -> IpcResult<()> {
    let mut cfg = load_config();
    if let Some(v) = args.asr_provider {
        let p = parse_provider(&Some(v), VoiceProvider::Openai);
        cfg.asr_provider = Some(p.as_str().to_owned());
        if cfg.asr_endpoint.is_none() {
            cfg.asr_endpoint = None;
        }
    }
    if let Some(v) = args.asr_endpoint {
        cfg.asr_endpoint = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = args.asr_api_key {
        cfg.asr_api_key = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = args.tts_provider {
        let p = parse_provider(&Some(v), VoiceProvider::Openai);
        cfg.tts_provider = Some(p.as_str().to_owned());
        if cfg.tts_endpoint.is_none() {
            cfg.tts_endpoint = None;
        }
        let default_v = p.default_voice().to_owned();
        if !p.tts_voices().contains(&cfg.tts_voice.as_str()) {
            cfg.tts_voice = default_v;
        }
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

// ───────────────────────── System-level recording ─────────────────────────

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

    let wav_bytes = rx.await.map_err(|e| {
        RECORDING_ACTIVE.store(false, Ordering::SeqCst);
        IpcError::Internal {
            message: format!("recording thread panicked: {e}"),
        }
    })?.map_err(|msg| {
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
    let config = device.default_input_config().map_err(|e| format!("input_config:{e}"))?;

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
    }.map_err(|e| format!("stream_build:{e}"))?;

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
        let mut writer = hound::WavWriter::new(&mut wav_buf, spec).map_err(|e| format!("wav_writer:{e}"))?;
        for &s in &all_samples {
            let val = (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32);
            writer.write_sample(val as i16).map_err(|e| format!("wav_write:{e}"))?;
        }
        writer.finalize().map_err(|e| format!("wav_finalize:{e}"))?;
    }

    Ok(wav_buf.into_inner())
}
