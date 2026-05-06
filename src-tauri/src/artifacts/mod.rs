//! **B-9.4 — workflow artifacts.**
//!
//! Files produced during a workflow run (or written by Hermes Agent
//! via the `save_artifact` MCP tool) live under
//! `~/.hermes/artifacts/<run_id>/<name>`. This module is the only
//! thing that knows about that layout — IPC handlers and MCP tools
//! both go through `write_artifact` / `list_artifacts` so the
//! filename normalisation rules stay consistent.
//!
//! ## Filename safety
//!
//! Hermes / users can hand us arbitrary strings as `name`. We strip
//! anything that could escape the run dir or break tooling:
//! - path separators (`/` `\`) → replaced with `_`
//! - parent traversal (`..`) → rejected (errors)
//! - leading `.` → kept (hidden files OK), but `.` and `..` alone
//!   are rejected
//! - control chars / null bytes → stripped
//! - max length 200 chars (per filename, not full path)
//!
//! ## Why no DB rows
//!
//! Treating the directory as the source of truth keeps the model
//! tiny: `ls ~/.hermes/artifacts/<run>/` IS the API. Adding a DB
//! table would mean two write paths (file + row) that can drift —
//! every "out of sync" bug in artifact UIs across other tools is
//! that drift. Filesystem mtime + size answers everything we need
//! for the v1 list view.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_NAME_CHARS: usize = 200;
/// Hard ceiling on a single artifact's bytes. Above this we refuse
/// the write so a runaway agent step can't fill the user's disk
/// silently. Tunable; chosen so a CSV with ~50 K rows fits but a
/// 100 MB log dump doesn't. Hermes can chunk if it really needs to.
const MAX_BYTES_PER_ARTIFACT: u64 = 8 * 1024 * 1024;

/// Metadata for one artifact file. Used by both `list_artifacts`
/// and `write_artifact` (the latter returns the freshly-written
/// info so callers don't have to re-stat).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactInfo {
    /// Run id this artifact belongs to.
    pub run_id: String,
    /// Sanitised filename relative to the run dir (no slashes).
    pub name: String,
    /// Absolute path on disk. Useful for the GUI's "Reveal in
    /// Finder" action; never sent to remote services.
    pub path: String,
    /// Byte count of the file.
    pub size: u64,
    /// Last-modified unix ms. UI shows "edited 3m ago".
    pub mtime_ms: i64,
}

/// `~/.hermes/artifacts/`. Created lazily; missing dir means there
/// are no artifacts yet.
pub fn artifacts_root() -> std::io::Result<PathBuf> {
    Ok(crate::paths::hermes_data_dir()?.join("artifacts"))
}

/// `~/.hermes/artifacts/<run_id>/`. Run id is treated as opaque; we
/// just sanitise it the same way as artifact names so a malformed
/// id can't escape the artifacts root.
pub fn run_dir(run_id: &str) -> std::io::Result<PathBuf> {
    let safe = sanitise_segment(run_id).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("run_id: {e}"))
    })?;
    Ok(artifacts_root()?.join(safe))
}

/// List every artifact in `run_id`'s dir. Empty Vec when the dir
/// doesn't exist or is empty. Errors only on I/O the caller can
/// usefully retry (permission denied, disk gone, …).
pub fn list_artifacts(run_id: &str) -> std::io::Result<Vec<ArtifactInfo>> {
    let dir = run_dir(run_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let name = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(ArtifactInfo {
            run_id: run_id.to_string(),
            name,
            path: entry.path().to_string_lossy().into_owned(),
            size: meta.len(),
            mtime_ms,
        });
    }
    // Most recent first — matches the chat artifact card ordering.
    out.sort_by_key(|b| std::cmp::Reverse(b.mtime_ms));
    Ok(out)
}

/// Write `bytes` to `<run dir>/<sanitised name>`. Creates the run
/// dir if missing. Refuses writes that would exceed
/// `MAX_BYTES_PER_ARTIFACT` so a misbehaving step can't fill the
/// disk. Overwrites existing files at the same name — that's
/// usually what the user means ("update the report"), and we'd
/// rather take responsibility than silently rename.
pub fn write_artifact(run_id: &str, name: &str, bytes: &[u8]) -> std::io::Result<ArtifactInfo> {
    if bytes.len() as u64 > MAX_BYTES_PER_ARTIFACT {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "artifact too large: {} bytes (limit {} bytes)",
                bytes.len(),
                MAX_BYTES_PER_ARTIFACT
            ),
        ));
    }
    let safe_name = sanitise_segment(name)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("name: {e}")))?;
    let dir = run_dir(run_id)?;
    fs::create_dir_all(&dir)?;
    let path = dir.join(&safe_name);
    fs::write(&path, bytes)?;
    let meta = fs::metadata(&path)?;
    Ok(ArtifactInfo {
        run_id: run_id.to_string(),
        name: safe_name,
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        mtime_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    })
}

/// Resolve an absolute path inside `run_dir(run_id)/<name>`. Errors
/// if the resulting path would be outside the run dir (defence
/// against `..` even though `sanitise_segment` already strips it).
/// Used by IPC handlers that want to read or open the artifact.
pub fn artifact_path(run_id: &str, name: &str) -> std::io::Result<PathBuf> {
    let safe = sanitise_segment(name)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("name: {e}")))?;
    let dir = run_dir(run_id)?;
    let full = dir.join(&safe);
    // Belt-and-braces: stat the dir, walk full's components, ensure
    // it lives under it. Symlink within the artifacts tree would
    // technically still be resolved fine; we don't currently follow
    // them (Linux/macOS default: `fs::canonicalize` would; we don't
    // call it) and the sanitiser already blocks `..`.
    if !full.starts_with(&dir) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "resolved path escapes the run dir",
        ));
    }
    Ok(full)
}

/// Validate a single path segment: no separators, no traversal, no
/// control chars, length cap, not a reserved special name.
fn sanitise_segment(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("empty".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("reserved name".into());
    }
    if trimmed.contains("..") {
        return Err("contains parent traversal".into());
    }
    let mut out = String::with_capacity(trimmed.len());
    for c in trimmed.chars() {
        match c {
            '/' | '\\' => out.push('_'),
            c if (c as u32) < 0x20 => continue, // strip control
            '\u{7F}' => continue,
            c => out.push(c),
        }
    }
    if out.is_empty() {
        return Err("empty after sanitise".into());
    }
    if out.chars().count() > MAX_NAME_CHARS {
        // Truncate keeping the extension if any, so `.csv` survives.
        let path = Path::new(&out);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(&out);
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let keep = MAX_NAME_CHARS.saturating_sub(ext.len() + 1).max(1);
        let mut truncated: String = stem.chars().take(keep).collect();
        if !ext.is_empty() {
            truncated.push('.');
            truncated.push_str(ext);
        }
        out = truncated;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitise_strips_path_separators() {
        assert_eq!(
            sanitise_segment("a/b").expect("sanitise valid input"),
            "a_b"
        );
        assert_eq!(
            sanitise_segment(r"a\b").expect("sanitise valid input"),
            "a_b"
        );
    }

    #[test]
    fn sanitise_rejects_traversal() {
        assert!(sanitise_segment("..").is_err());
        assert!(sanitise_segment("../etc").is_err());
        assert!(sanitise_segment("foo/../bar").is_err());
    }

    #[test]
    fn sanitise_rejects_empty() {
        assert!(sanitise_segment("").is_err());
        assert!(sanitise_segment("   ").is_err());
    }

    #[test]
    fn sanitise_strips_control_chars() {
        let s = sanitise_segment("foo\x00bar\x1fbaz.txt").expect("sanitise valid input");
        assert_eq!(s, "foobarbaz.txt");
    }

    #[test]
    fn sanitise_truncates_long_names_preserving_ext() {
        let long = "a".repeat(300);
        let with_ext = format!("{long}.csv");
        let out = sanitise_segment(&with_ext).expect("sanitise valid input");
        assert!(out.ends_with(".csv"));
        assert!(out.chars().count() <= MAX_NAME_CHARS);
    }

    #[test]
    fn sanitise_keeps_dot_prefix() {
        // `.gitignore` style hidden files are useful artifact names
        // ("." alone is still rejected above).
        assert_eq!(
            sanitise_segment(".gitignore").expect("sanitise valid input"),
            ".gitignore"
        );
    }
}
