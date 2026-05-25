//! Pack runtime configuration IPC surface.
//!
//! Provides `pack_named_config_get` / `pack_named_config_set` — schema-driven
//! reader/writer for any `~/.hermes/pack-data/<id>/config/<name>.yaml` file.
//! Used by the v0.3.0 `SchemaConfig` template when a view declares
//! `options.config_file`.
//!
//! Extracted from `mod.rs` 2026-05-17. Legacy IPC handlers deleted 2026-05-19.

use std::fs;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::pack::manifest::ConfigField;
use crate::state::AppState;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackConfigSchemaField {
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
    pub fields: Vec<PackConfigSchemaField>,
    pub item: Vec<PackConfigSchemaField>,
    pub show_if: String,
    pub preview: String,
    pub min_items: u32,
    pub max_items: u32,
    pub add_label: String,
    pub width: String,
    pub key_label: String,
}

impl From<&ConfigField> for PackConfigSchemaField {
    fn from(f: &ConfigField) -> Self {
        let default_json = serde_json::to_value(&f.default).unwrap_or(serde_json::Value::Null);
        Self {
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
            default: default_json,
            options: f.options.clone(),
            fields: f.fields.iter().map(PackConfigSchemaField::from).collect(),
            item: f.item.iter().map(PackConfigSchemaField::from).collect(),
            show_if: f.show_if.clone(),
            preview: f.preview.clone(),
            min_items: f.min_items,
            max_items: f.max_items,
            add_label: f.add_label.clone(),
            width: f.width.clone(),
            key_label: f.key_label.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackConfigSchema {
    pub pack_id: String,
    pub pack_title: String,
    pub schema: Vec<PackConfigSchemaField>,
}

#[tauri::command]
pub async fn pack_config_schema(
    pack_id: String,
    state: State<'_, AppState>,
) -> IpcResult<PackConfigSchema> {
    let registry = state.packs.read();
    let entry = registry
        .packs
        .iter()
        .find(|e| {
            e.manifest
                .as_deref()
                .map(|m| m.id == pack_id)
                .unwrap_or(false)
        })
        .ok_or_else(|| IpcError::Internal {
            message: format!("pack not found: {pack_id}"),
        })?;
    let manifest = entry
        .manifest
        .as_deref()
        .ok_or_else(|| IpcError::Internal {
            message: format!("pack has no manifest: {pack_id}"),
        })?;
    Ok(PackConfigSchema {
        pack_id: manifest.id.clone(),
        pack_title: manifest.title.clone(),
        schema: manifest
            .config_schema
            .iter()
            .map(PackConfigSchemaField::from)
            .collect(),
    })
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
            .join("config.yaml");
        if !yaml_path.exists() {
            return Ok(serde_json::Value::Object(serde_json::Map::new()));
        }
        let raw = fs::read_to_string(&yaml_path).map_err(|e| IpcError::Internal {
            message: format!("read pack config: {e}"),
        })?;
        let value: serde_json::Value =
            serde_yaml::from_str(&raw).map_err(|e| IpcError::Internal {
                message: format!("parse pack config: {e}"),
            })?;
        Ok(value)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("pack_config_get join: {e}"),
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
        let pack_data_dir = hermes_dir.join("pack-data").join(&pack_id);
        fs::create_dir_all(&pack_data_dir).map_err(|e| IpcError::Internal {
            message: format!("create pack-data dir: {e}"),
        })?;
        let yaml_path = pack_data_dir.join("config.yaml");
        let tmp = yaml_path.with_extension("yaml.tmp");
        let body = serde_yaml::to_string(&config).map_err(|e| IpcError::Internal {
            message: format!("serialize pack config: {e}"),
        })?;
        fs::write(&tmp, body).map_err(|e| IpcError::Internal {
            message: format!("write pack config tmp: {e}"),
        })?;
        fs::rename(&tmp, &yaml_path).map_err(|e| IpcError::Internal {
            message: format!("rename pack config: {e}"),
        })?;

        crate::hermes_config::inject_pack_env_vars();
        crate::hermes_config::inject_pack_mcp_servers();
        if let Err(e) = crate::hermes_config::gateway_restart() {
            tracing::warn!(pack_id = %pack_id, error = %e, "gateway restart after config save failed");
        }

        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("pack_config_set join: {e}"),
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
