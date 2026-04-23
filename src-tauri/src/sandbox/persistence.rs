//! Sandbox config persistence.
//!
//! Writes `sandbox.json` atomically to `<app_config_dir>/sandbox.json`.
//! Uses `fs_atomic::atomic_write` so a crash mid-write leaves the old file
//! intact. On read, an absent file is not an error — it signals "first
//! launch" to `PathAuthority::init_from_disk`, which seeds defaults.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::fs_atomic;

use super::{SandboxMode, WorkspaceRoot};

const FILE_NAME: &str = "sandbox.json";
const CURRENT_VERSION: u32 = 1;

/// On-disk representation of the sandbox config. Keep additive — never
/// break existing users by renaming or reordering fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SandboxConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_mode")]
    pub mode: SandboxMode,
    #[serde(default)]
    pub roots: Vec<WorkspaceRoot>,
}

fn default_version() -> u32 {
    CURRENT_VERSION
}
fn default_mode() -> SandboxMode {
    SandboxMode::Enforced
}

/// Resolve the absolute path to `sandbox.json` for the given app config dir.
pub fn sandbox_config_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(FILE_NAME)
}

/// Load the sandbox config. Returns `Ok(None)` if the file does not exist
/// (first launch). Returns `Err` on I/O or parse errors — the caller should
/// log and fall back to an empty authority rather than panic.
pub fn load(path: &Path) -> io::Result<Option<SandboxConfig>> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let cfg: SandboxConfig = serde_json::from_slice(&bytes).map_err(|e| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("sandbox.json parse error: {e}"),
                )
            })?;
            Ok(Some(cfg))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Persist the sandbox config atomically. Creates the parent directory if
/// needed. On Unix the file is written with 0600 perms so another user on a
/// shared machine can't enumerate the caller's workspace roots.
pub fn save(path: &Path, cfg: &SandboxConfig) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("sandbox.json serialize error: {e}"),
        )
    })?;
    fs_atomic::atomic_write(
        path,
        &bytes,
        #[cfg(unix)]
        Some(0o600),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{AccessMode, WorkspaceRoot};
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("corey-sandbox-persist-{name}-{n}"))
    }

    #[test]
    fn round_trip_preserves_fields() {
        let dir = tmp("roundtrip");
        std::fs::create_dir_all(&dir).unwrap();
        let path = sandbox_config_path(&dir);
        let cfg = SandboxConfig {
            version: 1,
            mode: SandboxMode::Enforced,
            roots: vec![WorkspaceRoot {
                path: std::env::temp_dir(),
                label: "tmp".into(),
                mode: AccessMode::ReadWrite,
            }],
        };
        save(&path, &cfg).unwrap();
        let loaded = load(&path).unwrap().unwrap();
        assert_eq!(loaded, cfg);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = tmp("missing");
        let path = sandbox_config_path(&dir);
        assert!(matches!(load(&path), Ok(None)));
    }

    #[test]
    fn unknown_fields_dont_break_parse() {
        let dir = tmp("unknown");
        std::fs::create_dir_all(&dir).unwrap();
        let path = sandbox_config_path(&dir);
        std::fs::write(
            &path,
            r#"{"version":1,"mode":"enforced","roots":[],"future_field":"hello"}"#,
        )
        .unwrap();
        let cfg = load(&path).unwrap().unwrap();
        assert_eq!(cfg.version, 1);
        assert_eq!(cfg.mode, SandboxMode::Enforced);
        std::fs::remove_dir_all(&dir).ok();
    }
}
