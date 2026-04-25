//! Phase 7 · T7.1 — MCP server manager IPC.
//!
//! Hermes natively supports the Model Context Protocol (MCP) via the
//! `mcp_servers:` section of `~/.hermes/config.yaml`. We don't run MCP
//! servers ourselves — Hermes forks each one (stdio) or connects over
//! HTTP. Corey's only job is to let the user curate which servers
//! Hermes should talk to.
//!
//! Upstream config format (verified 2026-04-23 against
//! hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes):
//!
//! ```yaml
//! mcp_servers:
//!   project_fs:
//!     command: "npx"
//!     args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/repo"]
//!     env:
//!       KEY: "value"
//!     tools:
//!       include: [read_file, list_directory]
//!   docs:
//!     url: "https://mcp.docs.example.com"
//!     headers:
//!       Authorization: "Bearer ..."
//!     tools:
//!       exclude: [delete_doc]
//! ```
//!
//! There is NO `enabled: true/false` flag upstream; presence of an
//! entry means enabled. To temporarily disable a server the user
//! comments it out or deletes it. We preserve this convention — no
//! invented fields that would bloat config.yaml with corey-specific
//! metadata Hermes would ignore anyway.
//!
//! Changes to `mcp_servers:` require either a `/reload-mcp` slash
//! command inside a chat or a gateway restart. The UI surfaces the
//! existing `hermes_gateway_restart` nudge (same pattern channels
//! already uses).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_yaml::Value as YamlValue;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_config;
use crate::sandbox::{self, PathAuthority};
use crate::state::AppState;

/// One MCP server entry. `config` is the full opaque JSON blob that
/// maps 1:1 to what sits under `mcp_servers.<id>` in config.yaml —
/// preserving `command/args/env` (stdio) or `url/headers` (http) plus
/// any `tools` filter the user wrote. Keeping it opaque means we
/// don't lock the user into Corey's view of the schema: any new
/// upstream field just rides through unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub config: serde_json::Value,
}

/// List every MCP server Hermes is configured to connect to. Returns
/// an empty vec when `config.yaml` is missing or has no `mcp_servers`
/// section — a fresh install should still render the page without
/// bubbling up "file not found".
#[tauri::command]
pub async fn mcp_server_list(state: State<'_, AppState>) -> IpcResult<Vec<McpServer>> {
    let authority = state.authority.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<Vec<McpServer>> {
        let doc = read_config_yaml(&authority)
            .map_err(|e| IpcError::Internal { message: format!("mcp_server_list: {e}") })?;
        Ok(extract_servers(&doc))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("mcp_server_list task join: {e}"),
    })?
}

/// Upsert one MCP server entry. `server.id` is the map key under
/// `mcp_servers:` — stable across edits. `server.config` is written
/// verbatim (it's already JSON; YAML accepts any JSON as valid YAML).
///
/// Validation is intentionally minimal: we require a non-empty `id`
/// and reject ids that would escape their key (dots would let a
/// "foo.bar" id write into `mcp_servers.foo.bar`, which is not what
/// the user means). Everything else — which transport fields are
/// present, whether the tool filter is valid, whether the remote URL
/// is reachable — is Hermes' responsibility once it reloads.
#[tauri::command]
pub async fn mcp_server_upsert(
    state: State<'_, AppState>,
    server: McpServer,
) -> IpcResult<()> {
    validate_id(&server.id)?;
    let id = server.id.clone();
    let journal = state.changelog_path.clone();
    let config = server.config;

    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut updates: HashMap<String, serde_json::Value> = HashMap::new();
        updates.insert(id, config);
        // `write_channel_yaml_fields` is misnamed from T3.2 — it's the
        // generic YAML patch helper. `root = "mcp_servers"` and one
        // dotted field (the server id) writes exactly the nested
        // structure upstream expects.
        hermes_config::write_channel_yaml_fields("mcp_servers", &updates, Some(&journal))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("mcp_server_upsert task join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("mcp_server_upsert: {e}"),
    })
}

/// Remove one MCP server entry. No-op if the id is not present —
/// aligns with the UI's delete flow which fire-and-forgets and
/// refreshes.
#[tauri::command]
pub async fn mcp_server_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    validate_id(&id)?;
    let journal = state.changelog_path.clone();

    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut updates: HashMap<String, serde_json::Value> = HashMap::new();
        // JSON null deletes the field in `write_channel_yaml_fields`.
        updates.insert(id, serde_json::Value::Null);
        hermes_config::write_channel_yaml_fields("mcp_servers", &updates, Some(&journal))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("mcp_server_delete task join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("mcp_server_delete: {e}"),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct McpProbeResult {
    pub id: String,
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn mcp_server_probe(
    state: State<'_, AppState>,
    id: String,
) -> IpcResult<McpProbeResult> {
    let authority = state.authority.clone();
    let server: serde_json::Value = tokio::task::spawn_blocking({
        let authority = authority.clone();
        let id = id.clone();
        move || -> IpcResult<serde_json::Value> {
            let doc = read_config_yaml(&authority)
                .map_err(|e| IpcError::Internal { message: format!("mcp_probe read: {e}") })?;
            let servers = extract_servers(&doc);
            let srv = servers.into_iter().find(|s| s.id == id).ok_or_else(|| {
                IpcError::Internal { message: format!("mcp server '{id}' not found") }
            })?;
            Ok(srv.config)
        }
    }).await.map_err(|e| IpcError::Internal { message: format!("mcp_probe join: {e}") })?
    .map_err(|e: IpcError| e)?;

    let rid = id.clone();

    if let Some(url) = server.get("url").and_then(|v| v.as_str()) {
        let url = url.to_string();
        let start = std::time::Instant::now();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| IpcError::Internal { message: format!("build client: {e}") })?;
        let resp = client.head(&url).send().await;
        let latency = start.elapsed().as_millis() as u64;
        match resp {
            Ok(r) if r.status().is_success() || r.status().is_server_error() => {
                Ok(McpProbeResult { id: rid, reachable: true, latency_ms: Some(latency), error: None })
            }
            Ok(r) => Ok(McpProbeResult {
                id: rid, reachable: false, latency_ms: Some(latency),
                error: Some(format!("HTTP {}", r.status())),
            }),
            Err(e) => Ok(McpProbeResult {
                id: rid, reachable: false, latency_ms: Some(latency),
                error: Some(e.to_string()),
            }),
        }
    } else if let Some(cmd) = server.get("command").and_then(|v| v.as_str()) {
        let cmd_str = cmd.to_string();
        let which = tokio::task::spawn_blocking(move || {
            std::process::Command::new("which").arg(&cmd_str).output()
        }).await;
        match which {
            Ok(Ok(o)) if o.status.success() => {
                Ok(McpProbeResult { id: rid, reachable: true, latency_ms: None, error: None })
            }
            _ => Ok(McpProbeResult {
                id: rid, reachable: false, latency_ms: None,
                error: Some(format!("command '{}' not found in PATH", cmd.to_string())),
            }),
        }
    } else {
        Ok(McpProbeResult {
            id: rid, reachable: false, latency_ms: None,
            error: Some("no 'url' or 'command' field".into()),
        })
    }
}

fn validate_id(id: &str) -> IpcResult<()> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(IpcError::Internal {
            message: "mcp server id cannot be empty".into(),
        });
    }
    if trimmed.contains('.') {
        return Err(IpcError::Internal {
            message: format!("mcp server id cannot contain '.': {id}"),
        });
    }
    Ok(())
}

/// Read `~/.hermes/config.yaml` through the sandbox. Missing file →
/// `YamlValue::Null`. Sibling of `ipc::channels::read_config_yaml_value`
/// but not reused because that function is private to the channels
/// module. Duplicating four lines costs less than threading a `pub` out.
fn read_config_yaml(authority: &Arc<PathAuthority>) -> std::io::Result<YamlValue> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "neither $HOME nor %USERPROFILE% set",
            )
        })?;
    let path = Path::new(&home).join(".hermes/config.yaml");
    let raw = match sandbox::fs::read_to_string_blocking(authority, &path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(YamlValue::Null),
        Err(e) => return Err(e),
    };
    serde_yaml::from_str::<YamlValue>(&raw)
        .map_err(|e| std::io::Error::other(format!("parse config.yaml: {e}")))
}

/// Pull every server out of the top-level `mcp_servers:` map. Order
/// follows YAML map iteration (insertion order for serde_yaml) — we
/// don't sort here so the UI can show the user's own grouping intent.
fn extract_servers(doc: &YamlValue) -> Vec<McpServer> {
    let Some(map) = doc.as_mapping() else {
        return Vec::new();
    };
    let Some(mcp) = map.get(YamlValue::String("mcp_servers".into())) else {
        return Vec::new();
    };
    let Some(mcp_map) = mcp.as_mapping() else {
        return Vec::new();
    };

    let mut out = Vec::with_capacity(mcp_map.len());
    for (k, v) in mcp_map {
        let YamlValue::String(id) = k else { continue };
        out.push(McpServer {
            id: id.clone(),
            config: yaml_to_json(v),
        });
    }
    out
}

fn yaml_to_json(v: &YamlValue) -> serde_json::Value {
    match v {
        YamlValue::Null => serde_json::Value::Null,
        YamlValue::Bool(b) => serde_json::Value::Bool(*b),
        YamlValue::Number(n) => {
            if let Some(u) = n.as_u64() {
                serde_json::Value::from(u)
            } else if let Some(i) = n.as_i64() {
                serde_json::Value::from(i)
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        YamlValue::String(s) => serde_json::Value::String(s.clone()),
        YamlValue::Sequence(seq) => {
            serde_json::Value::Array(seq.iter().map(yaml_to_json).collect())
        }
        YamlValue::Mapping(m) => {
            let mut o = serde_json::Map::new();
            for (k, v) in m {
                if let YamlValue::String(sk) = k {
                    o.insert(sk.clone(), yaml_to_json(v));
                }
            }
            serde_json::Value::Object(o)
        }
        YamlValue::Tagged(t) => yaml_to_json(&t.value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_servers_returns_empty_when_section_missing() {
        // Fresh config with no mcp_servers key at all.
        let doc: YamlValue = serde_yaml::from_str("channels: {}\n").unwrap();
        assert!(extract_servers(&doc).is_empty());
        // Null doc (missing file case).
        assert!(extract_servers(&YamlValue::Null).is_empty());
    }

    #[test]
    fn extract_servers_parses_stdio_and_url_transports_verbatim() {
        // Mirrors the format from hermes-agent docs. `config` is the
        // full blob — no stripping, no re-keying, no coercion.
        let yaml = r#"
mcp_servers:
  project_fs:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    env:
      TOKEN: "redacted"
  docs:
    url: "https://mcp.docs.example.com"
    headers:
      Authorization: "Bearer xyz"
    tools:
      exclude: [delete_doc]
"#;
        let doc: YamlValue = serde_yaml::from_str(yaml).unwrap();
        let out = extract_servers(&doc);
        assert_eq!(out.len(), 2);

        let fs = &out[0];
        assert_eq!(fs.id, "project_fs");
        assert_eq!(fs.config["command"], "npx");
        assert_eq!(fs.config["args"][0], "-y");
        assert_eq!(fs.config["env"]["TOKEN"], "redacted");
        // No url key on a stdio entry.
        assert!(fs.config.get("url").is_none());

        let docs = &out[1];
        assert_eq!(docs.id, "docs");
        assert_eq!(docs.config["url"], "https://mcp.docs.example.com");
        assert_eq!(docs.config["headers"]["Authorization"], "Bearer xyz");
        assert_eq!(docs.config["tools"]["exclude"][0], "delete_doc");
    }

    #[test]
    fn validate_id_rejects_empty_and_dotted() {
        assert!(validate_id("").is_err());
        assert!(validate_id("   ").is_err());
        assert!(validate_id("foo.bar").is_err());
        assert!(validate_id("project_fs").is_ok());
        assert!(validate_id("my-server_42").is_ok());
    }
}
