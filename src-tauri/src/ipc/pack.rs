//! IPC surface for the Pack subsystem.
//!
//! Commands:
//! - `pack_list`: read all installed Packs + their enable state.
//! - `pack_set_enabled`: flip a Pack's enable bit AND sync its
//!   MCP servers into `~/.hermes/config.yaml` (stage 3c). The
//!   gateway is restarted asynchronously after a successful sync
//!   so Hermes picks up the change without the user having to do
//!   it manually.

use std::collections::BTreeMap;
use std::fs;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_config;
use crate::license::{self, Verdict};
use crate::pack::{
    disable_updates, enable_updates, install_schedules, install_skills, install_workflows,
    uninstall_schedules, uninstall_skills, uninstall_workflows, PackManifest, RegistryEntry,
    TemplateContext,
};
use crate::state::AppState;

// Helper: convert a serde_yaml::Value into the JSON value the
// frontend expects. Pack manifests use YAML for ergonomics
// (multi-line strings, comments) but the IPC wire is JSON.
fn yaml_to_json(v: &serde_yaml::Value) -> serde_json::Value {
    match v {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(*b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(serde_json::Number::from(i))
            } else if let Some(u) = n.as_u64() {
                serde_json::Value::Number(serde_json::Number::from(u))
            } else if let Some(f) = n.as_f64() {
                serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s.clone()),
        serde_yaml::Value::Sequence(s) => {
            serde_json::Value::Array(s.iter().map(yaml_to_json).collect())
        }
        serde_yaml::Value::Mapping(m) => {
            let mut out = serde_json::Map::new();
            for (k, v) in m {
                let key = match k {
                    serde_yaml::Value::String(s) => s.clone(),
                    other => serde_yaml::to_string(other)
                        .ok()
                        .map(|s| s.trim().to_string())
                        .unwrap_or_default(),
                };
                out.insert(key, yaml_to_json(v));
            }
            serde_json::Value::Object(out)
        }
        serde_yaml::Value::Tagged(tagged) => yaml_to_json(&tagged.value),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListEntry {
    /// On-disk folder name (e.g. `cross_border_ecom`). Stable.
    pub dir_name: String,
    /// Manifest's declared id; equals `dir_name` for healthy
    /// packs. Empty when manifest failed to parse.
    pub manifest_id: String,
    /// Display name from manifest. Empty for broken packs.
    pub title: String,
    /// Manifest version string.
    pub version: String,
    /// Pack author / vendor (manifest field).
    pub author: String,
    /// One-line description.
    pub description: String,
    /// Whether the user has enabled this Pack. False until
    /// explicitly turned on.
    pub enabled: bool,
    /// Non-empty when manifest failed to load or sanity checks
    /// flagged a problem (e.g. id mismatch).
    pub error: Option<String>,
    /// True when manifest parsed; false means the entry is
    /// surfaced for visibility but not actually usable.
    pub healthy: bool,
    /// True when the Pack declares a `license_feature` that is
    /// NOT present in the active license. The UI should show
    /// a "requires authorization" placeholder and disable the
    /// enable toggle.
    pub license_gated: bool,
}

impl From<&RegistryEntry> for PackListEntry {
    fn from(e: &RegistryEntry) -> Self {
        let m: Option<&PackManifest> = e.manifest.as_deref();
        Self {
            dir_name: e.dir_name.clone(),
            manifest_id: m.map(|m| m.id.clone()).unwrap_or_default(),
            title: m.map(|m| m.title.clone()).unwrap_or_default(),
            version: m.map(|m| m.version.clone()).unwrap_or_default(),
            author: m.map(|m| m.author.clone()).unwrap_or_default(),
            description: m.map(|m| m.description.clone()).unwrap_or_default(),
            enabled: e.enabled,
            error: e.error.clone(),
            healthy: m.is_some(),
            license_gated: false,
        }
    }
}

fn resolve_license_features(config_dir: &std::path::Path) -> Vec<String> {
    match license::status(config_dir) {
        Verdict::Valid { payload } => payload.features,
        _ => Vec::new(),
    }
}

fn pack_is_gated(manifest: &PackManifest, features: &[String]) -> bool {
    if manifest.license_feature.is_empty() {
        return false;
    }
    !features.contains(&manifest.license_feature)
}

#[tauri::command]
pub async fn pack_list(state: State<'_, AppState>) -> IpcResult<Vec<PackListEntry>> {
    let config_dir = state.config_dir.clone();
    let features = tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_features join: {e}"),
        })?;
    let registry = state.packs.read();
    let mut entries: Vec<PackListEntry> = registry.packs.iter().map(PackListEntry::from).collect();
    for (i, entry) in registry.packs.iter().enumerate() {
        if let Some(m) = entry.manifest.as_deref() {
            entries[i].license_gated = pack_is_gated(m, &features);
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn pack_rescan(state: State<'_, AppState>) -> IpcResult<Vec<PackListEntry>> {
    let hermes_dir = crate::paths::hermes_data_dir().map_err(|e| IpcError::Internal {
        message: e.to_string(),
    })?;
    let config_dir = state.config_dir.clone();
    let features = tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_features join: {e}"),
        })?;
    let new_registry = crate::pack::Registry::scan(&hermes_dir);
    let mut entries: Vec<PackListEntry> =
        new_registry.packs.iter().map(PackListEntry::from).collect();
    for (i, entry) in new_registry.packs.iter().enumerate() {
        if let Some(m) = entry.manifest.as_deref() {
            entries[i].license_gated = pack_is_gated(m, &features);
        }
    }
    {
        let mut reg = state.packs.write();
        *reg = new_registry;
    }
    Ok(entries)
}

/// One view declared by an ENABLED Pack. The DTO carries
/// everything the frontend needs to render the right template plus
/// dispatch action buttons. Disabled Packs' views are filtered out
/// at the IPC boundary so the frontend doesn't have to think about
/// it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackViewDto {
    pub pack_id: String,
    pub pack_title: String,
    pub view_id: String,
    pub title: String,
    pub icon: String,
    pub nav_section: String,
    pub template: String,
    pub data_source: serde_json::Value,
    pub options: serde_json::Value,
    pub actions: Vec<PackActionDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackActionDto {
    pub label: String,
    pub workflow: String,
    pub skill: String,
    pub confirm: bool,
}

/// Resolve a Pack view's `data_source` directive into the JSON
/// payload its template renders.
///
/// Stage 5e supports the simplest data-source kind:
///
/// ```yaml
/// data_source:
///   static:
///     metrics: { revenue: 12345, cost: 8000, profit: 4345 }
/// ```
///
/// Future kinds (MCP call, HTTP fetch, SQLite query) plug into
/// the same dispatcher. Unknown / missing kinds return an empty
/// object so the template renders its own "no data" state rather
/// than the IPC throwing.
#[tauri::command]
pub async fn pack_view_data(
    pack_id: String,
    view_id: String,
    params: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    let data_source = {
        let registry = state.packs.read();
        let entry = registry.packs.iter().find(|p| matches_pack_id(p, &pack_id));
        let manifest = entry.and_then(|p| p.manifest.as_ref());
        let view = manifest.and_then(|m| m.views.iter().find(|v| v.id == view_id));
        view.map(|v| v.data_source.clone())
    };
    let Some(ds) = data_source else {
        return Err(IpcError::Internal {
            message: format!("view not found: {pack_id}/{view_id}"),
        });
    };
    let ds = resolve_config_templates(&ds, &pack_id, &state.packs.read().hermes_dir);
    let runtime_params = params.unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    resolve_data_source_async(&ds, &state.authority, &runtime_params).await
}

fn resolve_config_templates(
    ds: &serde_yaml::Value,
    pack_id: &str,
    hermes_dir: &std::path::Path,
) -> serde_yaml::Value {
    let mut yaml_str = match serde_yaml::to_string(ds) {
        Ok(s) => s,
        Err(_) => return ds.clone(),
    };
    if !yaml_str.contains("${config.") {
        return ds.clone();
    }
    let config_path = hermes_dir
        .join("pack-data")
        .join(pack_id)
        .join("config.json");
    let config: serde_json::Value = config_path
        .exists()
        .then(|| {
            std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        })
        .flatten()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    if let Some(obj) = config.as_object() {
        for (k, v) in obj {
            let placeholder = format!("${{config.{k}}}");
            let replacement = v
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| v.to_string());
            yaml_str = yaml_str.replace(&placeholder, &replacement);
        }
    }
    serde_yaml::from_str(&yaml_str).unwrap_or_else(|_| ds.clone())
}

async fn resolve_data_source_async(
    ds: &serde_yaml::Value,
    authority: &Arc<crate::sandbox::PathAuthority>,
    runtime_params: &serde_json::Value,
) -> IpcResult<serde_json::Value> {
    let json = yaml_to_json(ds);
    let Some(obj) = json.as_object() else {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    };
    if let Some(static_value) = obj.get("static") {
        return Ok(static_value.clone());
    }
    if let Some(http_cfg) = obj.get("http") {
        return resolve_http_source(http_cfg).await;
    }
    if let Some(mcp_cfg) = obj.get("mcp") {
        return resolve_mcp_source(mcp_cfg, authority, runtime_params).await;
    }
    Ok(serde_json::Value::Object(serde_json::Map::new()))
}

async fn resolve_http_source(cfg: &serde_json::Value) -> IpcResult<serde_json::Value> {
    let url = cfg
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or(IpcError::Internal {
            message: "http data_source missing 'url'".into(),
        })?;
    let method = cfg
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();
    let timeout_secs = cfg
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(15);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| IpcError::Internal {
            message: format!("http client build: {e}"),
        })?;
    let mut req = match method.as_str() {
        "POST" => client.post(url),
        _ => client.get(url),
    };
    if let Some(headers) = cfg.get("headers").and_then(|v| v.as_object()) {
        for (k, v) in headers {
            if let Some(val) = v.as_str() {
                req = req.header(k, val);
            }
        }
    }
    if let Some(body) = cfg.get("body") {
        req = req.json(body);
    }
    let resp = req.send().await.map_err(|e| IpcError::Internal {
        message: format!("http fetch failed: {e}"),
    })?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(IpcError::Internal {
            message: format!("http {status}: {body}"),
        });
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("http json parse: {e}"),
        })
}

enum McpTransport {
    Http {
        url: String,
    },
    Stdio {
        command: String,
        args: Vec<String>,
        env: std::collections::HashMap<String, String>,
    },
}

async fn resolve_mcp_source(
    cfg: &serde_json::Value,
    authority: &Arc<crate::sandbox::PathAuthority>,
    runtime_params: &serde_json::Value,
) -> IpcResult<serde_json::Value> {
    let server_name = cfg
        .get("server")
        .and_then(|v| v.as_str())
        .ok_or(IpcError::Internal {
            message: "mcp data_source missing 'server'".into(),
        })?;
    let tool = cfg
        .get("tool")
        .and_then(|v| v.as_str())
        .ok_or(IpcError::Internal {
            message: "mcp data_source missing 'tool'".into(),
        })?;
    let mut params = cfg
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    if let (Some(base), Some(extra)) = (params.as_object_mut(), runtime_params.as_object()) {
        for (k, v) in extra {
            base.insert(k.clone(), v.clone());
        }
    }
    let timeout_secs = cfg
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(30);

    let authority_clone = authority.clone();
    let server_name_owned = server_name.to_string();
    let transport = tokio::task::spawn_blocking(move || -> IpcResult<McpTransport> {
        let doc =
            super::mcp::read_config_yaml(&authority_clone).map_err(|e| IpcError::Internal {
                message: format!("read config.yaml: {e}"),
            })?;
        let servers = super::mcp::extract_servers(&doc);
        let srv = servers
            .into_iter()
            .find(|s| s.id == server_name_owned)
            .ok_or_else(|| IpcError::Internal {
                message: format!("mcp server '{server_name_owned}' not found in config.yaml"),
            })?;
        if let Some(url) = srv.config.get("url").and_then(|v| v.as_str()) {
            return Ok(McpTransport::Http {
                url: url.to_string(),
            });
        }
        if let Some(cmd) = srv.config.get("command").and_then(|v| v.as_str()) {
            let args: Vec<String> = srv
                .config
                .get("args")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let mut env = std::collections::HashMap::new();
            if let Some(e) = srv.config.get("env").and_then(|v| v.as_object()) {
                for (k, v) in e {
                    if let Some(val) = v.as_str() {
                        env.insert(k.clone(), val.to_string());
                    }
                }
            }
            return Ok(McpTransport::Stdio {
                command: cmd.to_string(),
                args,
                env,
            });
        }
        Err(IpcError::Internal {
            message: format!("mcp server '{server_name_owned}' has neither 'url' nor 'command'"),
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("mcp join: {e}"),
    })??;

    let tool_owned = tool.to_string();
    match transport {
        McpTransport::Http { url } => {
            resolve_mcp_http(&url, &tool_owned, &params, timeout_secs).await
        }
        McpTransport::Stdio { command, args, env } => {
            resolve_mcp_stdio(&command, &args, &env, &tool_owned, &params, timeout_secs).await
        }
    }
}

async fn resolve_mcp_http(
    server_url: &str,
    tool: &str,
    params: &serde_json::Value,
    timeout_secs: u64,
) -> IpcResult<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| IpcError::Internal {
            message: format!("mcp client build: {e}"),
        })?;

    let rpc_id = rpc_id_now();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "tools/call",
        "params": { "name": tool, "arguments": params }
    });

    let resp = client
        .post(format!("{server_url}messages"))
        .json(&body)
        .send()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("mcp call failed: {e}"),
        })?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(IpcError::Internal {
            message: format!("mcp {status}: {text}"),
        });
    }
    let result: serde_json::Value = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("mcp json parse: {e}"),
    })?;
    extract_mcp_text_content(&result)
}

async fn resolve_mcp_stdio(
    command: &str,
    args: &[String],
    env: &std::collections::HashMap<String, String>,
    tool: &str,
    params: &serde_json::Value,
    timeout_secs: u64,
) -> IpcResult<serde_json::Value> {
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args)
        .envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd.spawn().map_err(|e| IpcError::Internal {
        message: format!("mcp stdio spawn '{command}': {e}"),
    })?;

    let stdin = child.stdin.take().ok_or_else(|| IpcError::Internal {
        message: "mcp stdio: failed to capture stdin".into(),
    })?;
    let stdout = child.stdout.take().ok_or_else(|| IpcError::Internal {
        message: "mcp stdio: failed to capture stdout".into(),
    })?;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        mcp_stdio_session(stdin, stdout, tool, params),
    )
    .await
    .map_err(|_| IpcError::Internal {
        message: format!("mcp stdio timeout after {timeout_secs}s"),
    })?;

    let _ = child.kill().await;
    result
}

async fn mcp_stdio_session(
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    tool: &str,
    params: &serde_json::Value,
) -> IpcResult<serde_json::Value> {
    let mut reader = tokio::io::BufReader::new(stdout);

    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "corey-data-source", "version": "1.0" }
        }
    });
    write_jsonrpc(&mut stdin, &init_req).await?;
    let _init_resp = read_jsonrpc(&mut reader).await?;

    let init_notif = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    write_jsonrpc(&mut stdin, &init_notif).await?;

    let call_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": { "name": tool, "arguments": params }
    });
    write_jsonrpc(&mut stdin, &call_req).await?;
    let call_resp = read_jsonrpc(&mut reader).await?;

    extract_mcp_text_content(&call_resp)
}

async fn write_jsonrpc(
    stdin: &mut tokio::process::ChildStdin,
    msg: &serde_json::Value,
) -> IpcResult<()> {
    use tokio::io::AsyncWriteExt;
    let mut line = serde_json::to_string(msg).map_err(|e| IpcError::Internal {
        message: format!("mcp jsonrpc serialize: {e}"),
    })?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("mcp stdio write: {e}"),
        })?;
    stdin.flush().await.map_err(|e| IpcError::Internal {
        message: format!("mcp stdio flush: {e}"),
    })?;
    Ok(())
}

async fn read_jsonrpc(
    reader: &mut tokio::io::BufReader<tokio::process::ChildStdout>,
) -> IpcResult<serde_json::Value> {
    use tokio::io::AsyncBufReadExt;
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("mcp stdio read: {e}"),
        })?;
    if line.is_empty() {
        return Err(IpcError::Internal {
            message: "mcp stdio: server closed stdout before responding".into(),
        });
    }
    serde_json::from_str(line.trim()).map_err(|e| IpcError::Internal {
        message: format!("mcp stdio json parse: {e}"),
    })
}

fn extract_mcp_text_content(result: &serde_json::Value) -> IpcResult<serde_json::Value> {
    let content = result
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str());
    if let Some(text) = content {
        Ok(serde_json::from_str(text)
            .unwrap_or_else(|_| serde_json::Value::String(text.to_string())))
    } else {
        Ok(result.clone())
    }
}

fn rpc_id_now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Return every view declared by every CURRENTLY-ENABLED Pack.
/// Stable ordering: by pack id, then by view id within each pack.
#[tauri::command]
pub async fn pack_views_list(state: State<'_, AppState>) -> IpcResult<Vec<PackViewDto>> {
    let config_dir = state.config_dir.clone();
    let features = tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_features join: {e}"),
        })?;
    let registry = state.packs.read();
    let mut out = Vec::new();
    for entry in &registry.packs {
        if !entry.enabled {
            continue;
        }
        let Some(manifest) = &entry.manifest else {
            continue;
        };
        if pack_is_gated(manifest, &features) {
            continue;
        }
        for view in &manifest.views {
            let options: serde_json::Value = if view.options.is_empty() {
                serde_json::Value::Object(serde_json::Map::new())
            } else {
                let mut obj = serde_json::Map::new();
                for (k, v) in &view.options {
                    obj.insert(k.clone(), yaml_to_json(v));
                }
                serde_json::Value::Object(obj)
            };
            out.push(PackViewDto {
                pack_id: manifest.id.clone(),
                pack_title: if manifest.title.is_empty() {
                    manifest.id.clone()
                } else {
                    manifest.title.clone()
                },
                view_id: view.id.clone(),
                title: view.title.clone(),
                icon: view.icon.clone(),
                nav_section: view.nav_section.clone(),
                template: view.template.clone(),
                data_source: yaml_to_json(&view.data_source),
                options,
                actions: view
                    .actions
                    .iter()
                    .map(|a| PackActionDto {
                        label: a.label.clone(),
                        workflow: a.workflow.clone(),
                        skill: a.skill.clone(),
                        confirm: a.confirm,
                    })
                    .collect(),
            });
        }
    }
    out.sort_by(|a, b| {
        a.pack_id
            .cmp(&b.pack_id)
            .then_with(|| a.view_id.cmp(&b.view_id))
    });
    Ok(out)
}

#[tauri::command]
pub async fn pack_set_enabled(
    pack_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> IpcResult<()> {
    // Snapshot what we need under a read lock, drop it before any
    // file I/O so the registry stays available for concurrent
    // pack_list calls during the (potentially slow) gateway
    // restart that follows.
    let (manifest_arc, hermes_dir, pack_dir) = {
        let registry = state.packs.read();
        let entry = registry.packs.iter().find(|p| matches_pack_id(p, &pack_id));
        let manifest = entry.and_then(|p| p.manifest.clone());
        let pack_dir = entry.map(|p| p.dir_path.clone());
        (manifest, registry.hermes_dir.clone(), pack_dir)
    };

    if enabled && manifest_arc.is_none() {
        return Err(IpcError::Unsupported {
            capability: format!(
                "pack {pack_id:?} cannot be enabled: manifest is missing or invalid"
            ),
        });
    }

    if enabled {
        if let Some(m) = manifest_arc.as_deref() {
            let config_dir = state.config_dir.clone();
            let features =
                tokio::task::spawn_blocking(move || resolve_license_features(&config_dir))
                    .await
                    .map_err(|e| IpcError::Internal {
                        message: format!("license_features join: {e}"),
                    })?;
            if pack_is_gated(m, &features) {
                return Err(IpcError::Unauthorized {
                    detail: format!(
                        "pack {:?} requires license feature {:?}",
                        pack_id, m.license_feature
                    ),
                });
            }
        }
    }

    let journal = state.changelog_path.clone();

    // Sync to config.yaml (only if Pack actually has MCP servers).
    let config_changed = sync_config_yaml(&pack_id, &manifest_arc, enabled, &hermes_dir, &journal)?;

    // Install / uninstall Pack skills under
    // `~/.hermes/skills/pack__<id>/`. Skills are independent of MCP
    // servers — a Pack with no MCP can still ship pure-prompt
    // skills. Errors here don't roll back the config.yaml change
    // we just made: skills failing to install is annoying but not
    // critical, and rolling back would risk leaving Hermes
    // half-configured.
    sync_skills(
        &pack_id,
        &manifest_arc,
        enabled,
        &hermes_dir,
        pack_dir.as_deref(),
    )?;

    // Install / uninstall Pack workflows under
    // `~/.hermes/workflows/pack__<id>__*.yaml`. Workflows are
    // pure data files that the Corey workflow engine reads at
    // runtime; we just copy them in / out.
    sync_workflows(&pack_id, &manifest_arc, enabled, pack_dir.as_deref())?;

    // Install / uninstall Pack cron schedules in
    // `~/.hermes/cron/jobs.json`. These reference the prefixed
    // workflow ids written above, so they go LAST in the enable
    // sequence (workflows must exist before the cron tries to
    // run them).
    sync_schedules(&pack_id, &manifest_arc, enabled)?;

    // Persist the bool. Doing this AFTER config.yaml write means a
    // failure there leaves the user-visible enable state unchanged
    // — better than half-applied state.
    {
        let mut registry = state.packs.write();
        registry
            .set_enabled(&pack_id, enabled)
            .map_err(|e| IpcError::Internal {
                message: format!("persist pack-state.json: {e}"),
            })?;
    }

    tracing::info!(
        pack_id,
        enabled,
        config_changed,
        "pack enable state changed"
    );

    // Trigger a Hermes gateway restart so the new mcp_servers
    // entries become live. Hermes 0.10 has no `/reload-mcp`
    // endpoint (verified in mcp_server::register_with_hermes),
    // so restart is the only mechanism. Skip when nothing in
    // config.yaml changed (e.g. Pack with no MCP servers, or
    // toggle that turned out to be a no-op).
    if config_changed {
        tauri::async_runtime::spawn(async {
            let result = tokio::task::spawn_blocking(hermes_config::gateway_restart).await;
            match result {
                Ok(Ok(_)) => tracing::info!("pack toggle: hermes gateway restarted"),
                Ok(Err(e)) => tracing::warn!(error = %e, "pack toggle: gateway restart failed"),
                Err(e) => tracing::warn!(error = %e, "pack toggle: restart join error"),
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn pack_config_get(
    pack_id: String,
    state: State<'_, AppState>,
) -> IpcResult<serde_json::Value> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let path = hermes_dir
            .join("pack-data")
            .join(&pack_id)
            .join("config.json");
        if !path.exists() {
            return Ok(serde_json::Value::Object(serde_json::Map::new()));
        }
        let raw = fs::read_to_string(&path).map_err(|e| IpcError::Internal {
            message: format!("read config: {e}"),
        })?;
        serde_json::from_str(&raw).map_err(|e| IpcError::Internal {
            message: format!("parse config: {e}"),
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("config_get join: {e}"),
    })?
}

#[tauri::command]
pub async fn pack_config_set(
    pack_id: String,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> IpcResult<()> {
    let hermes_dir = state.packs.read().hermes_dir.clone();
    tokio::task::spawn_blocking(move || {
        let dir = hermes_dir.join("pack-data").join(&pack_id);
        fs::create_dir_all(&dir).map_err(|e| IpcError::Internal {
            message: format!("create pack-data dir: {e}"),
        })?;
        let path = dir.join("config.json");
        let tmp = path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(&config).map_err(|e| IpcError::Internal {
            message: format!("serialize config: {e}"),
        })?;
        fs::write(&tmp, body).map_err(|e| IpcError::Internal {
            message: format!("write config tmp: {e}"),
        })?;
        fs::rename(&tmp, &path).map_err(|e| IpcError::Internal {
            message: format!("rename config: {e}"),
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("config_set join: {e}"),
    })?
}

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

/// True when `entry`'s canonical Pack id matches `pack_id`. The
/// canonical id is `manifest.id` for healthy entries and falls
/// back to the directory name for broken ones (so the UI can
/// still target them for cleanup).
fn matches_pack_id(entry: &RegistryEntry, pack_id: &str) -> bool {
    let entry_id = entry
        .manifest
        .as_ref()
        .map(|m| m.id.as_str())
        .unwrap_or(entry.dir_name.as_str());
    entry_id == pack_id
}

/// Translate the Pack's mcp_servers section to / from
/// `~/.hermes/config.yaml`. Returns `true` when at least one
/// entry was written (caller uses this to decide whether to
/// trigger a gateway restart).
fn sync_config_yaml(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    journal: &std::path::Path,
) -> IpcResult<bool> {
    let Some(manifest) = manifest else {
        // No manifest, nothing to sync. Stage 3c+ may add a
        // fallback that scans config.yaml for stale prefixed
        // entries and removes them; for now disable on a broken
        // Pack is a no-op on config.yaml.
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

/// Copy / remove Pack workflow YAMLs in `~/.hermes/workflows/`.
fn sync_workflows(
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

/// Install / uninstall Pack cron schedules in jobs.json.
fn sync_schedules(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
) -> IpcResult<()> {
    if enabled {
        let Some(manifest) = manifest else {
            return Ok(());
        };
        if manifest.schedules.is_empty() {
            // Be sure to clear stale entries from a previous
            // version of the manifest that DID have schedules.
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

/// Copy / remove the Pack's skills under `~/.hermes/skills/pack__<id>/`.
///
/// On enable: copy each `manifest.skills` entry from the Pack
/// folder to the Hermes skills tree. On disable: remove the
/// `pack__<id>` subdirectory entirely.
///
/// `pack_dir` is `None` when the Pack folder is gone (user
/// uninstalled before disabling) — we still attempt to remove the
/// skills directory so stale files don't linger.
fn sync_skills(
    pack_id: &str,
    manifest: &Option<Arc<PackManifest>>,
    enabled: bool,
    hermes_dir: &std::path::Path,
    pack_dir: Option<&std::path::Path>,
) -> IpcResult<()> {
    if enabled {
        let (Some(manifest), Some(pack_dir)) = (manifest, pack_dir) else {
            // No manifest / no folder: nothing to copy. (We've
            // already rejected enable-with-broken-manifest at the
            // top of pack_set_enabled, so this branch is mostly
            // defensive.)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::Registry;
    use std::sync::Arc;

    #[test]
    fn pack_list_entry_handles_broken_manifest() {
        let entry = RegistryEntry {
            dir_name: "broken".into(),
            dir_path: "/tmp/broken".into(),
            manifest: None,
            error: Some("parse error".into()),
            enabled: false,
        };
        let dto: PackListEntry = (&entry).into();
        assert_eq!(dto.dir_name, "broken");
        assert!(!dto.healthy);
        assert_eq!(dto.manifest_id, "");
        assert_eq!(dto.error.as_deref(), Some("parse error"));
    }

    #[test]
    fn pack_list_entry_round_trips_manifest_fields() {
        // Parse a manifest, drop it into a RegistryEntry, then
        // mirror it as a DTO and check the fields landed.
        let yaml = "schema_version: 1\nid: foo\nversion: \"1.2.3\"\ntitle: Foo\nauthor: Acme\ndescription: hello\n";
        let manifest = match crate::pack::parse(yaml) {
            crate::pack::ManifestLoadOutcome::Loaded(m) => m,
            other => panic!("expected Loaded, got {other:?}"),
        };
        let entry = RegistryEntry {
            dir_name: "foo".into(),
            dir_path: "/tmp/foo".into(),
            manifest: Some(Arc::new(*manifest)),
            error: None,
            enabled: true,
        };
        let dto: PackListEntry = (&entry).into();
        assert_eq!(dto.manifest_id, "foo");
        assert_eq!(dto.title, "Foo");
        assert_eq!(dto.version, "1.2.3");
        assert_eq!(dto.author, "Acme");
        assert_eq!(dto.description, "hello");
        assert!(dto.healthy);
        assert!(dto.enabled);
        assert!(dto.error.is_none());
    }

    #[test]
    fn registry_empty_means_pack_list_is_empty() {
        // Smoke-test the registry default state matches the IPC
        // mapping (no Packs found = empty Vec).
        let r = Registry::empty();
        let dtos: Vec<PackListEntry> = r.packs.iter().map(PackListEntry::from).collect();
        assert!(dtos.is_empty());
    }

    #[test]
    fn rescan_produces_same_dto_shape_as_list() {
        // Verify that scanning a temp dir with one Pack and mapping
        // through the same DTO path produces a healthy entry.
        let tmp = tempfile::tempdir().expect("tempdir");
        let packs_dir = tmp.path().join("skill-packs");
        let pack_dir = packs_dir.join("test_pack");
        std::fs::create_dir_all(&pack_dir).expect("mkdir");
        std::fs::write(
            pack_dir.join("manifest.yaml"),
            "schema_version: 1\nid: test_pack\nversion: \"0.1.0\"\ntitle: Test\n",
        )
        .expect("write manifest");
        let registry = Registry::scan(tmp.path());
        let dtos: Vec<PackListEntry> = registry.packs.iter().map(PackListEntry::from).collect();
        assert_eq!(dtos.len(), 1);
        assert_eq!(dtos[0].manifest_id, "test_pack");
        assert!(dtos[0].healthy);
    }

    #[test]
    fn pack_is_gated_returns_true_when_feature_missing() {
        let yaml =
            "schema_version: 1\nid: pro_pack\nversion: \"1.0.0\"\nlicense_feature: pro_analytics\n";
        let manifest = match crate::pack::parse(yaml) {
            crate::pack::ManifestLoadOutcome::Loaded(m) => m,
            other => panic!("expected Loaded, got {other:?}"),
        };
        assert!(pack_is_gated(&manifest, &[]));
        assert!(pack_is_gated(&manifest, &["basic".into()]));
        assert!(!pack_is_gated(&manifest, &["pro_analytics".into()]));
        assert!(!pack_is_gated(
            &manifest,
            &["basic".into(), "pro_analytics".into()]
        ));
    }

    #[test]
    fn pack_is_gated_returns_false_when_no_license_feature() {
        let yaml = "schema_version: 1\nid: free_pack\nversion: \"1.0.0\"\n";
        let manifest = match crate::pack::parse(yaml) {
            crate::pack::ManifestLoadOutcome::Loaded(m) => m,
            other => panic!("expected Loaded, got {other:?}"),
        };
        assert!(!pack_is_gated(&manifest, &[]));
    }

    #[test]
    fn resolve_data_source_async_returns_static_data() {
        let ds: serde_yaml::Value =
            serde_yaml::from_str("static: { metrics: { revenue: 123 } }").expect("yaml");
        let authority = Arc::new(crate::sandbox::PathAuthority::new());
        let empty = serde_json::Value::Object(serde_json::Map::new());
        let rt = tokio::runtime::Runtime::new().expect("rt");
        let result = rt
            .block_on(resolve_data_source_async(&ds, &authority, &empty))
            .expect("resolve");
        assert_eq!(result["metrics"]["revenue"], 123);
    }

    #[test]
    fn resolve_data_source_async_returns_empty_for_unknown_kind() {
        let ds: serde_yaml::Value =
            serde_yaml::from_str("sql: { query: \"SELECT 1\" }").expect("yaml");
        let authority = Arc::new(crate::sandbox::PathAuthority::new());
        let empty = serde_json::Value::Object(serde_json::Map::new());
        let rt = tokio::runtime::Runtime::new().expect("rt");
        let result = rt
            .block_on(resolve_data_source_async(&ds, &authority, &empty))
            .expect("resolve");
        assert!(result.as_object().map(|o| o.is_empty()).unwrap_or(true));
    }

    #[test]
    fn resolve_http_source_rejects_missing_url() {
        let cfg = serde_json::json!({});
        let rt = tokio::runtime::Runtime::new().expect("rt");
        let result = rt.block_on(resolve_http_source(&cfg));
        assert!(result.is_err());
    }

    #[test]
    fn extract_mcp_text_content_parses_json_string() {
        let resp = serde_json::json!({
            "result": {
                "content": [{"type": "text", "text": "{\"revenue\": 999}"}]
            }
        });
        let out = extract_mcp_text_content(&resp).expect("extract");
        assert_eq!(out["revenue"], 999);
    }

    #[test]
    fn extract_mcp_text_content_returns_raw_when_not_json() {
        let resp = serde_json::json!({
            "result": {
                "content": [{"type": "text", "text": "plain string"}]
            }
        });
        let out = extract_mcp_text_content(&resp).expect("extract");
        assert_eq!(out.as_str().expect("str"), "plain string");
    }

    #[test]
    fn extract_mcp_text_content_fallback_for_missing_content() {
        let resp = serde_json::json!({"id": 1});
        let out = extract_mcp_text_content(&resp).expect("extract");
        assert_eq!(out["id"], 1);
    }

    #[test]
    fn rpc_id_now_returns_nonzero() {
        assert!(rpc_id_now() > 0);
    }

    #[test]
    fn resolve_config_templates_substitutes_placeholders() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pack_data = tmp.path().join("pack-data").join("test_pack");
        std::fs::create_dir_all(&pack_data).expect("mkdir");
        std::fs::write(
            pack_data.join("config.json"),
            r#"{"marketplace":"JP","threshold":"25"}"#,
        )
        .expect("write");
        let ds: serde_yaml::Value = serde_yaml::from_str(
            "mcp: { server: srv, tool: t, params: { marketplace: \"${config.marketplace}\" } }",
        )
        .expect("yaml");
        let result = resolve_config_templates(&ds, "test_pack", tmp.path());
        let json = yaml_to_json(&result);
        let mp = json
            .get("mcp")
            .and_then(|m| m.get("params"))
            .and_then(|p| p.get("marketplace"))
            .and_then(|v| v.as_str());
        assert_eq!(mp, Some("JP"));
    }

    #[test]
    fn resolve_config_templates_noop_without_placeholders() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ds: serde_yaml::Value = serde_yaml::from_str("static: { revenue: 100 }").expect("yaml");
        let result = resolve_config_templates(&ds, "any", tmp.path());
        let json = yaml_to_json(&result);
        assert_eq!(json["static"]["revenue"], 100);
    }
}
