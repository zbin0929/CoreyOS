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
use crate::license::{self, Verdict};
use crate::pack::{
    disable_updates, enable_updates, install_schedules, install_skills, install_workflows,
    prefix_workflow_id, uninstall_schedules, uninstall_skills, uninstall_workflows, PackManifest,
    RegistryEntry, TemplateContext,
};
use crate::state::AppState;
use crate::workflow::model::WorkflowSummary;

pub mod data_source;
pub mod mcp_transport;

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
        let view = manifest.and_then(|m| m.views.iter().find(|v| v.id == view_id));
        view.map(|v| v.data_source.clone())
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackConfigSchema {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub required: bool,
    pub secret: bool,
    pub description: String,
    pub help: String,
    pub group: String,
    pub validation: String,
    pub placeholder: String,
    pub default: serde_json::Value,
    pub options: Vec<String>,
}

#[tauri::command]
pub async fn pack_config_schema(
    pack_id: String,
    state: State<'_, AppState>,
) -> IpcResult<Vec<PackConfigSchema>> {
    let registry = state.packs.read();
    let entry = registry
        .packs
        .iter()
        .find(|e| e.manifest.as_ref().map(|m| &m.id) == Some(&pack_id))
        .ok_or_else(|| IpcError::Internal {
            message: format!("pack not found: {pack_id}"),
        })?;

    let manifest = entry.manifest.as_ref().ok_or_else(|| IpcError::Internal {
        message: "pack has no manifest".into(),
    })?;

    let schema = manifest
        .config_schema
        .iter()
        .map(|f| PackConfigSchema {
            key: f.key.clone(),
            label: f.label.clone(),
            field_type: f.field_type.clone(),
            required: f.required,
            secret: f.field_type == "secret",
            description: f.description.clone(),
            help: f.help.clone(),
            group: f.group.clone(),
            validation: f.validation.clone(),
            placeholder: f.placeholder.clone(),
            default: serde_yaml::from_value(f.default.clone()).unwrap_or(serde_json::Value::Null),
            options: f.options.clone(),
        })
        .collect();

    Ok(schema)
}

fn transform_yaml_to_ui(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(carriers) = value.get_mut("carriers").and_then(|v| v.as_object_mut()) {
        for carrier in carriers.values_mut() {
            if let Some(obj) = carrier.as_object_mut() {
                if let Some(url) = obj.remove("source_url") {
                    obj.insert("sourceUrl".to_string(), url);
                }
                if let Some(schedule) = obj.remove("update_schedule") {
                    obj.insert("updateFrequency".to_string(), schedule);
                }
                // Keep validityDays if present, default to 7
                if !obj.contains_key("validityDays") && !obj.contains_key("validity_days") {
                    obj.insert("validityDays".to_string(), serde_json::json!(7));
                } else if let Some(vd) = obj.remove("validity_days") {
                    obj.insert("validityDays".to_string(), vd);
                }

                if let Some(services) = obj.get_mut("services").and_then(|v| v.as_array_mut()) {
                    for service in services {
                        if let Some(svc_obj) = service.as_object_mut() {
                            if let Some(name) = svc_obj.remove("source_name") {
                                svc_obj.insert("sourceName".to_string(), name);
                            }
                            if let Some(apply) = svc_obj.remove("apply_to") {
                                svc_obj.insert("applyTo".to_string(), apply);
                            } else {
                                svc_obj.insert(
                                    "applyTo".to_string(),
                                    serde_json::Value::String("default".to_string()),
                                );
                            }
                            if let Some(codes) = svc_obj.remove("service_codes") {
                                svc_obj.insert("serviceCodes".to_string(), codes);
                            }
                            // legacy field: drop silently if present
                            svc_obj.remove("meizheng_service");
                        }
                    }
                }
            }
        }
    }
    value
}

fn transform_ui_to_yaml(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(carriers) = value.get_mut("carriers").and_then(|v| v.as_object_mut()) {
        for carrier in carriers.values_mut() {
            if let Some(obj) = carrier.as_object_mut() {
                if let Some(url) = obj.remove("sourceUrl") {
                    obj.insert("source_url".to_string(), url);
                }
                if let Some(freq) = obj.remove("updateFrequency") {
                    obj.insert("update_schedule".to_string(), freq);
                }
                // Save validityDays back to YAML as validity_days
                if let Some(vd) = obj.remove("validityDays") {
                    obj.insert("validity_days".to_string(), vd);
                }

                if let Some(services) = obj.get_mut("services").and_then(|v| v.as_array_mut()) {
                    for service in services {
                        if let Some(svc_obj) = service.as_object_mut() {
                            if let Some(name) = svc_obj.remove("sourceName") {
                                svc_obj.insert("source_name".to_string(), name);
                            }
                            if let Some(apply) = svc_obj.remove("applyTo") {
                                svc_obj.insert("apply_to".to_string(), apply);
                            }
                            if let Some(codes) = svc_obj.remove("serviceCodes") {
                                svc_obj.insert("service_codes".to_string(), codes);
                            }
                            // strip legacy field on save too
                            svc_obj.remove("targetService");
                        }
                    }
                }
            }
        }
    }
    value
}

#[tauri::command]
pub async fn pack_config_get(
    pack_id: String,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let yaml_path = hermes_dir
            .join("pack-data")
            .join(&pack_id)
            .join("config")
            .join("fuel-rate-config.yaml");

        if yaml_path.exists() {
            let raw = fs::read_to_string(&yaml_path).map_err(|e| IpcError::Internal {
                message: format!("read YAML config: {e}"),
            })?;
            let value: serde_json::Value =
                serde_yaml::from_str(&raw).map_err(|e| IpcError::Internal {
                    message: format!("parse YAML config: {e}"),
                })?;
            return Ok(transform_yaml_to_ui(value));
        }

        let json_path = hermes_dir
            .join("pack-data")
            .join(&pack_id)
            .join("config.json");
        if json_path.exists() {
            let raw = fs::read_to_string(&json_path).map_err(|e| IpcError::Internal {
                message: format!("read JSON config: {e}"),
            })?;
            return serde_json::from_str(&raw).map_err(|e| IpcError::Internal {
                message: format!("parse JSON config: {e}"),
            });
        }

        Ok(serde_json::Value::Object(serde_json::Map::new()))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("config_get join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_config_set(
    pack_id: String,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> IpcResult<()> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let config_dir = hermes_dir.join("pack-data").join(&pack_id).join("config");
        fs::create_dir_all(&config_dir).map_err(|e| IpcError::Internal {
            message: format!("create config dir: {e}"),
        })?;

        let yaml_path = config_dir.join("fuel-rate-config.yaml");
        let tmp = yaml_path.with_extension("yaml.tmp");
        let yaml_config = transform_ui_to_yaml(config);
        let body = serde_yaml::to_string(&yaml_config).map_err(|e| IpcError::Internal {
            message: format!("serialize YAML config: {e}"),
        })?;
        fs::write(&tmp, body).map_err(|e| IpcError::Internal {
            message: format!("write YAML config tmp: {e}"),
        })?;
        fs::rename(&tmp, &yaml_path).map_err(|e| IpcError::Internal {
            message: format!("rename YAML config: {e}"),
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("config_set join: {e}"),
    })?
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

#[tauri::command]
pub async fn pack_import_zip(zip_path: String, state: State<'_, AppState>) -> IpcResult<String> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let src = std::path::Path::new(&zip_path);
        if !src.exists() {
            return Err(IpcError::Internal {
                message: format!("zip not found: {zip_path}"),
            });
        }
        let packs_dir = hermes_dir.join("skill-packs");
        fs::create_dir_all(&packs_dir).map_err(|e| IpcError::Internal {
            message: format!("create skill-packs dir: {e}"),
        })?;
        let file = fs::File::open(src).map_err(|e| IpcError::Internal {
            message: format!("open zip: {e}"),
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| IpcError::Internal {
            message: format!("read zip: {e}"),
        })?;
        let first_entry = archive.by_index(0).map_err(|e| IpcError::Internal {
            message: format!("zip empty: {e}"),
        })?;
        let top_dir = first_entry
            .name()
            .split('/')
            .next()
            .unwrap_or("unknown")
            .to_string();
        drop(first_entry);

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| IpcError::Internal {
                message: format!("zip entry {i}: {e}"),
            })?;
            let out_path = packs_dir.join(entry.name());
            if entry.is_dir() {
                fs::create_dir_all(&out_path).map_err(|e| IpcError::Internal {
                    message: format!("mkdir {}: {e}", entry.name()),
                })?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| IpcError::Internal {
                        message: format!("mkdir parent: {e}"),
                    })?;
                }
                let mut buf = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut buf).map_err(|e| {
                    IpcError::Internal {
                        message: format!("read zip entry: {e}"),
                    }
                })?;
                fs::write(&out_path, &buf).map_err(|e| IpcError::Internal {
                    message: format!("write {}: {e}", entry.name()),
                })?;
            }
        }
        Ok(top_dir)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("import join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_uninstall(pack_id: String, state: State<'_, AppState>) -> IpcResult<()> {
    let (hermes_dir, pack_dir) = {
        let registry = state.packs.read();
        let entry = registry.packs.iter().find(|p| matches_pack_id(p, &pack_id));
        let pack_dir = entry.map(|p| p.dir_path.clone());
        (registry.hermes_dir.clone(), pack_dir)
    };

    tokio::task::spawn_blocking(move || {
        let _ = crate::pack::backup::backup_pack(&hermes_dir, &pack_id);
        if let Some(dir) = pack_dir {
            if dir.exists() {
                fs::remove_dir_all(&dir).map_err(|e| IpcError::Internal {
                    message: format!("remove pack dir: {e}"),
                })?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("uninstall join: {e}"),
    })?
}

fn matches_pack_id(entry: &RegistryEntry, pack_id: &str) -> bool {
    let entry_id = entry
        .manifest
        .as_ref()
        .map(|m| m.id.as_str())
        .unwrap_or(entry.dir_name.as_str());
    entry_id == pack_id
}

fn sync_config_yaml(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    journal: &std::path::Path,
) -> IpcResult<bool> {
    let Some(manifest) = manifest else {
        return Ok(false);
    };
    if manifest.mcp_servers.is_empty() {
        return Ok(false);
    }

    let pack_dir = hermes_dir.join("skill-packs").join(pack_id);
    let pack_data_dir = hermes_dir.join("pack-data").join(pack_id);
    if enabled {
        let _ = crate::pack::backup::backup_pack(hermes_dir, pack_id);
        if let Err(e) = fs::create_dir_all(&pack_data_dir) {
            return Err(IpcError::Internal {
                message: format!("create pack-data dir: {e}"),
            });
        }
        let _ = crate::pack::run_migrations(
            &pack_data_dir,
            "0",
            &manifest.version,
            &manifest.migrations,
        );
    }

    let ctx = TemplateContext {
        platform: crate::pack::current_platform().to_string(),
        pack_dir,
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

fn sync_skills(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    pack_dir: Option<&std::path::Path>,
) -> IpcResult<()> {
    if enabled {
        let (Some(manifest), Some(pack_dir)) = (manifest, pack_dir) else {
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
