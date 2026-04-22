//! JSONL mutation journal.
//!
//! Every config-altering IPC appends one entry to `changelog.jsonl` in the
//! app data dir. Format:
//!
//! ```jsonl
//! {"id":"2026-04-22T06:30:00.123Z-4","ts":"2026-04-22T06:30:00.123Z","op":"hermes.config.model","before":{...},"after":{...},"summary":"provider: deepseek → openai"}
//! ```
//!
//! The journal is append-only and never rewritten; old entries remain as
//! historical record even after a revert (which itself appends a fresh
//! entry). Phase 2.8 adds a revert UI; for now we just record.
//!
//! Tolerant reader: a torn trailing line (mid-write crash) is skipped, not
//! a fatal error — standard JSONL practice.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::fs_atomic;

/// Monotonic tiebreaker so two entries produced in the same millisecond still
/// get distinct ids. Session-local; a restart resets it which is fine because
/// the id also encodes the timestamp.
static SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    /// `<ISO-8601 timestamp>-<session-seq>`.
    pub id: String,
    /// RFC3339 UTC.
    pub ts: String,
    /// Dotted namespace, e.g. `hermes.config.model`, `hermes.env.key`.
    pub op: String,
    /// Optional prior state (JSON); `null` for creations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<Value>,
    /// New state (JSON); `null` for deletions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<Value>,
    /// Human-readable one-liner for UI display.
    pub summary: String,
}

/// Append one entry. Caller owns the `op` namespace and the `summary` wording.
pub fn append(
    path: &Path,
    op: impl Into<String>,
    before: Option<Value>,
    after: Option<Value>,
    summary: impl Into<String>,
) -> io::Result<Entry> {
    let now = Utc::now();
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let entry = Entry {
        id: format!("{}-{}", now.to_rfc3339(), seq),
        ts: now.to_rfc3339(),
        op: op.into(),
        before,
        after,
        summary: summary.into(),
    };
    let line =
        serde_json::to_string(&entry).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs_atomic::append_line(path, &line)?;
    Ok(entry)
}

/// Read the last `limit` entries, newest-first. Torn tail lines are skipped.
pub fn tail(path: &Path, limit: usize) -> io::Result<Vec<Entry>> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut out: Vec<Entry> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Entry>(l).ok())
        .collect();
    // Newest first.
    out.reverse();
    if out.len() > limit {
        out.truncate(limit);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "caduceus-changelog-{}-{}-{}",
            tag,
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&p).unwrap();
        p.join("changelog.jsonl")
    }

    #[test]
    fn append_then_tail_roundtrip() {
        let path = tmp("roundtrip");
        append(
            &path,
            "test.op",
            Some(serde_json::json!({"x": 1})),
            Some(serde_json::json!({"x": 2})),
            "x: 1 → 2",
        )
        .unwrap();
        append(
            &path,
            "test.op",
            None,
            Some(serde_json::json!({"y": true})),
            "init y",
        )
        .unwrap();

        let entries = tail(&path, 10).unwrap();
        assert_eq!(entries.len(), 2);
        // Newest-first ordering.
        assert_eq!(entries[0].summary, "init y");
        assert_eq!(entries[1].summary, "x: 1 → 2");
        assert!(entries[0].before.is_none());
        assert_eq!(entries[1].after, Some(serde_json::json!({"x": 2})));
    }

    #[test]
    fn tail_returns_empty_on_missing_file() {
        let path = std::env::temp_dir()
            .join(format!("caduceus-changelog-missing-{}", std::process::id()))
            .join("nope.jsonl");
        let entries = tail(&path, 5).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn tail_skips_torn_trailing_line() {
        let path = tmp("torn");
        append(&path, "ok", None, None, "fine").unwrap();
        // Simulate a mid-write crash: partial JSON appended after the good line.
        fs_atomic::append_line(&path, "{\"id\":\"bad\",\"op\":").unwrap();

        let entries = tail(&path, 10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].summary, "fine");
    }

    #[test]
    fn tail_respects_limit() {
        let path = tmp("limit");
        for i in 0..5 {
            append(
                &path,
                "n",
                None,
                Some(serde_json::json!({"i": i})),
                format!("{i}"),
            )
            .unwrap();
        }
        let entries = tail(&path, 2).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].summary, "4");
        assert_eq!(entries[1].summary, "3");
    }
}
