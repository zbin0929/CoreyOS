//! Pack subsystem (v0.2.0+).
//!
//! Drives the "唯一基座 + 数据驱动定制" architecture: each Pack is
//! a folder under `~/.hermes/skill-packs/<id>/` containing a
//! `manifest.yaml` plus skills / workflows / views / MCP binaries.
//! See `docs/01-architecture.md` § Pack Architecture for the full
//! design, including the iron rules:
//!
//! - `skill-packs/<id>/` is read-only at runtime
//! - `pack-data/<id>/` is the only place anything writes
//! - MCP binaries ship per-platform inside the Pack
//! - manifest schema_version is forward-compatible forever
//! - Pack upgrades preserve `pack-data/<id>/`
//!
//! v0.2.0 rollout:
//!
//! 1. ✅ Manifest schema + parser (commit 7963f93).
//! 2. **Scanner + enable-state persistence** (this commit) — read
//!    all Packs from disk, expose them through `pack_list` IPC,
//!    persist enable/disable to `<hermes_dir>/pack-state.json`.
//!    Lifecycle SIDE EFFECTS (spawning MCPs, mounting routes) are
//!    still no-ops; flipping the flag persists but nothing else
//!    reacts yet. Stage 3 wires those.
//! 3. MCP subprocess manager — spawn, supervise, reap.
//! 4. Workflow / Skill / Schedule / View registration pipelines.
//! 5. 12 view templates wired through the renderer.

mod manifest;
mod scanner;
mod state;
mod sync;
mod templates;

// Re-export only what IPC + AppState actually consume. The
// ancillary manifest sub-types (McpServerSpec, ViewSpec, etc.)
// stay reachable as `crate::pack::manifest::*` for stage 3+ work
// but aren't re-exported here to keep the surface small.
//
// The `unused_imports` allow guards re-exports that the production
// code path doesn't use yet — they're consumed only by tests today
// and by stage 3+ code tomorrow. Removing the allow once stage 3
// lands is the test that the public API is wired.
#[allow(unused_imports)]
pub use manifest::{load_from_dir, parse, ManifestLoadOutcome, PackManifest, MANIFEST_FILENAME};
pub use scanner::scan_skill_packs_dir;
pub use state::PackStateFile;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;

/// Subdirectory under `~/.hermes/` where Packs live (read-only at
/// runtime per architecture iron rule #2).
pub const SKILL_PACKS_DIRNAME: &str = "skill-packs";

/// In-memory snapshot of all installed Packs + their enable
/// flags. Built once at startup by `Registry::scan` and refreshed
/// when the user enables/disables a Pack or installs a new one.
///
/// Held inside a `RwLock` in `AppState.packs` so concurrent reads
/// (every `pack_list` IPC call) don't serialise behind the rare
/// rebuilds.
#[derive(Debug, Default)]
pub struct Registry {
    /// Where `~/.hermes/` resolved to at startup. Stored so
    /// rebuild operations don't have to re-resolve.
    pub hermes_dir: PathBuf,
    /// `<hermes_dir>/skill-packs/`. Stage 3+ uses this when
    /// resolving Pack-relative paths during MCP spawn.
    #[allow(dead_code)]
    pub skill_packs_dir: PathBuf,
    /// Discovered Packs, sorted by directory name.
    pub packs: Vec<RegistryEntry>,
    /// Last-loaded state file. Written through `set_enabled`.
    pub state: PackStateFile,
}

/// One Pack the registry knows about.
#[derive(Debug, Clone)]
pub struct RegistryEntry {
    pub dir_name: String,
    /// Absolute path to the Pack folder. Stage 3+ uses this when
    /// it needs to resolve `mcp/<server>/server-${platform}` and
    /// other relative paths in the manifest.
    #[allow(dead_code)]
    pub dir_path: PathBuf,
    pub manifest: Option<Arc<PackManifest>>,
    pub error: Option<String>,
    pub enabled: bool,
}

impl Registry {
    /// Build a fresh snapshot by scanning `<hermes_dir>/skill-packs/`
    /// and reading `<hermes_dir>/pack-state.json`. Always
    /// succeeds: missing dirs / unreadable state file just yield
    /// an empty registry. The caller logs the result.
    pub fn scan(hermes_dir: &Path) -> Self {
        let skill_packs_dir = hermes_dir.join(SKILL_PACKS_DIRNAME);
        let state = state::load(hermes_dir);
        let discovered = scan_skill_packs_dir(&skill_packs_dir);
        let packs = discovered
            .into_iter()
            .map(|d| {
                // The enable flag is keyed by manifest.id (the
                // canonical Pack identifier). Folders without a
                // valid manifest fall back to dir_name so the user
                // can still toggle them in UI even though they're
                // broken.
                let pack_id = d
                    .manifest
                    .as_ref()
                    .map(|m| m.id.clone())
                    .unwrap_or_else(|| d.dir_name.clone());
                RegistryEntry {
                    dir_name: d.dir_name,
                    dir_path: d.dir_path,
                    manifest: d.manifest,
                    error: d.error,
                    enabled: state.is_enabled(&pack_id),
                }
            })
            .collect();
        Self {
            hermes_dir: hermes_dir.to_path_buf(),
            skill_packs_dir,
            packs,
            state,
        }
    }

    /// Convenience: build an empty (no Packs, no state file)
    /// registry. Used as the AppState placeholder before `scan`
    /// runs.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Return the Pack id for a given directory name, used by the
    /// IPC layer to translate UI actions back to manifest ids.
    /// Currently unused by the v0.2.0-dev IPC surface (the
    /// frontend already passes manifest ids directly); kept for
    /// stage 3 where we may need to resolve dir → id during
    /// import/refresh flows.
    #[allow(dead_code)]
    pub fn pack_id_for_dir(&self, dir_name: &str) -> Option<String> {
        self.packs.iter().find(|p| p.dir_name == dir_name).map(|p| {
            p.manifest
                .as_ref()
                .map(|m| m.id.clone())
                .unwrap_or_else(|| p.dir_name.clone())
        })
    }

    /// Flip the enable flag for a Pack. Persists synchronously to
    /// `pack-state.json`. Stage 2 effect: nothing else reacts;
    /// stage 3+ wires MCP spawn/kill on transition.
    pub fn set_enabled(&mut self, pack_id: &str, enabled: bool) -> std::io::Result<()> {
        self.state.set_enabled(pack_id, enabled);
        for entry in self.packs.iter_mut() {
            let entry_id = entry
                .manifest
                .as_ref()
                .map(|m| m.id.as_str())
                .unwrap_or(entry.dir_name.as_str());
            if entry_id == pack_id {
                entry.enabled = enabled;
            }
        }
        state::save(&self.hermes_dir, &self.state)
    }
}

/// Convenience wrapper used by AppState — concrete type alias
/// keeps the noisy generics out of state.rs.
pub type SharedRegistry = Arc<RwLock<Registry>>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("corey-pack-mod-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("create test root");
        d
    }

    fn write_manifest(pack_dir: &Path, body: &str) {
        fs::create_dir_all(pack_dir).expect("create pack dir");
        fs::write(pack_dir.join(MANIFEST_FILENAME), body).expect("write manifest");
    }

    #[test]
    fn missing_manifest_yields_invalid() {
        let dir = temp_root("missing-manifest");
        match load_from_dir(&dir) {
            ManifestLoadOutcome::Invalid(msg) => assert!(msg.contains("not found")),
            other => panic!("expected Invalid, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_from_dir_reads_manifest() {
        let dir = temp_root("load-from-dir");
        fs::write(
            dir.join(MANIFEST_FILENAME),
            "schema_version: 1\nid: my_pack\nversion: \"0.1.0\"\n",
        )
        .expect("write manifest");

        match load_from_dir(&dir) {
            ManifestLoadOutcome::Loaded(m) => assert_eq!(m.id, "my_pack"),
            other => panic!("expected Loaded, got {other:?}"),
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn registry_scan_empty_yields_empty_registry() {
        let dir = temp_root("registry-empty");
        let r = Registry::scan(&dir);
        assert!(r.packs.is_empty());
        assert!(r.state.enabled.is_empty());
        assert_eq!(r.skill_packs_dir, dir.join(SKILL_PACKS_DIRNAME));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn registry_scan_picks_up_packs_and_state() {
        let dir = temp_root("registry-happy");
        let packs_root = dir.join(SKILL_PACKS_DIRNAME);
        write_manifest(
            &packs_root.join("alpha"),
            "schema_version: 1\nid: alpha\nversion: \"1.0.0\"\n",
        );
        write_manifest(
            &packs_root.join("beta"),
            "schema_version: 1\nid: beta\nversion: \"1.0.0\"\n",
        );
        // Pre-seed state so alpha is enabled.
        let mut s = PackStateFile::default();
        s.set_enabled("alpha", true);
        state::save(&dir, &s).expect("seed state");

        let r = Registry::scan(&dir);
        assert_eq!(r.packs.len(), 2);
        let alpha = r
            .packs
            .iter()
            .find(|p| p.dir_name == "alpha")
            .expect("alpha");
        let beta = r.packs.iter().find(|p| p.dir_name == "beta").expect("beta");
        assert!(alpha.enabled);
        assert!(!beta.enabled);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn registry_set_enabled_persists() {
        let dir = temp_root("registry-set-enabled");
        let packs_root = dir.join(SKILL_PACKS_DIRNAME);
        write_manifest(
            &packs_root.join("gamma"),
            "schema_version: 1\nid: gamma\nversion: \"1.0.0\"\n",
        );

        let mut r = Registry::scan(&dir);
        assert!(!r.packs[0].enabled);

        r.set_enabled("gamma", true).expect("save");
        assert!(r.packs[0].enabled);

        // Reload from disk: state should survive.
        let r2 = Registry::scan(&dir);
        assert!(r2.packs[0].enabled);

        let _ = fs::remove_dir_all(&dir);
    }
}
