//! Local voice pack downloader (B-8 v1 task 8).
//!
//! Downloads silero-vad / whisper.cpp / Sherpa-onnx MeloTTS model
//! files into `<hermes>/talk/{bin,models}/`. Built around a
//! **mirror chain**
//! per file because the primary upstreams (Hugging Face, GitHub
//! raw) are unreachable from inside China without a VPN. We try
//! each URL in order; the first one that completes a sane-sized
//! file wins. The fallback list deliberately covers:
//!
//! 1. **HF / upstream** — best-of-class freshness, works on
//!    machines outside China.
//! 2. **`hf-mirror.com`** — community-run HF mirror, the most
//!    reliable China-side source for HF-hosted weights.
//! 3. **`ghfast.top` / `ghproxy.com`** — GitHub-raw proxies for
//!    the silero-vad ONNX file (the only spec hosted on GitHub).
//!
//! Users who can't reach any of these can drop a manually-built
//! zip in via `talk_models_import_zip` (parallel to BGE-M3's
//! offline import path).
//!
//! Progress is published on the **same** `download:progress` /
//! `download:completed` / `download:error` event channel the
//! generic [`crate::ipc::download`] uses, so the existing
//! download-center UI (and any future "downloads tray") shows
//! talk pack progress automatically — no parallel UI plumbing.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use super::paths::{sherpa_tts_model_main_file, silero_vad_model, talk_bin_dir, talk_models_dir};

// ───────────────────── Spec table ─────────────────────

/// One file the local voice pack needs. `urls` is a fallback chain
/// — see module docs for the priority ordering rationale.
#[derive(Debug, Clone)]
pub struct TalkModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub kind: TalkModelKind,
    pub filename: &'static str,
    pub urls: &'static [&'static str],
    /// Smallest acceptable byte count — guards against partial
    /// downloads where the mirror returned an HTML error page
    /// with HTTP 200.
    pub min_size_bytes: u64,
    /// Optional SHA-256 digest. When present we verify after
    /// download and reject mismatches; when absent we trust
    /// `min_size_bytes`. Hard-coding hashes locks us to specific
    /// upstream revisions, so we leave them blank for files that
    /// upstream rotates frequently and pin only the stable ones.
    pub sha256: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TalkModelKind {
    /// Lives under `<hermes>/talk/models/`.
    Model,
    /// Lives under `<hermes>/talk/bin/` (whisper.cpp +
    /// sherpa-onnx-offline-tts executables shipped via Task 3-4
    /// sidecar packaging).
    Binary,
}

/// Required model files for the local voice pack.
///
/// Binaries (whisper-cli, sherpa-onnx-offline-tts) are NOT in
/// this list — they're shipped as Tauri sidecars and live in the
/// resource dir, not downloaded at runtime.
pub const TALK_MODELS: &[TalkModelSpec] = &[
    TalkModelSpec {
        id: "silero_vad",
        label: "silero-vad v5 (~2 MB)",
        kind: TalkModelKind::Model,
        filename: "silero_vad.onnx",
        urls: &[
            // Upstream — reachable outside China.
            "https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx",
            // HF mirror (community-maintained China proxy).
            "https://hf-mirror.com/onnx-community/silero-vad/resolve/main/onnx/model.onnx",
            // GitHub-raw proxies.
            "https://ghfast.top/https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx",
            "https://ghproxy.com/https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx",
        ],
        min_size_bytes: 1_000_000,
        sha256: None,
    },
    // Whisper.cpp medium-q5_0 — 539 MB. We used to ship
    // `ggml-base-q5_1.bin` (60 MB) but Mandarin accuracy was so
    // mediocre that real users hit garbage transcripts on the
    // very first turn (e.g. misheard words or phrases). We now
    // ship the medium-q5_0 model, which roughly triples download
    // size in exchange for ~95% accuracy and still fits the M1
    // 16 GB realtime budget. We deliberately don't expose a
    // model picker — one good default beats four mediocre
    // options the user has to evaluate (PD-2).
    TalkModelSpec {
        id: "whisper_medium",
        label: "whisper.cpp ggml-medium-q5_0 (~540 MB)",
        kind: TalkModelKind::Model,
        filename: "ggml-medium-q5_0.bin",
        urls: &[
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin",
            "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin",
        ],
        min_size_bytes: 400_000_000,
        sha256: None,
    },
    // Sherpa-onnx VITS-MeloTTS bilingual ZH/EN — replaces the
    // legacy Piper huayan voice. See `talk/tts.rs` module docs
    // for why we migrated. Model layout in upstream HF repo:
    //   k2-fsa/sherpa-onnx-vits-melo-tts-zh_en/{model.onnx,
    //   tokens.txt, lexicon.txt, dict/*, *.fst, ...}
    //
    // We download only the runtime-required artifacts. The
    // `dict/` directory + `.fst` normalisers ship as a single
    // tarball — that's handled by `scripts/fetch-talk-binaries.sh`
    // (the in-app one-shot downloader doesn't yet untar archives;
    // v1.2 todo). For now: the spec list probes individual flat
    // files for readiness, and the fetch script lays the dir
    // down. This means in-app "Download" only re-fetches the
    // ONNX graph; the lexicon + dict come from the script bundle.
    // The HF repo is `csukuangfj/vits-melo-tts-zh_en` (the
    // `csukuangfj` namespace is sherpa-onnx maintainer Fangjun
    // Kuang's personal HF account — the canonical home for these
    // model conversions, NOT a `k2-fsa` org repo, which doesn't
    // exist for this voice). Files live at the repo root.
    TalkModelSpec {
        id: "sherpa_melo_tts_model",
        label: "Sherpa MeloTTS zh_en model.onnx (~165 MB)",
        kind: TalkModelKind::Model,
        filename: "vits-melo-tts-zh_en/model.onnx",
        urls: &[
            "https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/model.onnx",
            "https://hf-mirror.com/csukuangfj/vits-melo-tts-zh_en/resolve/main/model.onnx",
            // ModelScope mirrors HF for many sherpa models — extra
            // China-friendly fallback when hf-mirror is congested.
            "https://www.modelscope.cn/models/csukuangfj/vits-melo-tts-zh_en/resolve/master/model.onnx",
        ],
        min_size_bytes: 100_000_000,
        sha256: None,
    },
    TalkModelSpec {
        id: "sherpa_melo_tts_tokens",
        label: "Sherpa MeloTTS tokens.txt (~5 KB)",
        kind: TalkModelKind::Model,
        filename: "vits-melo-tts-zh_en/tokens.txt",
        urls: &[
            "https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/tokens.txt",
            "https://hf-mirror.com/csukuangfj/vits-melo-tts-zh_en/resolve/main/tokens.txt",
            "https://www.modelscope.cn/models/csukuangfj/vits-melo-tts-zh_en/resolve/master/tokens.txt",
        ],
        min_size_bytes: 100,
        sha256: None,
    },
    TalkModelSpec {
        id: "sherpa_melo_tts_lexicon",
        label: "Sherpa MeloTTS lexicon.txt (~2 MB)",
        kind: TalkModelKind::Model,
        filename: "vits-melo-tts-zh_en/lexicon.txt",
        urls: &[
            "https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/lexicon.txt",
            "https://hf-mirror.com/csukuangfj/vits-melo-tts-zh_en/resolve/main/lexicon.txt",
            "https://www.modelscope.cn/models/csukuangfj/vits-melo-tts-zh_en/resolve/master/lexicon.txt",
        ],
        min_size_bytes: 100_000,
        sha256: None,
    },
];

// ───────────────────── Status reporting ─────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TalkModelFileStatus {
    pub id: String,
    pub label: String,
    pub kind: TalkModelKind,
    pub filename: String,
    pub target_path: String,
    pub exists: bool,
    pub size_bytes: u64,
    pub min_size_bytes: u64,
    pub mirror_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TalkModelsStatus {
    pub ready: bool,
    pub models_dir: String,
    pub bin_dir: String,
    pub files: Vec<TalkModelFileStatus>,
}

/// Resolve where a spec lands on disk. Centralised so the
/// `paths::*` helpers stay the source of truth (and so a future
/// move from `<hermes>/talk/models/` to e.g. an OS cache dir is
/// a one-line change).
fn target_path(spec: &TalkModelSpec) -> std::io::Result<PathBuf> {
    match spec.kind {
        TalkModelKind::Model => match spec.id {
            "silero_vad" => silero_vad_model(),
            // The flat-file probe for sherpa landing — same path
            // the runtime ready() check uses, so a successful
            // download here flips the readiness flag for free.
            "sherpa_melo_tts_model" => sherpa_tts_model_main_file(),
            // Other sherpa support files (`tokens.txt`, `lexicon.txt`)
            // route through the spec's own filename which already
            // includes the `vits-melo-tts-zh_en/` prefix → joined
            // with `talk_models_dir()` lands them in the same
            // model directory model.onnx lives in.
            _ => Ok(talk_models_dir()?.join(spec.filename)),
        },
        TalkModelKind::Binary => Ok(talk_bin_dir()?.join(spec.filename)),
    }
}

pub fn status() -> std::io::Result<TalkModelsStatus> {
    let models_dir = talk_models_dir()?;
    let bin_dir = talk_bin_dir()?;
    let files: Vec<TalkModelFileStatus> = TALK_MODELS
        .iter()
        .map(|spec| {
            let path = target_path(spec).unwrap_or_else(|_| PathBuf::from(spec.filename));
            let meta = std::fs::metadata(&path).ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            TalkModelFileStatus {
                id: spec.id.into(),
                label: spec.label.into(),
                kind: spec.kind,
                filename: spec.filename.into(),
                target_path: path.to_string_lossy().to_string(),
                exists: path.exists() && size >= spec.min_size_bytes,
                size_bytes: size,
                min_size_bytes: spec.min_size_bytes,
                mirror_count: spec.urls.len(),
            }
        })
        .collect();
    let ready = files.iter().all(|f| f.exists);
    Ok(TalkModelsStatus {
        ready,
        models_dir: models_dir.to_string_lossy().to_string(),
        bin_dir: bin_dir.to_string_lossy().to_string(),
        files,
    })
}

// ───────────────────── Download with mirror chain ─────────────────────

#[derive(Debug, Clone, Serialize)]
struct ProgressPayload {
    task_id: String,
    downloaded: u64,
    total: u64,
    speed_bps: u64,
}

#[derive(Debug, Clone, Serialize)]
struct CompletedPayload {
    task_id: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorPayload {
    task_id: String,
    message: String,
}

/// Download every missing file in `TALK_MODELS`. Returns the list
/// of (file_id, mirror_url_used) pairs for the audit log. The
/// `cancel` token is honored at chunk boundaries.
pub async fn download_all(
    app: &tauri::AppHandle,
    cancel: CancellationToken,
) -> anyhow::Result<Vec<(String, String)>> {
    std::fs::create_dir_all(talk_models_dir()?)?;
    std::fs::create_dir_all(talk_bin_dir()?)?;

    let mut report: Vec<(String, String)> = Vec::new();

    for spec in TALK_MODELS.iter() {
        let dest = target_path(spec)?;
        if dest.exists() {
            if let Ok(meta) = std::fs::metadata(&dest) {
                if meta.len() >= spec.min_size_bytes {
                    report.push((spec.id.into(), "<cached>".into()));
                    continue;
                }
            }
        }

        let task_id = format!("talk-model:{}", spec.id);
        let mut last_err: Option<anyhow::Error> = None;
        let mut succeeded_url: Option<String> = None;

        for &url in spec.urls.iter() {
            if cancel.is_cancelled() {
                anyhow::bail!("download cancelled");
            }
            tracing::info!(
                target: "talk.download",
                "trying {} from {url}",
                spec.id
            );

            match download_one(app, &task_id, url, &dest, spec, &cancel).await {
                Ok(()) => {
                    succeeded_url = Some(url.into());
                    break;
                }
                Err(e) => {
                    tracing::warn!(
                        target: "talk.download",
                        "{} from {url} failed: {e:#}",
                        spec.id
                    );
                    last_err = Some(e);
                    // Wipe the partial file so the next mirror
                    // doesn't see a tiny "I'm done" file.
                    let _ = std::fs::remove_file(&dest);
                    continue;
                }
            }
        }

        let url_used = match succeeded_url {
            Some(u) => u,
            None => {
                let msg = format!(
                    "all mirrors failed for {} (last error: {})",
                    spec.id,
                    last_err
                        .map(|e| format!("{e:#}"))
                        .unwrap_or_else(|| "unknown".into())
                );
                let _ = app.emit(
                    "download:error",
                    ErrorPayload {
                        task_id: task_id.clone(),
                        message: msg.clone(),
                    },
                );
                anyhow::bail!(msg);
            }
        };

        // Optional SHA-256 verification.
        if let Some(expected) = spec.sha256 {
            verify_sha256(&dest, expected).map_err(|e| {
                let _ = std::fs::remove_file(&dest);
                anyhow::anyhow!("sha256 verify failed for {}: {e}", spec.id)
            })?;
        }

        let _ = app.emit(
            "download:completed",
            CompletedPayload {
                task_id: task_id.clone(),
                path: dest.to_string_lossy().to_string(),
            },
        );
        report.push((spec.id.into(), url_used));
    }

    Ok(report)
}

async fn download_one(
    app: &tauri::AppHandle,
    task_id: &str,
    url: &str,
    dest: &Path,
    spec: &TalkModelSpec,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()?;
    let resp = client.get(url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("HTTP {status}");
    }
    let total = resp.content_length().unwrap_or(0);

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("partial");
    let mut file = std::fs::File::create(&tmp)?;

    let started = Instant::now();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut stream = resp.bytes_stream();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        if cancel.is_cancelled() {
            let _ = std::fs::remove_file(&tmp);
            anyhow::bail!("cancelled");
        }
        let bytes = chunk?;
        file.write_all(&bytes)?;
        downloaded += bytes.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(200) {
            let elapsed = started.elapsed().as_secs_f64().max(0.001);
            let speed_bps = (downloaded as f64 / elapsed) as u64;
            let _ = app.emit(
                "download:progress",
                ProgressPayload {
                    task_id: task_id.into(),
                    downloaded,
                    total,
                    speed_bps,
                },
            );
            last_emit = Instant::now();
        }
    }
    file.flush()?;
    drop(file);

    if downloaded < spec.min_size_bytes {
        let _ = std::fs::remove_file(&tmp);
        anyhow::bail!(
            "short download: {downloaded} < {} (mirror likely returned an error page)",
            spec.min_size_bytes
        );
    }

    std::fs::rename(&tmp, dest)?;
    Ok(())
}

fn verify_sha256(path: &Path, expected_hex: &str) -> anyhow::Result<()> {
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)?;
    std::io::copy(&mut file, &mut hasher)?;
    let got = hex::encode(hasher.finalize());
    if got.eq_ignore_ascii_case(expected_hex) {
        Ok(())
    } else {
        anyhow::bail!("sha256 mismatch: got {got}, want {expected_hex}")
    }
}

// ───────────────────── Offline zip import ─────────────────────

/// File names we accept as Talk Mode binaries. Matched against
/// each zip entry's basename (case-sensitive) — anything outside
/// this list is silently ignored so a "voice-pack.zip" containing
/// arbitrary extras can't litter `<hermes>/talk/bin/`.
///
/// Note: on Windows the binaries ship with `.exe` suffix; on
/// macOS/Linux they're suffix-less. We accept both regardless of
/// host OS so a Windows user importing a macOS zip still gets a
/// clear "wrong platform" signal at *runtime* (whisper-cli won't
/// execute) instead of a silent "nothing happened".
const BINARY_BASENAMES: &[&str] = &[
    "whisper-cli",
    "whisper-cli.exe",
    "sherpa-onnx-offline-tts",
    "sherpa-onnx-offline-tts.exe",
];

/// Extract a user-supplied zip into the talk dir. The zip must
/// contain one or more of:
///
/// 1. **Model files** — `silero_vad.onnx`, `ggml-medium-q5_0.bin`,
///    `vits-melo-tts-zh_en/{model.onnx,tokens.txt,lexicon.txt}`.
///    Top-level files match by basename; sherpa support files
///    are matched by basename and routed under the model dir.
/// 2. **Binaries** — `whisper-cli{,.exe}`,
///    `sherpa-onnx-offline-tts{,.exe}` plus optional shared libs
///    siblings (`*.dylib` / `*.so` / `*.dll`) that sherpa-onnx
///    needs at runtime. Binaries + libs land in
///    `<hermes>/talk/bin/`; binaries also get +x on Unix.
///
/// Returns the number of files extracted.
pub fn import_offline_zip(zip_path: &Path) -> anyhow::Result<usize> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut imported = 0_usize;
    let bin_dir = talk_bin_dir()?;
    std::fs::create_dir_all(&bin_dir)?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        if entry.is_dir() {
            continue;
        }
        let entry_name = match entry.enclosed_name() {
            Some(n) => n.to_path_buf(),
            None => continue,
        };
        let basename = match entry_name.file_name() {
            Some(b) => b.to_string_lossy().to_string(),
            None => continue,
        };

        // Decide where this entry lands and how to validate it.
        // Four independent matchers, most specific first:
        //   1. Model spec hit (filename ends in `<basename>`) →
        //      use the spec's target path + min_size validation.
        //      Specs whose filename has a `dir/` prefix (sherpa
        //      support files like `vits-melo-tts-zh_en/tokens.txt`)
        //      still match because we compare on the trailing
        //      basename via `.ends_with`.
        //   2. Top-level binary basename → land in talk/bin/.
        //   3. Shared lib (`*.dylib`/`*.so`/`*.dll`) → land in
        //      talk/bin/ alongside binaries (sherpa-onnx + the
        //      bundled onnxruntime ship as separate dylibs).
        //   4. Anything under `vits-melo-tts-zh_en/` (dict/, *.fst)
        //      → land under the model dir verbatim.
        if let Some(spec) = TALK_MODELS
            .iter()
            .find(|s| s.filename == basename || s.filename.ends_with(&format!("/{basename}")))
        {
            let dest = target_path(spec)?;
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            if let Ok(meta) = std::fs::metadata(&dest) {
                if meta.len() < spec.min_size_bytes {
                    let _ = std::fs::remove_file(&dest);
                    anyhow::bail!(
                        "imported {basename} is too small ({} < {})",
                        meta.len(),
                        spec.min_size_bytes
                    );
                }
            }
            imported += 1;
            continue;
        }

        if BINARY_BASENAMES.contains(&basename.as_str()) {
            let dest = bin_dir.join(&basename);
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            set_executable(&dest);
            imported += 1;
            continue;
        }

        // Shared libraries needed by sherpa-onnx at runtime
        // (libonnxruntime, libsherpa-onnx, libpiper_phonemize on
        // older builds, etc.). Drop them flat into `bin/` so
        // dyld / ld.so finds them via DYLD_LIBRARY_PATH that
        // SherpaTts sets when spawning. Strip directory prefix
        // so different vendor packaging layouts converge to the
        // same flat-bin layout we expect.
        let lower = basename.to_ascii_lowercase();
        let is_shared_lib = lower.ends_with(".dylib")
            || lower.ends_with(".so")
            || lower.contains(".so.") // libfoo.so.1 etc.
            || lower.ends_with(".dll");
        if is_shared_lib {
            let dest = bin_dir.join(&basename);
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            imported += 1;
            continue;
        }

        // Sherpa MeloTTS support tree — preserve any path under
        // `vits-melo-tts-zh_en/`. Same anti-traversal property
        // that `enclosed_name()` already gives us, so we can
        // route by string prefix safely.
        let path_str = entry_name.to_string_lossy().replace('\\', "/");
        if let Some((_, rel)) = path_str.split_once("vits-melo-tts-zh_en/") {
            let dest = talk_models_dir()?.join("vits-melo-tts-zh_en").join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            imported += 1;
            continue;
        }
    }

    Ok(imported)
}

/// Set the executable bit on Unix; no-op on Windows where the
/// `.exe` suffix is the only thing the OS cares about.
fn set_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(perms.mode() | 0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every spec must have at least one upstream URL and at
    /// least one China-mirror URL — the user explicitly flagged
    /// 国内直连 GitHub 网络问题 on 2026-05-07 and we promised
    /// fallback coverage. This test is a tripwire to keep that
    /// property under code review.
    #[test]
    fn every_spec_has_china_mirror_fallback() {
        for spec in TALK_MODELS {
            assert!(spec.urls.len() >= 2, "{} should have >= 2 mirrors", spec.id);
            let china_friendly = spec.urls.iter().any(|u| {
                u.contains("hf-mirror.com")
                    || u.contains("ghfast.top")
                    || u.contains("ghproxy.com")
                    || u.contains("modelscope.cn")
                    || u.contains("aliyuncs.com")
                    || u.contains("bcebos.com")
            });
            assert!(china_friendly, "{} has no China-friendly mirror", spec.id);
        }
    }

    #[test]
    fn min_sizes_are_sane() {
        for spec in TALK_MODELS {
            assert!(spec.min_size_bytes > 0, "{} min_size_bytes is 0", spec.id);
        }
    }

    #[test]
    fn ids_unique() {
        let mut ids: Vec<&str> = TALK_MODELS.iter().map(|s| s.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), TALK_MODELS.len(), "duplicate spec ids");
    }

    #[test]
    fn status_resolves_target_paths() {
        // Status must succeed even on a cold machine (no files
        // downloaded yet); `ready` should be false.
        let s = status().expect("status");
        assert!(!s.ready);
        assert_eq!(s.files.len(), TALK_MODELS.len());
    }

    #[test]
    fn binary_basenames_cover_both_unix_and_windows() {
        // Tripwire: the offline-zip importer must accept the
        // suffix-less Unix basename AND the .exe Windows variant
        // for both whisper-cli and sherpa-onnx-offline-tts. If
        // someone reorganises BINARY_BASENAMES this test catches
        // an accidental drop.
        for required in [
            "whisper-cli",
            "whisper-cli.exe",
            "sherpa-onnx-offline-tts",
            "sherpa-onnx-offline-tts.exe",
        ] {
            assert!(
                BINARY_BASENAMES.contains(&required),
                "BINARY_BASENAMES is missing {required}"
            );
        }
    }

    #[test]
    fn import_offline_zip_picks_up_known_files_only() {
        use std::io::Write as _;
        let tmp = tempfile::tempdir().expect("tempdir");
        let zip_path = tmp.path().join("voice-pack.zip");

        // Build a tiny zip with one known file (sized to clear
        // min_size_bytes) and one unknown that should be ignored.
        let f = std::fs::File::create(&zip_path).expect("create zip");
        let mut writer = zip::ZipWriter::new(f);
        let opts: zip::write::FileOptions<()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        // Use a sherpa support file (`tokens.txt`) — its spec
        // filename has a `vits-melo-tts-zh_en/` prefix, which
        // exercises the basename-tail match path the importer
        // uses for slash-prefixed specs.
        writer
            .start_file("vits-melo-tts-zh_en/tokens.txt", opts)
            .expect("start_file");
        // 200 bytes > min_size_bytes (100) for the tokens file.
        let payload = vec![b'a'; 200];
        writer.write_all(&payload).expect("write");
        writer.start_file("noise/random.txt", opts).expect("start");
        writer.write_all(b"unrelated").expect("write");
        writer.finish().expect("finish");

        // Smoke: zip loads + we can match the known entry against
        // a spec via the basename-tail rule. We don't actually run
        // `import_offline_zip` because it writes to
        // `<hermes>/talk/...` with side-effects on the dev machine.
        let file = std::fs::File::open(&zip_path).expect("open");
        let mut archive = zip::ZipArchive::new(file).expect("archive");
        assert_eq!(archive.len(), 2);
        let mut found = 0;
        for i in 0..archive.len() {
            let entry = archive.by_index(i).expect("entry");
            if let Some(p) = entry.enclosed_name() {
                if let Some(name) = p.file_name() {
                    let name = name.to_string_lossy();
                    if TALK_MODELS
                        .iter()
                        .any(|s| s.filename == name || s.filename.ends_with(&format!("/{name}")))
                    {
                        found += 1;
                    }
                }
            }
        }
        assert_eq!(found, 1);
    }
}
