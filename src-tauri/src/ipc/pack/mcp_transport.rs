use std::sync::Arc;

use serde_json::Value as JsonValue;

use crate::error::{IpcError, IpcResult};
use crate::sandbox::PathAuthority;

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

pub async fn resolve_mcp_source(
    cfg: &JsonValue,
    authority: &Arc<PathAuthority>,
    runtime_params: &JsonValue,
) -> IpcResult<JsonValue> {
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
        .unwrap_or(JsonValue::Object(serde_json::Map::new()));
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
            super::super::mcp::read_config_yaml(&authority_clone).map_err(|e| IpcError::Internal {
                message: format!("read config.yaml: {e}"),
            })?;
        let servers = super::super::mcp::extract_servers(&doc);
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
    params: &JsonValue,
    timeout_secs: u64,
) -> IpcResult<JsonValue> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| IpcError::Internal {
            message: format!("mcp client build: {e}"),
        })?;

    let rpc_id = super::data_source::rpc_id_now();
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
    let result: JsonValue = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("mcp json parse: {e}"),
    })?;
    super::data_source::extract_mcp_text_content(&result)
}

async fn resolve_mcp_stdio(
    command: &str,
    args: &[String],
    env: &std::collections::HashMap<String, String>,
    tool: &str,
    params: &JsonValue,
    timeout_secs: u64,
) -> IpcResult<JsonValue> {
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args)
        .envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
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
    params: &JsonValue,
) -> IpcResult<JsonValue> {
    let mut reader = tokio::io::BufReader::new(stdout);

    let init_req = JsonValue::Object(serde_json::Map::from_iter([
        ("jsonrpc".to_string(), JsonValue::String("2.0".to_string())),
        ("id".to_string(), JsonValue::Number(serde_json::Number::from(1))),
        ("method".to_string(), JsonValue::String("initialize".to_string())),
        ("params".to_string(), JsonValue::Object(serde_json::Map::from_iter([
            ("protocolVersion".to_string(), JsonValue::String("2024-11-05".to_string())),
            ("capabilities".to_string(), JsonValue::Object(serde_json::Map::new())),
            ("clientInfo".to_string(), JsonValue::Object(serde_json::Map::from_iter([
                ("name".to_string(), JsonValue::String("corey-data-source".to_string())),
                ("version".to_string(), JsonValue::String("1.0".to_string())),
            ]))),
        ]))),
    ]));
    write_jsonrpc(&mut stdin, &init_req).await?;
    let _init_resp = read_jsonrpc(&mut reader).await?;

    let init_notif = JsonValue::Object(serde_json::Map::from_iter([
        ("jsonrpc".to_string(), JsonValue::String("2.0".to_string())),
        ("method".to_string(), JsonValue::String("notifications/initialized".to_string())),
    ]));
    write_jsonrpc(&mut stdin, &init_notif).await?;

    let call_req = JsonValue::Object(serde_json::Map::from_iter([
        ("jsonrpc".to_string(), JsonValue::String("2.0".to_string())),
        ("id".to_string(), JsonValue::Number(serde_json::Number::from(2))),
        ("method".to_string(), JsonValue::String("tools/call".to_string())),
        ("params".to_string(), JsonValue::Object(serde_json::Map::from_iter([
            ("name".to_string(), JsonValue::String(tool.to_string())),
            ("arguments".to_string(), params.clone()),
        ]))),
    ]));
    write_jsonrpc(&mut stdin, &call_req).await?;
    let call_resp = read_jsonrpc(&mut reader).await?;

    super::data_source::extract_mcp_text_content(&call_resp)
}

async fn write_jsonrpc(
    stdin: &mut tokio::process::ChildStdin,
    msg: &JsonValue,
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
) -> IpcResult<JsonValue> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    #[ignore]
    fn b10_e2e_filesystem_mcp_server() {
        let test_root_str = std::env::var("HOME")
            .map(|h| format!("{h}/corey-mcp-test"))
            .expect("HOME must be set");
        let test_root = std::path::Path::new(&test_root_str);
        let test_file = test_root.join("test.txt");
        assert!(
            test_file.exists(),
            "precondition failed: {} does not exist. \
             Run `mkdir -p {} && echo hi > {}` first.",
            test_file.display(),
            test_root.display(),
            test_file.display()
        );

        let which = |c: &str| {
            std::process::Command::new(c)
                .arg("--version")
                .output()
                .is_ok()
        };
        assert!(which("npx"), "npx not on PATH; install Node ≥ 18");

        let hermes_tmp = tempfile::tempdir().expect("tempdir");
        let config_yaml = format!(
            "mcp_servers:\n  fs-test:\n    command: npx\n    args:\n      - -y\n      - \"@modelcontextprotocol/server-filesystem\"\n      - {}\n",
            test_root.display()
        );
        std::fs::write(hermes_tmp.path().join("config.yaml"), config_yaml)
            .expect("write config.yaml");

        std::env::set_var("COREY_HERMES_DIR", hermes_tmp.path());

        let authority = Arc::new(crate::sandbox::PathAuthority::new());
        let cfg = JsonValue::Object(serde_json::Map::from_iter([
            ("server".to_string(), JsonValue::String("fs-test".to_string())),
            ("tool".to_string(), JsonValue::String("read_text_file".to_string())),
            ("params".to_string(), JsonValue::Object(serde_json::Map::from_iter([
                ("path".to_string(), JsonValue::String(test_file.to_string_lossy().to_string())),
            ]))),
            ("timeout_secs".to_string(), JsonValue::Number(serde_json::Number::from(30))),
        ]));
        let runtime_params = JsonValue::Object(serde_json::Map::new());

        let rt = tokio::runtime::Runtime::new().expect("rt");
        let result = rt.block_on(resolve_mcp_source(&cfg, &authority, &runtime_params));

        std::env::remove_var("COREY_HERMES_DIR");

        let value = result.expect("resolve_mcp_source must succeed");
        let text = value
            .as_str()
            .map(String::from)
            .or_else(|| {
                value
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| serde_json::to_string(&value).unwrap_or_default());
        assert!(
            text.contains("B-10"),
            "expected file contents to contain 'B-10' marker, got: {text}"
        );
    }
}
