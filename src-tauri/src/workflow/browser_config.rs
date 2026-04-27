use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConfig {
    #[serde(default = "default_model")]
    pub model: String,
    /// Literal API key value. Kept for back-compat; writes from the new
    /// profile-picker UI leave this empty and rely on `api_key_env`
    /// instead so the secret never lives in a plaintext JSON file.
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    /// Name of the environment variable Hermes will resolve the real
    /// key from (e.g. `DEEPSEEK_API_KEY`). Resolved at runner-spawn
    /// time by reading process env + `~/.hermes/.env`. Absent on
    /// legacy configs, where callers fall back to `api_key` above.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
}

fn default_model() -> String {
    "openai/gpt-4o-mini".into()
}

impl Default for BrowserConfig {
    fn default() -> Self {
        Self {
            model: default_model(),
            api_key: String::new(),
            base_url: String::new(),
            api_key_env: None,
        }
    }
}

/// Resolve the configured API key at runner-spawn time. Preference order:
///   1. `api_key_env` → lookup in process env, then in `~/.hermes/.env`.
///   2. Literal `api_key` (legacy configs / manual overrides).
///
/// Returns `None` when nothing resolves so callers can decide whether
/// to fail loud or pass through with an unset key (Ollama etc. don't
/// need one).
pub fn resolve_api_key(cfg: &BrowserConfig) -> Option<String> {
    if let Some(name) = cfg.api_key_env.as_ref().filter(|s| !s.is_empty()) {
        if let Ok(v) = std::env::var(name) {
            if !v.is_empty() {
                return Some(v);
            }
        }
        if let Ok(Some(v)) = crate::hermes_config::read_env_value(name) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    if !cfg.api_key.is_empty() {
        return Some(cfg.api_key.clone());
    }
    None
}

fn config_path() -> anyhow::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| anyhow::anyhow!("no $HOME"))?;
    Ok(PathBuf::from(home)
        .join(".hermes")
        .join("browser_config.json"))
}

pub fn load() -> BrowserConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return BrowserConfig::default(),
    };
    if !path.exists() {
        return BrowserConfig::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => BrowserConfig::default(),
    }
}

pub fn save(cfg: &BrowserConfig) -> anyhow::Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(cfg)?;
    std::fs::write(&path, json)?;
    Ok(())
}
