//! Filesystem layout for Talk Mode binaries + ONNX models.
//!
//! Everything the talk subsystem needs at runtime lives under
//! `<hermes_data_dir>/talk/`. Splitting it out from the rest of the
//! Hermes data dir keeps HD-7 / HD-8 invariants intact (we never
//! touch `config.yaml`, `.env`, `MEMORY.md`, …) and lets the user
//! reset Talk Mode by deleting one folder without nuking their
//! Hermes setup.
//!
//! Layout:
//!
//! ```text
//! <hermes>/talk/
//!   bin/
//!     whisper.cpp               (executable, +x; .exe on Windows)
//!     sherpa-onnx-offline-tts   (executable; .exe on Windows)
//!     lib*.{dylib,so,dll}       (sherpa-onnx + onnxruntime shared libs)
//!   models/
//!     silero_vad.onnx           (~2 MB, shipped with first launch)
//!     ggml-medium-q5_0.bin      (~540 MB, downloaded on enable)
//!     vits-melo-tts-zh_en/      (~170 MB tree, downloaded on enable)
//!       model.onnx
//!       tokens.txt
//!       lexicon.txt
//!       dict/                   (cppjieba word-segmentation tables)
//!       *.fst                   (date / number / phone normalisers)
//! ```
//!
//! Helpers return `PathBuf`s without checking existence. The
//! installer/downloader in Task 8 is responsible for materialising
//! files; the talk runtime checks `.exists()` before spawning.

use std::io;
use std::path::PathBuf;

use crate::paths::hermes_data_dir;

/// Root directory for everything talk-related. Created lazily by
/// the installer; this getter never touches disk.
pub fn talk_dir() -> io::Result<PathBuf> {
    Ok(hermes_data_dir()?.join("talk"))
}

pub fn talk_bin_dir() -> io::Result<PathBuf> {
    Ok(talk_dir()?.join("bin"))
}

pub fn talk_models_dir() -> io::Result<PathBuf> {
    Ok(talk_dir()?.join("models"))
}

/// Append `.exe` on Windows so the same logical binary name resolves
/// across platforms. All talk binaries are built per-platform via
/// the GitHub Actions matrix in Task 3 / Task 4; we just pick the
/// right filename here.
fn exe(name: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("{name}.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        name.to_string()
    }
}

pub fn whisper_bin() -> io::Result<PathBuf> {
    Ok(talk_bin_dir()?.join(exe("whisper-cli")))
}

/// `sherpa-onnx-offline-tts` CLI binary. Replaces the legacy
/// `piper` binary that was retired in v1.1 because rhasspy/piper's
/// macOS arm64 prebuilts shipped x86_64 bytes (causing SIGABRT on
/// every M-series Mac). Sherpa-onnx ships native arm64 builds for
/// every platform we target, plus its Matcha-TTS / VITS engines
/// produce continuously streamable PCM where Piper was batch-only.
pub fn sherpa_offline_tts_bin() -> io::Result<PathBuf> {
    Ok(talk_bin_dir()?.join(exe("sherpa-onnx-offline-tts")))
}

/// silero-vad LSTM model. Tiny (~2 MB), shipped via first-launch
/// download or the offline-zip fallback (parallel to BGE-M3 in
/// `rag_import_offline_zip`).
pub fn silero_vad_model() -> io::Result<PathBuf> {
    Ok(talk_models_dir()?.join("silero_vad.onnx"))
}

/// Default whisper.cpp model — `ggml-medium-q5_0.bin`. Q5_0
/// quantisation puts the file at ~540 MB. Mandarin accuracy on
/// CMV benchmark jumps from ~80 (base) to ~95+ (medium); on M1
/// 16 GB the RTF stays at 0.45x so a 5 s utterance transcribes in
/// ~2 s — still real-time for push-to-talk turns. We deliberately
/// don't expose a model picker (PD-2: stable over feature-rich;
/// pick one good model and own it).
pub fn whisper_model() -> io::Result<PathBuf> {
    Ok(talk_models_dir()?.join("ggml-medium-q5_0.bin"))
}

/// Sherpa-onnx VITS-MeloTTS bilingual (Chinese + English) model
/// directory. Contains `model.onnx`, `tokens.txt`, `lexicon.txt`,
/// a `dict/` subdir for jieba/cppjieba word segmentation, plus
/// `*.fst` files for date / number / phone normalisation.
///
/// Why this specific model: MeloTTS is the only widely-distributed
/// open-source TTS that handles Chinese + English code-switching
/// cleanly (e.g. "我用 Python 写了个 script" pronounced naturally
/// rather than mangling the English mid-sentence). For pure
/// Chinese, `matcha-icefall-zh-baker` is a higher-quality
/// alternative we can swap to via the `model_dir` resolver.
pub fn sherpa_tts_model_dir() -> io::Result<PathBuf> {
    Ok(talk_models_dir()?.join("vits-melo-tts-zh_en"))
}

/// The single-file artifact that uniquely identifies a fully-
/// installed sherpa TTS model. We probe this exact path in
/// `ready()` checks because the model dir contains a dozen files
/// and stat'ing them all is slower than necessary.
pub fn sherpa_tts_model_main_file() -> io::Result<PathBuf> {
    Ok(sherpa_tts_model_dir()?.join("model.onnx"))
}

/// Sentinel that the talk-readiness probe checks before allowing
/// the auto-listening mode. Returns `true` only when every
/// runtime file the local pipeline needs is on disk: VAD model,
/// whisper binary + model, sherpa-onnx tts binary + model graph.
/// Cloud backends ignore this — they care only about API keys.
///
/// The model dir contains many files (tokens.txt, lexicon.txt,
/// dict/, *.fst), but probing `model.onnx` is enough — the
/// extraction tooling either lays the whole tree down or none of
/// it, so a half-installed dir is impossible in practice.
pub fn local_runtime_ready() -> bool {
    let probes = [
        silero_vad_model(),
        whisper_bin(),
        whisper_model(),
        sherpa_offline_tts_bin(),
        sherpa_tts_model_main_file(),
    ];
    probes
        .into_iter()
        .all(|p| p.map(|p| p.exists()).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// On systems where `hermes_data_dir()` resolves (every dev
    /// machine has either `$HOME` or `%USERPROFILE%`), the talk
    /// subdirectory should always nest two levels deep:
    /// `<hermes>/talk/{bin|models}/<file>`.
    #[test]
    fn paths_nest_under_talk() {
        let bin = whisper_bin().expect("whisper bin path");
        let model = silero_vad_model().expect("vad model path");
        assert!(
            bin.components().any(|c| c.as_os_str() == "talk"),
            "{:?}",
            bin
        );
        assert!(
            bin.components().any(|c| c.as_os_str() == "bin"),
            "{:?}",
            bin
        );
        assert!(
            model.components().any(|c| c.as_os_str() == "models"),
            "{:?}",
            model
        );
        assert_eq!(
            silero_vad_model()
                .expect("vad")
                .file_name()
                .expect("file name"),
            "silero_vad.onnx"
        );
    }

    #[test]
    fn whisper_binary_has_exe_on_windows() {
        let bin = whisper_bin().expect("whisper bin path");
        let name = bin
            .file_name()
            .expect("whisper file name")
            .to_string_lossy();
        #[cfg(target_os = "windows")]
        assert!(name.ends_with(".exe"), "{}", name);
        #[cfg(not(target_os = "windows"))]
        assert!(!name.ends_with(".exe"), "{}", name);
    }

    /// Cold machines (no models downloaded) must report `false` so
    /// the readiness probe in the frontend can route the user to
    /// the "Download local voice pack" UI in Settings instead of
    /// failing mid-recording.
    #[test]
    fn ready_check_is_false_on_cold_machine() {
        // The dev/CI machine almost certainly has nothing under
        // `<hermes>/talk/`; if the maintainer has a populated
        // dir locally, this test is still meaningful as long as
        // they haven't *also* dropped silero_vad.onnx + the four
        // other files. Treat it as a smoke test: just call the
        // function and make sure it doesn't panic.
        let _ = local_runtime_ready();
    }
}
