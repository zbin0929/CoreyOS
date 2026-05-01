//! IPC surface for white-label customer config.
//!
//! Frontend reads this once on startup (see `src/lib/customer.ts`)
//! and applies brand overrides + filters the nav tree. There is no
//! setter — `customer.yaml` is delivery-time configuration, never
//! edited by the running app.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::customer::{BrandConfig, CustomerConfig, NavigationConfig, PacksConfig};
use crate::error::IpcResult;
use crate::paths;
use crate::state::AppState;

/// Snapshot returned to the frontend. Mirrors `CustomerConfig` 1:1
/// but flattens `Option<>` so the TS side gets stable shapes (empty
/// strings / empty arrays for absent values, never `null`s mixed
/// with strings).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerConfigDto {
    pub schema_version: u32,
    pub brand: BrandDto,
    pub navigation: NavigationDto,
    pub packs: PacksDto,
    /// True when a `customer.yaml` was actually loaded from disk.
    /// Lets the frontend skip the apply step entirely on default
    /// installs.
    pub present: bool,
    /// Non-empty when the file existed but failed to parse. Surface
    /// to the user via Settings → Help so silent typos don't fly.
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandDto {
    pub app_name: String,
    pub logo: String,
    pub primary_color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationDto {
    pub hidden_routes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacksDto {
    pub preinstall: Vec<String>,
    pub config: serde_json::Map<String, serde_json::Value>,
    pub pin_to_primary: Vec<String>,
}

impl CustomerConfigDto {
    fn defaults() -> Self {
        Self::from_present(false, None, &CustomerConfig::default())
    }

    fn from_present(present: bool, error: Option<String>, cfg: &CustomerConfig) -> Self {
        // Resolve relative logo paths to absolute so the frontend can
        // call `convertFileSrc` on a stable path. Relative paths are
        // anchored at the Hermes data dir (`~/.hermes/`); absolute
        // paths pass through unchanged. If we can't resolve the
        // Hermes dir we fall back to the original string and let
        // the frontend deal with it.
        let logo = cfg.brand.logo.clone().unwrap_or_default();
        let logo_resolved = if logo.is_empty() {
            String::new()
        } else {
            resolve_logo_path(&logo)
        };

        let brand = BrandConfig {
            app_name: cfg.brand.app_name.clone(),
            logo: cfg.brand.logo.clone(),
            primary_color: cfg.brand.primary_color.clone(),
        };
        let nav = NavigationConfig {
            hidden_routes: cfg.navigation.hidden_routes.clone(),
        };
        let packs = PacksDto {
            preinstall: cfg.packs.preinstall.clone(),
            config: cfg
                .packs
                .config
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            pin_to_primary: cfg.packs.pin_to_primary.clone(),
        };
        Self {
            schema_version: cfg.schema_version,
            brand: BrandDto {
                app_name: brand.app_name.unwrap_or_default(),
                logo: logo_resolved,
                primary_color: brand.primary_color.unwrap_or_default(),
            },
            navigation: NavigationDto {
                hidden_routes: nav.hidden_routes,
            },
            packs,
            present,
            error,
        }
    }
}

fn resolve_logo_path(raw: &str) -> String {
    let p = Path::new(raw);
    if p.is_absolute() {
        return raw.to_string();
    }
    match paths::hermes_data_dir() {
        Ok(dir) => {
            let absolute: PathBuf = dir.join(p);
            absolute.to_string_lossy().into_owned()
        }
        Err(_) => raw.to_string(),
    }
}

/// Return the customer config snapshot. Always succeeds — when no
/// `customer.yaml` exists, returns defaults with `present=false`.
#[tauri::command]
pub async fn customer_config_get(state: State<'_, AppState>) -> IpcResult<CustomerConfigDto> {
    Ok(match &state.customer {
        Some(cfg) => CustomerConfigDto::from_present(true, None, cfg),
        None => match &state.customer_error {
            Some(err) => {
                let mut dto = CustomerConfigDto::defaults();
                dto.error = Some(err.clone());
                dto
            }
            None => CustomerConfigDto::defaults(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_have_present_false() {
        let dto = CustomerConfigDto::defaults();
        assert!(!dto.present);
        assert_eq!(dto.brand.app_name, "");
        assert_eq!(dto.navigation.hidden_routes, Vec::<String>::new());
    }

    #[test]
    fn from_present_round_trip() {
        let mut cfg = CustomerConfig {
            schema_version: 1,
            ..Default::default()
        };
        cfg.brand.app_name = Some("ACME".into());
        cfg.navigation.hidden_routes = vec!["analytics".into()];

        let dto = CustomerConfigDto::from_present(true, None, &cfg);
        assert!(dto.present);
        assert_eq!(dto.brand.app_name, "ACME");
        assert_eq!(dto.navigation.hidden_routes, vec!["analytics".to_string()]);
    }
}
