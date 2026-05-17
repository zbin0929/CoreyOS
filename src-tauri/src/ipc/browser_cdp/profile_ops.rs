//! Read + maintenance operations against the dedicated AI Browser
//! Chromium profile (`~/.hermes/chrome-debug/Default/`).
//!
//! Currently three entry points:
//!   - [`list_logged_in_domains`]: read-only sqlite peek to render
//!     "Logged-in sites" in the Settings panel. Best-effort; any
//!     failure (no profile yet / sqlite lock / future schema change)
//!     returns empty so the UI degrades gracefully.
//!   - [`clear_cookies_sync`]: nuke the entire profile dir. Used by
//!     Settings → "Sign out of everything" + MCP `browser_clear`.
//!     Refuses to run while Chrome is alive (sqlite is locked).
//!   - [`clear_domain_sync`]: targeted delete on a single host_key
//!     pair (exact + dotted variant). Used by Settings → per-row
//!     "Sign out" button + MCP `browser_clear_domain`.
//!
//! Extracted from `browser_cdp.rs` 2026-05-17. All three functions
//! depend on parent-module helpers (`profile_dir`, `port_is_listening`,
//! `build_status`, `CDP_PORT`); we access those via `super::` so the
//! parent doesn't need to widen visibility.

use crate::error::{IpcError, IpcResult};

use super::{build_status, port_is_listening, profile_dir, BrowserCdpStatus, CDP_PORT};

/// Read the dedicated profile's `Cookies` sqlite and return the set
/// of distinct host keys with persistent cookies. Returns an empty
/// vec on any failure (no profile yet, sqlite locked, schema
/// mismatch on a future Chrome version) — the UI treats that as "no
/// data" rather than an error, which is the right call for a
/// non-essential informational column.
pub(super) fn list_logged_in_domains() -> Vec<String> {
    let Ok(dir) = profile_dir() else {
        return Vec::new();
    };
    // The default profile's cookie store. Chrome supports multiple
    // profiles ("Profile 1", "Profile 2", ...) but we never create
    // them — the dedicated AI Browser only ever has Default.
    let cookies_db = dir.join("Default").join("Cookies");
    if !cookies_db.exists() {
        return Vec::new();
    }
    use rusqlite::{Connection, OpenFlags};
    let Ok(conn) = Connection::open_with_flags(
        &cookies_db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    // Filter `host_key != ''` to drop blank rows; we don't filter on
    // `expires_utc` because session cookies (expires=0) still imply
    // the user has visited and Chrome remembers state. Cap at 200
    // raw rows so the dedupe + sort cost stays bounded if a power
    // user has been browsing for years.
    let Ok(mut stmt) =
        conn.prepare("SELECT DISTINCT host_key FROM cookies WHERE host_key != '' LIMIT 200")
    else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    let mut domains: Vec<String> = rows
        .filter_map(Result::ok)
        // Chrome sometimes prefixes with '.' for cross-subdomain
        // cookies (".example.com"). Normalize so example.com and
        // .example.com aren't shown as two entries.
        .map(|d| d.trim_start_matches('.').to_string())
        .filter(|d| !d.is_empty())
        .collect();
    domains.sort();
    domains.dedup();
    // 50 is plenty for a panel — power users with hundreds of sites
    // can still see everything by inspecting the profile path
    // directly via the "Technical details" disclosure.
    domains.truncate(50);
    domains
}

pub(crate) fn clear_domain_sync(domain: &str) -> IpcResult<BrowserCdpStatus> {
    if port_is_listening(CDP_PORT) {
        return Err(IpcError::Internal {
            message: "Please quit the AI Browser window first (Chrome locks the cookies database \
                      while running)."
                .to_string(),
        });
    }
    let target = domain.trim().trim_start_matches('.').to_string();
    if target.is_empty() {
        return Err(IpcError::Internal {
            message: "domain is empty".to_string(),
        });
    }
    let dir = profile_dir()?;
    let cookies_db = dir.join("Default").join("Cookies");
    if !cookies_db.exists() {
        // Nothing to clear; return current snapshot rather than a
        // confusing "no profile" error.
        return Ok(build_status());
    }
    use rusqlite::{params, Connection};
    let conn = Connection::open(&cookies_db).map_err(|e| IpcError::Internal {
        message: format!("open cookies db: {e}"),
    })?;
    let dotted = format!(".{target}");
    let affected = conn
        .execute(
            "DELETE FROM cookies WHERE host_key = ?1 OR host_key = ?2",
            params![target, dotted],
        )
        .map_err(|e| IpcError::Internal {
            message: format!("delete cookies for {target}: {e}"),
        })?;
    tracing::info!(domain = %target, rows = affected, "cleared per-domain cookies");
    Ok(build_status())
}

pub(crate) fn clear_cookies_sync() -> IpcResult<BrowserCdpStatus> {
    if port_is_listening(CDP_PORT) {
        return Err(IpcError::Internal {
            message: "Please quit the AI Browser window first (Chrome must be closed before its profile can be wiped).".to_string(),
        });
    }
    let dir = profile_dir()?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| IpcError::Internal {
            message: format!("remove profile dir {}: {e}", dir.display()),
        })?;
    }
    Ok(build_status())
}
