//! Phase 7 · T7.3b — session_search panel.
//!
//! Full-text search over Hermes' `~/.hermes/state.db` (Hermes owns
//! the database; we open it READ-ONLY via rusqlite). Hermes ships
//! FTS5 triggers on the `messages` table, so a plain
//! `messages_fts MATCH '<query>'` is all we need. Everything the UI
//! returns comes from upstream — we never persist anything in our
//! own `caduceus.db`.
//!
//! Schema (verified 2026-04-23 against
//! hermes-agent.nousresearch.com/docs/developer-guide/session-storage):
//!
//!   sessions(id TEXT PK, source TEXT, model TEXT, title TEXT,
//!            started_at REAL, ...)
//!   messages(id INTEGER PK, session_id TEXT, role TEXT,
//!            content TEXT, timestamp REAL, ...)
//!   messages_fts USING fts5(content, content=messages)
//!
//! When `~/.hermes/state.db` doesn't exist (fresh Hermes install,
//! never-run, different machine), `search` returns an empty list
//! rather than erroring — matches the "missing file → empty" pattern
//! we use in memory_read and mcp_server_list.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

/// One matching message row surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct SessionSearchHit {
    pub session_id: String,
    /// Session display title; `None` when upstream hasn't titled it.
    pub session_title: Option<String>,
    /// Which platform fed this session (cli, telegram, discord, …).
    /// Useful for the UI to render an origin chip.
    pub session_source: String,
    pub role: String,
    /// FTS5-generated snippet with `>>>match<<<` markers around hits
    /// (Hermes' convention). The UI renders markers as bold spans.
    pub snippet: String,
    /// Unix-epoch seconds (float in SQLite, surfaced as ms for
    /// alignment with the rest of our UI which expects ms).
    pub timestamp_ms: i64,
}

/// Run an FTS5 query against Hermes' session DB and return top-N
/// hits ordered newest-first. Empty query returns an empty list
/// (saves a no-op round-trip — the UI's "did the user type anything
/// yet" gate is optional). `limit` capped at 100 server-side so a
/// mistyped LIMIT param from the UI can't pull the whole DB.
#[tauri::command]
pub async fn session_search(
    _state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> IpcResult<Vec<SessionSearchHit>> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let lim = limit.unwrap_or(50).min(100) as i64;
    let sanitized = sanitize_fts5_query(&q);

    tokio::task::spawn_blocking(move || -> IpcResult<Vec<SessionSearchHit>> {
        let path = state_db_path().map_err(|e| IpcError::Internal {
            message: format!("session_search: {e}"),
        })?;
        if !path.exists() {
            return Ok(Vec::new());
        }

        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| IpcError::Internal {
            message: format!("open state.db: {e}"),
        })?;

        // `snippet(tbl, col, start, end, ellipsis, tokens)` is FTS5's
        // built-in highlighter. Col index 0 is `content`. We bound
        // tokens at 32 so snippets stay inline-sized.
        let sql = "SELECT \
                   m.session_id, \
                   s.title, \
                   COALESCE(s.source, '') AS source, \
                   m.role, \
                   snippet(messages_fts, 0, '>>>', '<<<', '…', 32) AS snip, \
                   m.timestamp \
                 FROM messages_fts \
                 JOIN messages m ON m.id = messages_fts.rowid \
                 JOIN sessions s ON s.id = m.session_id \
                 WHERE messages_fts MATCH ?1 \
                 ORDER BY m.timestamp DESC \
                 LIMIT ?2";

        let mut stmt = conn.prepare(sql).map_err(|e| IpcError::Internal {
            message: format!("prepare search: {e}"),
        })?;

        let rows = stmt
            .query_map((&sanitized, lim), |row| {
                let ts: f64 = row.get(5)?;
                Ok(SessionSearchHit {
                    session_id: row.get(0)?,
                    session_title: row.get(1).ok(),
                    session_source: row.get(2).unwrap_or_default(),
                    role: row.get(3)?,
                    snippet: row.get(4)?,
                    timestamp_ms: (ts * 1000.0) as i64,
                })
            })
            .map_err(|e| IpcError::Internal {
                message: format!("query search: {e}"),
            })?;

        let mut out = Vec::new();
        for r in rows {
            match r {
                Ok(hit) => out.push(hit),
                Err(e) => {
                    return Err(IpcError::Internal {
                        message: format!("row decode: {e}"),
                    });
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("session_search task join: {e}"),
    })?
}

fn state_db_path() -> std::io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "neither $HOME nor %USERPROFILE% set",
            )
        })?;
    Ok(Path::new(&home).join(".hermes").join("state.db"))
}

/// Port of Hermes' `_sanitize_fts5_query`: strips unmatched quotes,
/// wraps hyphenated terms in double quotes (FTS5 treats `-` as
/// exclusion), and drops dangling boolean operators. Matches upstream
/// behaviour so a query that works in Hermes' CLI also works here.
fn sanitize_fts5_query(raw: &str) -> String {
    // Balance double quotes. If there's an odd count, strip them all
    // to avoid a parse error — the user's intent was probably just a
    // typo.
    let quote_count = raw.chars().filter(|c| *c == '"').count();
    let base = if quote_count % 2 != 0 {
        raw.replace('"', " ")
    } else {
        raw.to_string()
    };

    // Tokenize on whitespace; quote hyphenated terms that aren't
    // already quoted.
    let mut tokens: Vec<String> = Vec::new();
    for tok in base.split_whitespace() {
        if tok.contains('-') && !tok.starts_with('"') {
            tokens.push(format!("\"{}\"", tok.trim_matches('"')));
        } else {
            tokens.push(tok.to_string());
        }
    }

    // Drop dangling boolean operators at the end ("hello AND" → "hello").
    while let Some(last) = tokens.last() {
        if matches!(last.as_str(), "AND" | "OR" | "NOT") {
            tokens.pop();
        } else {
            break;
        }
    }

    tokens.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_balances_quotes() {
        // Odd quote count → strip them all (not a parse error).
        assert_eq!(sanitize_fts5_query(r#"foo "bar"#), "foo bar");
        // Even count → leave intact.
        assert_eq!(sanitize_fts5_query(r#"foo "bar""#), r#"foo "bar""#);
    }

    #[test]
    fn sanitize_wraps_hyphenated_terms() {
        // FTS5 treats `-` as exclusion; wrap in quotes to make it a
        // phrase match instead.
        assert_eq!(sanitize_fts5_query("chat-send"), "\"chat-send\"");
        assert_eq!(
            sanitize_fts5_query("logs chat-send error"),
            "logs \"chat-send\" error"
        );
    }

    #[test]
    fn sanitize_drops_trailing_operators() {
        assert_eq!(sanitize_fts5_query("hello AND"), "hello");
        assert_eq!(sanitize_fts5_query("hello AND OR NOT"), "hello");
        assert_eq!(sanitize_fts5_query("hello AND world"), "hello AND world");
    }

    #[test]
    fn empty_and_whitespace_queries_sanitise_to_empty() {
        assert_eq!(sanitize_fts5_query(""), "");
        assert_eq!(sanitize_fts5_query("   \t\n  "), "");
    }
}
