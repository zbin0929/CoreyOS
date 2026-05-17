//! IPC surface for the Pack subsystem.
//!
//! Commands:
//! - `pack_list`: read all installed Packs + their enable state.
//! - `pack_set_enabled`: flip a Pack's enable bit AND sync its
//!   MCP servers into `~/.hermes/config.yaml` (stage 3c). The
//!   gateway is restarted asynchronously after a successful sync
//!   so Hermes picks up the change without the user having to do
//!   it manually.

use std::fs;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_config;
use crate::license::{self, Verdict};
use crate::pack::{prefix_workflow_id, PackManifest, RegistryEntry};
use crate::state::AppState;
use crate::workflow::model::WorkflowSummary;

pub mod data_source;
pub mod mcp_transport;

mod config;
mod install;
use install::{matches_pack_id, sync_config_yaml, sync_schedules, sync_skills, sync_workflows};
// Glob re-exports so `tauri::generate_handler!` can find handlers
// (`pack_import_zip` / `pack_uninstall` from install, `pack_config_*` /
// `pack_named_config_*` from config) and their `__cmd__*` shims at
// `crate::ipc::pack::*`. Same pattern as `workflow/mod.rs`.
#[allow(unused_imports)]
pub use config::*;
#[allow(unused_imports)]
pub use install::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListEntry {
    pub dir_name: String,
    pub manifest_id: String,
    pub title: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub enabled: bool,
    pub error: Option<String>,
    pub healthy: bool,
    pub license_gated: bool,
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
            license_gated: false,
        }
    }
}

fn resolve_license_features(config_dir: &std::path::Path) -> Vec<String> {
    match license::status(config_dir) {
        Verdict::Valid { payload } => payload.features,
        _ => Vec::new(),
    }
}

fn pack_is_gated(manifest: &PackManifest, features: &[String]) -> bool {
    if manifest.license_feature.is_empty() {
        return false;
    }
    !features.contains(&manifest.license_feature)
}

#[tauri::command]
pub async fn pack_list(state: State<'_, AppState>) -> IpcResult<Vec<PackListEntry>> {
    let config_dir = state.config_dir.clone();
    let features = tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_features join: {e}"),
        })?;
    let registry = state.packs.read();
    let mut entries: Vec<PackListEntry> = registry.packs.iter().map(PackListEntry::from).collect();
    for (i, entry) in registry.packs.iter().enumerate() {
        if let Some(m) = entry.manifest.as_deref() {
            entries[i].license_gated = pack_is_gated(m, &features);
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn pack_rescan(state: State<'_, AppState>) -> IpcResult<Vec<PackListEntry>> {
    let hermes_dir = crate::paths::hermes_data_dir().map_err(|e| IpcError::Internal {
        message: e.to_string(),
    })?;
    let config_dir = state.config_dir.clone();
    let features = tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_features join: {e}"),
        })?;
    let new_registry = crate::pack::Registry::scan(&hermes_dir);
    let mut entries: Vec<PackListEntry> =
        new_registry.packs.iter().map(PackListEntry::from).collect();
    for (i, entry) in new_registry.packs.iter().enumerate() {
        if let Some(m) = entry.manifest.as_deref() {
            entries[i].license_gated = pack_is_gated(m, &features);
        }
    }
    {
        let mut reg = state.packs.write();
        *reg = new_registry;
    }
    Ok(entries)
}

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

/// Look up a view's `data_source` by `view_id`. Top-level views in
/// `manifest.views` are matched first; if no top-level match, walk
/// each view's `options.layout[].view` (CompositeDashboard child
/// cells) and match on the embedded `view.id`.
///
/// Returns `Some(data_source_yaml)` on hit, `None` on miss. Child
/// cells with `data_source: { static: {} }` resolve here too — they
/// just produce an empty object, which is the correct render for
/// "no live data; the cell shows its declared metrics with zeros".
fn find_view_data_source(manifest: &PackManifest, view_id: &str) -> Option<serde_yaml::Value> {
    if let Some(v) = manifest.views.iter().find(|v| v.id == view_id) {
        return Some(v.data_source.clone());
    }
    for parent in &manifest.views {
        let Some(layout) = parent.options.get("layout") else {
            continue;
        };
        let Some(cells) = layout.as_sequence() else {
            continue;
        };
        for cell in cells {
            let Some(cell_map) = cell.as_mapping() else {
                continue;
            };
            let Some(inner) = cell_map.get(serde_yaml::Value::String("view".into())) else {
                continue;
            };
            let Some(inner_map) = inner.as_mapping() else {
                continue;
            };
            let id_val = inner_map.get(serde_yaml::Value::String("id".into()));
            if id_val.and_then(|v| v.as_str()) == Some(view_id) {
                return Some(
                    inner_map
                        .get(serde_yaml::Value::String("data_source".into()))
                        .cloned()
                        .unwrap_or(serde_yaml::Value::Null),
                );
            }
        }
    }
    None
}

#[tauri::command]
pub async fn pack_view_data(
    pack_id: String,
    view_id: String,
    params: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    let data_source_val = {
        let registry = state.packs.read();
        let entry = registry.packs.iter().find(|p| matches_pack_id(p, &pack_id));
        let manifest = entry.and_then(|p| p.manifest.as_ref());
        manifest.and_then(|m| find_view_data_source(m, &view_id))
    };
    let Some(ds) = data_source_val else {
        return Err(IpcError::Internal {
            message: format!("view not found: {pack_id}/{view_id}"),
        });
    };
    let ds = data_source::resolve_config_templates(&ds, &pack_id, &state.packs.read().hermes_dir);
    let runtime_params = params.unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    data_source::resolve_data_source_async(&ds, &state.authority, &runtime_params).await
}

#[tauri::command]
pub async fn pack_views_list(state: State<'_, AppState>) -> IpcResult<Vec<PackViewDto>> {
    let config_dir = state.config_dir.clone();
    let features = tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_features join: {e}"),
        })?;
    let registry = state.packs.read();
    let mut out = Vec::new();
    for entry in &registry.packs {
        if !entry.enabled {
            continue;
        }
        let Some(manifest) = &entry.manifest else {
            continue;
        };
        if pack_is_gated(manifest, &features) {
            continue;
        }
        for view in &manifest.views {
            let options: serde_json::Value = if view.options.is_empty() {
                serde_json::Value::Object(serde_json::Map::new())
            } else {
                let mut obj = serde_json::Map::new();
                for (k, v) in &view.options {
                    obj.insert(k.clone(), data_source::yaml_to_json(v));
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
                data_source: data_source::yaml_to_json(&view.data_source),
                options,
                actions: view
                    .actions
                    .iter()
                    .map(|a| PackActionDto {
                        label: a.label.clone(),
                        workflow: if a.workflow.is_empty() || a.workflow.starts_with("pack__") {
                            a.workflow.clone()
                        } else {
                            prefix_workflow_id(&manifest.id, &a.workflow)
                        },
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

    if enabled {
        if let Some(m) = manifest_arc.as_deref() {
            let config_dir = state.config_dir.clone();
            let features =
                tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
                    .await
                    .map_err(|e| IpcError::Internal {
                        message: format!("license_features join: {e}"),
                    })?;
            if pack_is_gated(m, &features) {
                return Err(IpcError::Unauthorized {
                    detail: format!(
                        "pack {:?} requires license feature {:?}",
                        pack_id, m.license_feature
                    ),
                });
            }
        }
    }

    let journal = state.changelog_path.clone();

    let config_changed = sync_config_yaml(&pack_id, &manifest_arc, enabled, &hermes_dir, &journal)?;

    sync_skills(
        &pack_id,
        &manifest_arc,
        enabled,
        &hermes_dir,
        pack_dir.as_deref(),
    )?;

    sync_workflows(&pack_id, &manifest_arc, enabled, pack_dir.as_deref())?;

    sync_schedules(&pack_id, &manifest_arc, enabled)?;

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

#[tauri::command]
pub async fn pack_active_souls(state: State<'_, AppState>) -> IpcResult<Vec<PackSoulEntry>> {
    let registry = state.packs.read();
    let mut souls = Vec::new();
    for entry in registry.packs.iter() {
        if !entry.enabled {
            continue;
        }
        let Some(manifest) = entry.manifest.as_deref() else {
            continue;
        };
        if manifest.soul_inject.is_empty() {
            continue;
        }
        let mut parts: Vec<String> = Vec::new();
        for rel in &manifest.soul_inject {
            let path = entry.dir_path.join(rel);
            match fs::read_to_string(&path) {
                Ok(content) => {
                    parts.push(content);
                }
                Err(e) => {
                    tracing::warn!(path = %path.display(), "soul_inject read failed: {e}");
                }
            }
        }
        if !parts.is_empty() {
            souls.push(PackSoulEntry {
                pack_id: manifest.id.clone(),
                pack_title: manifest.title.clone(),
                content: parts.join("\n\n"),
            });
        }
    }
    Ok(souls)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSoulEntry {
    pub pack_id: String,
    pub pack_title: String,
    pub content: String,
}

#[tauri::command]
pub async fn pack_workflows_list(state: State<'_, AppState>) -> IpcResult<Vec<WorkflowSummary>> {
    let registry = state.packs.read();
    let mut workflows = Vec::new();

    for entry in &registry.packs {
        if !entry.enabled {
            continue;
        }
        let Some(manifest) = entry.manifest.as_ref() else {
            continue;
        };

        for wf_path in &manifest.workflows {
            let full_path = registry
                .hermes_dir
                .join("skill-packs")
                .join(&entry.dir_name)
                .join(wf_path);

            if !full_path.exists() {
                continue;
            }

            let Ok(yaml_str) = fs::read_to_string(&full_path) else {
                continue;
            };

            let Ok(wf_def) = serde_yaml::from_str::<crate::workflow::model::WorkflowDef>(&yaml_str)
            else {
                continue;
            };

            let prefixed_id = prefix_workflow_id(&manifest.id, &wf_def.name);

            workflows.push(WorkflowSummary {
                id: prefixed_id,
                name: wf_def.name.clone(),
                description: wf_def.description.clone(),
                version: wf_def.version,
                trigger_type: wf_def.trigger_type_label().to_string(),
                step_count: wf_def.steps.len(),
                updated_at_ms: 0,
            });
        }
    }

    Ok(workflows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::Registry;
    use std::sync::Arc;

    fn manifest_for_lookup(yaml: &str) -> PackManifest {
        serde_yaml::from_str(yaml).expect("parse manifest")
    }

    #[test]
    fn find_view_data_source_hits_top_level() {
        let m = manifest_for_lookup(
            r#"
id: t
title: T
version: 1.0.0
views:
  - id: top
    title: Top
    template: MetricsCard
    data_source:
      static: {}
"#,
        );
        let ds = find_view_data_source(&m, "top").expect("found");
        assert!(ds
            .as_mapping()
            .is_some_and(|m| m.contains_key(serde_yaml::Value::String("static".into()))));
    }

    #[test]
    fn find_view_data_source_hits_nested_child_in_composite_layout() {
        // Mirror the meizheng dashboard shape: top-level CompositeDashboard
        // view whose `layout[].view` block declares its own id + data_source.
        let m = manifest_for_lookup(
            r#"
id: t
title: T
version: 1.0.0
views:
  - id: dashboard
    title: Dashboard
    template: CompositeDashboard
    layout:
      - span: 4
        view:
          id: dashboard-ups-fuel
          title: UPS
          template: MetricsCard
          data_source:
            static: {}
      - span: 4
        view:
          id: dashboard-fedex-fuel
          title: FedEx
          template: MetricsCard
          data_source:
            mcp:
              server: x
              method: y
"#,
        );
        let ups = find_view_data_source(&m, "dashboard-ups-fuel").expect("ups found");
        assert!(ups
            .as_mapping()
            .is_some_and(|m| m.contains_key(serde_yaml::Value::String("static".into()))));
        let fedex = find_view_data_source(&m, "dashboard-fedex-fuel").expect("fedex found");
        assert!(fedex
            .as_mapping()
            .is_some_and(|m| m.contains_key(serde_yaml::Value::String("mcp".into()))));
    }

    #[test]
    fn find_view_data_source_returns_none_for_unknown_id() {
        let m = manifest_for_lookup(
            r#"
id: t
title: T
version: 1.0.0
views:
  - id: dashboard
    title: D
    template: CompositeDashboard
    layout:
      - span: 4
        view:
          id: child
          title: C
          template: MetricsCard
"#,
        );
        assert!(find_view_data_source(&m, "missing").is_none());
    }

    #[test]
    fn find_view_data_source_keeps_scanning_other_parents_after_layoutless_one() {
        // Regression: an early `?` operator returned None from the function as
        // soon as the first parent had no `layout`, masking children declared
        // under a later parent. With `let-else continue` we must keep scanning.
        let m = manifest_for_lookup(
            r#"
id: t
title: T
version: 1.0.0
views:
  - id: solo
    title: Solo
    template: MetricsCard
  - id: dashboard
    title: D
    template: CompositeDashboard
    layout:
      - span: 12
        view:
          id: child
          title: C
          template: MetricsCard
          data_source:
            static: {}
"#,
        );
        assert!(find_view_data_source(&m, "child").is_some());
    }

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
        let r = Registry::empty();
        let dtos: Vec<PackListEntry> = r.packs.iter().map(PackListEntry::from).collect();
        assert!(dtos.is_empty());
    }

    #[test]
    fn rescan_produces_same_dto_shape_as_list() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let packs_dir = tmp.path().join("skill-packs");
        let pack_dir = packs_dir.join("test_pack");
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

    #[test]
    fn pack_is_gated_returns_true_when_feature_missing() {
        let yaml =
            "schema_version: 1\nid: pro_pack\nversion: \"1.0.0\"\nlicense_feature: pro_analytics\n";
        let manifest = match crate::pack::parse(yaml) {
            crate::pack::ManifestLoadOutcome::Loaded(m) => m,
            other => panic!("expected Loaded, got {other:?}"),
        };
        assert!(pack_is_gated(&manifest, &[]));
        assert!(pack_is_gated(&manifest, &["basic".into()]));
        assert!(!pack_is_gated(&manifest, &["pro_analytics".into()]));
        assert!(!pack_is_gated(
            &manifest,
            &["basic".into(), "pro_analytics".into()]
        ));
    }

    #[test]
    fn pack_is_gated_returns_false_when_no_license_feature() {
        let yaml = "schema_version: 1\nid: free_pack\nversion: \"1.0.0\"\n";
        let manifest = match crate::pack::parse(yaml) {
            crate::pack::ManifestLoadOutcome::Loaded(m) => m,
            other => panic!("expected Loaded, got {other:?}"),
        };
        assert!(!pack_is_gated(&manifest, &[]));
    }
}
