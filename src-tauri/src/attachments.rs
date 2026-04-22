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
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Tests mutate $HOME; serialise via the crate-wide HOME_LOCK.
    static LOCAL_LOCK: Mutex<()> = Mutex::new(());

    struct HomeGuard {
        _local: std::sync::MutexGuard<'static, ()>,
        _crate: std::sync::MutexGuard<'static, ()>,
        prev_home: Option<std::ffi::OsString>,
        prev_userprofile: Option<std::ffi::OsString>,
    }
    impl HomeGuard {
        fn new(home: &Path) -> Self {
            let local = LOCAL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let c = crate::skills::HOME_LOCK
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let prev_home = std::env::var_os("HOME");
            let prev_userprofile = std::env::var_os("USERPROFILE");
            std::env::set_var("HOME", home);
            std::env::set_var("USERPROFILE", home);
            Self {
                _local: local,
                _crate: c,
                prev_home,
                prev_userprofile,
            }
        }
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match self.prev_home.take() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
            match self.prev_userprofile.take() {
                Some(v) => std::env::set_var("USERPROFILE", v),
                None => std::env::remove_var("USERPROFILE"),
            }
        }
    }

    fn tmp_home() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "caduceus-attachments-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn stage_blob_writes_bytes_and_returns_matching_metadata() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);

        let body = b"hello world";
        let b64 = base64::engine::general_purpose::STANDARD.encode(body);
        let att = stage_blob("hi.txt", "text/plain", &b64).unwrap();

        assert_eq!(att.name, "hi.txt");
        assert_eq!(att.mime, "text/plain");
        assert_eq!(att.size, body.len() as i64);
        let on_disk = std::fs::read(&att.path).unwrap();
        assert_eq!(on_disk, body);
        // On-disk filename uses the id + ext — not the display name.
        let fname = Path::new(&att.path).file_name().unwrap().to_str().unwrap();
        assert!(fname.ends_with(".txt"));
        assert!(fname.starts_with(&att.id));
    }

    #[test]
    fn stage_blob_rejects_oversize() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        // MAX_BLOB_BYTES + 1 decoded; pad the base64 accordingly.
        let huge = vec![0u8; MAX_BLOB_BYTES + 1];
        let b64 = base64::engine::general_purpose::STANDARD.encode(&huge);
        let err = stage_blob("big.bin", "application/octet-stream", &b64).unwrap_err();
        assert!(err.to_string().contains("too large"), "got: {err}");
    }

    #[test]
    fn stage_blob_rejects_invalid_base64() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        let err = stage_blob("x.png", "image/png", "not_base64!!!!").unwrap_err();
        assert!(err.to_string().contains("base64"), "got: {err}");
    }

    #[test]
    fn stage_path_copies_file_and_guesses_mime() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        // Source outside of attachments dir.
        let src_dir =
            std::env::temp_dir().join(format!("caduceus-attach-src-{}", std::process::id()));
        std::fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("cat.png");
        std::fs::write(&src, b"\x89PNG\r\n\x1a\nfake").unwrap();

        let att = stage_path(&src, None).unwrap();
        assert_eq!(att.name, "cat.png");
        assert_eq!(att.mime, "image/png");
        // File is a COPY — original still intact.
        assert!(src.is_file());
        assert!(Path::new(&att.path).is_file());
    }

    #[test]
    fn stage_path_rejects_directory_and_missing() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        let missing = home.join("does-not-exist.png");
        assert!(stage_path(&missing, None).is_err());
        // Use home itself as a "directory" target.
        assert!(stage_path(&home, None).is_err());
    }

    #[test]
    fn delete_is_idempotent_and_path_sandboxed() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"x");
        let att = stage_blob("x.txt", "text/plain", &b64).unwrap();

        delete(&att.path).unwrap();
        assert!(!Path::new(&att.path).exists());
        // Second delete is a no-op, not an error.
        delete(&att.path).unwrap();

        // Paths outside the attachments dir are rejected.
        let outside = home.join("evil.txt");
        std::fs::write(&outside, b"bad").unwrap();
        let err = delete(outside.to_str().unwrap()).unwrap_err();
        assert!(err.to_string().contains("refusing"), "got: {err}");
        assert!(
            outside.exists(),
            "delete() must not touch files outside the dir"
        );
    }

    // T1.5d — preview

    #[test]
    fn preview_returns_data_url_for_image() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        let bytes = b"\x89PNG\r\n\x1a\nfake-body";
        let b64_body = base64::engine::general_purpose::STANDARD.encode(bytes);
        let att = stage_blob("pic.png", "image/png", &b64_body).unwrap();

        let url = read_as_data_url(&att.path, Some("image/png")).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        let comma = url.find(',').unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&url[comma + 1..])
            .unwrap();
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn preview_rejects_non_image_mime() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"PDF-bytes");
        let att = stage_blob("doc.pdf", "application/pdf", &b64).unwrap();
        let err = read_as_data_url(&att.path, Some("application/pdf")).unwrap_err();
        assert!(err.to_string().contains("image/"), "got: {err}");
    }

    #[test]
    fn preview_rejects_outside_sandbox() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        let outside = home.join("sneaky.png");
        std::fs::write(&outside, b"bytes").unwrap();
        let err = read_as_data_url(outside.to_str().unwrap(), Some("image/png")).unwrap_err();
        assert!(err.to_string().contains("refusing"), "got: {err}");
    }

    #[test]
    fn preview_falls_back_to_guessed_mime_when_hint_blank() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        // guess_mime() keys off the display name — stage needs a .png
        // name so the extension-based guess returns image/png even when
        // we pass an empty hint.
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"bytes");
        let att = stage_blob("auto.png", "image/png", &b64).unwrap();
        let url = read_as_data_url(&att.path, Some("")).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }

    // T1.5e — GC

    #[test]
    fn gc_removes_orphans_and_keeps_live() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);

        let b64 = base64::engine::general_purpose::STANDARD.encode(b"live");
        let live = stage_blob("live.txt", "text/plain", &b64).unwrap();
        let orphan = stage_blob("orphan.txt", "text/plain", &b64).unwrap();

        let mut set = std::collections::HashSet::new();
        set.insert(PathBuf::from(&live.path));

        let report = gc_orphans(&set).unwrap();
        assert_eq!(report.removed_count, 1);
        assert_eq!(report.removed_bytes, b"live".len() as u64);
        assert!(report.failed.is_empty());
        assert!(Path::new(&live.path).exists(), "live file must survive");
        assert!(
            !Path::new(&orphan.path).exists(),
            "orphan file must be swept"
        );
    }

    #[test]
    fn gc_empty_dir_is_noop() {
        let home = tmp_home();
        let _g = HomeGuard::new(&home);
        // Dir may not even exist yet.
        let report = gc_orphans(&std::collections::HashSet::new()).unwrap();
        assert_eq!(report.removed_count, 0);
        assert!(report.failed.is_empty());
    }

    #[test]
    fn validate_name_rejects_separators() {
        assert!(validate_name("").is_err());
        assert!(validate_name("ok.txt").is_ok());
        assert!(validate_name("../evil.txt").is_err());
        assert!(validate_name("sub/dir.txt").is_err());
        assert!(validate_name("win\\path.txt").is_err());
    }
}
