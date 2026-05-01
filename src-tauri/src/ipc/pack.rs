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
    disable_updates, enable_updates, install_schedules, install_skills, install_workflows,
    uninstall_schedules, uninstall_skills, uninstall_workflows, PackManifest, RegistryEntry,
    TemplateContext,
};
use crate::state::AppState;

// Helper: convert a serde_yaml::Value into the JSON value the
// frontend expects. Pack manifests use YAML for ergonomics
// (multi-line strings, comments) but the IPC wire is JSON.
fn yaml_to_json(v: &serde_yaml::Value) -> serde_json::Value {
    match v {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(*b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(serde_json::Number::from(i))
            } else if let Some(u) = n.as_u64() {
                serde_json::Value::Number(serde_json::Number::from(u))
            } else if let Some(f) = n.as_f64() {
                serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s.clone()),
        serde_yaml::Value::Sequence(s) => {
            serde_json::Value::Array(s.iter().map(yaml_to_json).collect())
        }
        serde_yaml::Value::Mapping(m) => {
            let mut out = serde_json::Map::new();
            for (k, v) in m {
                let key = match k {
                    serde_yaml::Value::String(s) => s.clone(),
                    other => serde_yaml::to_string(other)
                        .ok()
                        .map(|s| s.trim().to_string())
                        .unwrap_or_default(),
                };
                out.insert(key, yaml_to_json(v));
            }
            serde_json::Value::Object(out)
        }
        serde_yaml::Value::Tagged(tagged) => yaml_to_json(&tagged.value),
    }
}

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
pub async fn pack_rescan(state: State<'_, AppState>) -> IpcResult<Vec<PackListEntry>> {
    let hermes_dir = crate::paths::hermes_data_dir().map_err(|e| IpcError::Other(e.to_string()))?;
    let new_registry = crate::pack::Registry::scan(&hermes_dir);
    let entries: Vec<PackListEntry> = new_registry.packs.iter().map(PackListEntry::from).collect();
    {
        let mut reg = state.packs.write();
        *reg = new_registry;
    }
    Ok(entries)
}

/// One view declared by an ENABLED Pack. The DTO carries
/// everything the frontend needs to render the right template plus
/// dispatch action buttons. Disabled Packs' views are filtered out
/// at the IPC boundary so the frontend doesn't have to think about
/// it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackViewDto {
    pub pack_id: String,
    pub pack_title: String,
    pub view_id: String,
    pub title: String,
    pub icon: String,
    pub nav_section: String,
    pub template: String,
    pub data_source: serde_json::Value,
    pub options: serde_json::Value,
    pub actions: Vec<PackActionDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackActionDto {
    pub label: String,
    pub workflow: String,
    pub skill: String,
    pub confirm: bool,
}

/// Resolve a Pack view's `data_source` directive into the JSON
/// payload its template renders.
///
/// Stage 5e supports the simplest data-source kind:
///
/// ```yaml
/// data_source:
///   static:
///     metrics: { revenue: 12345, cost: 8000, profit: 4345 }
/// ```
///
/// Future kinds (MCP call, HTTP fetch, SQLite query) plug into
/// the same dispatcher. Unknown / missing kinds return an empty
/// object so the template renders its own "no data" state rather
/// than the IPC throwing.
#[tauri::command]
pub async fn pack_view_data(
    pack_id: String,
    view_id: String,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    let data_source = {
        let registry = state.packs.read();
        let entry = registry.packs.iter().find(|p| matches_pack_id(p, &pack_id));
        let manifest = entry.and_then(|p| p.manifest.as_ref());
        let view = manifest.and_then(|m| m.views.iter().find(|v| v.id == view_id));
        view.map(|v| v.data_source.clone())
    };
    let Some(ds) = data_source else {
        return Err(IpcError::Internal {
            message: format!("view not found: {pack_id}/{view_id}"),
        });
    };
    Ok(resolve_data_source(&ds))
}

fn resolve_data_source(ds: &serde_yaml::Value) -> serde_json::Value {
    let json = yaml_to_json(ds);
    if let Some(obj) = json.as_object() {
        if let Some(static_value) = obj.get("static") {
            return static_value.clone();
        }
        // `mcp`, `http`, `sql` etc land in stage 5f. For now they
        // return an empty object so the template can still render
        // its skeleton.
    }
    serde_json::Value::Object(serde_json::Map::new())
}

/// Return every view declared by every CURRENTLY-ENABLED Pack.
/// Stable ordering: by pack id, then by view id within each pack.
#[tauri::command]
pub async fn pack_views_list(state: State<'_, AppState>) -> IpcResult<Vec<PackViewDto>> {
    let registry = state.packs.read();
    let mut out = Vec::new();
    for entry in &registry.packs {
        if !entry.enabled {
            continue;
        }
        let Some(manifest) = &entry.manifest else {
            continue;
        };
        for view in &manifest.views {
            let options: serde_json::Value = if view.options.is_empty() {
                serde_json::Value::Object(serde_json::Map::new())
            } else {
                let mut obj = serde_json::Map::new();
                for (k, v) in &view.options {
                    obj.insert(k.clone(), yaml_to_json(v));
                }
                serde_json::Value::Object(obj)
            };
            out.push(PackViewDto {
                pack_id: manifest.id.clone(),
                pack_title: if manifest.title.is_empty() {
                    manifest.id.clone()
                } else {
                    manifest.title.clone()
                },
                view_id: view.id.clone(),
                title: view.title.clone(),
                icon: view.icon.clone(),
                nav_section: view.nav_section.clone(),
                template: view.template.clone(),
                data_source: yaml_to_json(&view.data_source),
                options,
                actions: view
                    .actions
                    .iter()
                    .map(|a| PackActionDto {
                        label: a.label.clone(),
                        workflow: a.workflow.clone(),
                        skill: a.skill.clone(),
                        confirm: a.confirm,
                    })
                    .collect(),
            });
        }
    }
    out.sort_by(|a, b| {
        a.pack_id
            .cmp(&b.pack_id)
            .then_with(|| a.view_id.cmp(&b.view_id))
    });
    Ok(out)
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

    // Install / uninstall Pack workflows under
    // `~/.hermes/workflows/pack__<id>__*.yaml`. Workflows are
    // pure data files that the Corey workflow engine reads at
    // runtime; we just copy them in / out.
    sync_workflows(&pack_id, &manifest_arc, enabled, pack_dir.as_deref())?;

    // Install / uninstall Pack cron schedules in
    // `~/.hermes/cron/jobs.json`. These reference the prefixed
    // workflow ids written above, so they go LAST in the enable
    // sequence (workflows must exist before the cron tries to
    // run them).
    sync_schedules(&pack_id, &manifest_arc, enabled)?;

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

/// Copy / remove Pack workflow YAMLs in `~/.hermes/workflows/`.
fn sync_workflows(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    pack_dir: Option<&std::path::Path>,
) -> IpcResult<()> {
    if enabled {
        let (Some(manifest), Some(pack_dir)) = (manifest, pack_dir) else {
            return Ok(());
        };
        if manifest.workflows.is_empty() {
            return Ok(());
        }
        let n = install_workflows(manifest, pack_dir).map_err(|e| IpcError::Internal {
            message: format!("install pack workflows: {e}"),
        })?;
        tracing::info!(pack_id, installed = n, "pack workflows installed");
    } else {
        let removed = uninstall_workflows(pack_id).map_err(|e| IpcError::Internal {
            message: format!("uninstall pack workflows: {e}"),
        })?;
        tracing::info!(pack_id, removed, "pack workflows uninstalled");
    }
    Ok(())
}

/// Install / uninstall Pack cron schedules in jobs.json.
fn sync_schedules(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
) -> IpcResult<()> {
    if enabled {
        let Some(manifest) = manifest else {
            return Ok(());
        };
        if manifest.schedules.is_empty() {
            // Be sure to clear stale entries from a previous
            // version of the manifest that DID have schedules.
            let _ = uninstall_schedules(pack_id).map_err(|e| IpcError::Internal {
                message: format!("clear stale pack schedules: {e}"),
            });
            return Ok(());
        }
        let (installed, replaced) =
            install_schedules(manifest).map_err(|e| IpcError::Internal {
                message: format!("install pack schedules: {e}"),
            })?;
        tracing::info!(pack_id, installed, replaced, "pack schedules installed");
    } else {
        let removed = uninstall_schedules(pack_id).map_err(|e| IpcError::Internal {
            message: format!("uninstall pack schedules: {e}"),
        })?;
        tracing::info!(pack_id, removed, "pack schedules uninstalled");
    }
    Ok(())
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

    #[test]
    fn rescan_produces_same_dto_shape_as_list() {
        // Verify that scanning a temp dir with one Pack and mapping
        // through the same DTO path produces a healthy entry.
        let tmp = tempfile::tempdir().expect("tempdir");
        let pack_dir = tmp.path().join("test_pack");
        std::fs::create_dir_all(&pack_dir).expect("mkdir");
        std::fs::write(
            pack_dir.join("manifest.yaml"),
            "schema_version: 1\nid: test_pack\nversion: \"0.1.0\"\ntitle: Test\n",
        )
        .expect("write manifest");
        let registry = Registry::scan(tmp.path());
        let dtos: Vec<PackListEntry> = registry.packs.iter().map(PackListEntry::from).collect();
        assert_eq!(dtos.len(), 1);
        assert_eq!(dtos[0].manifest_id, "test_pack");
        assert!(dtos[0].healthy);
    }
}
