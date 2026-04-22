//! Tail N lines from one of Hermes's log files. These live under
//! `~/.hermes/logs/` — `agent.log`, `gateway.log`, `error.log`. Files
//! rotate externally (Hermes manages rotation); we just read the current
//! file.
//!
//! Phase 2.6 deliberately keeps this simple: read-on-demand, no `notify`
//! watcher, no streaming, no level parsing. The UI calls
//! `hermes_log_tail` on mount and whenever the user hits Refresh.
//! Upgrading to a streaming tail (SSE events + `notify`) is Phase 3
//! territory when the log volume starts to matter.
//!
//! ## Correctness notes
//! - We do a full-file read and keep the last N lines. For the tiny log
//!   files we see today (< a few MB after rotation) this is faster than
//!   the book-keeping a seek-from-end approach requires, and it's trivial
//!   to get right. If logs balloon we'll add a size guard before blindly
//!   reading (< O(filesize) always wins over O(N) when N dominates).
//! - UTF-8 is not guaranteed in arbitrary log writers. We lossy-convert
//!   so a malformed byte doesn't kill the tail.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Which of Hermes's rolling log files to read.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogKind {
    Agent,
    Gateway,
    Error,
}

impl LogKind {
    fn filename(self) -> &'static str {
        match self {
            LogKind::Agent => "agent.log",
            LogKind::Gateway => "gateway.log",
            LogKind::Error => "error.log",
        }
    }
}

/// Resolved location of a log file. Does NOT guarantee the file exists —
/// the tail operation handles missing-file as an empty response so a
/// brand-new Hermes install doesn't look like an error.
pub fn log_path(kind: LogKind, home_override: Option<&Path>) -> PathBuf {
    let home = home_override.map(Path::to_path_buf).unwrap_or_else(|| {
        // `std::env::home_dir` is deprecated but `dirs` already pulled in.
        // Re-resolve with the same fallback the rest of the crate uses.
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    });
    home.join(".hermes/logs").join(kind.filename())
}

/// Response shape for the `hermes_log_tail` IPC. Carries the resolved
/// path so the UI can surface it (e.g. "No log yet at <path>").
#[derive(Debug, Clone, Serialize)]
pub struct LogTail {
    pub path: String,
    /// `true` when the file didn't exist. `lines` will be empty.
    pub missing: bool,
    /// Last N lines in chronological order (oldest first). Newlines
    /// stripped; empty lines preserved to keep positions stable.
    pub lines: Vec<String>,
    /// Total lines in the file, before truncation. Lets the UI show
    /// "Showing last 500 of 12,340 lines".
    pub total_lines: usize,
}

/// Core tail operation. Pure function of (path, max_lines) so it's easy
/// to test with a tempdir.
pub fn tail_log_at(path: &Path, max_lines: usize) -> io::Result<LogTail> {
    let path_str = path.display().to_string();
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Ok(LogTail {
                path: path_str,
                missing: true,
                lines: Vec::new(),
                total_lines: 0,
            });
        }
        Err(e) => return Err(e),
    };
    let text = String::from_utf8_lossy(&bytes);

    // Split on '\n'; trim a trailing empty line that the file-ends-with-
    // newline convention produces, but preserve interior empties.
    let mut all: Vec<&str> = text.split('\n').collect();
    if all.last().is_some_and(|s| s.is_empty()) {
        all.pop();
    }
    let total_lines = all.len();

    let take_from = total_lines.saturating_sub(max_lines);
    let lines: Vec<String> = all[take_from..].iter().map(|s| s.to_string()).collect();

    Ok(LogTail {
        path: path_str,
        missing: false,
        lines,
        total_lines,
    })
}

/// IPC-facing convenience: resolve path for `kind` and tail.
pub fn tail_log(kind: LogKind, max_lines: usize) -> io::Result<LogTail> {
    tail_log_at(&log_path(kind, None), max_lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Cheap unique tempdir without the `tempfile` crate — same shape as
    /// other tests in this crate (see `config.rs::tempfile_dir`).
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!(
                "caduceus-logs-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ));
            fs::create_dir_all(&base).unwrap();
            Self(base)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_log(dir: &Path, name: &str, contents: &str) -> PathBuf {
        let path = dir.join(name);
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(contents.as_bytes()).unwrap();
        path
    }

    #[test]
    fn tail_returns_last_n_in_chronological_order() {
        let tmp = TempDir::new();
        let p = write_log(tmp.path(), "x.log", "a\nb\nc\nd\ne\n");

        let got = tail_log_at(&p, 3).unwrap();
        assert!(!got.missing);
        assert_eq!(got.total_lines, 5);
        assert_eq!(got.lines, vec!["c", "d", "e"]);
    }

    #[test]
    fn tail_with_max_larger_than_file_returns_all_lines() {
        let tmp = TempDir::new();
        let p = write_log(tmp.path(), "x.log", "one\ntwo\n");

        let got = tail_log_at(&p, 100).unwrap();
        assert_eq!(got.total_lines, 2);
        assert_eq!(got.lines, vec!["one", "two"]);
    }

    #[test]
    fn tail_missing_file_reports_missing_without_error() {
        let tmp = TempDir::new();
        let p = tmp.path().join("nope.log");

        let got = tail_log_at(&p, 10).unwrap();
        assert!(got.missing);
        assert_eq!(got.total_lines, 0);
        assert!(got.lines.is_empty());
    }

    #[test]
    fn tail_preserves_interior_empty_lines() {
        // If a log has a blank line between entries we want to keep it —
        // otherwise the UI's line count diverges from the file.
        let tmp = TempDir::new();
        let p = write_log(tmp.path(), "x.log", "a\n\nb\n");

        let got = tail_log_at(&p, 10).unwrap();
        assert_eq!(got.lines, vec!["a", "", "b"]);
        assert_eq!(got.total_lines, 3);
    }

    #[test]
    fn tail_handles_file_without_trailing_newline() {
        let tmp = TempDir::new();
        let p = write_log(tmp.path(), "x.log", "a\nb\nc");

        let got = tail_log_at(&p, 10).unwrap();
        assert_eq!(got.lines, vec!["a", "b", "c"]);
        assert_eq!(got.total_lines, 3);
    }

    #[test]
    fn log_kind_filenames() {
        // Regression guard against accidental renames leaking into the
        // Hermes contract.
        assert_eq!(LogKind::Agent.filename(), "agent.log");
        assert_eq!(LogKind::Gateway.filename(), "gateway.log");
        assert_eq!(LogKind::Error.filename(), "error.log");
    }

    #[test]
    fn log_path_honors_home_override() {
        let p = log_path(LogKind::Agent, Some(Path::new("/tmp/fakehome")));
        assert_eq!(p, PathBuf::from("/tmp/fakehome/.hermes/logs/agent.log"));
    }
}
