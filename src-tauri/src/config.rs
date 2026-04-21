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
        }
    }

    /// Load from `<dir>/gateway.json`, falling back to env+defaults if the
    /// file is missing or malformed.
    pub fn load_or_default(config_dir: &Path) -> Self {
        let path = config_dir.join(FILE_NAME);
        match fs::read_to_string(&path) {
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
        }
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
        };
        cfg.save(&tmp).unwrap();
        let loaded = GatewayConfig::load_or_default(&tmp);
        assert_eq!(loaded.base_url, cfg.base_url);
        assert_eq!(loaded.api_key, cfg.api_key);
        assert_eq!(loaded.default_model, cfg.default_model);
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
