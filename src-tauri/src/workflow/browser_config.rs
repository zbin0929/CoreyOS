use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConfig {
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
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
        }
    }
}

fn config_path() -> anyhow::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| anyhow::anyhow!("no $HOME"))?;
    Ok(PathBuf::from(home).join(".hermes").join("browser_config.json"))
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
