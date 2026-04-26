//! Provider abstraction for ASR (speech-to-text) and TTS (text-to-speech).
//!
//! Each variant carries its own default endpoint, model, voices, and
//! capability flags (`has_asr`, `has_tts`). The IPC layer keeps a
//! per-side selection (asr_provider + tts_provider) so users can mix
//! e.g. Groq Whisper for ASR with OpenAI for TTS.
//!
//! Adding a new provider: implement every match arm and tick the
//! capability flags. Endpoints are URL strings (no Bearer token here —
//! the auth header is constructed in `voice_transcribe`/`voice_tts`).

use serde::{Deserialize, Serialize};

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
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Zhipu => "zhipu",
            Self::Groq => "groq",
            Self::Edge => "edge",
        }
    }

    pub fn all() -> &'static [Self] {
        &[Self::Openai, Self::Zhipu, Self::Groq, Self::Edge]
    }

    pub fn default_asr_endpoint(&self) -> &'static str {
        match self {
            Self::Openai => "https://api.openai.com/v1/audio/transcriptions",
            Self::Zhipu => "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions",
            Self::Groq => "https://api.groq.com/openai/v1/audio/transcriptions",
            Self::Edge => "",
        }
    }

    pub fn default_tts_endpoint(&self) -> Option<&'static str> {
        match self {
            Self::Openai => Some("https://api.openai.com/v1/audio/speech"),
            Self::Zhipu => Some("https://open.bigmodel.cn/api/paas/v4/audio/speech"),
            Self::Groq => None,
            Self::Edge => Some("http://localhost:5050/v1/audio/speech"),
        }
    }

    pub fn asr_model(&self) -> &'static str {
        match self {
            Self::Openai => "whisper-1",
            Self::Zhipu => "glm-asr-2512",
            Self::Groq => "whisper-large-v3",
            Self::Edge => "",
        }
    }

    pub fn tts_model(&self) -> &'static str {
        match self {
            Self::Openai => "tts-1",
            Self::Zhipu => "glm-tts",
            Self::Groq => "",
            Self::Edge => "tts-1",
        }
    }

    pub fn tts_voices(&self) -> &'static [&'static str] {
        match self {
            Self::Openai => &["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
            Self::Zhipu => &[
                "tongtong", "chuichui", "xiaochen", "jam", "kazi", "douji", "luodo",
            ],
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

    pub fn default_voice(&self) -> &'static str {
        match self {
            Self::Openai => "alloy",
            Self::Zhipu => "tongtong",
            Self::Groq => "",
            Self::Edge => "zh-CN-XiaoxiaoNeural",
        }
    }

    pub fn has_asr(&self) -> bool {
        !matches!(self, Self::Edge)
    }

    pub fn has_tts(&self) -> bool {
        !matches!(self, Self::Groq)
    }
}

/// Parse a string into a `VoiceProvider`. Falls back to the supplied
/// default when the string is missing or unrecognised — keeps the
/// IPC robust against stale frontend payloads or hand-edited
/// `voice.json` files.
pub fn parse_provider(s: &Option<String>, fallback: VoiceProvider) -> VoiceProvider {
    match s.as_deref() {
        Some("zhipu") => VoiceProvider::Zhipu,
        Some("groq") => VoiceProvider::Groq,
        Some("edge") => VoiceProvider::Edge,
        Some("openai") => VoiceProvider::Openai,
        _ => fallback,
    }
}
