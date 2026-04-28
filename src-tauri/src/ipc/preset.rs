//! Preset installation IPC.
//!
//! A *preset* is a bundled folder under `src-tauri/assets/presets/<id>/`
//! containing starter content for Hermes:
//!
//! ```text
//! manifest.yaml       ← id, name, description
//! skills/*.md         ← copied to ~/.hermes/skills/
//! mcp-servers.yaml    ← merged into ~/.hermes/config.yaml → mcp_servers:
//! USER.md             ← written to ~/.hermes/USER.md (if missing)
//! MEMORY.md           ← written to ~/.hermes/MEMORY.md (if missing)
//! ```
//!
//! Tauri's `bundle.resources` copies the folder into the app bundle
//! (`Contents/Resources/assets/presets/` on macOS). At runtime we
//! resolve it via `app.path().resource_dir()`.
//!
//! ## Install semantics
//!
//! - **Idempotent**: re-running never clobbers user edits. Each target
//!   file is written only if it doesn't already exist; the return value
//!   records which files were installed vs skipped.
//! - **MCP merge**: `mcp-servers.yaml` entries are appended to the
//!   Hermes config only if an entry with the same `id` isn't already
//!   present. Same "no clobber" rule.
//! - **No gateway restart**: that's a follow-up the UI nudges the user
//!   about; we don't restart Hermes from here.
//!
//! ## Why not a generic `preset_install(id)` that walks an arbitrary
//! path?
//!
//! Security. The IPC takes a preset *id* (string slug, validated
//! against a known list) rather than a filesystem path, so a
//! compromised frontend can't point this at `/etc/passwd` or similar.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{IpcError, IpcResult};

/// Whitelist of preset ids the frontend is allowed to install. Keep
/// this in sync with subdirectories of `src-tauri/assets/presets/`.
const ALLOWED_PRESETS: &[&str] = &["default"];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PresetManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: u32,
}

#[derive(Debug, Serialize, Default)]
pub struct PresetInstallResult {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
    pub manifest: Option<PresetManifest>,
}

/// Resolve the on-disk directory for a bundled preset.
fn preset_dir(app: &AppHandle, id: &str) -> IpcResult<PathBuf> {
    if !ALLOWED_PRESETS.contains(&id) {
        return Err(IpcError::Internal {
            message: format!("unknown preset id: {id}"),
        });
    }
    let base = app.path().resource_dir().map_err(|e| IpcError::Internal {
        message: format!("resource_dir: {e}"),
    })?;
    Ok(base.join("assets").join("presets").join(id))
}

fn hermes_home() -> IpcResult<PathBuf> {
    crate::paths::hermes_data_dir().map_err(|e| IpcError::Internal {
        message: format!("hermes data dir: {e}"),
    })
}

/// Read and parse `manifest.yaml` from the preset directory. The
/// frontend can display the preset's name / description before the
/// user confirms install.
#[tauri::command]
pub async fn preset_describe(app: AppHandle, id: String) -> IpcResult<PresetManifest> {
    let dir = preset_dir(&app, &id)?;
    let path = dir.join("manifest.yaml");
    let text = fs::read_to_string(&path).map_err(|e| IpcError::Internal {
        message: format!("read manifest {}: {e}", path.display()),
    })?;
    serde_yaml::from_str::<PresetManifest>(&text).map_err(|e| IpcError::Internal {
        message: format!("parse manifest: {e}"),
    })
}

/// Install the preset's contents into `~/.hermes/`. Safe to re-run —
/// existing files are never overwritten.
#[tauri::command]
pub async fn preset_install(app: AppHandle, id: String) -> IpcResult<PresetInstallResult> {
    let src = preset_dir(&app, &id)?;
    let dst = hermes_home()?;

    // Blocking fs work moves off the tokio runtime — the install touches
    // many small files and YAML parsing isn't free.
    tokio::task::spawn_blocking(move || install_sync(&src, &dst))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("install join: {e}"),
        })?
}

fn install_sync(src: &Path, dst: &Path) -> IpcResult<PresetInstallResult> {
    fs::create_dir_all(dst).map_err(|e| IpcError::Internal {
        message: format!("mkdir {}: {e}", dst.display()),
    })?;

    let mut result = PresetInstallResult::default();

    // Manifest — non-fatal if missing, but we surface it in the result
    // so the frontend can show the preset's name in its toast.
    let manifest_path = src.join("manifest.yaml");
    if manifest_path.exists() {
        if let Ok(text) = fs::read_to_string(&manifest_path) {
            if let Ok(m) = serde_yaml::from_str::<PresetManifest>(&text) {
                result.manifest = Some(m);
            }
        }
    }

    // Skills — copy each file into ~/.hermes/skills/ if target doesn't
    // already exist. Preserve relative subpaths (e.g. work/standup.md).
    let skills_src = src.join("skills");
    let skills_dst = dst.join("skills");
    if skills_src.exists() {
        fs::create_dir_all(&skills_dst).map_err(|e| IpcError::Internal {
            message: format!("mkdir {}: {e}", skills_dst.display()),
        })?;
        copy_tree(&skills_src, &skills_dst, &mut result, "skills")?;
    }

    // Identity files — write only if target doesn't exist, so users who
    // already have a USER.md don't get trampled.
    for (name, label) in &[
        ("USER.md", "USER.md"),
        ("MEMORY.md", "MEMORY.md"),
        ("SOUL.md", "SOUL.md"),
    ] {
        let src_file = src.join(name);
        if !src_file.exists() {
            continue;
        }
        let dst_file = dst.join(name);
        if dst_file.exists() {
            result.skipped.push((*label).to_string());
            continue;
        }
        fs::copy(&src_file, &dst_file).map_err(|e| IpcError::Internal {
            message: format!("copy {label}: {e}"),
        })?;
        result.installed.push((*label).to_string());
    }

    // MCP servers — merge into ~/.hermes/config.yaml's mcp_servers:
    // section. Never clobber an existing entry with the same id.
    let mcp_src = src.join("mcp-servers.yaml");
    if mcp_src.exists() {
        match merge_mcp_servers(&mcp_src, &dst.join("config.yaml")) {
            Ok(merged) => {
                for id in merged {
                    result.installed.push(format!("mcp/{id}"));
                }
            }
            Err(e) => {
                // Non-fatal — log and continue. A broken config merge
                // shouldn't block skill install.
                tracing::warn!("mcp merge failed: {e:?}");
            }
        }
    }

    Ok(result)
}

/// Recursive file copy that respects the "no clobber" rule and
/// reports each path as installed or skipped.
fn copy_tree(
    src: &Path,
    dst: &Path,
    result: &mut PresetInstallResult,
    prefix: &str,
) -> IpcResult<()> {
    for entry in fs::read_dir(src).map_err(|e| IpcError::Internal {
        message: format!("read_dir {}: {e}", src.display()),
    })? {
        let entry = entry.map_err(|e| IpcError::Internal {
            message: format!("read_dir entry: {e}"),
        })?;
        let path = entry.path();
        let name = entry.file_name();
        let dst_path = dst.join(&name);
        let label = format!(
            "{}/{}",
            prefix,
            path.file_name().and_then(|s| s.to_str()).unwrap_or("?")
        );

        if path.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| IpcError::Internal {
                message: format!("mkdir {}: {e}", dst_path.display()),
            })?;
            copy_tree(&path, &dst_path, result, &label)?;
        } else if dst_path.exists() {
            result.skipped.push(label);
        } else {
            fs::copy(&path, &dst_path).map_err(|e| IpcError::Internal {
                message: format!("copy {}: {e}", path.display()),
            })?;
            result.installed.push(label);
        }
    }
    Ok(())
}

/// Merge the preset's MCP-servers YAML into `~/.hermes/config.yaml`.
/// Returns the list of *newly installed* server ids (existing entries
/// are left alone).
fn merge_mcp_servers(preset_path: &Path, config_path: &Path) -> IpcResult<Vec<String>> {
    #[derive(Deserialize)]
    struct PresetServers {
        servers: Vec<serde_yaml::Value>,
    }

    let preset_text = fs::read_to_string(preset_path).map_err(|e| IpcError::Internal {
        message: format!("read preset mcp: {e}"),
    })?;
    let preset: PresetServers =
        serde_yaml::from_str(&preset_text).map_err(|e| IpcError::Internal {
            message: format!("parse preset mcp: {e}"),
        })?;

    let mut config: serde_yaml::Value = if config_path.exists() {
        let text = fs::read_to_string(config_path).map_err(|e| IpcError::Internal {
            message: format!("read config: {e}"),
        })?;
        serde_yaml::from_str(&text).unwrap_or(serde_yaml::Value::Mapping(Default::default()))
    } else {
        serde_yaml::Value::Mapping(Default::default())
    };

    let map = config.as_mapping_mut().ok_or_else(|| IpcError::Internal {
        message: "hermes config.yaml is not a mapping".into(),
    })?;

    let key = serde_yaml::Value::String("mcp_servers".into());
    let existing = map
        .entry(key.clone())
        .or_insert_with(|| serde_yaml::Value::Sequence(vec![]));
    let existing_seq = existing
        .as_sequence_mut()
        .ok_or_else(|| IpcError::Internal {
            message: "mcp_servers is not a list".into(),
        })?;

    let existing_ids: Vec<String> = existing_seq
        .iter()
        .filter_map(|v| {
            v.get(serde_yaml::Value::String("id".into()))
                .and_then(|x| x.as_str().map(String::from))
        })
        .collect();

    let mut newly_added = Vec::new();
    for srv in preset.servers {
        let id = srv
            .get(serde_yaml::Value::String("id".into()))
            .and_then(|x| x.as_str().map(String::from));
        let Some(id) = id else { continue };
        if existing_ids.contains(&id) {
            continue;
        }
        existing_seq.push(srv);
        newly_added.push(id);
    }

    if newly_added.is_empty() {
        return Ok(vec![]);
    }

    let out = serde_yaml::to_string(&config).map_err(|e| IpcError::Internal {
        message: format!("serialize config: {e}"),
    })?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| IpcError::Internal {
            message: format!("mkdir parent: {e}"),
        })?;
    }
    fs::write(config_path, out).map_err(|e| IpcError::Internal {
        message: format!("write config: {e}"),
    })?;

    Ok(newly_added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    #[test]
    fn install_copies_fresh_files() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();
        write(
            &src.path().join("manifest.yaml"),
            "id: test\nname: Test\ndescription: x\nversion: 1\n",
        );
        write(&src.path().join("skills").join("one.md"), "# one");
        write(
            &src.path().join("skills").join("nested").join("two.md"),
            "# two",
        );
        write(&src.path().join("USER.md"), "# user");

        let r = install_sync(src.path(), dst.path()).unwrap();
        assert!(r.installed.iter().any(|x| x.ends_with("one.md")));
        assert!(r.installed.iter().any(|x| x.ends_with("two.md")));
        assert!(r.installed.contains(&"USER.md".to_string()));
        assert!(dst.path().join("skills/one.md").exists());
        assert!(dst.path().join("skills/nested/two.md").exists());
        assert!(dst.path().join("USER.md").exists());
    }

    #[test]
    fn install_skips_existing_files() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();
        write(&src.path().join("skills").join("keeper.md"), "# new");
        write(
            &dst.path().join("skills").join("keeper.md"),
            "# existing-user-version",
        );

        let r = install_sync(src.path(), dst.path()).unwrap();
        assert!(r.skipped.iter().any(|x| x.ends_with("keeper.md")));
        // User's copy is untouched.
        let body = fs::read_to_string(dst.path().join("skills/keeper.md")).unwrap();
        assert_eq!(body, "# existing-user-version");
    }

    #[test]
    fn mcp_merge_appends_new_only() {
        let tmp = TempDir::new().unwrap();
        let preset = tmp.path().join("mcp.yaml");
        let config = tmp.path().join("config.yaml");
        write(
            &preset,
            "servers:\n  - id: fetch\n    command: npx\n  - id: pre-existing\n    command: npx\n",
        );
        write(
            &config,
            "model:\n  default: deepseek-chat\nmcp_servers:\n  - id: pre-existing\n    command: old\n",
        );

        let added = merge_mcp_servers(&preset, &config).unwrap();
        assert_eq!(added, vec!["fetch"]);

        let merged = fs::read_to_string(&config).unwrap();
        // New server appended.
        assert!(merged.contains("id: fetch"));
        // User's pre-existing entry preserved verbatim.
        assert!(merged.contains("command: old"));
    }

    #[test]
    fn mcp_merge_creates_config_when_missing() {
        let tmp = TempDir::new().unwrap();
        let preset = tmp.path().join("mcp.yaml");
        let config = tmp.path().join("config.yaml");
        write(&preset, "servers:\n  - id: fetch\n    command: npx\n");

        let added = merge_mcp_servers(&preset, &config).unwrap();
        assert_eq!(added, vec!["fetch"]);
        assert!(config.exists());
    }
}
