//! MCP tool catalog for the `corey-native` server.
//!
//! Each tool is a `(name, schema, handler)` triple. Adding one is a
//! ~30-line dance: register in `manifest()`, branch in `call()`,
//! implement the handler with explicit input/output JSON shapes.
//! Schemas are JSON Schema draft 2020-12 — Hermes' MCP client uses
//! them to render tool-call forms and validate args before sending.
//!
//! Tools available today
//! ---------------------
//!   - `corey_native.notify`       — desktop notification (toast).
//!   - `corey_native.pick_file`    — native Finder file picker (single).
//!   - `corey_native.pick_folder`  — native Finder folder picker.
//!   - `corey_native.open_settings`— deep-link the GUI to a Settings
//!                                    panel by id.
//!
//! The `corey_native.` prefix is a namespacing convention picked up by
//! Hermes' tool selector so users can scope-disable us with one tag
//! (`hermes tools disable corey-native:*`) without having to enumerate.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

/// Static tool manifest returned by `tools/list`. JSON-Schema is
/// hand-written rather than derived because the schema is the user's
/// contract — a `serde::Serialize` derive would silently change it
/// when Rust struct fields are reordered.
pub fn manifest() -> Vec<Value> {
    vec![
        json!({
            "name": "corey_native.notify",
            "description": "Show a native OS notification (toast). Use \
                this when the user is likely in another application and \
                a long-running task just finished, or when an event \
                deserves attention but not a chat message.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Short headline (e.g. \"调研完成\"). Max ~40 chars before OS truncates."
                    },
                    "body": {
                        "type": "string",
                        "description": "One-line detail. Optional. Max ~200 chars."
                    }
                },
                "required": ["title"]
            }
        }),
        json!({
            "name": "corey_native.pick_file",
            "description": "Show a native file-open dialog and return \
                the absolute path the user picked. Returns \
                `{path: null}` if the user cancelled. Use this when you \
                need a file from the user that's hard to describe in \
                chat, or when the path likely lives outside any \
                workspace root.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Dialog title. Optional. macOS hides this; Windows / Linux show it."
                    },
                    "extensions": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Restrict to extensions (e.g. [\"png\",\"jpg\"]). Empty = any."
                    }
                }
            }
        }),
        json!({
            "name": "corey_native.pick_folder",
            "description": "Show a native folder-open dialog and return \
                the absolute path the user picked. Returns \
                `{path: null}` if the user cancelled.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Dialog title. Optional."
                    }
                }
            }
        }),
        json!({
            "name": "corey_native.open_settings",
            "description": "Switch the Corey GUI to a specific Settings \
                panel. Use when the agent has determined the user must \
                configure something to proceed (e.g. add an API key, \
                enable a channel). The panel id corresponds to the \
                `id` of an entry in the Settings sidebar.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "panel": {
                        "type": "string",
                        "description": "Panel id. Known: \"models\", \"channels\", \"sandbox\", \"agents\", \"profile\", \"about\"."
                    }
                },
                "required": ["panel"]
            }
        }),
    ]
}

/// Dispatch a `tools/call` request. Hermes sends:
///   `{ name: "corey_native.notify", arguments: { title: "...", body: "..." } }`
/// and expects a `{ content: [{type: "text", text: "..."}] }`-style
/// reply per the MCP spec. We wrap a single text payload — that keeps
/// every tool's surface predictable, and Hermes happily renders the
/// text into the agent's working context.
pub async fn call(app: AppHandle, params: &Value) -> Result<Value, (i32, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((-32602, "missing `name`".into()))?;
    let args = params.get("arguments").cloned().unwrap_or(Value::Null);

    let text = match name {
        "corey_native.notify" => notify(app, args).await?,
        "corey_native.pick_file" => pick_file(app, args).await?,
        "corey_native.pick_folder" => pick_folder(app, args).await?,
        "corey_native.open_settings" => open_settings(app, args).await?,
        _ => return Err((-32601, format!("unknown tool: {name}"))),
    };

    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "isError": false,
    }))
}

#[derive(Debug, Deserialize, Default)]
struct NotifyArgs {
    title: String,
    #[serde(default)]
    body: Option<String>,
}

async fn notify(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    let args: NotifyArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid notify args: {e}")))?;

    let mut builder = app.notification().builder().title(args.title.clone());
    if let Some(body) = args.body.as_deref().filter(|b| !b.is_empty()) {
        builder = builder.body(body);
    }
    builder
        .show()
        .map_err(|e| (-32603, format!("notification failed: {e}")))?;

    Ok(format!(
        "Notification posted: {}",
        if let Some(b) = args.body {
            format!("{} — {}", args.title, b)
        } else {
            args.title
        }
    ))
}

#[derive(Debug, Deserialize, Default)]
struct PickFileArgs {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    extensions: Vec<String>,
}

async fn pick_file(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    // serde_json::from_value of Null -> default-construct via #[derive(Default)].
    let args: PickFileArgs = if args.is_null() {
        PickFileArgs::default()
    } else {
        serde_json::from_value(args)
            .map_err(|e| (-32602, format!("invalid pick_file args: {e}")))?
    };

    // Tauri's dialog plugin exposes both blocking and async variants.
    // We use the channel-based async form so the axum task isn't
    // blocked while the user thinks. If the user cancels (closes the
    // dialog) we get `None`.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(title) = args.title.as_deref().filter(|t| !t.is_empty()) {
        dialog = dialog.set_title(title);
    }
    let exts: Vec<&str> = args.extensions.iter().map(String::as_str).collect();
    if !exts.is_empty() {
        dialog = dialog.add_filter("Allowed", &exts);
    }
    dialog.pick_file(move |path| {
        let _ = tx.send(path);
    });

    let picked = rx
        .await
        .map_err(|e| (-32603, format!("pick_file channel: {e}")))?;
    Ok(match picked {
        Some(p) => json!({ "path": p.to_string() }).to_string(),
        None => json!({ "path": null, "cancelled": true }).to_string(),
    })
}

#[derive(Debug, Deserialize, Default)]
struct PickFolderArgs {
    #[serde(default)]
    title: Option<String>,
}

async fn pick_folder(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    let args: PickFolderArgs = if args.is_null() {
        PickFolderArgs::default()
    } else {
        serde_json::from_value(args)
            .map_err(|e| (-32602, format!("invalid pick_folder args: {e}")))?
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(title) = args.title.as_deref().filter(|t| !t.is_empty()) {
        dialog = dialog.set_title(title);
    }
    dialog.pick_folder(move |path| {
        let _ = tx.send(path);
    });

    let picked = rx
        .await
        .map_err(|e| (-32603, format!("pick_folder channel: {e}")))?;
    Ok(match picked {
        Some(p) => json!({ "path": p.to_string() }).to_string(),
        None => json!({ "path": null, "cancelled": true }).to_string(),
    })
}

#[derive(Debug, Deserialize)]
struct OpenSettingsArgs {
    panel: String,
}

async fn open_settings(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    let args: OpenSettingsArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid open_settings args: {e}")))?;

    // Soft-validate the panel id against the known set. Unknown ids
    // still get forwarded to the frontend (the router will 404 in the
    // GUI itself, which is more user-visible than a silent no-op).
    const KNOWN: &[&str] = &[
        "models", "channels", "sandbox", "agents", "profile", "about",
    ];
    let warning = if KNOWN.contains(&args.panel.as_str()) {
        ""
    } else {
        " (warning: unknown panel id; the GUI may show a 404)"
    };

    // Emit a Tauri event the renderer subscribes to. The frontend
    // listener (in `src/app/router/...`) calls `navigate({to:
    // "/settings/<panel>"})`. Doing it via event keeps backend
    // ignorant of frontend route shape — the GUI owns its own URL
    // structure and we just whisper "go look at panel X".
    use tauri::Emitter;
    app.emit("corey_native:open_settings", &args.panel)
        .map_err(|e| (-32603, format!("emit open_settings: {e}")))?;

    Ok(format!(
        "Asked Corey GUI to switch to Settings → {}{}.",
        args.panel, warning
    ))
}
