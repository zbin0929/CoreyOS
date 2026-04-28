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

/// Auto-context-compression section (`compression:` in config.yaml).
///
/// Hermes ships with this on by default — the v9 audit found that and
/// elected to expose it through Corey's Settings → Context page rather
/// than make users hand-edit YAML. Each field is `Option<…>` so the
/// UI distinguishes "unset (Hermes default)" from "explicit value".
///
/// Field semantics (from `agent/context_compressor.py`):
///   - `enabled`             on/off the whole subsystem
///   - `threshold`           0..1 ratio of context-window-fill that triggers
///   - `target_ratio`        0..1 ratio to compress DOWN to
///   - `protect_last_n`      most-recent N messages excluded from the squash
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HermesCompressionSection {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub threshold: Option<f64>,
    #[serde(default)]
    pub target_ratio: Option<f64>,
    #[serde(default)]
    pub protect_last_n: Option<u32>,
}

/// Hermes' tool-permission knobs (`approvals:` block + the
/// top-level `command_allowlist:` array).
///
/// Important: Hermes' security model is **command-pattern based**,
/// not path-based. Corey's own `PathAuthority` (sandbox.json) only
/// gates Corey's own IPC; Hermes-side tools (`shell`, `read_file`)
/// look at the keys here. Surfacing them in `Settings → Sandbox`
/// gives users one screen for both halves of the permission story.
///
/// Field semantics (from `hermes-agent/tools/approval.py`):
/// - `approval_mode` — "manual" / "auto" / "yolo".
///   manual = ask user for risky commands.
///   auto   = LLM auto-judges; user only sees the catastrophic ones.
///   yolo   = bypass all approvals (DANGEROUS).
/// - `approval_timeout_s` — wait before auto-rejecting an approval
///   prompt (default 60).
/// - `cron_mode` — "deny" / "ask" / "allow"; what to do when a
///   cron-triggered run hits a risky command. Cron has no human
///   at the keyboard, so default is "deny".
/// - `command_allowlist` — glob-ish patterns that skip approval
///   entirely (e.g. "git status", "npm install").
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HermesSecuritySection {
    #[serde(default)]
    pub approval_mode: Option<String>,
    #[serde(default)]
    pub approval_timeout_s: Option<u32>,
    #[serde(default)]
    pub cron_mode: Option<String>,
    #[serde(default)]
    pub command_allowlist: Vec<String>,
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
    /// Current `compression.*` values. Always present (defaults
    /// resolved to `None` when the YAML is missing the section).
    pub compression: HermesCompressionSection,
    /// Current `approvals.*` + `command_allowlist` view. Same null
    /// semantics — empty struct when the YAML omits the section.
    pub security: HermesSecuritySection,
    /// API-key env vars detected in `~/.hermes/.env`. We return the KEY NAMES
    /// only, never the values — so the UI can show "DEEPSEEK_API_KEY ✓ set"
    /// without exposing secrets over IPC.
    pub env_keys_present: Vec<String>,
}

/// Resolve the Hermes data directory. Thin re-export of
/// [`crate::paths::hermes_data_dir`] kept here so the many existing
/// call-sites (and tests) that spell `hermes_config::hermes_dir()`
/// keep compiling. See `crate::paths` for the precedence rules.
pub(crate) fn hermes_dir() -> io::Result<PathBuf> {
    crate::paths::hermes_data_dir()
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

    let (present, model, compression, security) = match fs::read_to_string(&config_path) {
        Ok(raw) => {
            let root: Value = serde_yaml::from_str(&raw).unwrap_or(Value::Null);
            (
                true,
                extract_model(&root),
                extract_compression(&root),
                extract_security(&root),
            )
        }
        Err(_) => (
            false,
            HermesModelSection::default(),
            HermesCompressionSection::default(),
            HermesSecuritySection::default(),
        ),
    };

    let env_keys_present = read_env_key_names().unwrap_or_default();

    Ok(HermesConfigView {
        config_path: path_str,
        present,
        model,
        compression,
        security,
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

fn extract_compression(root: &Value) -> HermesCompressionSection {
    let Some(map) = root.as_mapping() else {
        return HermesCompressionSection::default();
    };
    let Some(comp) = map
        .get(Value::String("compression".into()))
        .and_then(|v| v.as_mapping())
    else {
        return HermesCompressionSection::default();
    };
    HermesCompressionSection {
        enabled: comp
            .get(Value::String("enabled".into()))
            .and_then(Value::as_bool),
        threshold: comp
            .get(Value::String("threshold".into()))
            .and_then(Value::as_f64),
        target_ratio: comp
            .get(Value::String("target_ratio".into()))
            .and_then(Value::as_f64),
        protect_last_n: comp
            .get(Value::String("protect_last_n".into()))
            .and_then(Value::as_u64)
            .map(|v| v as u32),
    }
}

/// Persist the `compression:` section. Each `Some(_)` field is written
/// (or overwritten); each `None` is left as-is on disk so a partial
/// update from the UI doesn't accidentally erase fields the user
/// hasn't touched. To explicitly remove a field, the caller can
/// hand-edit `~/.hermes/config.yaml` (rare; the UI doesn't expose a
/// "delete" affordance because the safe default is "let Hermes pick").
///
/// Like `write_model`, this preserves every other YAML field. The
/// underlying mechanism is the generic `walk_set` from `yaml.rs`,
/// reused so we never re-implement YAML traversal.
///
/// `journal_path`, when provided, gets one `hermes.config.compression`
/// changelog entry with before/after JSON. Pass `None` in tests.
pub fn write_compression(
    new: &HermesCompressionSection,
    journal_path: Option<&Path>,
) -> io::Result<()> {
    use std::collections::HashMap;
    let mut updates: HashMap<String, serde_json::Value> = HashMap::new();
    if let Some(v) = new.enabled {
        updates.insert("enabled".into(), serde_json::Value::Bool(v));
    }
    if let Some(v) = new.threshold {
        updates.insert(
            "threshold".into(),
            serde_json::Number::from_f64(v)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
        );
    }
    if let Some(v) = new.target_ratio {
        updates.insert(
            "target_ratio".into(),
            serde_json::Number::from_f64(v)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
        );
    }
    if let Some(v) = new.protect_last_n {
        updates.insert("protect_last_n".into(), serde_json::Value::Number(v.into()));
    }
    if updates.is_empty() {
        return Ok(()); // no-op, caller passed all `None`s
    }
    yaml::write_channel_yaml_fields("compression", &updates, journal_path)
}

fn extract_security(root: &Value) -> HermesSecuritySection {
    let map = match root.as_mapping() {
        Some(m) => m,
        None => return HermesSecuritySection::default(),
    };
    let approvals = map
        .get(Value::String("approvals".into()))
        .and_then(|v| v.as_mapping());
    let approval_mode = approvals
        .and_then(|m| m.get(Value::String("mode".into())))
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let approval_timeout_s = approvals
        .and_then(|m| m.get(Value::String("timeout".into())))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let cron_mode = approvals
        .and_then(|m| m.get(Value::String("cron_mode".into())))
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    // command_allowlist sits at the document root, not under
    // approvals (matches Hermes' yaml shape).
    let command_allowlist = map
        .get(Value::String("command_allowlist".into()))
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    HermesSecuritySection {
        approval_mode,
        approval_timeout_s,
        cron_mode,
        command_allowlist,
    }
}

/// Persist the `approvals:` mapping + the top-level
/// `command_allowlist:` array. Same semantics as
/// `write_compression`: each `Some(_)` overwrites; `None` is
/// untouched. `command_allowlist` is replaced wholesale (it's a
/// flat list, partial-update doesn't make sense here).
pub fn write_security(new: &HermesSecuritySection, journal_path: Option<&Path>) -> io::Result<()> {
    use std::collections::HashMap;

    // approvals.* updates go into one batched yaml write.
    let mut approval_updates: HashMap<String, serde_json::Value> = HashMap::new();
    if let Some(v) = &new.approval_mode {
        approval_updates.insert("mode".into(), serde_json::Value::String(v.clone()));
    }
    if let Some(v) = new.approval_timeout_s {
        approval_updates.insert("timeout".into(), serde_json::Value::Number(v.into()));
    }
    if let Some(v) = &new.cron_mode {
        approval_updates.insert("cron_mode".into(), serde_json::Value::String(v.clone()));
    }
    if !approval_updates.is_empty() {
        yaml::write_channel_yaml_fields("approvals", &approval_updates, journal_path)?;
    }

    // command_allowlist sits at the doc root. We always write it
    // (even when empty) because the UI's source of truth IS the
    // edited list — letting `None` mean "leave alone" would make
    // "delete the last entry" impossible from the GUI.
    let mut root_updates: HashMap<String, serde_json::Value> = HashMap::new();
    root_updates.insert(
        "command_allowlist".into(),
        serde_json::Value::Array(
            new.command_allowlist
                .iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect(),
        ),
    );
    yaml::write_channel_yaml_fields("", &root_updates, journal_path)?;

    Ok(())
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
use env::read_env_key_names;
#[cfg(test)]
use env::{is_allowed_env_key, line_matches_key};
pub use gateway::{
    detect, gateway_restart, gateway_start, inject_hermes_home, install_preflight,
    run_bootstrap_script, suppress_window, HermesDetection, HermesInstallPreflight,
};
pub use yaml::write_channel_yaml_fields;
#[cfg(test)]
use yaml::{json_to_yaml_value, walk_remove, walk_set};

#[cfg(test)]
mod tests;
