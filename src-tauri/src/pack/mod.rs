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
//! v0.2.0 ships in stages:
//!
//! 1. **Manifest schema + parser** (this commit) — the contract.
//!    Pack folders aren't scanned yet; nothing is wired into
//!    AppState. Just types + tests. Hence the module-level
//!    `dead_code` allowance: every public item is unused TODAY
//!    and will be used in stage 2+. Removing the allow attribute
//!    is the test that the wiring is complete.
//! 2. Pack scanner + lifecycle (next) — discover, validate,
//!    enable, disable, uninstall.
//! 3. MCP subprocess manager — spawn, supervise, reap.
//! 4. Workflow / Skill / Schedule / View registration pipelines.
//! 5. 12 view templates wired through the renderer.

#![allow(dead_code, unused_imports)] // see stage 1 note above

mod manifest;

pub use manifest::{
    parse, ActionButton, ConfigField, ManifestLoadOutcome, McpServerSpec, Migration, PackManifest,
    PackRequires, ScheduleSpec, ViewSpec, MAX_KNOWN_SCHEMA_VERSION,
};

use std::fs;
use std::path::Path;

/// Filename Corey expects inside each Pack folder.
pub const MANIFEST_FILENAME: &str = "manifest.yaml";

/// Read and parse `<pack_dir>/manifest.yaml`. Best-effort:
/// missing file / unreadable file / parse error all surface as
/// `ManifestLoadOutcome::Invalid` so the caller can decide whether
/// to log, skip, or surface to UI.
pub fn load_from_dir(pack_dir: &Path) -> ManifestLoadOutcome {
    let path = pack_dir.join(MANIFEST_FILENAME);
    if !path.exists() {
        return ManifestLoadOutcome::Invalid(format!(
            "{} not found in pack dir {}",
            MANIFEST_FILENAME,
            pack_dir.display()
        ));
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            return ManifestLoadOutcome::Invalid(format!("read {}: {e}", path.display()));
        }
    };
    parse(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_manifest_yields_invalid() {
        let dir =
            std::env::temp_dir().join(format!("corey-pack-test-{}-missing", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        match load_from_dir(&dir) {
            ManifestLoadOutcome::Invalid(msg) => assert!(msg.contains("not found")),
            other => panic!("expected Invalid, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_from_dir_reads_manifest() {
        let dir = std::env::temp_dir().join(format!("corey-pack-test-{}-load", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
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
}
