//! Pack install / uninstall lifecycle + the sync helpers that wire
//! a freshly enabled Pack's MCP servers, workflows, schedules, and
//! skills into `~/.hermes/`.
//!
//! Split out from `mod.rs` 2026-05-17 so the IPC handler catalog in
//! the parent module doesn't grow past AC-1's monitor threshold as
//! we add new industry Packs. Each sync helper is independent
//! (`sync_config_yaml`, `sync_workflows`, `sync_schedules`,
//! `sync_skills`) — the parent `pack_set_enabled` handler still
//! lives in `mod.rs` because it orchestrates the call sequence and
//! is the primary entry point.
//!
//! Public surface re-exported by `super` (`mod.rs`):
//!   - [`pack_import_zip`]: zip-file install path (Settings → Packs →
//!     Import).
//!   - [`pack_uninstall`]: nuke an installed Pack + all its synced
//!     state.
//!
//! Internal helpers:
//!   - `matches_pack_id`: tolerant id comparison (case + suffix).
//!   - `sync_config_yaml` / `sync_workflows` / `sync_schedules` /
//!     `sync_skills`: idempotent installers used by `pack_set_enabled`
//!     in `mod.rs` and by `pack_import_zip` here.

use std::collections::BTreeMap;
use std::fs;
use std::sync::Arc;

use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_config;
use crate::pack::{
    disable_updates, enable_updates, install_schedules, install_skills, install_workflows,
    uninstall_schedules, uninstall_skills, uninstall_workflows, PackManifest, RegistryEntry,
    TemplateContext,
};
use crate::state::AppState;

#[tauri::command]
pub async fn pack_import_zip(zip_path: String, state: State<'_, AppState>) -> IpcResult<String> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let src = std::path::Path::new(&zip_path);
        if !src.exists() {
            return Err(IpcError::Internal {
                message: format!("zip not found: {zip_path}"),
            });
        }
        let packs_dir = hermes_dir.join("skill-packs");
        fs::create_dir_all(&packs_dir).map_err(|e| IpcError::Internal {
            message: format!("create skill-packs dir: {e}"),
        })?;
        let file = fs::File::open(src).map_err(|e| IpcError::Internal {
            message: format!("open zip: {e}"),
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| IpcError::Internal {
            message: format!("read zip: {e}"),
        })?;
        let first_entry = archive.by_index(0).map_err(|e| IpcError::Internal {
            message: format!("zip empty: {e}"),
        })?;
        let top_dir = first_entry
            .name()
            .split('/')
            .next()
            .unwrap_or("unknown")
            .to_string();
        drop(first_entry);

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| IpcError::Internal {
                message: format!("zip entry {i}: {e}"),
            })?;
            let out_path = packs_dir.join(entry.name());
            if entry.is_dir() {
                fs::create_dir_all(&out_path).map_err(|e| IpcError::Internal {
                    message: format!("mkdir {}: {e}", entry.name()),
                })?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| IpcError::Internal {
                        message: format!("mkdir parent: {e}"),
                    })?;
                }
                let mut buf = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut buf).map_err(|e| {
                    IpcError::Internal {
                        message: format!("read zip entry: {e}"),
                    }
                })?;
                fs::write(&out_path, &buf).map_err(|e| IpcError::Internal {
                    message: format!("write {}: {e}", entry.name()),
                })?;
            }
        }
        Ok(top_dir)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("import join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_uninstall(pack_id: String, state: State<'_, AppState>) -> IpcResult<()> {
    let (hermes_dir, pack_dir) = {
        let registry = state.packs.read();
        let entry = registry.packs.iter().find(|p| matches_pack_id(p, &pack_id));
        let pack_dir = entry.map(|p| p.dir_path.clone());
        (registry.hermes_dir.clone(), pack_dir)
    };

    tokio::task::spawn_blocking(move || {
        let _ = crate::pack::backup::backup_pack(&hermes_dir, &pack_id);
        if let Some(dir) = pack_dir {
            if dir.exists() {
                fs::remove_dir_all(&dir).map_err(|e| IpcError::Internal {
                    message: format!("remove pack dir: {e}"),
                })?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("uninstall join: {e}"),
    })?
}

pub(super) fn matches_pack_id(entry: &RegistryEntry, pack_id: &str) -> bool {
    let entry_id = entry
        .manifest
        .as_ref()
        .map(|m| m.id.as_str())
        .unwrap_or(entry.dir_name.as_str());
    entry_id == pack_id
}

pub(super) fn sync_config_yaml(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    journal: &std::path::Path,
) -> IpcResult<bool> {
    let Some(manifest) = manifest else {
        return Ok(false);
    };
    if manifest.mcp_servers.is_empty() {
        return Ok(false);
    }

    let pack_dir = hermes_dir.join("skill-packs").join(pack_id);
    let pack_data_dir = hermes_dir.join("pack-data").join(pack_id);
    if enabled {
        let _ = crate::pack::backup::backup_pack(hermes_dir, pack_id);
        if let Err(e) = fs::create_dir_all(&pack_data_dir) {
            return Err(IpcError::Internal {
                message: format!("create pack-data dir: {e}"),
            });
        }
        let _ = crate::pack::run_migrations(
            &pack_data_dir,
            "0",
            &manifest.version,
            &manifest.migrations,
        );
    }

    let ctx = TemplateContext {
        platform: crate::pack::current_platform().to_string(),
        pack_dir,
        pack_data_dir,
        pack_config: BTreeMap::new(),
    };

    let updates = if enabled {
        enable_updates(manifest, &ctx)
    } else {
        disable_updates(manifest)
    };

    hermes_config::write_channel_yaml_fields("mcp_servers", &updates, Some(journal)).map_err(
        |e| IpcError::Internal {
            message: format!("write mcp_servers to config.yaml: {e}"),
        },
    )?;
    Ok(true)
}

pub(super) fn sync_workflows(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    pack_dir: Option<&std::path::Path>,
) -> IpcResult<()> {
    if enabled {
        let (Some(manifest), Some(pack_dir)) = (manifest, pack_dir) else {
            return Ok(());
        };
        if manifest.workflows.is_empty() {
            return Ok(());
        }
        let n = install_workflows(manifest, pack_dir).map_err(|e| IpcError::Internal {
            message: format!("install pack workflows: {e}"),
        })?;
        tracing::info!(pack_id, installed = n, "pack workflows installed");
    } else {
        let removed = uninstall_workflows(pack_id).map_err(|e| IpcError::Internal {
            message: format!("uninstall pack workflows: {e}"),
        })?;
        tracing::info!(pack_id, removed, "pack workflows uninstalled");
    }
    Ok(())
}

pub(super) fn sync_schedules(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
) -> IpcResult<()> {
    if enabled {
        let Some(manifest) = manifest else {
            return Ok(());
        };
        if manifest.schedules.is_empty() {
            let _ = uninstall_schedules(pack_id).map_err(|e| IpcError::Internal {
                message: format!("clear stale pack schedules: {e}"),
            });
            return Ok(());
        }
        let (installed, replaced) =
            install_schedules(manifest).map_err(|e| IpcError::Internal {
                message: format!("install pack schedules: {e}"),
            })?;
        tracing::info!(pack_id, installed, replaced, "pack schedules installed");
    } else {
        let removed = uninstall_schedules(pack_id).map_err(|e| IpcError::Internal {
            message: format!("uninstall pack schedules: {e}"),
        })?;
        tracing::info!(pack_id, removed, "pack schedules uninstalled");
    }
    Ok(())
}

pub(super) fn sync_skills(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    pack_dir: Option<&std::path::Path>,
) -> IpcResult<()> {
    if enabled {
        let (Some(manifest), Some(pack_dir)) = (manifest, pack_dir) else {
            return Ok(());
        };
        if manifest.skills.is_empty() {
            return Ok(());
        }
        let n = install_skills(manifest, pack_dir, hermes_dir).map_err(|e| IpcError::Internal {
            message: format!("install pack skills: {e}"),
        })?;
        tracing::info!(pack_id, installed = n, "pack skills installed");
    } else {
        uninstall_skills(pack_id, hermes_dir).map_err(|e| IpcError::Internal {
            message: format!("uninstall pack skills: {e}"),
        })?;
        tracing::info!(pack_id, "pack skills uninstalled");
    }
    Ok(())
}
