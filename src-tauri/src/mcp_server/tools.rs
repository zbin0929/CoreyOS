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
//!   - `corey_native.notify`         — desktop notification (toast).
//!   - `corey_native.pick_file`      — native Finder file picker (single).
//!   - `corey_native.pick_folder`    — native Finder folder picker.
//!   - `corey_native.open_settings`  — deep-link the GUI to a Settings panel.
//!   - `corey_native.list_workflows` — enumerate user-defined workflows.
//!   - `corey_native.run_workflow`   — trigger a workflow run by id, returns run_id.
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
            "name": "list_workflows",
            "description": "List the user's saved Corey workflows. \
                Returns each workflow's id, name, description, and \
                declared inputs (so the agent can decide whether to \
                ask the user for parameters before running). \n\n\
                Trigger when the user asks: \"what workflows do I \
                have\", \"list my automations\", \"what can I run\", \
                \"show workflows\"; or in Chinese: \"有哪些工作流\", \
                \"我的自动化\", \"列出 workflow\", \"我能跑什么\". \n\n\
                Also use proactively when a user request matches a \
                multi-step procedure shape (\"促销审批\", \"代码 \
                review\", \"日报汇总\") — list first, then call \
                `run_workflow` with the matched id.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "run_workflow",
            "description": "Start a Corey workflow run by id. Returns \
                immediately with the new run's id; execution \
                continues asynchronously and the user watches it in \
                the Workflow page. \n\n\
                Trigger when the user explicitly names a workflow \
                (\"run the promo approval flow\", \"跑一下电商促销 \
                审批\") OR when their goal cleanly matches one of \
                the workflows returned by `list_workflows` (audit \
                trail + human approval semantics imply the user \
                wants a workflow, not raw chat). \n\n\
                Pass the workflow's declared inputs as a flat object \
                under `inputs`. If the user didn't specify required \
                fields, ASK in chat first — workflows that pause on \
                an empty input render confusing approval cards.\n\n\
                NOT for one-off chats; for those, just answer in chat \
                directly. Workflows are for repeatable, audited \
                procedures.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "The workflow id from `list_workflows` (e.g. \"ecommerce-promotion-approval\"). Case-sensitive; must match exactly."
                    },
                    "inputs": {
                        "type": "object",
                        "description": "Run-time inputs declared by the workflow's `inputs:` section. Pass {} when the workflow takes no inputs.",
                        "additionalProperties": true
                    }
                },
                "required": ["workflow_id"]
            }
        }),
        json!({
            "name": "list_skills",
            "description": "List every skill the user has installed in Corey \
                (skill packs + custom). Each skill is a named, versioned, \
                executable bundle the agent can invoke when its built-in \
                knowledge isn't enough for a domain task.\n\n\
                Trigger when the user asks \"what skills do I have\" / \
                \"can you do X for me\" — check the list before answering \
                so you can name a real skill instead of guessing. \
                Phrase examples — EN: \"list my skills\", \"what skills \
                are installed\". ZH: \"我有哪些技能\", \"列出已安装技能\".",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "list_chat_sessions",
            "description": "List the user's recent chat sessions (id, \
                title, last activity, message count). Useful when the \
                user references a past conversation by topic — you can \
                find it instead of asking them to retype context.\n\n\
                Default returns the 20 most recent. Phrase examples — EN: \
                \"find my chat about X\", \"list recent conversations\". \
                ZH: \"找一下之前关于 X 的对话\", \"列出最近的对话\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "How many sessions to return (1-100, default 20)."
                    }
                }
            }
        }),
        json!({
            "name": "read_memory",
            "description": "Read one of Corey's memory files. There are \
                two: `agent` (~/.hermes/MEMORY.md, where you write notes \
                to your future self) and `user` (~/.hermes/USER.md, the \
                user's profile / preferences they typed into Settings).\n\n\
                Trigger before answering personal questions (\"what's my \
                X\" / \"do you remember Y\") so you can ground the answer \
                in real notes instead of guessing. \
                Phrase examples — EN: \"do you remember\", \"check your \
                notes\". ZH: \"还记得吗\", \"查一下你的笔记\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["agent", "user"],
                        "description": "`agent` = your own MEMORY.md notes; `user` = the user's USER.md profile."
                    }
                },
                "required": ["kind"]
            }
        }),
        json!({
            "name": "append_memory",
            "description": "Append a fact to Corey's MEMORY.md (your \
                own notes). Use this AFTER the user explicitly tells \
                you to remember something, OR when you've discovered \
                a stable fact about the user / their workspace that \
                will matter on later turns. Each call appends one \
                dated `## [auto] YYYY-MM-DD` block.\n\n\
                Do NOT spam — the file has a 256 KB cap. Skip if the \
                fact is short-lived or already in MEMORY.md.\n\n\
                Phrase examples that should trigger — EN: \"remember \
                that I prefer X\", \"note for next time\". \
                ZH: \"记住我喜欢 X\", \"下次记得 Y\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fact": {
                        "type": "string",
                        "description": "The fact to remember, in one or two short bullet points. Don't dump full conversations."
                    }
                },
                "required": ["fact"]
            }
        }),
        json!({
            "name": "list_active_runs",
            "description": "List currently-running workflows (id, \
                workflow_id, status, started_at). Use after \
                `run_workflow` to confirm the run kicked off, or when \
                the user asks \"what's running right now\".\n\n\
                Phrase examples — EN: \"what's running\", \"show \
                active jobs\". ZH: \"正在跑什么\", \"看一下任务\".",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "cancel_run",
            "description": "Cancel a running workflow by its run_id. \
                The current step finishes (don't kill mid-LLM call — \
                wastes tokens) then the engine exits cleanly. Use \
                when the user says \"stop\" / \"cancel\" referencing \
                a known run.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "run_id": {
                        "type": "string",
                        "description": "Run id from `list_active_runs` or the response of `run_workflow`."
                    }
                },
                "required": ["run_id"]
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
        "list_workflows" => list_workflows(app).await?,
        "run_workflow" => run_workflow(app, args).await?,
        // Expanded surface (user requirement: "all operations via dialog").
        // Each handler reuses an existing IPC's pure logic; nothing new
        // ships through Hermes Agent itself.
        "list_skills" => list_skills().await?,
        "list_chat_sessions" => list_chat_sessions(app, args).await?,
        "read_memory" => read_memory(args).await?,
        "append_memory" => append_memory(args).await?,
        "list_active_runs" => list_active_runs(app).await?,
        "cancel_run" => cancel_run(app, args).await?,
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
    let args: NotifyArgs =
        serde_json::from_value(args).map_err(|e| (-32602, format!("invalid notify args: {e}")))?;

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

// ───────────────────────── workflow tools ─────────────────────────
//
// Bridge MCP → the workflow IPC layer. We DON'T re-invoke `tauri::command`
// handlers from here — those route through Tauri's IPC pipe and need
// State<'_> bindings that aren't available in the axum context. Instead
// we reach into AppState directly via `app.state::<AppState>()` and call
// the same backend primitives the IPC handlers wrap.

async fn list_workflows(app: AppHandle) -> Result<String, (i32, String)> {
    use crate::state::AppState;
    use tauri::Manager;

    // We don't actually need AppState here — `store::list` reads
    // straight from `~/.hermes/workflows/`. But we keep the Manager
    // import + state lookup for symmetry with `run_workflow`, so
    // future changes that need state (e.g. filter by user) don't
    // have to thread it back in.
    let _state = app.state::<AppState>();
    let payload = tokio::task::spawn_blocking(|| -> Result<Value, String> {
        let defs = crate::workflow::store::list().map_err(|e| format!("list: {e}"))?;
        let items: Vec<Value> = defs
            .into_iter()
            .map(|d| {
                let inputs: Vec<Value> = d
                    .inputs
                    .iter()
                    .map(|i| {
                        json!({
                            "name": i.name,
                            "label": i.label,
                            "type": i.input_type,
                            "required": i.required,
                            "default": i.default,
                        })
                    })
                    .collect();
                json!({
                    "id": d.id,
                    "name": d.name,
                    "description": d.description,
                    "inputs": inputs,
                })
            })
            .collect();
        Ok(json!({ "workflows": items }))
    })
    .await
    .map_err(|e| (-32603, format!("list_workflows join: {e}")))?
    .map_err(|e| (-32603, e))?;

    Ok(payload.to_string())
}

#[derive(Debug, Deserialize)]
struct RunWorkflowArgs {
    workflow_id: String,
    inputs: Option<Value>,
}

async fn run_workflow(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    let args: RunWorkflowArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid run_workflow args: {e}")))?;
    let workflow_id = args.workflow_id.clone();
    let inputs = args.inputs.unwrap_or(Value::Object(Default::default()));

    let run_id = start_workflow_run(&app, &workflow_id, inputs).await?;

    Ok(json!({
        "run_id": run_id,
        "workflow_id": workflow_id,
        "status": "started",
        "ui_path": "/workflow",
    })
    .to_string())
}

/// **Shared workflow start helper.** Used by `run_workflow` (MCP
/// tool, JSON-RPC entry) and `webhook` (B-10.7 HTTP entry) so a
/// fix in any of the boot dance (def load → cancel-flag alloc →
/// initial persist → spawn) lands in both call paths.
///
/// Returns the new run id on success, `(rpc_code, message)` on
/// failure where the rpc_code is JSON-RPC compatible
/// (-32602 = invalid params, -32603 = internal). HTTP callers
/// translate those to 400 / 500 respectively.
pub(crate) async fn start_workflow_run(
    app: &AppHandle,
    workflow_id: &str,
    inputs: Value,
) -> Result<String, (i32, String)> {
    use crate::state::AppState;
    use crate::workflow::engine;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tauri::Manager;

    let state = app.state::<AppState>();
    let runs = state.workflow_runs.clone();
    let adapters = state.adapters.clone();
    let authority = state.authority.clone();
    let db = state.db.clone();
    let cancel_flags = state.workflow_cancel_flags.clone();

    // Same shape as `workflow_run` IPC: load def, allocate run +
    // cancel flag, persist initial state, then hand off to the
    // shared executor spawn helper. We do this off the axum task's
    // current thread so a slow disk read doesn't park other MCP
    // requests behind us.
    let (run_id, def) = tokio::task::spawn_blocking({
        let workflow_id = workflow_id.to_string();
        move || -> Result<(String, crate::workflow::model::WorkflowDef), String> {
            let def = crate::workflow::store::get(&workflow_id)
                .map_err(|e| format!("workflow not found: {e}"))?;
            Ok((uuid::Uuid::new_v4().to_string(), def))
        }
    })
    .await
    .map_err(|e| (-32603, format!("run_workflow join: {e}")))?
    .map_err(|e| (-32602, e))?;

    let (mut run, ctx) = engine::create_initial_run(&def, inputs);
    run.id = run_id.clone();
    let mut owned_run = run;
    if let Some(db) = db.as_ref() {
        owned_run.updated_at_ms = chrono::Utc::now().timestamp_millis();
        let _ = db.upsert_workflow_run(&owned_run);
    }
    runs.lock().insert(run_id.clone(), owned_run);

    let cancel_flag: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    cancel_flags
        .lock()
        .insert(run_id.clone(), cancel_flag.clone());

    crate::ipc::workflow::spawn_run_executor(
        runs,
        adapters,
        authority,
        db,
        def,
        run_id.clone(),
        ctx,
        cancel_flag,
    );

    Ok(run_id)
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

// ── Expanded surface ─────────────────────────────────────────────
//
// Each function below is a thin wrapper over an existing IPC's pure
// logic, exposing it under the MCP `tools/call` surface so Hermes
// Agent can drive it from chat. Matches the user's "all operations
// via dialog" requirement; no Hermes Agent code is touched.

async fn list_skills() -> Result<String, (i32, String)> {
    let summaries = tokio::task::spawn_blocking(|| crate::skills::list().unwrap_or_default())
        .await
        .map_err(|e| (-32603, format!("list_skills join: {e}")))?;
    let items: Vec<Value> = summaries
        .into_iter()
        .map(|s| {
            json!({
                "path": s.path,
                "name": s.name,
                "group": s.group,
                "description": s.description,
            })
        })
        .collect();
    Ok(json!({ "skills": items }).to_string())
}

#[derive(Debug, Deserialize, Default)]
struct ListSessionsArgs {
    #[serde(default)]
    limit: Option<u32>,
}

async fn list_chat_sessions(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    use crate::adapters::SessionQuery;
    use crate::state::AppState;
    use tauri::Manager;

    let parsed: ListSessionsArgs = serde_json::from_value(args).unwrap_or_default();
    let limit = parsed.limit.unwrap_or(20).clamp(1, 100);

    let state = app.state::<AppState>();
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or((-32603, "no default adapter registered".into()))?;

    // Reuse the same SessionQuery the GUI passes via session_list,
    // so the agent sees an identical view to what the user sees in
    // the recent-sessions sidebar.
    let sessions = adapter
        .list_sessions(SessionQuery {
            source: None,
            limit: Some(limit),
            search: None,
        })
        .await
        .map_err(|e| (-32603, format!("list_sessions: {e}")))?;

    let items: Vec<Value> = sessions
        .into_iter()
        .map(|s| {
            json!({
                "id": s.id,
                "title": s.title,
                "model": s.model_id,
                "last_message_at": s.last_message_at.to_rfc3339(),
                "created_at": s.created_at.to_rfc3339(),
                "is_live": s.is_live,
                "adapter_id": s.adapter_id,
            })
        })
        .collect();
    Ok(json!({ "sessions": items }).to_string())
}

#[derive(Debug, Deserialize)]
struct ReadMemoryArgs {
    kind: String,
}

async fn read_memory(args: Value) -> Result<String, (i32, String)> {
    let args: ReadMemoryArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid read_memory args: {e}")))?;
    let file_name = match args.kind.as_str() {
        "agent" => "MEMORY.md",
        "user" => "USER.md",
        other => {
            return Err((
                -32602,
                format!("kind must be 'agent' or 'user', got '{other}'"),
            ))
        }
    };

    let kind_label = args.kind.clone();
    let content = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let path = crate::paths::hermes_data_dir()
            .map_err(|e| format!("resolve dir: {e}"))?
            .join(file_name);
        match std::fs::read_to_string(&path) {
            Ok(s) => Ok(s),
            Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(e) => Err(format!("read {file_name}: {e}")),
        }
    })
    .await
    .map_err(|e| (-32603, format!("read_memory join: {e}")))?
    .map_err(|e| (-32603, e))?;

    Ok(json!({
        "kind": kind_label,
        "content": content,
        "bytes": content.len(),
    })
    .to_string())
}

#[derive(Debug, Deserialize)]
struct AppendMemoryArgs {
    fact: String,
}

async fn append_memory(args: Value) -> Result<String, (i32, String)> {
    let args: AppendMemoryArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid append_memory args: {e}")))?;
    let trimmed = args.fact.trim();
    if trimmed.is_empty() {
        return Err((-32602, "fact must not be empty".into()));
    }

    let block = format!(
        "\n\n## [auto] {}\n- {}\n",
        chrono::Utc::now().format("%Y-%m-%d"),
        trimmed.replace('\n', "\n- "),
    );
    let written_len = block.len();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let path = crate::paths::hermes_data_dir()
            .map_err(|e| format!("resolve dir: {e}"))?
            .join("MEMORY.md");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        }
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let next = format!("{existing}{block}");
        if next.len() as u64 > crate::ipc::memory::MEMORY_MAX_BYTES {
            return Err(
                "MEMORY.md would exceed 256 KB cap; run /memory cleanup first".into(),
            );
        }
        std::fs::write(&path, next.as_bytes()).map_err(|e| format!("write: {e}"))
    })
    .await
    .map_err(|e| (-32603, format!("append_memory join: {e}")))?
    .map_err(|e| (-32603, e))?;

    Ok(json!({
        "appended_bytes": written_len,
        "ok": true,
    })
    .to_string())
}

async fn list_active_runs(app: AppHandle) -> Result<String, (i32, String)> {
    use crate::state::AppState;
    use crate::workflow::engine::RunStatus;
    use tauri::Manager;

    let state = app.state::<AppState>();
    let runs_map = state.workflow_runs.clone();
    let runs = runs_map.lock();
    let items: Vec<Value> = runs
        .values()
        .filter(|r| {
            !matches!(
                r.status,
                RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled
            )
        })
        .map(|r| {
            json!({
                "id": r.id,
                "workflow_id": r.workflow_id,
                "status": format!("{:?}", r.status),
                "started_at_ms": r.started_at_ms,
                "updated_at_ms": r.updated_at_ms,
            })
        })
        .collect();
    Ok(json!({ "runs": items }).to_string())
}

#[derive(Debug, Deserialize)]
struct CancelRunArgs {
    run_id: String,
}

async fn cancel_run(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    use crate::state::AppState;
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    let args: CancelRunArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid cancel_run args: {e}")))?;

    let state = app.state::<AppState>();
    let flags = state.workflow_cancel_flags.lock();
    let Some(flag) = flags.get(&args.run_id) else {
        return Err((
            -32602,
            format!("run not found or already finished: {}", args.run_id),
        ));
    };
    flag.store(true, Ordering::Relaxed);

    Ok(json!({
        "run_id": args.run_id,
        "cancel_requested": true,
        "note": "current step finishes, then the engine exits cleanly",
    })
    .to_string())
}
