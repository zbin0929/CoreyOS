//! IPC surface for the Pack subsystem.
//!
//! Stage 2 commands:
//! - `pack_list`: read all installed Packs + their enable state.
//! - `pack_set_enabled`: flip a Pack's enable bit, persisted to
//!   `~/.hermes/pack-state.json`. Stage 2 has no side effects
//!   beyond persistence; stages 3+ wire MCP spawn/kill, view
//!   mount/unmount, etc.

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::pack::{PackManifest, RegistryEntry};
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListEntry {
    /// On-disk folder name (e.g. `cross_border_ecom`). Stable.
    pub dir_name: String,
    /// Manifest's declared id; equals `dir_name` for healthy
    /// packs. Empty when manifest failed to parse.
    pub manifest_id: String,
    /// Display name from manifest. Empty for broken packs.
    pub title: String,
    /// Manifest version string.
    pub version: String,
    /// Pack author / vendor (manifest field).
    pub author: String,
    /// One-line description.
    pub description: String,
    /// Whether the user has enabled this Pack. False until
    /// explicitly turned on.
    pub enabled: bool,
    /// Non-empty when manifest failed to load or sanity checks
    /// flagged a problem (e.g. id mismatch).
    pub error: Option<String>,
    /// True when manifest parsed; false means the entry is
    /// surfaced for visibility but not actually usable.
    pub healthy: bool,
}

impl From<&RegistryEntry> for PackListEntry {
    fn from(e: &RegistryEntry) -> Self {
        let m: Option<&PackManifest> = e.manifest.as_deref();
        Self {
            dir_name: e.dir_name.clone(),
            manifest_id: m.map(|m| m.id.clone()).unwrap_or_default(),
            title: m.map(|m| m.title.clone()).unwrap_or_default(),
            version: m.map(|m| m.version.clone()).unwrap_or_default(),
            author: m.map(|m| m.author.clone()).unwrap_or_default(),
            description: m.map(|m| m.description.clone()).unwrap_or_default(),
            enabled: e.enabled,
            error: e.error.clone(),
            healthy: m.is_some(),
        }
    }
}

#[tauri::command]
pub async fn pack_list(state: State<'_, AppState>) -> IpcResult<Vec<PackListEntry>> {
    let registry = state.packs.read();
    Ok(registry.packs.iter().map(PackListEntry::from).collect())
}

#[tauri::command]
pub async fn pack_set_enabled(
    pack_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> IpcResult<()> {
    let mut registry = state.packs.write();
    registry
        .set_enabled(&pack_id, enabled)
        .map_err(|e| IpcError::Internal {
            message: format!("persist pack-state.json: {e}"),
        })?;
    tracing::info!(pack_id, enabled, "pack enable state changed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::Registry;
    use std::sync::Arc;

    #[test]
    fn pack_list_entry_handles_broken_manifest() {
        let entry = RegistryEntry {
            dir_name: "broken".into(),
            dir_path: "/tmp/broken".into(),
            manifest: None,
            error: Some("parse error".into()),
            enabled: false,
        };
        let dto: PackListEntry = (&entry).into();
        assert_eq!(dto.dir_name, "broken");
        assert!(!dto.healthy);
        assert_eq!(dto.manifest_id, "");
        assert_eq!(dto.error.as_deref(), Some("parse error"));
    }

    #[test]
    fn pack_list_entry_round_trips_manifest_fields() {
        // Parse a manifest, drop it into a RegistryEntry, then
        // mirror it as a DTO and check the fields landed.
        let yaml = "schema_version: 1\nid: foo\nversion: \"1.2.3\"\ntitle: Foo\nauthor: Acme\ndescription: hello\n";
        let manifest = match crate::pack::parse(yaml) {
            crate::pack::ManifestLoadOutcome::Loaded(m) => m,
            other => panic!("expected Loaded, got {other:?}"),
        };
        let entry = RegistryEntry {
            dir_name: "foo".into(),
            dir_path: "/tmp/foo".into(),
            manifest: Some(Arc::new(*manifest)),
            error: None,
            enabled: true,
        };
        let dto: PackListEntry = (&entry).into();
        assert_eq!(dto.manifest_id, "foo");
        assert_eq!(dto.title, "Foo");
        assert_eq!(dto.version, "1.2.3");
        assert_eq!(dto.author, "Acme");
        assert_eq!(dto.description, "hello");
        assert!(dto.healthy);
        assert!(dto.enabled);
        assert!(dto.error.is_none());
    }

    #[test]
    fn registry_empty_means_pack_list_is_empty() {
        // Smoke-test the registry default state matches the IPC
        // mapping (no Packs found = empty Vec).
        let r = Registry::empty();
        let dtos: Vec<PackListEntry> = r.packs.iter().map(PackListEntry::from).collect();
        assert!(dtos.is_empty());
    }
}
