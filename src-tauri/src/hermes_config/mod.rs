//! Read/write integration with `~/.hermes/config.yaml`.
//!
//! We care only about the `model` section (which LLM the Hermes agent is
//! using under the hood). Everything else in that file is preserved as
//! opaque YAML — we round-trip through `serde_yaml::Value` so users can
//! keep hand-crafted fields (fallback_providers, auxiliary.*, etc.) without
//! us silently dropping them.
//!
//! **Important:** Hermes does NOT hot-reload `config.yaml`. Changes to the
//! model section take effect only after `hermes gateway restart`. Surfacing
//! that to the user is the frontend's job.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::changelog;
use crate::fs_atomic;

pub(super) const HERMES_DIR: &str = ".hermes";
pub(super) const CONFIG_FILE: &str = "config.yaml";
pub(super) const ENV_FILE: &str = ".env";

/// The subset of Hermes config we understand + expose in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HermesModelSection {
    /// Model id (e.g. `deepseek-reasoner`).
    #[serde(default)]
    pub default: Option<String>,
    /// Provider slug (e.g. `deepseek`, `openai`, `anthropic`, `openrouter`).
    #[serde(default)]
    pub provider: Option<String>,
    /// Optional base URL override — for OpenAI-compatible custom endpoints.
    #[serde(default)]
    pub base_url: Option<String>,
}

/// Aggregated view for the LLMs page.
#[derive(Debug, Clone, Serialize)]
pub struct HermesConfigView {
    /// Absolute path we read from, for display + error messages.
    pub config_path: String,
    /// `true` if the file existed and was parseable.
    pub present: bool,
    /// Current `model.*` values.
    pub model: HermesModelSection,
    /// API-key env vars detected in `~/.hermes/.env`. We return the KEY NAMES
    /// only, never the values — so the UI can show "DEEPSEEK_API_KEY ✓ set"
    /// without exposing secrets over IPC.
    pub env_keys_present: Vec<String>,
}

/// Resolve `~/.hermes/`. Pure std, no `dirs` crate needed.
///
/// Reads `$HOME` first (covers macOS, Linux, and WSL), then falls back
/// to `%USERPROFILE%` so Windows CI and native Windows hosts — where
/// `$HOME` isn't populated by default — also resolve.
pub(crate) fn hermes_dir() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "neither $HOME nor %USERPROFILE% set",
            )
        })?;
    Ok(PathBuf::from(home).join(HERMES_DIR))
}

pub(super) fn config_path() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(CONFIG_FILE))
}

pub(super) fn env_path() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(ENV_FILE))
}

/// Full snapshot suitable for the UI.
pub fn read_view() -> io::Result<HermesConfigView> {
    let config_path = config_path()?;
    let path_str = config_path.to_string_lossy().to_string();

    let (present, model) = match fs::read_to_string(&config_path) {
        Ok(raw) => {
            let root: Value = serde_yaml::from_str(&raw).unwrap_or(Value::Null);
            let model = extract_model(&root);
            (true, model)
        }
        Err(_) => (false, HermesModelSection::default()),
    };

    let env_keys_present = read_env_key_names().unwrap_or_default();

    Ok(HermesConfigView {
        config_path: path_str,
        present,
        model,
        env_keys_present,
    })
}

fn extract_model(root: &Value) -> HermesModelSection {
    let Some(map) = root.as_mapping() else {
        return HermesModelSection::default();
    };
    let Some(model) = map
        .get(Value::String("model".into()))
        .and_then(|v| v.as_mapping())
    else {
        return HermesModelSection::default();
    };
    HermesModelSection {
        default: model
            .get(Value::String("default".into()))
            .and_then(Value::as_str)
            .map(str::to_owned),
        provider: model
            .get(Value::String("provider".into()))
            .and_then(Value::as_str)
            .map(str::to_owned),
        base_url: model
            .get(Value::String("base_url".into()))
            .and_then(Value::as_str)
            .map(str::to_owned),
    }
}

/// Write just the `model` subsection. All other fields in the YAML are
/// preserved verbatim. Missing or empty string fields are REMOVED from the
/// YAML (so `base_url: ""` doesn't stay polluting the file after the user
/// clears it).
///
/// `journal_path`, when provided, receives one `hermes.config.model` entry
/// with the before/after model sections. Pass `None` in contexts where a
/// journal isn't available (tests, early boot).
pub fn write_model(new_model: &HermesModelSection, journal_path: Option<&Path>) -> io::Result<()> {
    let config_path = config_path()?;
    let raw = fs::read_to_string(&config_path).unwrap_or_default();

    // Capture before-state for the journal entry (cheap; small mapping).
    let before_model = if raw.trim().is_empty() {
        HermesModelSection::default()
    } else {
        serde_yaml::from_str::<Value>(&raw)
            .map(|v| extract_model(&v))
            .unwrap_or_default()
    };

    let mut root: Value = if raw.trim().is_empty() {
        Value::Mapping(Mapping::new())
    } else {
        serde_yaml::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    };

    // Ensure root is a mapping (Hermes config always is).
    if !matches!(root, Value::Mapping(_)) {
        root = Value::Mapping(Mapping::new());
    }

    let root_map = root.as_mapping_mut().expect("root is mapping");
    let model_key = Value::String("model".into());

    let mut model_map = root_map
        .get(model_key.clone())
        .and_then(Value::as_mapping)
        .cloned()
        .unwrap_or_else(Mapping::new);

    set_or_remove(&mut model_map, "default", new_model.default.as_deref());
    set_or_remove(&mut model_map, "provider", new_model.provider.as_deref());
    set_or_remove(&mut model_map, "base_url", new_model.base_url.as_deref());

    root_map.insert(model_key, Value::Mapping(model_map));

    let serialized =
        serde_yaml::to_string(&root).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs_atomic::atomic_write(&config_path, serialized.as_bytes(), None)?;

    if let Some(jp) = journal_path {
        let summary = summarize_model_diff(&before_model, new_model);
        let _ = changelog::append(
            jp,
            "hermes.config.model",
            Some(serde_json::to_value(&before_model).unwrap_or(serde_json::Value::Null)),
            Some(serde_json::to_value(new_model).unwrap_or(serde_json::Value::Null)),
            summary,
        );
    }
    Ok(())
}

fn summarize_model_diff(before: &HermesModelSection, after: &HermesModelSection) -> String {
    let mut parts = Vec::new();
    if before.default != after.default {
        parts.push(format!(
            "default: {} → {}",
            before.default.as_deref().unwrap_or("∅"),
            after.default.as_deref().unwrap_or("∅")
        ));
    }
    if before.provider != after.provider {
        parts.push(format!(
            "provider: {} → {}",
            before.provider.as_deref().unwrap_or("∅"),
            after.provider.as_deref().unwrap_or("∅")
        ));
    }
    if before.base_url != after.base_url {
        parts.push(format!(
            "base_url: {} → {}",
            before.base_url.as_deref().unwrap_or("∅"),
            after.base_url.as_deref().unwrap_or("∅")
        ));
    }
    if parts.is_empty() {
        "no-op".to_string()
    } else {
        parts.join(", ")
    }
}

fn set_or_remove(map: &mut Mapping, key: &str, value: Option<&str>) {
    let k = Value::String(key.into());
    match value {
        Some(v) if !v.is_empty() => {
            map.insert(k, Value::String(v.to_string()));
        }
        _ => {
            map.remove(k);
        }
    }
}

mod env;
mod gateway;
mod yaml;

pub use env::{read_env_value, write_env_key};
// Re-imported into the parent scope so the existing test suite —
// which uses `super::*` from `tests.rs` — can keep referencing the
// helpers by their bare names (`walk_set`, `is_allowed_env_key`,
// etc.) without learning the new module layout.
#[cfg(test)]
use env::{is_allowed_env_key, line_matches_key};
use env::read_env_key_names;
pub use gateway::{detect, gateway_restart, gateway_start, HermesDetection};
pub use yaml::write_channel_yaml_fields;
#[cfg(test)]
use yaml::{json_to_yaml_value, walk_remove, walk_set};

#[cfg(test)]
mod tests;
