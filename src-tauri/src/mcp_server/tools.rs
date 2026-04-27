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
///
/// Naming convention: tool names are SHORT and unprefixed (`notify`,
/// not `corey_native.notify`). Hermes' MCP client wraps every remote
/// tool with `mcp_<server_name>_` automatically — so what shows up
/// in the agent's tool catalog is `mcp_corey_native_notify`, not
/// `mcp_corey_native_corey_native_notify`. The earlier draft had the
/// name field redundantly prefixed with `corey_native.`, which got
/// double-prefixed and burned 3-4 LLM round-trips per invocation
/// while the model played name-guessing games before settling on the
/// mangled form. Single source of namespacing → first-call hit rate.
pub fn manifest() -> Vec<Value> {
    vec![
        json!({
            "name": "notify",
            // Description tuned for bilingual tool-selection. The
            // earlier draft said "Show a native OS notification" and
            // DeepSeek-zh consistently misread Chinese requests like
            // "发个通知" / "提醒我一下" as "draft a notification
            // document" rather than "trigger a system toast", because
            // 通知 is overloaded in Chinese (notification vs memo).
            // Three rhetorical moves fix this:
            //   1. Lead with the *physical effect* ("Pop a desktop
            //      toast on the user's screen") so the model sees
            //      this is a system call, not a writing task.
            //   2. Enumerate trigger phrases EN + ZH so token-by-
            //      token attention has direct anchors.
            //   3. Anti-list ("NOT for...") to suppress the
            //      doc-drafting interpretation explicitly.
            "description": "Pop a native desktop notification \
                (system toast) on the user's screen. The user sees a \
                small banner outside the chat window, like a Slack \
                ping or macOS Calendar reminder. \n\n\
                Trigger when the user asks to: \"send a desktop \
                notification\", \"show a toast\", \"ping me\", \"alert \
                me when X is done\", \"remind me\"; or in Chinese: \
                \"发个桌面通知\", \"弹个系统通知\", \"提醒我\", \
                \"在桌面提示我\", \"通知我一下\", \"任务完成时叫我\". \n\n\
                NOT for drafting announcement text, writing a memo, \
                or composing a notification document — for those, \
                just reply with the drafted content in chat. This \
                tool only fires the OS-level banner.\n\n\
                Example: user says \"任务完成时通知我\" → call \
                `notify(title=\"任务完成\", body=\"...\")`.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Short headline shown in bold (e.g. \"调研完成\" / \"Build OK\"). Max ~40 chars before the OS truncates."
                    },
                    "body": {
                        "type": "string",
                        "description": "Optional one-line detail under the title. Max ~200 chars."
                    }
                },
                "required": ["title"]
            }
        }),
        json!({
            "name": "pick_file",
            // Bilingual triggers + clarification that this is a
            // BLOCKING dialog (model should not call it without a
            // user-facing reason — e.g. mid-monologue surprises).
            "description": "Open the native OS file-picker dialog and \
                return the absolute path the user selects. Returns \
                `{path: null, cancelled: true}` if the user cancels. \n\n\
                Trigger when the user asks to: \"pick a file\", \
                \"choose a file\", \"open file dialog\", \"browse for \
                a file\", \"let me select...\"; or in Chinese: \
                \"选个文件\", \"打开文件选择器\", \"让我选个文件\", \
                \"挑一个 X 文件\". \n\n\
                Also use proactively when you need a file from the \
                user that's hard to describe in chat (e.g. \"the PDF \
                you mentioned\"), or when the path likely lives \
                outside any workspace root the agent already knows.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Dialog title (e.g. \"Choose your resume\" / \"选择简历\"). Optional. macOS hides this; Windows/Linux show it."
                    },
                    "extensions": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Restrict to file extensions, no leading dot (e.g. [\"png\",\"jpg\"] or [\"pdf\"]). Empty/omitted = any file type."
                    }
                }
            }
        }),
        json!({
            "name": "pick_folder",
            "description": "Open the native OS folder-picker dialog \
                and return the absolute path the user selects. \
                Returns `{path: null, cancelled: true}` if the user \
                cancels.\n\n\
                Trigger when the user asks to: \"pick a folder\", \
                \"choose a directory\", \"select working directory\"; \
                or in Chinese: \"选个文件夹\", \"打开目录选择器\", \
                \"让我选个工作目录\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Dialog title (e.g. \"Pick a project root\" / \"选择项目根目录\"). Optional."
                    }
                }
            }
        }),
        json!({
            "name": "open_settings",
            "description": "Deep-link the Corey desktop GUI to a \
                specific Settings panel. The user's window will \
                switch to that panel immediately.\n\n\
                Trigger when the agent determines the user must \
                configure something to proceed: missing API key, \
                disabled channel, sandbox scope needs adjustment, \
                profile not set up, etc. \n\n\
                Phrase examples — EN: \"open settings\", \"go to \
                model config\", \"take me to channel settings\". \
                ZH: \"打开设置\", \"跳到模型配置\", \"去渠道设置\", \
                \"打开沙盒页面\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "panel": {
                        "type": "string",
                        "description": "Panel id matching a Settings sidebar entry. Known values: \"models\" (LLM providers/keys), \"channels\" (input/output channels), \"sandbox\" (filesystem scopes), \"agents\" (Hermes adapters), \"profile\" (user info), \"about\"."
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
        // Match SHORT names — these are what `manifest()` advertises
        // and what Hermes will pass back here in `tools/call`.
        "notify" => notify(app, args).await?,
        "pick_file" => pick_file(app, args).await?,
        "pick_folder" => pick_folder(app, args).await?,
        "open_settings" => open_settings(app, args).await?,
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
