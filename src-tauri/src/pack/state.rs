//! Pack enable/disable state, persisted to disk.
//!
//! Stored at `<hermes_dir>/pack-state.json`. NOT in the Pack
//! folder itself (that's read-only per architecture iron rule)
//! and NOT in `pack-data/<id>/` either (that survives Pack
//! uninstall — but enable state should not). One file at the top
//! of the data dir is the right scope.
//!
//! Default policy: a Pack discovered for the first time is
//! **disabled**. The user opts in via the Settings → Packs UI
//! (or `customer.yaml` `packs.preinstall`, landing in stage 4).
//! This is conservative: a third-party Pack drop-in shouldn't
//! auto-spawn its MCP servers without consent.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const STATE_FILE: &str = "pack-state.json";
const SCHEMA_VERSION: u32 = 1;

/// On-disk shape. Versioned for the same forward-compat reason
/// the manifests are: a future Corey may add fields, and we want
/// older binaries to ignore them gracefully.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackStateFile {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// `pack_id -> enabled?`. Missing entries mean "never seen
    /// before; treat as disabled until user enables".
    #[serde(default)]
    pub enabled: BTreeMap<String, bool>,
}

impl Default for PackStateFile {
    /// Hand-rolled `Default` so `schema_version` matches the value
    /// `serde(default = "default_schema_version")` would inject on
    /// deserialisation. Auto-derived `Default` would give `0`.
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            enabled: BTreeMap::new(),
        }
    }
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

impl PackStateFile {
    pub fn is_enabled(&self, pack_id: &str) -> bool {
        self.enabled.get(pack_id).copied().unwrap_or(false)
    }

    pub fn set_enabled(&mut self, pack_id: &str, enabled: bool) {
        self.enabled.insert(pack_id.to_string(), enabled);
    }
}

/// Read `<hermes_dir>/pack-state.json`. Missing or unreadable file
/// returns a fresh empty state — the most common case (first run,
/// user never enabled anything yet) is the same as the failure
/// case. We log non-NotFound IO errors so a broken filesystem
/// surfaces in the logs rather than presenting as "all packs
/// quietly reset to disabled".
pub fn load(hermes_dir: &Path) -> PackStateFile {
    let path = state_path(hermes_dir);
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return PackStateFile::default(),
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(), "pack-state.json read failed");
            return PackStateFile::default();
        }
    };
    match serde_json::from_str::<PackStateFile>(&raw) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(
                error = %e,
                path = %path.display(),
                "pack-state.json parse failed; resetting to default"
            );
            PackStateFile::default()
        }
    }
}

/// Atomically write the state to disk. Uses the standard
/// temp-file + rename pattern so a crash mid-write can't corrupt
/// the file (worst case: lose the in-flight write).
pub fn save(hermes_dir: &Path, state: &PackStateFile) -> io::Result<()> {
    if let Err(e) = fs::create_dir_all(hermes_dir) {
        if e.kind() != io::ErrorKind::AlreadyExists {
            return Err(e);
        }
    }
    let path = state_path(hermes_dir);
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(state)?;
    fs::write(&tmp, body)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

fn state_path(hermes_dir: &Path) -> PathBuf {
    hermes_dir.join(STATE_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "corey-pack-state-test-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("create state test dir");
        d
    }

    #[test]
    fn missing_file_yields_default_empty() {
        let dir = temp_dir("missing");
        let state = load(&dir);
        assert!(state.enabled.is_empty());
        assert_eq!(state.schema_version, SCHEMA_VERSION);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_file_yields_default_empty() {
        let dir = temp_dir("malformed");
        fs::write(dir.join(STATE_FILE), "{not json").expect("write garbage");
        let state = load(&dir);
        assert!(state.enabled.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_then_load_round_trip() {
        let dir = temp_dir("round_trip");
        let mut state = PackStateFile::default();
        state.set_enabled("alpha", true);
        state.set_enabled("beta", false);
        save(&dir, &state).expect("save");
        let read = load(&dir);
        assert_eq!(read.enabled.len(), 2);
        assert!(read.is_enabled("alpha"));
        assert!(!read.is_enabled("beta"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_pack_defaults_to_disabled() {
        let state = PackStateFile::default();
        assert!(!state.is_enabled("never_heard_of_this_one"));
    }
}
