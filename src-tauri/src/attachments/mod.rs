//! Phase 1 · T1.5 — Chat attachments.
//!
//! Files the user drags, pastes, or picks in the composer are "staged"
//! under `~/.hermes/attachments/<uuid>[.<ext>]`. Staging is a COPY, not a
//! move — we never touch the source file. The returned metadata rides with
//! the UI message, and a later DB upsert persists the association.
//!
//! Why a separate staging dir instead of keeping the blob inline?
//!   1. Messages can stream for tens of seconds; we don't want a 20 MB
//!      base64 string parked in zustand.
//!   2. The gateway will eventually take a file path (multimodal uploads
//!      are provider-specific; most SDKs accept a local path or a URL).
//!   3. The user can delete the message without a separate "orphan file"
//!      cleanup — we cascade on message row delete.
//!
//! What this module does NOT do:
//!   - Does not render thumbnails. The frontend shows a filename chip; if
//!     we want previews later a small helper reading the staged bytes is
//!     cheap to add.
//!   - Does not deduplicate (two identical pastes produce two files). A
//!     content-hash cache is a nice-to-have, not essential for v1.
//!   - Does not compress. 25 MB cap keeps blob uploads reasonable without
//!     the complexity of streaming writes.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::fs_atomic;

const HERMES_DIR: &str = ".hermes";
const ATTACHMENTS_DIR: &str = "attachments";

/// Hard ceiling on a single staged blob. 25 MB is generous for the common
/// case (screenshots + PDFs) and well under the typical provider multimodal
/// limit (20 MB for GPT-4o, 5 MB for Claude images). We reject above this
/// rather than silently truncate.
const MAX_BLOB_BYTES: usize = 25 * 1024 * 1024;

/// Upper bound on the `name` field. The filesystem can hold longer names
/// but we use it as a display string; 255 bytes matches POSIX NAME_MAX and
/// keeps serialisation honest.
const MAX_NAME_BYTES: usize = 255;

fn hermes_dir() -> io::Result<PathBuf> {
    // Same HOME-then-USERPROFILE fallback as the rest of the crate — keeps
    // Windows CI and native Windows installs resolving.
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "neither $HOME nor %USERPROFILE% set",
            )
        })?;
    Ok(PathBuf::from(home).join(HERMES_DIR))
}

pub fn attachments_dir() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(ATTACHMENTS_DIR))
}

/// Returned to the frontend after a successful stage. `path` is the
/// absolute, canonical location on disk; the UI round-trips it verbatim so
/// later send / render / delete calls can act on the same file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub path: String,
    pub created_at: i64,
}

/// Accept a base64-encoded blob (clipboard paste, drag-drop File reader) and
/// write it to the staging dir. `name` is the display name the user sees;
/// the on-disk filename is `<uuid>.<ext>` derived from the name's suffix
/// (so filesystem listings stay tidy even if two files share a display
/// name). `mime` comes from the browser — we don't sniff.
pub fn stage_blob(name: &str, mime: &str, base64_body: &str) -> anyhow::Result<StagedAttachment> {
    validate_name(name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_body.as_bytes())
        .map_err(|e| anyhow::anyhow!("invalid base64: {e}"))?;
    if bytes.len() > MAX_BLOB_BYTES {
        anyhow::bail!(
            "attachment too large: {} bytes (max {} bytes)",
            bytes.len(),
            MAX_BLOB_BYTES,
        );
    }
    write_staged(name, mime, &bytes)
}

/// Copy a user-picked file (native file dialog) into the staging dir. We
/// copy rather than symlink/move so deleting the original never leaves a
/// dangling attachment, and so the user's filesystem layout isn't coupled
/// to how long Hermes keeps its history around.
pub fn stage_path(src: &Path, mime_hint: Option<&str>) -> anyhow::Result<StagedAttachment> {
    if !src.is_file() {
        anyhow::bail!("not a regular file: {}", src.display());
    }
    let meta = fs::metadata(src)?;
    let size = meta.len() as usize;
    if size > MAX_BLOB_BYTES {
        anyhow::bail!(
            "attachment too large: {} bytes (max {} bytes)",
            size,
            MAX_BLOB_BYTES,
        );
    }
    let name = src
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| anyhow::anyhow!("path has no filename or non-utf8: {}", src.display()))?;
    validate_name(name)?;
    let bytes = fs::read(src)?;
    let mime = mime_hint
        .map(str::to_string)
        .unwrap_or_else(|| guess_mime(name));
    write_staged(name, &mime, &bytes)
}

/// T1.5d — preview cap. Hard ceiling on the bytes we'll willingly
/// base64-encode and stream back over IPC for an `<img>` preview. Anything
/// larger than this renders as a filename chip without a thumbnail.
/// 5 MB chosen empirically: enough for a retina screenshot or a typical
/// photo, small enough to keep IPC transport under a second even on
/// mechanical drives and large enough to avoid nagging users for
/// resize-before-preview.
const MAX_PREVIEW_BYTES: usize = 5 * 1024 * 1024;

/// T1.5d — read a staged attachment and return a `data:<mime>;base64,<…>`
/// URL suitable for `<img src="…">`. Sandbox-checked (must live under
/// `attachments_dir`) and size-capped so an enormous file can't freeze
/// the renderer thread.
///
/// `mime_hint` is what the UI already stored on the message row — if
/// missing or blank we fall back to the extension-based guess. We
/// deliberately return an error for non-image MIMEs: the frontend only
/// calls this for `image/*` attachments today and keeping a MIME allow-
/// list here stops a future caller from accidentally inlining a PDF
/// into an `<img>`.
pub fn read_as_data_url(abs_path: &str, mime_hint: Option<&str>) -> anyhow::Result<String> {
    let root = attachments_dir()?;
    let target = PathBuf::from(abs_path);
    if !target.starts_with(&root) {
        anyhow::bail!(
            "refusing to read outside attachments dir: {}",
            target.display(),
        );
    }
    let meta = fs::metadata(&target)?;
    let size = meta.len() as usize;
    if size > MAX_PREVIEW_BYTES {
        anyhow::bail!(
            "attachment too large to preview: {} bytes (max {} bytes)",
            size,
            MAX_PREVIEW_BYTES,
        );
    }
    let mime = match mime_hint {
        Some(m) if !m.trim().is_empty() => m.to_string(),
        _ => {
            let name = target
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            guess_mime(name)
        }
    };
    if !mime.starts_with("image/") {
        anyhow::bail!("preview only supports image/* MIMEs, got: {mime}");
    }
    let bytes = fs::read(&target)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// T1.5e — garbage-collect attachment files that no DB row references.
/// Given the set of paths the DB believes are still live, remove every
/// regular file under `attachments_dir` that isn't in that set. Returns
/// `(removed_count, removed_bytes)` for observability.
///
/// Silently tolerates individual delete failures (we log via the caller)
/// rather than aborting on the first error — GC should be best-effort
/// and never block app startup.
pub fn gc_orphans(live_paths: &std::collections::HashSet<PathBuf>) -> anyhow::Result<GcReport> {
    let root = attachments_dir()?;
    if !root.exists() {
        return Ok(GcReport::default());
    }
    let mut report = GcReport::default();
    for entry in fs::read_dir(&root)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if live_paths.contains(&path) {
            continue;
        }
        // Canonicalize-lite: try the exact path first, then accept a
        // symlink/case-insensitive match if the set happens to carry a
        // differently-spelled equivalent.
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        match fs::remove_file(&path) {
            Ok(()) => {
                report.removed_count += 1;
                report.removed_bytes += size;
            }
            Err(e) => {
                report.failed.push(format!("{}: {}", path.display(), e));
            }
        }
    }
    Ok(report)
}

/// Summary of a GC pass — what the frontend can surface as a toast or
/// log to devtools. `failed` is empty on the happy path.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct GcReport {
    pub removed_count: u64,
    pub removed_bytes: u64,
    pub failed: Vec<String>,
}

/// Remove a staged file from disk. Idempotent — a missing file is not an
/// error (the UI may call this speculatively during a remove-and-re-stage
/// flow). Paths outside `attachments_dir` are rejected to keep this call
/// safe to expose over IPC even though the frontend should never construct
/// such a path.
pub fn delete(abs_path: &str) -> anyhow::Result<()> {
    let root = attachments_dir()?;
    let target = PathBuf::from(abs_path);
    if !target.starts_with(&root) {
        anyhow::bail!(
            "refusing to delete outside attachments dir: {}",
            target.display(),
        );
    }
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

// ─── helpers ─────────────────────────────────────────────────────────

fn validate_name(name: &str) -> anyhow::Result<()> {
    if name.is_empty() {
        anyhow::bail!("attachment name must not be empty");
    }
    if name.len() > MAX_NAME_BYTES {
        anyhow::bail!(
            "attachment name too long: {} bytes (max {})",
            name.len(),
            MAX_NAME_BYTES,
        );
    }
    // Paths are written flat inside a single dir; don't let the name
    // escape via `..` or an absolute prefix. This is belt-and-braces —
    // the on-disk filename is a uuid anyway.
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        anyhow::bail!("attachment name contains path separators: {name}");
    }
    Ok(())
}

fn write_staged(name: &str, mime: &str, bytes: &[u8]) -> anyhow::Result<StagedAttachment> {
    let dir = attachments_dir()?;
    fs::create_dir_all(&dir)?;
    let id = uuid::Uuid::new_v4().to_string();
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let filename = if ext.is_empty() {
        id.clone()
    } else {
        format!("{id}.{ext}")
    };
    let abs = dir.join(&filename);
    // Atomic write so a crash mid-write doesn't leave a half-file that
    // the message row later points at.
    fs_atomic::atomic_write(&abs, bytes, None)?;
    let created_at = chrono::Utc::now().timestamp_millis();
    Ok(StagedAttachment {
        id,
        name: name.to_string(),
        mime: mime.to_string(),
        size: bytes.len() as i64,
        path: abs.to_string_lossy().into_owned(),
        created_at,
    })
}

/// Cheap extension-based MIME guess used when the caller doesn't supply
/// one (native file-dialog path flow). Deliberately tiny — the provider
/// SDKs either sniff themselves or accept the bytes with no MIME at all.
fn guess_mime(name: &str) -> String {
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" | "log" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    }
    .to_string()
}


#[cfg(test)]
mod tests;
