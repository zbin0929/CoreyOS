//! Runtime configuration for the default (Hermes) adapter.
//!
//! Precedence, highest to lowest:
//! 1. A JSON file at `<app_config_dir>/gateway.json` (written by the
//!    Settings UI).
//! 2. Env vars `HERMES_GATEWAY_URL` / `HERMES_GATEWAY_KEY` /
//!    `HERMES_DEFAULT_MODEL`.
//! 3. Hardcoded defaults.
//!
//! The config file lives under Tauri's `app.path().app_config_dir()`, so
//! the path is platform-native:
//!
//! | OS       | Path                                                               |
//! |----------|--------------------------------------------------------------------|
//! | macOS    | `~/Library/Application Support/com.caduceus.app/gateway.json`      |
//! | Linux    | `~/.config/com.caduceus.app/gateway.json`                          |
//! | Windows  | `%APPDATA%\com.caduceus.app\gateway.json`                          |
//!
//! The API key is stored in plaintext — same trust boundary as the file
//! system of the current user. Encrypted storage (stronghold/keychain) is
//! a future hardening step and is tracked in CHANGELOG.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8642";
const FILE_NAME: &str = "gateway.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    /// Human-friendly label shown in the AgentSwitcher and Settings
    /// for the **default** Hermes adapter (id `"hermes"`). Empty
    /// string falls back to "Hermes" at render time. Surfaced in
    /// the Hermes Instances list as a synthetic first row so users
    /// can rename their primary agent without dropping into a config
    /// file.
    #[serde(default)]
    pub label: Option<String>,
}

impl GatewayConfig {
    /// Hardcoded + env-var defaults. Used when no file is present.
    pub fn defaults_with_env() -> Self {
        let base_url = std::env::var("HERMES_GATEWAY_URL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        let api_key = std::env::var("HERMES_GATEWAY_KEY")
            .ok()
            .filter(|s| !s.is_empty());
        let default_model = std::env::var("HERMES_DEFAULT_MODEL")
            .ok()
            .filter(|s| !s.is_empty());
        Self {
            base_url,
            api_key,
            default_model,
            label: None,
        }
    }

    /// Load from `<dir>/gateway.json`, falling back to env+defaults if the
    /// file is missing or malformed.
    pub fn load_or_default(config_dir: &Path) -> Self {
        let path = config_dir.join(FILE_NAME);
        let mut cfg = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Self>(&raw) {
                Ok(cfg) => cfg,
                Err(e) => {
                    tracing::warn!(
                        path = %path.display(),
                        error = %e,
                        "gateway config parse failed — using defaults",
                    );
                    Self::defaults_with_env()
                }
            },
            Err(_) => Self::defaults_with_env(),
        };
        if cfg.api_key.as_deref().filter(|s| !s.is_empty()).is_none() {
            cfg.api_key = read_api_server_key_from_hermes_env();
        }
        cfg
    }

    /// Atomic write to `<dir>/gateway.json`. Creates the directory if absent.
    pub fn save(&self, config_dir: &Path) -> io::Result<PathBuf> {
        fs::create_dir_all(config_dir)?;
        let final_path = config_dir.join(FILE_NAME);
        let tmp_path = config_dir.join(format!("{FILE_NAME}.tmp"));
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&tmp_path, json)?;
        fs::rename(&tmp_path, &final_path)?;
        Ok(final_path)
    }
}

/// Read `API_SERVER_KEY` from `~/.hermes/.env` so the gateway client
/// authenticates against Hermes v0.16+ which made the key mandatory
/// even on loopback. Returns `None` on any failure (best-effort).
fn read_api_server_key_from_hermes_env() -> Option<String> {
    let env_path = crate::paths::hermes_data_dir().ok()?.join(".env");
    let raw = fs::read_to_string(&env_path).ok()?;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if let Some(eq) = trimmed.find('=') {
            if trimmed[..eq].trim() == "API_SERVER_KEY" {
                let val = trimmed[eq + 1..].trim().trim_matches('"');
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_use_hardcoded_url_when_no_env() {
        // Clear env vars just in case.
        std::env::remove_var("HERMES_GATEWAY_URL");
        std::env::remove_var("HERMES_GATEWAY_KEY");
        std::env::remove_var("HERMES_DEFAULT_MODEL");
        let cfg = GatewayConfig::defaults_with_env();
        assert_eq!(cfg.base_url, DEFAULT_BASE_URL);
        assert!(cfg.api_key.is_none());
        assert!(cfg.default_model.is_none());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let tmp = tempfile_dir();
        let cfg = GatewayConfig {
            base_url: "http://example.com:9000".into(),
            api_key: Some("secret".into()),
            default_model: Some("deepseek-chat".into()),
            label: Some("我的本地 Hermes".into()),
        };
        cfg.save(&tmp).unwrap();
        let loaded = GatewayConfig::load_or_default(&tmp);
        assert_eq!(loaded.base_url, cfg.base_url);
        assert_eq!(loaded.api_key, cfg.api_key);
        assert_eq!(loaded.default_model, cfg.default_model);
        assert_eq!(loaded.label, cfg.label);
    }

    #[test]
    fn load_falls_back_when_missing() {
        let tmp = tempfile_dir();
        std::env::remove_var("HERMES_GATEWAY_URL");
        let loaded = GatewayConfig::load_or_default(&tmp);
        assert_eq!(loaded.base_url, DEFAULT_BASE_URL);
    }

    /// Cheap unique tempdir without pulling in the `tempfile` crate.
    fn tempfile_dir() -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "caduceus-config-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4(),
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }
}
