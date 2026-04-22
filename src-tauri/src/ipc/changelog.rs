//! Changelog journal IPC.
//!
//! `changelog_list` reads the journal newest-first for display.
//!
//! `changelog_revert(id)` dispatches by the entry's `op` field back to the
//! adapter module that originally wrote. Each revert is itself journaled
//! (as a new entry with op `<orig>.revert`), so the history is append-only
//! forever — reverts can themselves be reverted.
//!
//! **Not everything is revertible.** `hermes.env.key` entries only record
//! presence (never the secret value), so undoing a key deletion is literally
//! impossible — we return a clear error rather than pretending.

use tauri::State;

use crate::changelog::{self, Entry};
use crate::error::{IpcError, IpcResult};
use crate::hermes_config::{self, HermesModelSection};
use crate::hermes_profiles as hp;
use crate::state::AppState;

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;

#[tauri::command]
pub async fn changelog_list(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> IpcResult<Vec<Entry>> {
    let lim = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let path = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || changelog::tail(&path, lim))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("changelog join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("read changelog: {e}"),
        })
}

/// Returned so the UI can immediately refresh its list without a separate
/// `changelog_list` round-trip.
#[derive(Debug, serde::Serialize)]
pub struct RevertReport {
    /// The fresh entry we just appended describing the revert itself.
    pub revert_entry: Entry,
}

#[tauri::command]
pub async fn changelog_revert(
    entry_id: String,
    state: State<'_, AppState>,
) -> IpcResult<RevertReport> {
    let path = state.changelog_path.clone();

    // Blocking I/O + potentially a YAML write — off the async executor.
    tokio::task::spawn_blocking(move || -> IpcResult<RevertReport> {
        let entry = changelog::find(&path, &entry_id)
            .map_err(|e| IpcError::Internal {
                message: format!("lookup entry: {e}"),
            })?
            .ok_or_else(|| IpcError::NotConfigured {
                hint: format!("changelog entry not found: {entry_id}"),
            })?;
        apply_revert(&path, &entry)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("revert join: {e}"),
    })?
}

/// Dispatch the inverse of `entry` against the on-disk state. Extracted
/// so unit tests can exercise the full switch without a running Tauri
/// command. Returns the fresh changelog entry the inverse appended (so
/// the caller can echo it back in the IPC reply without a re-read).
pub fn apply_revert(path: &std::path::Path, entry: &Entry) -> IpcResult<RevertReport> {
    match entry.op.as_str() {
        "hermes.config.model" => {
            // Restore `before` into hermes config.yaml. When `before` is
            // absent (creation entry), an empty model section is the
            // right inverse.
            let before_model: HermesModelSection = match &entry.before {
                Some(v) => serde_json::from_value(v.clone()).map_err(|e| IpcError::Protocol {
                    detail: format!("malformed before-state: {e}"),
                })?,
                None => HermesModelSection::default(),
            };
            hermes_config::write_model(&before_model, Some(path)).map_err(|e| {
                IpcError::Internal {
                    message: format!("revert write_model: {e}"),
                }
            })?;
            // Latest entry on disk is the revert we just appended.
            let latest = changelog::tail(path, 1)
                .map_err(|e| IpcError::Internal {
                    message: format!("read back revert: {e}"),
                })?
                .into_iter()
                .next()
                .ok_or_else(|| IpcError::Internal {
                    message: "revert appended but journal empty".into(),
                })?;
            Ok(RevertReport {
                revert_entry: latest,
            })
        }
        "hermes.env.key" => Err(IpcError::Unsupported {
            capability: "env key revert (secret not retained)".into(),
        }),

        // P2-follow-up — profile op reverts. Each revert calls the
        // inverse hp:: function with Some(path), which appends its
        // own fresh changelog entry so the history stays append-only.
        //
        // Contract per op:
        //   create → delete (refuses active; the inverse is trivial).
        //   rename (from → to) → rename (to → from).
        //   clone (src → dst) → delete (dst). Same-profile-active
        //     refusal applies.
        //   delete → re-create with a seed config.yaml. The original
        //     `.env`, skills etc. CANNOT be restored — we warn the
        //     caller via a Protocol error so the user learns that
        //     delete-reverts are effectively new-empty-profile.
        "hermes.profile.create" => {
            let name = pluck_name(&entry.after).ok_or_else(|| IpcError::Protocol {
                detail: "profile create entry missing after.name".into(),
            })?;
            hp::delete_profile(&name, Some(path)).map_err(|e| IpcError::Internal {
                message: format!("revert profile.create: {e}"),
            })?;
            read_latest(path).map(|revert_entry| RevertReport { revert_entry })
        }

        "hermes.profile.rename" => {
            let from = pluck_name(&entry.before).ok_or_else(|| IpcError::Protocol {
                detail: "profile rename entry missing before.name".into(),
            })?;
            let to = pluck_name(&entry.after).ok_or_else(|| IpcError::Protocol {
                detail: "profile rename entry missing after.name".into(),
            })?;
            // Inverse: rename `to` back to `from`.
            hp::rename_profile(&to, &from, Some(path)).map_err(|e| IpcError::Internal {
                message: format!("revert profile.rename: {e}"),
            })?;
            read_latest(path).map(|revert_entry| RevertReport { revert_entry })
        }

        "hermes.profile.clone" => {
            // `after.name` is the destination we created.
            let dst = pluck_name(&entry.after).ok_or_else(|| IpcError::Protocol {
                detail: "profile clone entry missing after.name".into(),
            })?;
            hp::delete_profile(&dst, Some(path)).map_err(|e| IpcError::Internal {
                message: format!("revert profile.clone: {e}"),
            })?;
            read_latest(path).map(|revert_entry| RevertReport { revert_entry })
        }

        "hermes.profile.delete" => {
            // Re-create the profile directory. Its prior contents
            // (`.env`, skills, chats) are GONE — `remove_dir_all`
            // was recursive. We re-seed with the same minimal
            // config.yaml the `create` path uses so the profile is
            // valid for Hermes, and the surrounding UI can surface
            // "data not restored" in its own copy.
            let name = pluck_name(&entry.before).ok_or_else(|| IpcError::Protocol {
                detail: "profile delete entry missing before.name".into(),
            })?;
            hp::create_profile(&name, Some(path)).map_err(|e| IpcError::Internal {
                message: format!("revert profile.delete: {e}"),
            })?;
            read_latest(path).map(|revert_entry| RevertReport { revert_entry })
        }

        other => Err(IpcError::Unsupported {
            capability: format!("revert for op: {other}"),
        }),
    }
}

// ───────────────────────── helpers ─────────────────────────

/// Extract `.name` from a `{"name": "..."}` payload. Profile ops store
/// the profile identifier under that key on both `before` and `after`;
/// we pluck rather than full-decode so we don't have to share a
/// Serde struct with `hermes_profiles`.
fn pluck_name(v: &Option<serde_json::Value>) -> Option<String> {
    v.as_ref()
        .and_then(|val| val.get("name"))
        .and_then(|n| n.as_str())
        .map(str::to_string)
}

/// After an inverse hp:: call appends its own revert entry, read the
/// journal's latest row so the report reflects what was just written.
/// Wrapped helper because all four profile branches do it identically.
fn read_latest(path: &std::path::Path) -> IpcResult<Entry> {
    changelog::tail(path, 1)
        .map_err(|e| IpcError::Internal {
            message: format!("read back revert: {e}"),
        })?
        .into_iter()
        .next()
        .ok_or_else(|| IpcError::Internal {
            message: "revert appended but journal empty".into(),
        })
}

// ───────────────────────── P2 revert-dispatch tests ─────────────────────────
//
// Covers the new profile branches in `apply_revert`. The `hermes.config.model`
// branch is exercised end-to-end by the existing `changelog.spec.ts`
// Playwright test, so we don't redo that coverage here.

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Mutex;

    /// Serialise $HOME mutation across tests in this module; `hp::*` helpers
    /// read the real `$HOME` so parallel tests would otherwise race.
    static LOCAL_LOCK: Mutex<()> = Mutex::new(());

    struct HomeGuard {
        _local: std::sync::MutexGuard<'static, ()>,
        _crate: std::sync::MutexGuard<'static, ()>,
        prev_home: Option<std::ffi::OsString>,
        prev_userprofile: Option<std::ffi::OsString>,
    }
    impl HomeGuard {
        fn new(home: &std::path::Path) -> Self {
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

    fn tmp_env() -> (PathBuf, PathBuf) {
        // (home, changelog_path)
        let d = std::env::temp_dir().join(format!(
            "caduceus-revert-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir_all(d.join(".hermes/profiles")).unwrap();
        let log = d.join(".hermes/changelog.jsonl");
        (d, log)
    }

    #[test]
    fn reverts_profile_create_by_deleting_it() {
        let (home, log) = tmp_env();
        let _g = HomeGuard::new(&home);

        // Simulate `hermes_profile_create` producing a changelog entry.
        crate::hermes_profiles::create_profile("foo", Some(&log)).unwrap();
        assert!(home.join(".hermes/profiles/foo").is_dir());
        let entries = changelog::tail(&log, 10).unwrap();
        let create_entry = entries
            .iter()
            .find(|e| e.op == "hermes.profile.create")
            .unwrap();

        // Revert → profile directory gone; new entry appended.
        let before_len = changelog::tail(&log, 10).unwrap().len();
        let report = apply_revert(&log, create_entry).unwrap();
        assert!(!home.join(".hermes/profiles/foo").exists());
        assert_eq!(report.revert_entry.op, "hermes.profile.delete");
        let after_len = changelog::tail(&log, 10).unwrap().len();
        assert_eq!(after_len, before_len + 1);
    }

    #[test]
    fn reverts_profile_rename_by_swapping_names_back() {
        let (home, log) = tmp_env();
        let _g = HomeGuard::new(&home);

        crate::hermes_profiles::create_profile("alpha", Some(&log)).unwrap();
        crate::hermes_profiles::rename_profile("alpha", "beta", Some(&log)).unwrap();
        assert!(home.join(".hermes/profiles/beta").is_dir());
        assert!(!home.join(".hermes/profiles/alpha").exists());

        let rename_entry = changelog::tail(&log, 10)
            .unwrap()
            .into_iter()
            .find(|e| e.op == "hermes.profile.rename")
            .unwrap();

        apply_revert(&log, &rename_entry).unwrap();
        assert!(home.join(".hermes/profiles/alpha").is_dir());
        assert!(!home.join(".hermes/profiles/beta").exists());
    }

    #[test]
    fn reverts_profile_clone_by_deleting_the_destination() {
        let (home, log) = tmp_env();
        let _g = HomeGuard::new(&home);

        crate::hermes_profiles::create_profile("src", Some(&log)).unwrap();
        crate::hermes_profiles::clone_profile("src", "dst", Some(&log)).unwrap();
        assert!(home.join(".hermes/profiles/dst").is_dir());

        let clone_entry = changelog::tail(&log, 10)
            .unwrap()
            .into_iter()
            .find(|e| e.op == "hermes.profile.clone")
            .unwrap();
        apply_revert(&log, &clone_entry).unwrap();

        // `src` survives; only the clone is swept.
        assert!(home.join(".hermes/profiles/src").is_dir());
        assert!(!home.join(".hermes/profiles/dst").exists());
    }

    #[test]
    fn reverts_profile_delete_recreates_empty_profile_dir() {
        let (home, log) = tmp_env();
        let _g = HomeGuard::new(&home);

        // Seed with a profile that has prior "state" (extra file beyond
        // the config.yaml seed). The delete sweeps it recursively.
        crate::hermes_profiles::create_profile("ghost", Some(&log)).unwrap();
        std::fs::write(home.join(".hermes/profiles/ghost/notes.md"), b"important").unwrap();
        crate::hermes_profiles::delete_profile("ghost", Some(&log)).unwrap();
        assert!(!home.join(".hermes/profiles/ghost").exists());

        let delete_entry = changelog::tail(&log, 10)
            .unwrap()
            .into_iter()
            .find(|e| e.op == "hermes.profile.delete")
            .unwrap();
        apply_revert(&log, &delete_entry).unwrap();

        // Profile dir is back, but ONLY the seed config — the prior
        // `notes.md` is NOT restored. This is the documented contract:
        // delete-reverts reinstate the shell, not the data.
        assert!(home.join(".hermes/profiles/ghost").is_dir());
        assert!(home.join(".hermes/profiles/ghost/config.yaml").is_file());
        assert!(!home.join(".hermes/profiles/ghost/notes.md").exists());
    }

    #[test]
    fn env_key_revert_still_unsupported() {
        // The env.key branch MUST keep surfacing Unsupported — we never
        // stored the secret, so we can't put it back. Regression guard
        // against a future branch accidentally shadowing it.
        let entry = Entry {
            id: "fake".into(),
            ts: "2026-01-01T00:00:00Z".into(),
            op: "hermes.env.key".into(),
            before: None,
            after: None,
            summary: "set DEEPSEEK_API_KEY".into(),
        };
        let err = apply_revert(std::path::Path::new("/dev/null"), &entry).unwrap_err();
        assert!(matches!(err, IpcError::Unsupported { .. }), "got: {err:?}");
    }
}
