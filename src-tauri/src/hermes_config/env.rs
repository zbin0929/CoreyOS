//! `~/.hermes/.env` API-key discovery + safe writes. Split out of the
//! parent module so `mod.rs` stays focused on the YAML model section.
//!
//! All writes go through `fs_atomic::write_atomic` and the changelog
//! journal so users can audit / undo changes via the Logs tab.

use std::fs;
use std::io;
use std::path::Path;

use crate::changelog;
use crate::fs_atomic;

use super::env_path;

pub fn read_env_value(key: &str) -> io::Result<Option<String>> {
    if !is_allowed_env_key(key) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("refusing to read non-API-key env var: {key}"),
        ));
    }
    let path = env_path()?;
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    for line in raw.lines() {
        if !line_matches_key(line, key) {
            continue;
        }
        let Some((_, value)) = line.split_once('=') else {
            continue;
        };
        let val = value.trim().trim_matches('"').trim_matches('\'');
        if val.is_empty() {
            return Ok(None);
        }
        return Ok(Some(val.to_string()));
    }
    Ok(None)
}

/// Parse `.env` and return the KEYS of any `*_API_KEY=nonempty` lines.
/// We deliberately drop the values — the UI never needs them, and passing
/// secrets over IPC is an anti-pattern.
pub(super) fn read_env_key_names() -> io::Result<Vec<String>> {
    let path = env_path()?;
    let raw = fs::read_to_string(&path)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            if !key.ends_with("_API_KEY") {
                continue;
            }
            // Treat unquoted empty and pure whitespace as unset.
            let val = value.trim().trim_matches('"').trim_matches('\'');
            if !val.is_empty() {
                out.push(key.to_string());
            }
        }
    }
    Ok(out)
}

/// Upsert or delete a key in `~/.hermes/.env`, preserving every other line
/// (comments, blanks, order). If `value` is `None` or empty, the existing
/// line is removed. If the key doesn't exist yet, it's appended at the end.
///
/// Only `*_API_KEY` names are permitted to avoid accidental corruption of
/// non-secret config via this endpoint.
pub fn write_env_key(
    key: &str,
    value: Option<&str>,
    journal_path: Option<&Path>,
) -> io::Result<()> {
    if !is_allowed_env_key(key) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("refusing to write non-API-key env var: {key}"),
        ));
    }

    let path = env_path()?;
    let raw = fs::read_to_string(&path).unwrap_or_default();
    let was_present = raw.lines().any(|l| line_matches_key(l, key));

    let mut out = String::with_capacity(raw.len() + 64);
    let mut found = false;
    let should_delete = value.map(str::is_empty).unwrap_or(true);
    let target_value = value.unwrap_or("");

    for line in raw.lines() {
        if line_matches_key(line, key) {
            found = true;
            if !should_delete {
                out.push_str(key);
                out.push('=');
                out.push_str(target_value);
                out.push('\n');
            }
            // else: skip, effectively deleting the line
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }

    while out.ends_with("\n\n") {
        out.pop();
    }

    if !found && !should_delete {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(key);
        out.push('=');
        out.push_str(target_value);
        out.push('\n');
    }

    // 0o600 so api keys are owner-only. `atomic_write` applies perms to the
    // tmp file BEFORE rename, closing the window where the final file briefly
    // had default perms.
    fs_atomic::atomic_write(&path, out.as_bytes(), Some(0o600))?;

    if let Some(jp) = journal_path {
        let summary = if should_delete {
            format!("env: -{key}")
        } else if was_present {
            format!("env: {key} (updated)")
        } else {
            format!("env: +{key}")
        };
        // before/after record PRESENCE only — never secret values.
        let _ = changelog::append(
            jp,
            "hermes.env.key",
            Some(serde_json::json!({ "key": key, "present": was_present })),
            Some(serde_json::json!({ "key": key, "present": !should_delete })),
            summary,
        );
    }
    Ok(())
}

/// True for env keys the UI is allowed to read/write. Today: any
/// uppercase `*_API_KEY`, plus any env var declared by a channel
/// spec. Locks the IPC layer down to the named providers — the
/// surface never lets the frontend introspect arbitrary env vars.
pub(super) fn is_allowed_env_key(key: &str) -> bool {
    if key.is_empty() {
        return false;
    }
    let shape_ok = key
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    if !shape_ok {
        return false;
    }
    // Original rule: any `*_API_KEY` name (model providers — Phase 2).
    if key.ends_with("_API_KEY") {
        return true;
    }
    // Phase 3: any env name declared by a channel spec. Keeps the
    // allowlist tight — we never let the UI write arbitrary env vars.
    crate::channels::allowed_channel_env_keys()
        .iter()
        .any(|s| s == key)
}

/// Returns `true` when `line` (after trimming leading whitespace, ignoring
/// comments) assigns `key`. Handles `  KEY=value`, `KEY =value`, etc.
pub(super) fn line_matches_key(line: &str, key: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with('#') {
        return false;
    }
    let Some(eq) = trimmed.find('=') else {
        return false;
    };
    trimmed[..eq].trim() == key
}
