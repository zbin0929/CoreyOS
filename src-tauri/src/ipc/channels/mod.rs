//! IPC surface for the Phase 3 Channels page. T3.1 ships just the
//! read-only `hermes_channel_list` — it returns the static catalog
//! joined with current disk state:
//!
//!   - Which of each channel's env keys are currently set in
//!     `~/.hermes/.env` (as booleans; values never cross the IPC
//!     boundary).
//!   - Current values for each yaml field, read from
//!     `~/.hermes/config.yaml` by walking `yaml_root` + `path` through
//!     the `serde_yaml::Value` tree.
//!
//! Writes live in `hermes_channel_save` (T3.2): atomic `.env`
//! upserts + YAML field patches under the channel's `yaml_root`.

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_yaml::Value as YamlValue;
use tauri::State;

use crate::channels::{self as cat, CHANNEL_SPECS};

pub mod probe;
use crate::error::{IpcError, IpcResult};
use crate::hermes_config;
use crate::sandbox::{self, PathAuthority};
use crate::state::AppState;

/// One row returned by `hermes_channel_list`. Frontend renders one card
/// per entry; there's no separate "list specs" vs "list state" call
/// because the static catalog is small and this keeps the UI simple.
#[derive(Debug, Serialize)]
pub struct ChannelState {
    /// The static spec, cloned out of the Lazy — serde flattens the
    /// shape so the frontend sees one flat object per channel.
    #[serde(flatten)]
    pub spec: cat::ChannelSpec,
    /// `env_keys[i].name` → whether that key is currently set with a
    /// non-empty value. Parallel to `spec.env_keys` but keyed by name
    /// for robustness against UI reordering.
    pub env_present: std::collections::HashMap<String, bool>,
    /// Current value for each yaml field, resolved through
    /// `yaml_root + "." + path`. Missing / unset fields report `null`.
    /// Stringly-typed via JSON so the frontend can render a generic
    /// "value preview" without knowing field kinds ahead of time.
    pub yaml_values: std::collections::HashMap<String, serde_json::Value>,
}

#[tauri::command]
pub async fn hermes_channel_list(state: State<'_, AppState>) -> IpcResult<Vec<ChannelState>> {
    let authority = state.authority.clone();
    tokio::task::spawn_blocking(move || build_channel_states(&authority))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("channel_list task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("channel_list: {e}"),
        })
}

/// Patch payload for `hermes_channel_save`. Fields omitted from the
/// maps are left untouched on disk — a partial save is normal (e.g.
/// the user toggles `mention_required` without retyping the bot
/// token). The envelope lives in its own struct so specta/ts-codegen
/// has something stable to point at.
#[derive(Debug, Deserialize)]
pub struct ChannelSaveArgs {
    /// Stable slug — must match a `ChannelSpec` in the catalog.
    pub id: String,
    /// Env-key updates by name. `Some("")`/`None` DELETES the key;
    /// `Some(v)` upserts. Only keys declared in the channel's spec
    /// are accepted — anything else is a 400-equiv `Internal` error.
    #[serde(default)]
    pub env_updates: std::collections::HashMap<String, Option<String>>,
    /// YAML field updates keyed by relative dotted path (matching
    /// `YamlFieldSpec.path`). `null` deletes the field.
    #[serde(default)]
    pub yaml_updates: std::collections::HashMap<String, serde_json::Value>,
}

/// Save a channel's credentials + behavior fields.
///
/// Writes happen in two phases, each already atomic via
/// `fs_atomic::atomic_write`:
///   1) `.env` upserts — one call per env key, each journaled as its
///      own `hermes.env.key` entry (consistent with the Phase 2 model
///      page).
///   2) `config.yaml` patch — a single call merging every yaml field
///      update under `yaml_root`, journaled as one
///      `hermes.channel.yaml` entry.
///
/// Returns the refreshed `ChannelState` for this channel only, so the
/// frontend can update its card without re-fetching the whole list.
/// The `hot_reloadable` flag in the response tells the UI whether to
/// prompt for a gateway restart — the backend never restarts on its
/// own (restart is a separate user-confirmed action via
/// `hermes_gateway_restart`).
#[tauri::command]
pub async fn hermes_channel_save(
    args: ChannelSaveArgs,
    state: State<'_, AppState>,
) -> IpcResult<ChannelState> {
    // Validate against the static spec BEFORE we spawn_blocking — cheap
    // and lets us return a clean error without doing any I/O.
    let spec = cat::find_spec(&args.id).ok_or_else(|| IpcError::Internal {
        message: format!("unknown channel id: {}", args.id),
    })?;
    let allowed_env: std::collections::HashSet<&str> =
        spec.env_keys.iter().map(|e| e.name.as_str()).collect();
    for key in args.env_updates.keys() {
        if !allowed_env.contains(key.as_str()) {
            return Err(IpcError::Internal {
                message: format!("env key '{key}' not declared by channel '{}'", args.id),
            });
        }
    }
    let allowed_fields: std::collections::HashSet<&str> =
        spec.yaml_fields.iter().map(|f| f.path.as_str()).collect();
    for path in args.yaml_updates.keys() {
        if !allowed_fields.contains(path.as_str()) {
            return Err(IpcError::Internal {
                message: format!("yaml field '{path}' not declared by channel '{}'", args.id,),
            });
        }
    }
    if spec.yaml_root.is_empty() && !args.yaml_updates.is_empty() {
        return Err(IpcError::Internal {
            message: format!("channel '{}' has no yaml footprint", args.id),
        });
    }

    let journal = state.changelog_path.clone();
    let id = args.id.clone();
    let yaml_root = spec.yaml_root.to_string();
    let authority = state.authority.clone();

    tokio::task::spawn_blocking(move || -> std::io::Result<ChannelState> {
        // 1) .env upserts — one journal entry per key so revert
        //    targets a single credential at a time.
        for (key, val) in &args.env_updates {
            hermes_config::write_env_key(key, val.as_deref(), Some(&journal))?;
        }
        // 2) YAML patch under the channel's root.
        if !args.yaml_updates.is_empty() {
            hermes_config::write_channel_yaml_fields(
                &yaml_root,
                &args.yaml_updates,
                Some(&journal),
            )?;
        }
        // Re-read disk state for the freshened card.
        let all = build_channel_states(&authority)?;
        all.into_iter()
            .find(|c| c.spec.id == id)
            .ok_or_else(|| std::io::Error::other(format!("channel disappeared: {id}")))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("channel_save task join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("channel_save: {e}"),
    })
}

/// Walk the catalog, cross-reference on-disk state. Returns one
/// `ChannelState` per spec, in catalog order (stable across reloads).
fn build_channel_states(authority: &Arc<PathAuthority>) -> std::io::Result<Vec<ChannelState>> {
    // Read the full `.env` keyset once — cheaper than re-reading per
    // channel. We only need a set of known-set names; values are never
    // surfaced.
    let env_keyset = read_nonempty_env_keys(authority).unwrap_or_default();

    // Read the yaml doc once so nested lookups are cheap.
    let yaml_doc = read_config_yaml_value(authority).unwrap_or(YamlValue::Null);

    let mut out = Vec::with_capacity(CHANNEL_SPECS.len());
    for spec in CHANNEL_SPECS.iter() {
        let mut env_present = std::collections::HashMap::new();
        for env in &spec.env_keys {
            env_present.insert(env.name.clone(), env_keyset.contains(&env.name));
        }

        let mut yaml_values = std::collections::HashMap::new();
        for field in &spec.yaml_fields {
            let full_path = if spec.yaml_root.is_empty() {
                field.path.clone()
            } else {
                format!("{}.{}", spec.yaml_root, field.path)
            };
            let v = walk_dotted(&yaml_doc, &full_path)
                .map(yaml_to_json)
                .unwrap_or(serde_json::Value::Null);
            yaml_values.insert(field.path.clone(), v);
        }

        out.push(ChannelState {
            spec: spec.clone(),
            env_present,
            yaml_values,
        });
    }
    Ok(out)
}

/// Parse `~/.hermes/.env` and collect the set of KEY names whose values
/// are non-empty. Symmetric with `read_env_key_names` in
/// `hermes_config.rs` but without the `*_API_KEY` filter — channels use
/// token-style names (`TELEGRAM_BOT_TOKEN`, `MATRIX_ACCESS_TOKEN`, …).
fn read_nonempty_env_keys(
    authority: &PathAuthority,
) -> std::io::Result<std::collections::HashSet<String>> {
    let path = env_path()?;
    let raw = match sandbox::fs::read_to_string_blocking(authority, &path) {
        Ok(s) => s,
        // Missing .env is a valid "none configured yet" state; surface
        // as an empty set rather than bubbling the error up to the UI.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Default::default()),
        Err(e) => return Err(e),
    };
    let mut out = std::collections::HashSet::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let mut value = value.trim();
        // Strip surrounding quotes, matching hermes_config's convention.
        if (value.starts_with('"') && value.ends_with('"')) && value.len() >= 2 {
            value = &value[1..value.len() - 1];
        }
        if !value.is_empty() {
            out.insert(key.to_string());
        }
    }
    Ok(out)
}

fn env_path() -> std::io::Result<std::path::PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "neither $HOME nor %USERPROFILE% set",
            )
        })?;
    Ok(Path::new(&home).join(".hermes/.env"))
}

fn read_config_yaml_value(authority: &PathAuthority) -> std::io::Result<YamlValue> {
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

/// Walk a dotted path through a `serde_yaml::Value`. Returns `Some`
/// only when every segment is a key in a mapping and the final
/// segment resolves. Non-mapping intermediate values abort the walk —
/// we never auto-coerce through a list or scalar.
fn walk_dotted<'a>(doc: &'a YamlValue, path: &str) -> Option<&'a YamlValue> {
    let mut cur = doc;
    for segment in path.split('.') {
        let map = cur.as_mapping()?;
        cur = map.get(YamlValue::String(segment.to_string()))?;
    }
    Some(cur)
}

/// Translate a YAML value to a JSON value for the IPC boundary. Most
/// kinds map cleanly; Tags, Aliases, etc. fall through as strings.
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
                // Only serialize string-keyed entries — non-string keys
                // aren't representable in JSON anyway.
                if let YamlValue::String(sk) = k {
                    o.insert(sk.clone(), yaml_to_json(v));
                }
            }
            serde_json::Value::Object(o)
        }
        YamlValue::Tagged(t) => yaml_to_json(&t.value),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ChannelQrSetupResult {
    pub qr_url: Option<String>,
    pub qr_data: Option<String>,
    pub status: String,
    pub message: String,
}

#[tauri::command]
pub async fn hermes_channel_setup_qr(channel_id: String) -> IpcResult<ChannelQrSetupResult> {
    tokio::task::spawn_blocking(move || {
        let supported = ["whatsapp", "weixin", "dingtalk", "qq"];
        if !supported.contains(&channel_id.as_str()) {
            return Err(IpcError::Internal {
                message: format!("QR login not supported for channel '{}'", channel_id),
            });
        }
        run_qr_login(&channel_id)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("hermes_channel_setup_qr join: {e}"),
    })?
}

fn run_qr_login(channel_id: &str) -> IpcResult<ChannelQrSetupResult> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    let hermes_home = crate::paths::hermes_data_dir().map_err(|e| IpcError::Internal {
        message: format!("hermes data dir: {e}"),
    })?;

    let session_dir = std::env::temp_dir().join("corey-qr-session");
    std::fs::create_dir_all(&session_dir).ok();
    let session_file = session_dir.join(format!("{channel_id}.json"));

    if session_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&session_file) {
            if let Ok(session) = serde_json::from_str::<serde_json::Value>(&content) {
                let s = session.get("status").and_then(|v| v.as_str()).unwrap_or("");
                match s {
                    "done" => {
                        let _ = std::fs::remove_file(&session_file);
                        if let Some(env) = session.get("env").and_then(|v| v.as_object()) {
                            let env_file = hermes_home.join(".env");
                            let mut env_content =
                                std::fs::read_to_string(&env_file).unwrap_or_default();
                            for (k, v) in env {
                                if let Some(val) = v.as_str() {
                                    let pattern = format!("{}=", k);
                                    if env_content.lines().any(|l| l.starts_with(&pattern)) {
                                        env_content = env_content
                                            .lines()
                                            .map(|l| {
                                                if l.starts_with(&pattern) {
                                                    format!("{}={}", k, val)
                                                } else {
                                                    l.to_string()
                                                }
                                            })
                                            .collect::<Vec<_>>()
                                            .join("\n");
                                    } else {
                                        if !env_content.ends_with('\n') {
                                            env_content.push('\n');
                                        }
                                        env_content.push_str(&format!("{}={}\n", k, val));
                                    }
                                }
                            }
                            if let Err(e) = std::fs::write(&env_file, &env_content) {
                                tracing::error!("qr-login: failed to write .env: {e}");
                            }
                        }
                        return Ok(ChannelQrSetupResult {
                            qr_url: None,
                            qr_data: None,
                            status: "done".to_string(),
                            message: "QR scan successful".to_string(),
                        });
                    }
                    _ => {
                        let _ = std::fs::remove_file(&session_file);
                    }
                }
            } else {
                let _ = std::fs::remove_file(&session_file);
            }
        } else {
            let _ = std::fs::remove_file(&session_file);
        }
    }

    let venv_python = hermes_home
        .join("hermes-agent")
        .join("venv")
        .join("bin")
        .join("python3");
    let python = if venv_python.exists() {
        venv_python
    } else {
        std::path::PathBuf::from("python3")
    };

    let script_src = include_str!("../../../assets/scripts/qr-login.py");
    let script_dir = std::env::temp_dir().join("corey-qr-login");
    std::fs::create_dir_all(&script_dir).map_err(|e| IpcError::Internal {
        message: format!("create temp dir: {e}"),
    })?;
    let script_path = script_dir.join("qr-login.py");
    std::fs::write(&script_path, script_src).map_err(|e| IpcError::Internal {
        message: format!("write qr-login script: {e}"),
    })?;

    let mut cmd = std::process::Command::new(&python);
    cmd.arg(&script_path)
        .arg(channel_id)
        .arg(&session_dir)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::hermes_config::inject_hermes_home(&mut cmd);
    crate::hermes_config::suppress_window(&mut cmd);

    tracing::info!("qr-login: python={:?}, channel={}", python, channel_id);

    let mut child = cmd.spawn().map_err(|e| IpcError::Internal {
        message: format!("spawn qr-login.py: {e}"),
    })?;

    let stdout = child.stdout.take().ok_or_else(|| IpcError::Internal {
        message: "failed to capture stdout".to_string(),
    })?;

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                tracing::info!("qr-login stderr: {}", &line[..line.len().min(200)]);
            }
        });
    }

    let reader = BufReader::new(stdout);
    let mut result_qr: Option<String> = None;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    for line in reader.lines() {
        if std::time::Instant::now() > deadline {
            break;
        }
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        tracing::info!("qr-login stdout: {}", &line[..line.len().min(200)]);
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            match json.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "qr" => {
                    if let Some(data) = json.get("data").and_then(|v| v.as_str()) {
                        result_qr = Some(data.to_string());
                    }
                    break;
                }
                "error" => {
                    let msg = json
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(ChannelQrSetupResult {
                        qr_url: None,
                        qr_data: None,
                        status: "error".to_string(),
                        message: msg.to_string(),
                    });
                }
                _ => {}
            }
        }
    }

    if let Some(qr) = result_qr {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        return Ok(ChannelQrSetupResult {
            qr_url: None,
            qr_data: Some(qr),
            status: "pending".to_string(),
            message: String::new(),
        });
    }

    let _ = child.kill();
    let _ = child.wait();

    if session_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&session_file) {
            if let Ok(session) = serde_json::from_str::<serde_json::Value>(&content) {
                let msg = session
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Failed to get QR");
                return Ok(ChannelQrSetupResult {
                    qr_url: None,
                    qr_data: None,
                    status: "error".to_string(),
                    message: msg.to_string(),
                });
            }
        }
    }

    Ok(ChannelQrSetupResult {
        qr_url: None,
        qr_data: None,
        status: "error".to_string(),
        message: "No QR data received".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walk_dotted_resolves_nested_keys_and_returns_none_on_miss() {
        let doc: YamlValue = serde_yaml::from_str(
            r#"
channels:
  telegram:
    mention_required: true
    reactions: false
"#,
        )
        .unwrap();

        let got = walk_dotted(&doc, "channels.telegram.mention_required").unwrap();
        assert_eq!(got, &YamlValue::Bool(true));

        assert!(walk_dotted(&doc, "channels.telegram.missing").is_none());
        assert!(walk_dotted(&doc, "channels.discord").is_none());
    }

    #[test]
    fn yaml_to_json_covers_scalars_sequences_and_mappings() {
        let doc: YamlValue = serde_yaml::from_str(
            r#"
b: true
n: 42
s: hi
seq: [1, 2, "three"]
map:
  inner: true
"#,
        )
        .unwrap();
        let j = yaml_to_json(&doc);
        assert_eq!(j["b"], serde_json::json!(true));
        assert_eq!(j["n"], serde_json::json!(42));
        assert_eq!(j["s"], serde_json::json!("hi"));
        assert_eq!(j["seq"], serde_json::json!([1, 2, "three"]));
        assert_eq!(j["map"]["inner"], serde_json::json!(true));
    }
}
