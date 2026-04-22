//! Atomic file writes.
//!
//! Writes via `<target>.caduceus.tmp-<pid>-<nonce>` then `rename` onto the
//! final path. `rename` within the same filesystem is atomic on POSIX and
//! on NTFS (via `MoveFileEx` replacement semantics that `std::fs::rename`
//! uses under the hood on Windows). This guarantees readers never observe
//! a half-written file, and a mid-write crash leaves either the pristine
//! original or the fully-written successor — never a truncated mess.
//!
//! Rationale for extracting this from `hermes_config.rs`: we now need
//! atomic writes in at least 3 places (config.yaml, .env, changelog.jsonl,
//! and whatever else Phase 2 adds), and 3 copies of the same 6-line pattern
//! is where subtle bugs (forgotten fsync, stale tmp files on panic) breed.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TMP_NONCE: AtomicU64 = AtomicU64::new(0);

/// Atomically replace `path` with `contents`.
///
/// - Creates parent dir if missing.
/// - Writes to a sibling `<name>.caduceus.tmp-<pid>-<n>` first.
/// - On Unix, applies `perms` to the tmp file (so `0o600` for secret files
///   lands atomically; no race window where the final file is world-readable).
/// - `rename`s over the target.
///
/// On failure the tmp file is best-effort removed; callers shouldn't rely on
/// cleanup (a crashed process leaves its tmp behind, which is fine — next
/// successful write uses a fresh nonce).
pub fn atomic_write(
    path: &Path,
    contents: &[u8],
    #[cfg(unix)] perms: Option<u32>,
    #[cfg(not(unix))] _perms: Option<u32>,
) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let nonce = TMP_NONCE.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(
        "{}.caduceus.tmp-{}-{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("tmp"),
        std::process::id(),
        nonce,
    );
    let tmp_path = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.join(&tmp_name),
        _ => std::path::PathBuf::from(&tmp_name),
    };

    let write_result = (|| -> io::Result<()> {
        fs::write(&tmp_path, contents)?;
        #[cfg(unix)]
        if let Some(mode) = perms {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp_path, fs::Permissions::from_mode(mode))?;
        }
        fs::rename(&tmp_path, path)?;
        Ok(())
    })();

    if write_result.is_err() {
        // Best-effort cleanup; ignore failures (disk full etc.).
        let _ = fs::remove_file(&tmp_path);
    }
    write_result
}

/// Append `line` plus a newline to `path`, creating parent dirs as needed.
/// Not atomic across a crash (a crash mid-append can leave a torn line), but
/// `rename` isn't useful here — we WANT accumulation. For JSONL journals the
/// reader must tolerate a torn trailing line anyway (standard practice).
pub fn append_line(path: &Path, line: &str) -> io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    f.write_all(line.as_bytes())?;
    if !line.ends_with('\n') {
        f.write_all(b"\n")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "caduceus-fs-atomic-{}-{}-{}",
            tag,
            std::process::id(),
            TMP_NONCE.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn atomic_write_creates_new_file() {
        let dir = tmp_dir("new");
        let target = dir.join("sub/deeper/file.txt");
        atomic_write(&target, b"hello", None).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"hello");
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let dir = tmp_dir("replace");
        let target = dir.join("x");
        fs::write(&target, b"old content, longer").unwrap();
        atomic_write(&target, b"new", None).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn atomic_write_leaves_no_tmp_on_success() {
        let dir = tmp_dir("no-tmp");
        let target = dir.join("y");
        atomic_write(&target, b"ok", None).unwrap();
        let remaining: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".caduceus.tmp-"))
            .collect();
        assert!(remaining.is_empty(), "tmp file leaked: {remaining:?}");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_applies_perms_before_rename() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp_dir("perms");
        let target = dir.join("secret");
        atomic_write(&target, b"sk-xxx", Some(0o600)).unwrap();
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn append_line_adds_trailing_newline_once() {
        let dir = tmp_dir("append");
        let target = dir.join("log.jsonl");
        append_line(&target, "one").unwrap();
        append_line(&target, "two\n").unwrap(); // caller already newline-terminated
        append_line(&target, "three").unwrap();
        let body = fs::read_to_string(&target).unwrap();
        assert_eq!(body, "one\ntwo\nthree\n");
    }
}
