//! IPC surface for the Pack subsystem.
//!
//! Commands:
//! - `pack_list`: read all installed Packs + their enable state.
//! - `pack_set_enabled`: flip a Pack's enable bit AND sync its
//!   MCP servers into `~/.hermes/config.yaml` (stage 3c). The
//!   gateway is restarted asynchronously after a successful sync
//!   so Hermes picks up the change without the user having to do
//!   it manually.

use std::collections::BTreeMap;
use std::fs;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_config;
use crate::pack::{
    disable_updates, enable_updates, install_skills, uninstall_skills, PackManifest, RegistryEntry,
    TemplateContext,
};
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
    // Snapshot what we need under a read lock, drop it before any
    // file I/O so the registry stays available for concurrent
    // pack_list calls during the (potentially slow) gateway
    // restart that follows.
    let (manifest_arc, hermes_dir, pack_dir) = {
        let registry = state.packs.read();
        let entry = registry.packs.iter().find(|p| matches_pack_id(p, &pack_id));
        let manifest = entry.and_then(|p| p.manifest.clone());
        let pack_dir = entry.map(|p| p.dir_path.clone());
        (manifest, registry.hermes_dir.clone(), pack_dir)
    };

    if enabled && manifest_arc.is_none() {
        return Err(IpcError::Unsupported {
            capability: format!(
                "pack {pack_id:?} cannot be enabled: manifest is missing or invalid"
            ),
        });
    }

    let journal = state.changelog_path.clone();

    // Sync to config.yaml (only if Pack actually has MCP servers).
    let config_changed = sync_config_yaml(&pack_id, &manifest_arc, enabled, &hermes_dir, &journal)?;

    // Install / uninstall Pack skills under
    // `~/.hermes/skills/pack__<id>/`. Skills are independent of MCP
    // servers — a Pack with no MCP can still ship pure-prompt
    // skills. Errors here don't roll back the config.yaml change
    // we just made: skills failing to install is annoying but not
    // critical, and rolling back would risk leaving Hermes
    // half-configured.
    sync_skills(
        &pack_id,
        &manifest_arc,
        enabled,
        &hermes_dir,
        pack_dir.as_deref(),
    )?;

    // Persist the bool. Doing this AFTER config.yaml write means a
    // failure there leaves the user-visible enable state unchanged
    // — better than half-applied state.
    {
        let mut registry = state.packs.write();
        registry
            .set_enabled(&pack_id, enabled)
            .map_err(|e| IpcError::Internal {
                message: format!("persist pack-state.json: {e}"),
            })?;
    }

    tracing::info!(
        pack_id,
        enabled,
        config_changed,
        "pack enable state changed"
    );

    // Trigger a Hermes gateway restart so the new mcp_servers
    // entries become live. Hermes 0.10 has no `/reload-mcp`
    // endpoint (verified in mcp_server::register_with_hermes),
    // so restart is the only mechanism. Skip when nothing in
    // config.yaml changed (e.g. Pack with no MCP servers, or
    // toggle that turned out to be a no-op).
    if config_changed {
        tauri::async_runtime::spawn(async {
            let result = tokio::task::spawn_blocking(hermes_config::gateway_restart).await;
            match result {
                Ok(Ok(_)) => tracing::info!("pack toggle: hermes gateway restarted"),
                Ok(Err(e)) => tracing::warn!(error = %e, "pack toggle: gateway restart failed"),
                Err(e) => tracing::warn!(error = %e, "pack toggle: restart join error"),
            }
        });
    }

    Ok(())
}

/// True when `entry`'s canonical Pack id matches `pack_id`. The
/// canonical id is `manifest.id` for healthy entries and falls
/// back to the directory name for broken ones (so the UI can
/// still target them for cleanup).
fn matches_pack_id(entry: &RegistryEntry, pack_id: &str) -> bool {
    let entry_id = entry
        .manifest
        .as_ref()
        .map(|m| m.id.as_str())
        .unwrap_or(entry.dir_name.as_str());
    entry_id == pack_id
}

/// Translate the Pack's mcp_servers section to / from
/// `~/.hermes/config.yaml`. Returns `true` when at least one
/// entry was written (caller uses this to decide whether to
/// trigger a gateway restart).
fn sync_config_yaml(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    journal: &std::path::Path,
) -> IpcResult<bool> {
    let Some(manifest) = manifest else {
        // No manifest, nothing to sync. Stage 3c+ may add a
        // fallback that scans config.yaml for stale prefixed
        // entries and removes them; for now disable on a broken
        // Pack is a no-op on config.yaml.
        return Ok(false);
    };
    if manifest.mcp_servers.is_empty() {
        return Ok(false);
    }

    let pack_data_dir = hermes_dir.join("pack-data").join(pack_id);
    if enabled {
        // Make sure ~/.hermes/pack-data/<id>/ exists before the
        // MCP server tries to write into it.
        if let Err(e) = fs::create_dir_all(&pack_data_dir) {
            return Err(IpcError::Internal {
                message: format!("create pack-data dir: {e}"),
            });
        }
    }

    // Stage 3c uses an empty pack_config; stage 4 adds the config
    // form UI that populates `pack-data/<id>/config.json`.
    let ctx = TemplateContext {
        platform: crate::pack::current_platform().to_string(),
        pack_data_dir,
        pack_config: BTreeMap::new(),
    };

    let updates = if enabled {
        enable_updates(manifest, &ctx)
    } else {
        disable_updates(manifest)
    };

    hermes_config::write_channel_yaml_fields("mcp_servers", &updates, Some(journal)).map_err(
        |e| IpcError::Internal {
            message: format!("write mcp_servers to config.yaml: {e}"),
        },
    )?;
    Ok(true)
}

/// Copy / remove the Pack's skills under `~/.hermes/skills/pack__<id>/`.
///
/// On enable: copy each `manifest.skills` entry from the Pack
/// folder to the Hermes skills tree. On disable: remove the
/// `pack__<id>` subdirectory entirely.
///
/// `pack_dir` is `None` when the Pack folder is gone (user
/// uninstalled before disabling) — we still attempt to remove the
/// skills directory so stale files don't linger.
fn sync_skills(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    pack_dir: Option<&std::path::Path>,
) -> IpcResult<()> {
    if enabled {
        let (Some(manifest), Some(pack_dir)) = (manifest, pack_dir) else {
            // No manifest / no folder: nothing to copy. (We've
            // already rejected enable-with-broken-manifest at the
            // top of pack_set_enabled, so this branch is mostly
            // defensive.)
            return Ok(());
        };
        if manifest.skills.is_empty() {
            return Ok(());
        }
        let n = install_skills(manifest, pack_dir, hermes_dir).map_err(|e| IpcError::Internal {
            message: format!("install pack skills: {e}"),
        })?;
        tracing::info!(pack_id, installed = n, "pack skills installed");
    } else {
        uninstall_skills(pack_id, hermes_dir).map_err(|e| IpcError::Internal {
            message: format!("uninstall pack skills: {e}"),
        })?;
        tracing::info!(pack_id, "pack skills uninstalled");
    }
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
