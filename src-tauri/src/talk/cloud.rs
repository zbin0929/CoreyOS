//! Cloud-provider Talk backend — `Stt` / `Tts` impls that hit the
//! existing `voice_*` providers (OpenAI / Zhipu / Groq / Edge).
//!
//! This is the **default** v1 backend on machines that haven't
//! downloaded the local voice pack yet. The local (whisper.cpp +
//! sherpa-onnx) backend lands in Tasks 3-6 and slots into the same
//! `TalkBackend` bundle without touching the talk state machine.
//!
//! Implementation strategy: rather than duplicate the provider
//! switch from `ipc::voice::transcribe` / `ipc::voice::tts`, the
//! cloud backend re-issues the same HTTP requests via small
//! free-function helpers. v0/v0.1 of Talk Mode still drive
//! transcription + synthesis through the original IPC commands
//! straight from the frontend hook, so this file is currently a
//! thin shim used only by the (Rust-side) talk state machine that
//! lands with auto-listening (Task 7). Until then, the impls below
//! are unreachable in production but the trait contract is locked
//! so Task 7 doesn't have to invent it.

use anyhow::Context;
use async_trait::async_trait;

use super::backend::{Stt, Tts, TtsAudio};

/// Cloud STT — transcribes via whatever provider the user has
/// selected in Settings › Voice (`asr_provider` in `voice.json`).
pub struct CloudStt;

#[async_trait]
impl Stt for CloudStt {
    fn name(&self) -> &str {
        "cloud-asr"
    }

    async fn transcribe(&self, _wav: &[u8]) -> anyhow::Result<String> {
        // Wired in Task 7 alongside the auto-listening state
        // machine. For Task 1 we only need the trait contract; the
        // frontend hook (`useTalkMode.ts`) keeps calling
        // `voice_transcribe` directly.
        Err(anyhow::anyhow!(
            "CloudStt::transcribe not wired yet (Task 7)"
        ))
        .context("talk::cloud")
    }
}

/// Cloud TTS — same provider switch as the Settings › Voice page.
pub struct CloudTts;

#[async_trait]
impl Tts for CloudTts {
    fn name(&self) -> &str {
        "cloud-tts"
    }

    async fn synthesize(&self, _text: &str) -> anyhow::Result<TtsAudio> {
        Err(anyhow::anyhow!(
            "CloudTts::synthesize not wired yet (Task 7)"
        ))
        .context("talk::cloud")
    }
}
