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

use super::{SandboxMode, SandboxScope, WorkspaceRoot, DEFAULT_SCOPE_ID};

const FILE_NAME: &str = "sandbox.json";
const CURRENT_VERSION: u32 = 2;

/// On-disk representation of the sandbox config.
///
/// **Schema history**:
/// - `v1`: single flat `roots: Vec<WorkspaceRoot>` list shared by every
///   adapter in the process.
/// - `v2` (T6.5, 2026-04-23): same shape but `roots` is gone and replaced
///   by `scopes: Vec<SandboxScope>`. A scope named `"default"` is always
///   present and holds the v1 root list verbatim after migration —
///   semantic parity for installs that never visit the scope UI.
///
/// Serde-level compat: v1 files are parsed via the intermediate
/// [`LegacyV1`] shape in [`load`] and migrated in-memory; the next
/// `save` call writes v2. We never downgrade.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SandboxConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_mode")]
    pub mode: SandboxMode,
    /// Always non-empty; the scope with id `"default"` is guaranteed to
    /// exist and holds the "unassigned" root list.
    #[serde(default)]
    pub scopes: Vec<SandboxScope>,
}

fn default_version() -> u32 {
    CURRENT_VERSION
}
fn default_mode() -> SandboxMode {
    SandboxMode::Enforced
}

/// Transitional shape used only by [`load`] to detect v1 on disk. We can't
/// just re-use [`SandboxConfig`] because v1's `roots` field is absent in
/// v2 and serde would drop information during a mixed-schema read.
#[derive(Debug, Deserialize)]
struct LegacyV1 {
    #[serde(default = "default_mode")]
    mode: SandboxMode,
    #[serde(default)]
    roots: Vec<WorkspaceRoot>,
}

impl SandboxConfig {
    /// Return a reference to the default scope, panicking if it's
    /// somehow missing — upstream code maintains the invariant that
    /// the `"default"` scope is always present. Only tests construct
    /// configs directly enough to use this; production paths always
    /// look up scopes by id through `PathAuthority`.
    #[cfg(test)]
    pub fn default_scope(&self) -> &SandboxScope {
        self.scopes
            .iter()
            .find(|s| s.id == DEFAULT_SCOPE_ID)
            .expect("default scope must exist")
    }
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
            // Parse the version tag only first so we can pick the right
            // shape. Any file without `version` or with `version<=1` is
            // treated as v1 and migrated on the fly. v2+ parses via the
            // canonical `SandboxConfig` shape.
            let peek: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("sandbox.json parse error: {e}"),
                )
            })?;
            let version = peek
                .get("version")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32;

            if version <= 1 {
                let legacy: LegacyV1 = serde_json::from_value(peek).map_err(|e| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("sandbox.json v1 parse error: {e}"),
                    )
                })?;
                tracing::info!(
                    path = %path.display(),
                    roots = legacy.roots.len(),
                    "sandbox: migrating v1 config to v2 (roots → default scope)",
                );
                Ok(Some(SandboxConfig {
                    version: CURRENT_VERSION,
                    mode: legacy.mode,
                    scopes: vec![SandboxScope {
                        id: DEFAULT_SCOPE_ID.into(),
                        label: "Default".into(),
                        roots: legacy.roots,
                    }],
                }))
            } else {
                let mut cfg: SandboxConfig =
                    serde_json::from_value(peek).map_err(|e| {
                        io::Error::new(
                            io::ErrorKind::InvalidData,
                            format!("sandbox.json v{version} parse error: {e}"),
                        )
                    })?;
                // Enforce the "default scope must exist" invariant even
                // if a hand-edited file dropped it. This keeps crash
                // handling symmetric with `SandboxConfig::empty_v2`.
                if !cfg.scopes.iter().any(|s| s.id == DEFAULT_SCOPE_ID) {
                    cfg.scopes.insert(0, SandboxScope::default_empty());
                }
                Ok(Some(cfg))
            }
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
    fn round_trip_v2_preserves_scopes() {
        let dir = tmp("roundtrip-v2");
        std::fs::create_dir_all(&dir).unwrap();
        let path = sandbox_config_path(&dir);
        let cfg = SandboxConfig {
            version: 2,
            mode: SandboxMode::Enforced,
            scopes: vec![
                SandboxScope {
                    id: "default".into(),
                    label: "Default".into(),
                    roots: vec![WorkspaceRoot {
                        path: std::env::temp_dir(),
                        label: "tmp".into(),
                        mode: AccessMode::ReadWrite,
                    }],
                },
                SandboxScope {
                    id: "worker".into(),
                    label: "Worker".into(),
                    roots: vec![],
                },
            ],
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
            r#"{"version":2,"mode":"enforced","scopes":[{"id":"default","label":"Default","roots":[]}],"future_field":"hello"}"#,
        )
        .unwrap();
        let cfg = load(&path).unwrap().unwrap();
        assert_eq!(cfg.version, 2);
        assert_eq!(cfg.mode, SandboxMode::Enforced);
        assert_eq!(cfg.scopes.len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// T6.5: a v1 `sandbox.json` on disk must migrate to v2 on load —
    /// the legacy `roots` list becomes the `default` scope's roots,
    /// preserving exact semantics for installs that never touch the
    /// scope UI.
    #[test]
    fn v1_config_migrates_to_v2_default_scope() {
        let dir = tmp("migrate-v1");
        std::fs::create_dir_all(&dir).unwrap();
        let path = sandbox_config_path(&dir);
        // Write a real v1 payload — version:1 + roots array, no scopes field.
        let tmp_root = std::env::temp_dir();
        std::fs::write(
            &path,
            format!(
                r#"{{"version":1,"mode":"enforced","roots":[{{"path":{:?},"label":"tmp","mode":"read_write"}}]}}"#,
                tmp_root.display().to_string(),
            ),
        )
        .unwrap();

        let cfg = load(&path).unwrap().unwrap();
        assert_eq!(cfg.version, 2, "load should upgrade the in-memory version");
        assert_eq!(cfg.scopes.len(), 1);
        let default_scope = cfg.default_scope();
        assert_eq!(default_scope.id, "default");
        assert_eq!(default_scope.roots.len(), 1);
        assert_eq!(default_scope.roots[0].path, tmp_root);
        assert_eq!(default_scope.roots[0].label, "tmp");

        // Round-trip: save the migrated config, re-load, assert shape
        // survived and no longer needs migration.
        save(&path, &cfg).unwrap();
        let reloaded = load(&path).unwrap().unwrap();
        assert_eq!(reloaded, cfg, "save+load of a migrated config is idempotent");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A hand-edited v2 file that accidentally drops the `default` scope
    /// must still load — `load` re-inserts it to maintain the
    /// "default always exists" invariant.
    #[test]
    fn v2_missing_default_scope_is_reinserted() {
        let dir = tmp("missing-default");
        std::fs::create_dir_all(&dir).unwrap();
        let path = sandbox_config_path(&dir);
        std::fs::write(
            &path,
            r#"{"version":2,"mode":"enforced","scopes":[{"id":"worker","label":"Worker","roots":[]}]}"#,
        )
        .unwrap();
        let cfg = load(&path).unwrap().unwrap();
        assert!(cfg.scopes.iter().any(|s| s.id == "default"));
        // Original scope is preserved too.
        assert!(cfg.scopes.iter().any(|s| s.id == "worker"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
