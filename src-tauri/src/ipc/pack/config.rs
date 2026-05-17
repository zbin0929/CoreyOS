//! Pack runtime configuration IPC surface.
//!
//! Three flavours of configuration sit under here:
//!
//!   1. **Generic** — `pack_config_schema` (declarative spec from
//!      `manifest.config_schema`) + `pack_config_get` / `pack_config_set`
//!      (per-Pack `config.yaml` in `~/.hermes/pack-data/<id>/`).
//!      Drives the "Configure" tab in Settings → Packs and the
//!      schema-driven `<PackConfig>` template.
//!
//!   2. **Exchange-rate specific** (`pack_exchange_rate_config_*`) and
//!      **Zone specific** (`pack_zone_config_*`) — Pack-specific
//!      handlers for the meizheng Pack's specialized config files
//!      (exchange rates schedule + zone uploader schedule). Will be
//!      generalized into the generic schema-driven path during PR 3.
//!
//!   3. The two **YAML <-> UI transformers** (`transform_yaml_to_ui`,
//!      `transform_ui_to_yaml`) that translate between disk format
//!      (snake_case YAML) and frontend format (camelCase JSON). Used
//!      by all the per-Pack config handlers.
//!
//! Extracted from `mod.rs` 2026-05-17.

use std::fs;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

/// IPC mirror of [`crate::pack::manifest::ConfigField`]. Carries the
/// recursive schema fields added in v0.3.0 (`fields` / `item` /
/// `showIf` / `preview` / array bounds / width hint) so the
/// frontend `SchemaConfig` template can render nested objects and
/// dynamic arrays without a second round-trip.
///
/// Old flat-schema Packs serialize identically — every new field
/// is `default`-initialized.
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
    /// Sub-schema for `type: nested`. Empty array for scalar fields.
    pub fields: Vec<PackConfigSchema>,
    /// Sub-schema for `type: array` items. Empty array for scalar fields.
    pub item: Vec<PackConfigSchema>,
    /// Optional showIf expression evaluated by the frontend.
    pub show_if: String,
    /// Optional preview / computed template string.
    pub preview: String,
    /// Lower bound on array length. 0 = unlimited.
    pub min_items: u32,
    /// Upper bound on array length. 0 = unlimited.
    pub max_items: u32,
    /// Label for the array "+ Add" button. Empty = frontend default.
    pub add_label: String,
    /// Visual width hint: `""` / `"full"` / `"half"` / `"small"`.
    pub width: String,
}

fn convert_field(f: &crate::pack::ConfigField) -> PackConfigSchema {
    PackConfigSchema {
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
        fields: f.fields.iter().map(convert_field).collect(),
        item: f.item.iter().map(convert_field).collect(),
        show_if: f.show_if.clone(),
        preview: f.preview.clone(),
        min_items: f.min_items,
        max_items: f.max_items,
        add_label: f.add_label.clone(),
        width: f.width.clone(),
    }
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

    let schema = manifest.config_schema.iter().map(convert_field).collect();
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
    let manifest_for_schedule = {
        let registry = state.packs.read();
        registry
            .packs
            .iter()
            .find(|e| {
                e.manifest
                    .as_deref()
                    .map(|m| m.id == pack_id)
                    .unwrap_or(false)
            })
            .and_then(|e| e.manifest.as_deref().cloned())
    };
    tokio::task::spawn_blocking(move || {
        let pack_data_dir = hermes_dir.join("pack-data").join(&pack_id);
        let config_dir = pack_data_dir.join("config");
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
        })?;

        // Reinstall schedules so the carrier-level cron change in
        // fuel-rate-config.yaml takes effect without a restart. Best-effort:
        // a failure here is logged but doesn't fail the save.
        if let Some(manifest) = manifest_for_schedule.as_ref() {
            match crate::pack::schedules::install_schedules_with_overrides(
                manifest,
                Some(pack_data_dir.as_path()),
            ) {
                Ok((installed, replaced)) => {
                    tracing::info!(
                        pack_id = %manifest.id,
                        installed,
                        replaced,
                        "pack_config_set: schedules re-installed with cron overrides"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        pack_id = %manifest.id,
                        error = %e,
                        "pack_config_set: failed to re-install schedules"
                    );
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("config_set join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_exchange_rate_config_get(
    pack_id: String,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let yaml_path = hermes_dir
            .join("pack-data")
            .join(&pack_id)
            .join("config")
            .join("exchange-rate-config.yaml");

        if !yaml_path.exists() {
            return Ok(serde_json::Value::Object(serde_json::Map::new()));
        }
        let raw = fs::read_to_string(&yaml_path).map_err(|e| IpcError::Internal {
            message: format!("read exchange-rate-config: {e}"),
        })?;
        let value: serde_json::Value =
            serde_yaml::from_str(&raw).map_err(|e| IpcError::Internal {
                message: format!("parse exchange-rate-config: {e}"),
            })?;
        Ok(value)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("exchange_rate_config_get join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_exchange_rate_config_set(
    pack_id: String,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> IpcResult<()> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    let manifest_for_schedule = {
        let registry = state.packs.read();
        registry
            .packs
            .iter()
            .find(|e| {
                e.manifest
                    .as_deref()
                    .map(|m| m.id == pack_id)
                    .unwrap_or(false)
            })
            .and_then(|e| e.manifest.as_deref().cloned())
    };
    tokio::task::spawn_blocking(move || {
        let pack_data_dir = hermes_dir.join("pack-data").join(&pack_id);
        let config_dir = pack_data_dir.join("config");
        fs::create_dir_all(&config_dir).map_err(|e| IpcError::Internal {
            message: format!("create config dir: {e}"),
        })?;

        let yaml_path = config_dir.join("exchange-rate-config.yaml");
        let tmp = yaml_path.with_extension("yaml.tmp");
        let body = serde_yaml::to_string(&config).map_err(|e| IpcError::Internal {
            message: format!("serialize exchange-rate-config: {e}"),
        })?;
        fs::write(&tmp, body).map_err(|e| IpcError::Internal {
            message: format!("write exchange-rate-config tmp: {e}"),
        })?;
        fs::rename(&tmp, &yaml_path).map_err(|e| IpcError::Internal {
            message: format!("rename exchange-rate-config: {e}"),
        })?;

        if let Some(manifest) = manifest_for_schedule.as_ref() {
            match crate::pack::schedules::install_schedules_with_overrides(
                manifest,
                Some(pack_data_dir.as_path()),
            ) {
                Ok((installed, replaced)) => {
                    tracing::info!(
                        pack_id = %manifest.id,
                        installed,
                        replaced,
                        "pack_exchange_rate_config_set: schedules re-installed"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        pack_id = %manifest.id,
                        error = %e,
                        "pack_exchange_rate_config_set: failed to re-install schedules"
                    );
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("exchange_rate_config_set join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_zone_config_get(
    pack_id: String,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let yaml_path = hermes_dir
            .join("pack-data")
            .join(&pack_id)
            .join("config")
            .join("zone-config.yaml");

        if !yaml_path.exists() {
            return Ok(serde_json::Value::Object(serde_json::Map::new()));
        }
        let raw = fs::read_to_string(&yaml_path).map_err(|e| IpcError::Internal {
            message: format!("read zone-config: {e}"),
        })?;
        let value: serde_json::Value =
            serde_yaml::from_str(&raw).map_err(|e| IpcError::Internal {
                message: format!("parse zone-config: {e}"),
            })?;
        Ok(value)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("zone_config_get join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_zone_config_set(
    pack_id: String,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> IpcResult<()> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    let manifest_for_schedule = {
        let registry = state.packs.read();
        registry
            .packs
            .iter()
            .find(|e| {
                e.manifest
                    .as_deref()
                    .map(|m| m.id == pack_id)
                    .unwrap_or(false)
            })
            .and_then(|e| e.manifest.as_deref().cloned())
    };
    tokio::task::spawn_blocking(move || {
        let pack_data_dir = hermes_dir.join("pack-data").join(&pack_id);
        let config_dir = pack_data_dir.join("config");
        fs::create_dir_all(&config_dir).map_err(|e| IpcError::Internal {
            message: format!("create config dir: {e}"),
        })?;

        let yaml_path = config_dir.join("zone-config.yaml");
        let tmp = yaml_path.with_extension("yaml.tmp");
        let body = serde_yaml::to_string(&config).map_err(|e| IpcError::Internal {
            message: format!("serialize zone-config: {e}"),
        })?;
        fs::write(&tmp, body).map_err(|e| IpcError::Internal {
            message: format!("write zone-config tmp: {e}"),
        })?;
        fs::rename(&tmp, &yaml_path).map_err(|e| IpcError::Internal {
            message: format!("rename zone-config: {e}"),
        })?;

        if let Some(manifest) = manifest_for_schedule.as_ref() {
            match crate::pack::schedules::install_schedules_with_overrides(
                manifest,
                Some(pack_data_dir.as_path()),
            ) {
                Ok((installed, replaced)) => {
                    tracing::info!(
                        pack_id = %manifest.id,
                        installed,
                        replaced,
                        "pack_zone_config_set: schedules re-installed"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        pack_id = %manifest.id,
                        error = %e,
                        "pack_zone_config_set: failed to re-install schedules"
                    );
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("zone_config_set join: {e}"),
    })?
}

/// Validate a config-file slug supplied by a Pack manifest. Names
/// must be `[a-z0-9][a-z0-9-]*` to prevent path traversal and to
/// keep file names predictable across platforms.
fn validate_config_name(name: &str) -> IpcResult<()> {
    if name.is_empty() || name.len() > 64 {
        return Err(IpcError::Internal {
            message: format!("invalid config name length: {:?}", name.len()),
        });
    }
    let bytes = name.as_bytes();
    let first = bytes[0];
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return Err(IpcError::Internal {
            message: "config name must start with a lowercase letter or digit".into(),
        });
    }
    let last = bytes[bytes.len() - 1];
    if last == b'-' {
        return Err(IpcError::Internal {
            message: "config name must not end with a dash".into(),
        });
    }
    for &b in bytes {
        let ok = b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-';
        if !ok {
            return Err(IpcError::Internal {
                message: format!("config name has forbidden char: {name:?}"),
            });
        }
    }
    Ok(())
}

/// Read `~/.hermes/pack-data/<pack_id>/config/<config_name>.yaml`.
/// Returns `{}` when the file is missing so first-time loads land
/// gracefully on default-filled forms.
///
/// Used by the v0.3.0 schema-driven `SchemaConfig` template — every
/// view declares its own `config_file` so one Pack can host many
/// independent configuration surfaces (fuel rate / exchange rate /
/// zone / etc.) without proliferating dedicated IPC commands.
#[tauri::command]
pub async fn pack_named_config_get(
    pack_id: String,
    config_name: String,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    validate_config_name(&config_name)?;
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let yaml_path = hermes_dir
            .join("pack-data")
            .join(&pack_id)
            .join("config")
            .join(format!("{config_name}.yaml"));
        if !yaml_path.exists() {
            return Ok(serde_json::Value::Object(serde_json::Map::new()));
        }
        let raw = fs::read_to_string(&yaml_path).map_err(|e| IpcError::Internal {
            message: format!("read named config {config_name}: {e}"),
        })?;
        let value: serde_json::Value =
            serde_yaml::from_str(&raw).map_err(|e| IpcError::Internal {
                message: format!("parse named config {config_name}: {e}"),
            })?;
        Ok(value)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("named_config_get join: {e}"),
    })?
}

/// Atomic-write the supplied JSON value to
/// `~/.hermes/pack-data/<pack_id>/config/<config_name>.yaml` and
/// re-install Pack schedules so any cron overrides take effect
/// without requiring a Corey restart (mirrors the existing
/// fuel/exchange-rate/zone handlers).
#[tauri::command]
pub async fn pack_named_config_set(
    pack_id: String,
    config_name: String,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> IpcResult<()> {
    validate_config_name(&config_name)?;
    let hermes_dir = state.packs.read().hermes_dir.clone();
    let manifest_for_schedule = {
        let registry = state.packs.read();
        registry
            .packs
            .iter()
            .find(|e| {
                e.manifest
                    .as_deref()
                    .map(|m| m.id == pack_id)
                    .unwrap_or(false)
            })
            .and_then(|e| e.manifest.as_deref().cloned())
    };
    tokio::task::spawn_blocking(move || {
        let pack_data_dir = hermes_dir.join("pack-data").join(&pack_id);
        let config_dir = pack_data_dir.join("config");
        fs::create_dir_all(&config_dir).map_err(|e| IpcError::Internal {
            message: format!("create config dir: {e}"),
        })?;

        let yaml_path = config_dir.join(format!("{config_name}.yaml"));
        let tmp = yaml_path.with_extension("yaml.tmp");
        let body = serde_yaml::to_string(&config).map_err(|e| IpcError::Internal {
            message: format!("serialize named config {config_name}: {e}"),
        })?;
        fs::write(&tmp, body).map_err(|e| IpcError::Internal {
            message: format!("write named config {config_name} tmp: {e}"),
        })?;
        fs::rename(&tmp, &yaml_path).map_err(|e| IpcError::Internal {
            message: format!("rename named config {config_name}: {e}"),
        })?;

        if let Some(manifest) = manifest_for_schedule.as_ref() {
            match crate::pack::schedules::install_schedules_with_overrides(
                manifest,
                Some(pack_data_dir.as_path()),
            ) {
                Ok((installed, replaced)) => {
                    tracing::info!(
                        pack_id = %manifest.id,
                        config_name = %config_name,
                        installed,
                        replaced,
                        "pack_named_config_set: schedules re-installed"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        pack_id = %manifest.id,
                        config_name = %config_name,
                        error = %e,
                        "pack_named_config_set: failed to re-install schedules"
                    );
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("named_config_set join: {e}"),
    })?
}

#[cfg(test)]
mod named_config_tests {
    use super::*;

    #[test]
    fn validate_config_name_accepts_canonical() {
        assert!(validate_config_name("fuel-rate-config").is_ok());
        assert!(validate_config_name("exchange-rate-config").is_ok());
        assert!(validate_config_name("zone-config").is_ok());
        assert!(validate_config_name("a").is_ok());
        assert!(validate_config_name("a1").is_ok());
    }

    #[test]
    fn validate_config_name_rejects_traversal_and_uppercase() {
        for bad in [
            "",
            "../escape",
            "..",
            "Foo",
            "foo_bar",
            "foo.bar",
            "/abs",
            "-leading-dash",
            "trailing-",
            "with space",
        ] {
            assert!(
                validate_config_name(bad).is_err(),
                "expected reject for {bad:?}"
            );
        }
    }

    #[test]
    fn validate_config_name_rejects_too_long() {
        let long = "a".repeat(65);
        assert!(validate_config_name(&long).is_err());
        assert!(validate_config_name(&long[..64]).is_ok());
    }
}
