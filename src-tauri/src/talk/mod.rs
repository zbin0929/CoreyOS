// CI runs clippy with `-D warnings`. Until Task 7 wires the talk
// state machine into the IPC layer, every public item in this
// subtree is "never used" by the default-features build. Allow
// dead code at the module root rather than scatter `#[allow]` on
// each item — the API surface is intentional and locked.
#![allow(dead_code)]

//! B-8 Talk Mode v1 — backend abstraction.
//!
//! v0 / v0.1 of Talk Mode lived entirely in the frontend hook
//! `useTalkMode.ts` and reused the existing `voice_*` IPC commands
//! (which target cloud STT/TTS providers). v1 introduces a Rust-side
//! backend layer so we can add silero-vad, whisper.cpp, and
//! sherpa-onnx incrementally without touching the chat /
//! persistence wiring.
//!
//! Module map (all sub-modules are `pub` so `lib.rs` can register
//! `#[tauri::command]` helpers — Tauri's `__cmd__<name>` glue does
//! not follow `pub use` re-exports):
//!
//! - [`backend`] — `Stt` / `Tts` / `Vad` traits + `TalkBackend` bundle
//! - [`paths`] — filesystem layout for talk binaries + ONNX models
//!   (`<hermes>/talk/{bin,models}/…`), cross-platform
//! - [`cloud`] — `Stt`/`Tts` impls that delegate to the existing cloud
//!   `voice_*` providers (used as the v0 fallback backend until
//!   sherpa-onnx / whisper.cpp ship)
//! - [`vad`] — silero-vad ONNX integration (Task 2)
//!
//! Crate-internal contract: the talk subsystem **never** writes to
//! Hermes shared files (config.yaml, .env, MEMORY.md). It only owns
//! `<hermes>/talk/` (bin + models + cache). That keeps HD-7 and HD-8
//! invariants intact when Hermes upgrades.

pub mod backend;
pub mod cloud;
pub mod download;
pub mod paths;
pub mod session;
pub mod stt;
pub mod tts;
#[cfg(feature = "talk-local")]
pub mod tts_engine;
pub mod vad;
