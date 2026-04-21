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
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

const HERMES_DIR: &str = ".hermes";
const CONFIG_FILE: &str = "config.yaml";
const ENV_FILE: &str = ".env";

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
fn hermes_dir() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "$HOME not set"))?;
    Ok(PathBuf::from(home).join(HERMES_DIR))
}

fn config_path() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(CONFIG_FILE))
}

fn env_path() -> io::Result<PathBuf> {
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
pub fn write_model(new_model: &HermesModelSection) -> io::Result<()> {
    let config_path = config_path()?;
    let raw = fs::read_to_string(&config_path).unwrap_or_default();
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

    // Atomic write: tmp file + rename. Preserves file perms on *nix.
    let serialized =
        serde_yaml::to_string(&root).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let tmp = config_path.with_extension("yaml.caduceus.tmp");
    fs::write(&tmp, serialized)?;
    fs::rename(&tmp, &config_path)?;
    Ok(())
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

/// Parse `.env` and return the KEYS of any `*_API_KEY=nonempty` lines.
/// We deliberately drop the values — the UI never needs them, and passing
/// secrets over IPC is an anti-pattern.
fn read_env_key_names() -> io::Result<Vec<String>> {
    let path = env_path()?;
    let raw = fs::read_to_string(&path)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            if !key.ends_with("_API_KEY") {
                continue;
            }
            // Treat unquoted empty and pure whitespace as unset.
            let val = value.trim().trim_matches('"').trim_matches('\'');
            if !val.is_empty() {
                out.push(key.to_string());
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_model_parses_standard_layout() {
        let yaml = r#"
model:
  default: deepseek-reasoner
  provider: deepseek
  base_url: https://api.deepseek.com/v1
unrelated: keep_me
"#;
        let root: Value = serde_yaml::from_str(yaml).unwrap();
        let m = extract_model(&root);
        assert_eq!(m.default.as_deref(), Some("deepseek-reasoner"));
        assert_eq!(m.provider.as_deref(), Some("deepseek"));
        assert_eq!(m.base_url.as_deref(), Some("https://api.deepseek.com/v1"));
    }

    #[test]
    fn set_or_remove_clears_empty() {
        let k = || Value::String("k".into());
        let mut m = Mapping::new();
        m.insert(k(), Value::String("old".into()));
        set_or_remove(&mut m, "k", None);
        assert!(m.get(k()).is_none());

        set_or_remove(&mut m, "k", Some("new"));
        assert_eq!(m.get(k()).and_then(Value::as_str), Some("new"));

        set_or_remove(&mut m, "k", Some(""));
        assert!(m.get(k()).is_none());
    }

    #[test]
    fn env_keys_only_returns_nonempty_api_keys() {
        // Write a fake .env into a temp HOME.
        let tmp = std::env::temp_dir().join(format!("caduceus-hermes-env-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join(".hermes")).unwrap();
        let env_file = tmp.join(".hermes/.env");
        std::fs::write(
            &env_file,
            r#"
# comment
DEEPSEEK_API_KEY=sk-abc
OPENAI_API_KEY=
ANTHROPIC_API_KEY="sk-xyz"
NOT_A_KEY=hello
"#,
        )
        .unwrap();

        // Temporarily point HOME at our tempdir.
        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &tmp);

        let keys = read_env_key_names().unwrap();
        assert!(keys.contains(&"DEEPSEEK_API_KEY".to_string()));
        assert!(keys.contains(&"ANTHROPIC_API_KEY".to_string()));
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"NOT_A_KEY".to_string()));

        // Restore.
        if let Some(v) = original_home {
            std::env::set_var("HOME", v);
        } else {
            std::env::remove_var("HOME");
        }
    }
}
