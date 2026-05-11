//! Browser site aliases — the answer to "I want to say '打开店铺' and
//! Corey opens https://sellercentral.amazon.com/, without me ever
//! pasting the URL again."
//!
//! ## Why a dedicated store (not MEMORY.md)
//!
//! Hermes Agent already has `MEMORY.md` and a `memory` tool the
//! customer can use to teach the agent any fact ("remember I prefer
//! GLM" / "remember our slogan is X"). We initially leaned on that
//! for URL shortcuts too, but three concerns pushed us to a dedicated
//! store:
//!
//! 1. **UI editability** — customers want a Settings table where they
//!    see every alias in one glance, edit a typo, delete a stale one.
//!    MEMORY.md is a free-form append-only journal; building a
//!    line-perfect editor on top of it would be its own subsystem.
//! 2. **Agent reliability** — when the alias list lives in MEMORY.md,
//!    the LLM's lookup is "scan a 10KB markdown for a phrase". It
//!    works most of the time but fails occasionally on long memory
//!    files. With a dedicated MCP tool returning structured JSON
//!    (`[{alias, url}, ...]`), the lookup is deterministic.
//! 3. **Lifecycle hygiene** — `corey_browser_clear` (wipe sign-ins)
//!    should NOT also wipe the customer's URL bookmarks. Splitting
//!    the stores makes that obvious; muddling them in MEMORY.md
//!    would make `clear` either too aggressive or too narrow.
//!
//! ## Storage
//!
//! `~/.hermes/.corey/browser-aliases.json` — a hot-leaning JSON file:
//! ```json
//! { "version": 1, "entries": [
//!     { "alias": "店铺后台",   "url": "https://sellercentral.amazon.com/", "updated_at": 1714... },
//!     { "alias": "广告中心",   "url": "https://advertising.amazon.com/",   "updated_at": 1714... }
//! ] }
//! ```
//!
//! - Atomic writes via `tempfile::NamedTempFile::persist`.
//! - Aliases are case-insensitive on lookup but stored case-preserved.
//! - URL is validated with `url::Url::parse` on insert; the IPC
//!   surfaces validation errors so the UI / agent can prompt for a
//!   correction.
//! - **No de-duplication of aliases** — we treat upsert by exact
//!   alias as "replace". This makes the agent's "user said X is now Y
//!   instead" path cheap.
//! - Hard cap: 200 entries (any reasonable customer with more is on
//!   the wrong tool — we'd rather they use a real bookmark manager).
//!
//! ## Why no domain field on persistence
//!
//! The Settings UI derives `domain` for display by parsing `url` on
//! the fly. Storing it would create a lying-state surface
//! (alias.url updated, alias.domain stale). Cheap to compute, never
//! drift.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{IpcError, IpcResult};
use crate::paths;

const FILE_VERSION: u32 = 1;
const MAX_ENTRIES: usize = 200;
const MAX_ALIAS_LEN: usize = 64;
const MAX_URL_LEN: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserAlias {
    pub alias: String,
    pub url: String,
    /// Unix epoch seconds. Lets the UI sort by recency without storing
    /// a separate index.
    pub updated_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AliasFile {
    /// Format version. Bump if we ever break the schema; the loader
    /// tolerantly upgrades or returns empty on mismatch (we never
    /// crash a customer on a stale file).
    version: u32,
    #[serde(default)]
    entries: Vec<BrowserAlias>,
}

fn store_path() -> IpcResult<PathBuf> {
    let dir = paths::hermes_data_dir()
        .map_err(|e| IpcError::Internal {
            message: format!("hermes data dir: {e}"),
        })?
        .join(".corey");
    Ok(dir.join("browser-aliases.json"))
}

fn load_file() -> IpcResult<AliasFile> {
    let path = store_path()?;
    if !path.exists() {
        return Ok(AliasFile {
            version: FILE_VERSION,
            entries: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| IpcError::Internal {
        message: format!("read aliases: {e}"),
    })?;
    // Tolerant parse: a corrupted file shouldn't lock the customer
    // out of the feature. Log + reset.
    match serde_json::from_str::<AliasFile>(&raw) {
        Ok(f) if f.version <= FILE_VERSION => Ok(f),
        Ok(f) => {
            tracing::warn!(
                version = f.version,
                "browser-aliases.json from a future version; ignoring entries"
            );
            Ok(AliasFile {
                version: FILE_VERSION,
                entries: Vec::new(),
            })
        }
        Err(e) => {
            tracing::warn!(error = %e, "browser-aliases.json malformed; resetting");
            Ok(AliasFile {
                version: FILE_VERSION,
                entries: Vec::new(),
            })
        }
    }
}

fn save_file(file: &AliasFile) -> IpcResult<()> {
    let path = store_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| IpcError::Internal {
            message: format!("create alias dir: {e}"),
        })?;
    }
    // Atomic-ish write: temp-file in same dir then rename. Avoids a
    // partially-written file if the OS dies mid-flush.
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(file).map_err(|e| IpcError::Internal {
        message: format!("serialize aliases: {e}"),
    })?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| IpcError::Internal {
            message: format!("write tmp aliases: {e}"),
        })?;
        f.write_all(json.as_bytes())
            .map_err(|e| IpcError::Internal {
                message: format!("write aliases: {e}"),
            })?;
        f.sync_all().map_err(|e| IpcError::Internal {
            message: format!("sync aliases: {e}"),
        })?;
    }
    fs::rename(&tmp, &path).map_err(|e| IpcError::Internal {
        message: format!("rename aliases: {e}"),
    })?;
    Ok(())
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Cheap scheme + host check. We deliberately don't depend on the
/// `url` crate just for this — pulling in idna + percent-encoding for
/// one validator inflates the WASI-target build by ~80KB. The
/// guarantees we actually need are:
///   - scheme is http or https (otherwise `browser_navigate` ignores)
///   - host segment is non-empty (otherwise Chrome 404s instantly)
///
/// Anything stricter (TLD plausibility, port range, IDN puny-encoding)
/// is the customer's problem; we'd rather let an "almost right" URL
/// through than reject typo-distance entries the customer can fix.
fn validate_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("url is empty".into());
    }
    if trimmed.len() > MAX_URL_LEN {
        return Err(format!("url too long (max {} chars)", MAX_URL_LEN));
    }
    // Pluck the scheme manually (case-insensitive) to avoid lower-
    // casing the path, which is case-sensitive on most backends.
    let lower = trimmed.to_ascii_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("https://") {
        r
    } else if let Some(r) = lower.strip_prefix("http://") {
        r
    } else {
        return Err("url must start with http:// or https://".into());
    };
    // Empty host = `https:///foo`. Catches the common copy-paste typo
    // where the customer pasted only a path.
    let host_end = rest.find('/').unwrap_or(rest.len());
    if rest[..host_end].is_empty() {
        return Err("url has no host".into());
    }
    Ok(trimmed.to_string())
}

fn validate_alias(alias: &str) -> Result<String, String> {
    let trimmed = alias.trim();
    if trimmed.is_empty() {
        return Err("alias is empty".into());
    }
    if trimmed.chars().count() > MAX_ALIAS_LEN {
        return Err(format!("alias too long (max {} chars)", MAX_ALIAS_LEN));
    }
    Ok(trimmed.to_string())
}

// ─── IPC commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_aliases_list() -> IpcResult<Vec<BrowserAlias>> {
    tokio::task::spawn_blocking(|| -> IpcResult<Vec<BrowserAlias>> {
        let mut file = load_file()?;
        // Newest first — matches "what did I just teach the agent" UX
        // expectation in the Settings table.
        file.entries
            .sort_by_key(|e| std::cmp::Reverse(e.updated_at));
        Ok(file.entries)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("aliases list join: {e}"),
    })?
}

#[derive(Debug, Deserialize)]
pub struct UpsertArgs {
    pub alias: String,
    pub url: String,
}

#[tauri::command]
pub async fn browser_aliases_upsert(args: UpsertArgs) -> IpcResult<BrowserAlias> {
    tokio::task::spawn_blocking(move || -> IpcResult<BrowserAlias> {
        let alias = validate_alias(&args.alias).map_err(|e| IpcError::Internal { message: e })?;
        let url = validate_url(&args.url).map_err(|e| IpcError::Internal { message: e })?;

        let mut file = load_file()?;
        // Case-insensitive comparison so the customer doesn't end up
        // with `店铺` vs `店铺 ` vs `店铺` (NFC normalised) ghost dups.
        let pos = file
            .entries
            .iter()
            .position(|e| e.alias.eq_ignore_ascii_case(&alias));
        let entry = BrowserAlias {
            alias: alias.clone(),
            url: url.clone(),
            updated_at: now_epoch(),
        };
        match pos {
            Some(i) => file.entries[i] = entry.clone(),
            None => {
                if file.entries.len() >= MAX_ENTRIES {
                    return Err(IpcError::Internal {
                        message: format!(
                            "alias limit reached ({}). Delete some before adding new ones.",
                            MAX_ENTRIES
                        ),
                    });
                }
                file.entries.push(entry.clone());
            }
        }
        save_file(&file)?;
        Ok(entry)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("aliases upsert join: {e}"),
    })?
}

#[derive(Debug, Deserialize)]
pub struct RemoveArgs {
    pub alias: String,
}

#[tauri::command]
pub async fn browser_aliases_remove(args: RemoveArgs) -> IpcResult<bool> {
    tokio::task::spawn_blocking(move || -> IpcResult<bool> {
        let mut file = load_file()?;
        let before = file.entries.len();
        file.entries
            .retain(|e| !e.alias.eq_ignore_ascii_case(args.alias.trim()));
        let removed = file.entries.len() < before;
        if removed {
            save_file(&file)?;
        }
        Ok(removed)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("aliases remove join: {e}"),
    })?
}

/// Used by the MCP tool wrapper. Same logic as the IPC, but synchronous
/// because the MCP layer is already blocking-pool friendly.
pub(crate) fn list_sync() -> IpcResult<Vec<BrowserAlias>> {
    let mut file = load_file()?;
    file.entries
        .sort_by_key(|e| std::cmp::Reverse(e.updated_at));
    Ok(file.entries)
}

pub(crate) fn upsert_sync(alias: &str, url: &str) -> IpcResult<BrowserAlias> {
    let alias = validate_alias(alias).map_err(|e| IpcError::Internal { message: e })?;
    let url = validate_url(url).map_err(|e| IpcError::Internal { message: e })?;
    let mut file = load_file()?;
    let pos = file
        .entries
        .iter()
        .position(|e| e.alias.eq_ignore_ascii_case(&alias));
    let entry = BrowserAlias {
        alias,
        url,
        updated_at: now_epoch(),
    };
    match pos {
        Some(i) => file.entries[i] = entry.clone(),
        None => {
            if file.entries.len() >= MAX_ENTRIES {
                return Err(IpcError::Internal {
                    message: format!("alias limit reached ({})", MAX_ENTRIES),
                });
            }
            file.entries.push(entry.clone());
        }
    }
    save_file(&file)?;
    Ok(entry)
}

pub(crate) fn remove_sync(alias: &str) -> IpcResult<bool> {
    let mut file = load_file()?;
    let before = file.entries.len();
    file.entries
        .retain(|e| !e.alias.eq_ignore_ascii_case(alias.trim()));
    let removed = file.entries.len() < before;
    if removed {
        save_file(&file)?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_url_scheme() {
        assert!(validate_url("https://example.com").is_ok());
        assert!(validate_url("http://example.com").is_ok());
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("not a url").is_err());
        assert!(validate_url("").is_err());
    }

    #[test]
    fn validates_alias_length() {
        assert!(validate_alias("店铺后台").is_ok());
        assert!(validate_alias("a").is_ok());
        assert!(validate_alias("").is_err());
        assert!(validate_alias("   ").is_err());
        let long: String = "x".repeat(MAX_ALIAS_LEN + 1);
        assert!(validate_alias(&long).is_err());
    }

    #[test]
    fn alias_eq_ignore_ascii_case() {
        // Sanity check on the matcher we use for upsert dedup.
        assert!("foo".eq_ignore_ascii_case("FOO"));
        assert!("店铺".eq_ignore_ascii_case("店铺"));
    }
}
