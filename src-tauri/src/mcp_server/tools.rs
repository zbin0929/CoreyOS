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
//!   - `corey_native.corey_list_llms`       — enumerate LLM profiles + which is default.
//!   - `corey_native.corey_set_default_llm` — switch the gateway's default model by profile id.
//!   - `corey_native.corey_open_route`       — deep-link the GUI to any frontend route.
//!
//! These three carry an explicit `corey_` prefix because Hermes Agent
//! ships its own builtin `list_llms` tool (returning Hermes' own
//! profile system, separate from Corey's `llm_profiles.json`). Without
//! the prefix the agent flips a coin between the two and picks the
//! wrong one in chat sessions where Pack tools are also loaded.
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
            "name": "save_artifact",
            "description": "Persist a file under the current run's \
                artifact directory (`~/.hermes/artifacts/<run_id>/<name>`). \
                **You MUST call this after every file you produce** — a \
                CSV, a markdown report, an .xlsx / .pdf / .docx / .pptx \
                from the document-authoring skills, a generated config. \
                Without this step the file lives only in the sandbox \
                and the user has no way to find it. Once saved, the \
                file shows up in the /tasks detail panel with one-click \
                open / reveal in Finder, and your chat reply should \
                include a markdown link the user can click straight to \
                it (see Soul for the link format).\n\n\
                **Text vs binary**: provide `content` for plain text \
                (md/csv/json) — the bytes are written as UTF-8. Provide \
                `source_path` (absolute path the agent already wrote \
                to in its sandbox) for binary formats (xlsx/pdf/pptx/\
                docx/png/jpg). Set exactly one; `source_path` wins if \
                both are set.\n\n\
                If you don't have a `run_id` (typical for ad-hoc chats), \
                pass the literal string `chat` and the file lands under \
                `artifacts/chat/`. Same name overwrites; pick a different \
                name when versioning matters.\n\n\
                Hard cap: 8 MB per file. Returns the absolute path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Filename (no slashes; we sanitise but don't path-join). Include the extension so previewers know the type — `report-2026-05.md`, `weekly-revenue.csv`, `q3-budget.xlsx`, etc."
                    },
                    "content": {
                        "type": "string",
                        "description": "Inline text content (UTF-8). Use for md/csv/json/yaml. Pass `source_path` instead for binary."
                    },
                    "source_path": {
                        "type": "string",
                        "description": "Absolute path the file already exists at in the sandbox (e.g. `/tmp/report.xlsx` after running an openpyxl script). Bytes are copied verbatim. Use for xlsx / pdf / pptx / docx / images."
                    },
                    "run_id": {
                        "type": "string",
                        "description": "Workflow run id from `run_workflow` / `list_active_runs`. Use the literal `chat` for non-workflow contexts."
                    }
                },
                "required": ["name"]
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
        // Demo-critical: agent must be able to enumerate + switch the
        // default model from chat. Backed by Corey's own llm_profiles
        // store + ~/.hermes/config.yaml; Hermes Agent itself untouched.
        json!({
            "name": "corey_list_llms",
            "description": "List the user's configured LLM profiles \
                (id, label, provider, model, vision support) and \
                report which one is the gateway's current default. \
                Use BEFORE `corey_set_default_llm` so you can confirm the \
                target id exists. \n\n\
                Phrase examples — EN: \"what models are configured\", \
                \"list LLMs\", \"which model am I using\". \
                ZH: \"列出模型\", \"现在用的是哪个模型\", \"有哪些 LLM\".",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "corey_set_default_llm",
            "description": "Switch the gateway's default model to the \
                given LLM profile. Writes ~/.hermes/config.yaml's \
                model.{default,provider,base_url} section atomically. \
                The change takes effect on the NEXT chat turn — no \
                gateway restart needed for this field. \n\n\
                Phrase examples — EN: \"switch to GLM\", \"use \
                Anthropic\", \"change default model to deepseek\". \
                ZH: \"切换到 GLM\", \"用 Anthropic\", \"换成 \
                DeepSeek\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "profile_id": {
                        "type": "string",
                        "description": "LLM profile id from corey_list_llms (e.g. \"glm\", \"deepseek\", \"minimax-m27\")."
                    }
                },
                "required": ["profile_id"]
            }
        }),
        // ─── AI Browser (CDP) management ─────────────────────────
        // Lets the agent manage its own dedicated Chrome from chat:
        //   "AI 浏览器没启动，要我帮你开吗？" → corey_browser_launch
        //   "我登录了哪些网站？"             → corey_browser_status
        //   "清除 AI 浏览器登录态"           → corey_browser_clear
        // Mirrors the four IPC commands behind the Settings panel,
        // but skips the gateway-restart step (we're inside an
        // in-flight agent loop — restart would kill the chat stream).
        // The reply text always tells the user a restart is needed
        // before the *next* turn can drive the new browser.
        json!({
            "name": "corey_browser_status",
            "description": "Report the AI Browser's current state: \
                whether the dedicated Chrome is running, whether \
                BROWSER_CDP_URL is configured, which Chrome binary was \
                detected, and the list of domains the agent has \
                persistent cookies for (i.e. sites it's 'logged in to'). \
                Cheap — call this whenever the user asks about the \
                browser without explicit verbs.\n\n\
                Trigger phrases — EN: \"is the browser running\", \
                \"what sites am I logged into\", \"check the AI \
                browser\". ZH: \"AI 浏览器开着吗\", \"我登录了哪些 \
                网站\", \"看下浏览器状态\".",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "corey_browser_launch",
            "description": "Open the dedicated Chrome that the agent \
                drives, write BROWSER_CDP_URL to ~/.hermes/.env, and \
                tell the user a Hermes Gateway restart is needed for \
                the wiring to take effect on the NEXT chat turn (we \
                deliberately do NOT restart inside this tool — it \
                would kill the in-flight SSE stream).\n\n\
                Idempotent: if Chrome is already on port 9222 we \
                only (re)write the env var. After the call returns, \
                the user logs into each backend in the Chrome window \
                ONCE, then closes the Settings panel and continues \
                chatting; the agent will use the logged-in browser \
                from the next chat turn forward.\n\n\
                Trigger phrases — EN: \"open the AI browser\", \
                \"start the dedicated browser\", \"let me sign in\". \
                ZH: \"打开 AI 浏览器\", \"启动专属浏览器\", \"我要登录\".",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "corey_browser_stop",
            "description": "Disable the AI Browser by clearing \
                BROWSER_CDP_URL from ~/.hermes/.env. This does NOT \
                kill the Chrome window itself — the user might still \
                want their tabs. From the next chat turn onward, the \
                agent falls back to its built-in ephemeral browser. \
                Skips gateway restart (same reason as launch).\n\n\
                Trigger phrases — EN: \"stop the AI browser\", \
                \"disable the dedicated browser\". ZH: \"停止 AI 浏览器\", \
                \"关掉专属浏览器\".",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "corey_browser_clear",
            "description": "Wipe the dedicated Chrome profile — \
                cookies, history, saved passwords, the lot. Use ONLY \
                after explicit user request (\"forget all my logins\" \
                / \"清除登录态\"); we don't want the agent doing this \
                proactively. Refuses to run while Chrome is still \
                alive — ask the user to quit the AI Browser window \
                first if needed.\n\n\
                Trigger phrases — EN: \"clear the AI browser\", \
                \"wipe AI browser logins\", \"forget all my sign-ins\". \
                ZH: \"清除 AI 浏览器登录态\", \"清空浏览器\", \
                \"忘掉我登录过的所有网站\".",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        // ─── AI Browser site aliases ─────────────────────────────
        // The agent uses these to translate "去店铺后台" / "看广告"
        // into a real URL without the customer ever pasting one.
        // Mirrors the Settings → AI Browser → Site Aliases table.
        json!({
            "name": "corey_browser_aliases_list",
            "description": "List the user's saved AI Browser site \
                aliases — `[{alias, url, updated_at}, ...]`. ALWAYS \
                call this BEFORE `browser_navigate` when the user \
                refers to a site by NAME instead of URL (\"打开店铺\", \
                \"去广告中心\", \"open the dashboard\"): match the \
                phrase against `alias` (case-insensitive substring \
                works fine), pick the best hit, navigate to its `url`. \
                Only fall back to asking for a URL when no alias \
                matches.\n\n\
                The list is small (capped at 200) and cheap; calling \
                this on every chat turn that mentions a non-URL site \
                phrase is fine.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "corey_browser_aliases_set",
            "description": "Save (or update) a user-friendly name → \
                URL mapping for the AI Browser. Use when the user \
                says something like \"以后我说 X 就帮我打开 Y\" / \
                \"记一下，店铺指 https://...\" / \"give X a shortcut\". \
                If the alias already exists, this REPLACES the URL — \
                the customer's last statement wins.\n\n\
                URL must be http:// or https://; aliases up to 64 \
                chars. We persist to a separate file from MEMORY.md \
                so `corey_browser_clear` (cookie wipe) does NOT \
                delete shortcuts.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "alias": {
                        "type": "string",
                        "description": "The friendly name the user will \
                            say. Trim before saving. Example: \"店铺后台\" \
                            or \"weekly report\"."
                    },
                    "url": {
                        "type": "string",
                        "description": "Full URL with scheme. Example: \
                            \"https://sellercentral.amazon.com/\"."
                    }
                },
                "required": ["alias", "url"]
            }
        }),
        json!({
            "name": "corey_browser_aliases_remove",
            "description": "Delete one alias by name. Use when the user \
                says \"忘掉 X 这个快捷方式\" / \"remove the shortcut \
                for Y\". Matches case-insensitively. Returns whether a \
                row was actually removed (false = no such alias).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "alias": {
                        "type": "string",
                        "description": "The exact alias the user wants \
                            removed (case-insensitive)."
                    }
                },
                "required": ["alias"]
            }
        }),
        json!({
            "name": "corey_browser_clear_domain",
            "description": "Wipe sign-in state for ONE domain only \
                (e.g. \"forget my Amazon login but keep the rest\"). \
                Refuses while the AI Browser is running — ask the user \
                to quit the Chrome window first if needed. Strips a \
                leading dot before matching; subdomains are NOT \
                included (clearing 'amazon.com' leaves \
                'sellercentral.amazon.com' alone).\n\n\
                Trigger phrases — EN: \"forget my login on X\", \
                \"clear cookies for Y\". ZH: \"清掉 X 的登录\", \
                \"忘掉 Y 网站\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "domain": {
                        "type": "string",
                        "description": "Bare domain (no scheme, no \
                            path). Example: \"amazon.com\" or \
                            \"sellercentral.amazon.com\"."
                    }
                },
                "required": ["domain"]
            }
        }),
        json!({
            "name": "corey_open_route",
            "description": "Deep-link the Corey desktop GUI to ANY \
                frontend route (not just Settings). Generalises \
                open_settings. Use when the agent has finished a \
                short task and wants the user to inspect the full \
                detail view (\"summary in chat + button to the page\" \
                pattern). \n\n\
                Common targets: \"/\" (Home), \"/chat\", \
                \"/workflows\", \"/tasks\", \"/models\", \
                \"/analytics\", \"/logs\", \"/skills\", \
                \"/knowledge\", \"/memory\", \"/mcp\", \
                \"/settings\". \n\n\
                Phrase examples — EN: \"go to tasks\", \"show me the \
                models page\", \"open analytics\". ZH: \"去 Tasks \
                页\", \"打开模型页\", \"看分析页\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute frontend route path starting with '/'. Example: \"/tasks\" or \"/models\"."
                    }
                },
                "required": ["path"]
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
        "save_artifact" => save_artifact(args).await?,
        "list_active_runs" => list_active_runs(app).await?,
        "cancel_run" => cancel_run(app, args).await?,
        "corey_list_llms" => list_llms(app).await?,
        "corey_set_default_llm" => set_default_llm(app, args).await?,
        "corey_browser_status" => browser_status(app).await?,
        "corey_browser_launch" => browser_launch(app).await?,
        "corey_browser_stop" => browser_stop(app).await?,
        "corey_browser_clear" => browser_clear(app).await?,
        "corey_browser_aliases_list" => browser_aliases_list().await?,
        "corey_browser_aliases_set" => browser_aliases_set(args).await?,
        "corey_browser_aliases_remove" => browser_aliases_remove(args).await?,
        "corey_browser_clear_domain" => browser_clear_domain(app, args).await?,
        "corey_open_route" => open_route(app, args).await?,
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
    let trimmed = args.fact.trim().to_string();
    if trimmed.is_empty() {
        return Err((-32602, "fact must not be empty".into()));
    }

    // Run dedup + append on a blocking thread so the chat task isn't
    // parked on disk I/O. We share the same bigram tokenize +
    // jaccard threshold the auto-extract path uses, so the agent
    // can't trivially re-introduce noise the user just compacted
    // away — if a near-paraphrase of `fact` is already in
    // MEMORY.md, we report skipped instead of writing.
    let outcome = tokio::task::spawn_blocking(move || -> Result<AppendOutcome, String> {
        let path = crate::paths::hermes_data_dir()
            .map_err(|e| format!("resolve dir: {e}"))?
            .join("MEMORY.md");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        }
        let existing = std::fs::read_to_string(&path).unwrap_or_default();

        // Bigram dedup against EVERY fact bullet already in
        // MEMORY.md, not just the most recent block. Same scope
        // `learning_compact_memory` uses on its semantic pass.
        let new_tokens = crate::ipc::learning::tokenize(&trimmed);
        if !new_tokens.is_empty() {
            for line in existing.lines() {
                let line_trim = line.trim();
                if !line_trim.starts_with('-') {
                    continue;
                }
                let kept_tokens = crate::ipc::learning::tokenize(line_trim);
                if kept_tokens.is_empty() {
                    continue;
                }
                let sim = crate::ipc::learning::jaccard(&new_tokens, &kept_tokens);
                if sim >= crate::ipc::learning::SIMILARITY_THRESHOLD {
                    return Ok(AppendOutcome::Skipped {
                        reason: format!("near-duplicate of existing line (jaccard={sim:.2})"),
                    });
                }
            }
        }

        let block = format!(
            "\n\n## [auto] {}\n- {}\n",
            chrono::Utc::now().format("%Y-%m-%d"),
            trimmed.replace('\n', "\n- "),
        );
        let written_len = block.len();
        let next = format!("{existing}{block}");
        if next.len() as u64 > crate::ipc::memory::MEMORY_MAX_BYTES {
            return Err("MEMORY.md would exceed 256 KB cap; run /memory cleanup first".into());
        }
        std::fs::write(&path, next.as_bytes()).map_err(|e| format!("write: {e}"))?;
        Ok(AppendOutcome::Wrote { bytes: written_len })
    })
    .await
    .map_err(|e| (-32603, format!("append_memory join: {e}")))?
    .map_err(|e| (-32603, e))?;

    let payload = match outcome {
        AppendOutcome::Wrote { bytes } => json!({
            "ok": true,
            "skipped": false,
            "appended_bytes": bytes,
        }),
        AppendOutcome::Skipped { reason } => json!({
            "ok": true,
            "skipped": true,
            "reason": reason,
        }),
    };
    Ok(payload.to_string())
}

enum AppendOutcome {
    Wrote { bytes: usize },
    Skipped { reason: String },
}

#[derive(Debug, Deserialize)]
struct SaveArtifactArgs {
    name: String,
    /// Inline text (utf-8). Either this OR `source_path` must be set.
    #[serde(default)]
    content: Option<String>,
    /// Absolute path the agent already wrote the file to in its
    /// sandbox. Used for binary formats (xlsx, pdf, pptx, docx, png).
    /// The bytes are read once and copied into the artifact store;
    /// the source file is left in place.
    #[serde(default)]
    source_path: Option<String>,
    #[serde(default)]
    run_id: Option<String>,
}

async fn save_artifact(args: Value) -> Result<String, (i32, String)> {
    let args: SaveArtifactArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid save_artifact args: {e}")))?;
    let run_id = args
        .run_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("chat")
        .to_string();
    let name = args.name.clone();

    // Resolve the bytes-to-write up front so the rest of the function
    // doesn't have to branch on text vs binary. `source_path` wins
    // when both are set — that's the binary path and the more
    // common case for the document-authoring skills (xlsx/pdf/...).
    let bytes: Vec<u8> = match (&args.source_path, &args.content) {
        (Some(p), _) => {
            let path = p.clone();
            tokio::task::spawn_blocking(move || std::fs::read(&path))
                .await
                .map_err(|e| (-32603, format!("read source_path join: {e}")))?
                .map_err(|e| (-32602, format!("read source_path {p}: {e}")))?
        }
        (None, Some(text)) => text.clone().into_bytes(),
        (None, None) => {
            return Err((
                -32602,
                "save_artifact: provide either `content` (text) or `source_path` (binary file)"
                    .into(),
            ));
        }
    };

    let info = tokio::task::spawn_blocking(move || {
        crate::artifacts::write_artifact(&run_id, &name, &bytes)
    })
    .await
    .map_err(|e| (-32603, format!("save_artifact join: {e}")))?
    .map_err(|e| (-32602, format!("save_artifact: {e}")))?;

    Ok(json!({
        "ok": true,
        "run_id": info.run_id,
        "name": info.name,
        "path": info.path,
        "size": info.size,
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

// ── Demo-critical surface (v0.2.11+) ────────────────────────────
// list_llms / set_default_llm / open_route. These wrap pre-existing
// pure helpers in `llm_profiles` / `hermes_config`, so Hermes Agent
// itself stays untouched (HD-1/HD-2). The chat agent calls these
// via MCP and the GUI updates either via the existing
// AppStatus poll (set_default_llm) or via the `corey_native:open_route`
// event listener (open_route).

async fn list_llms(app: AppHandle) -> Result<String, (i32, String)> {
    use crate::state::AppState;
    use tauri::Manager;

    let state = app.state::<AppState>();
    let config_dir = state.config_dir.clone();

    let (profiles, current_model) = tokio::task::spawn_blocking(move || {
        let profiles = crate::llm_profiles::load(&config_dir);
        let current = crate::hermes_config::read_view()
            .ok()
            .and_then(|v| v.model.default.clone());
        (profiles, current)
    })
    .await
    .map_err(|e| (-32603, format!("list_llms join: {e}")))?;

    let items: Vec<Value> = profiles
        .iter()
        .map(|p| {
            let is_default = current_model
                .as_deref()
                .map(|m| m == p.model)
                .unwrap_or(false);
            json!({
                "id": p.id,
                "label": if p.label.is_empty() { p.id.clone() } else { p.label.clone() },
                "provider": p.provider,
                "model": p.model,
                "vision": p.vision.unwrap_or(false),
                "is_default": is_default,
            })
        })
        .collect();

    Ok(json!({
        "current_model": current_model,
        "profiles": items,
    })
    .to_string())
}

#[derive(Debug, Deserialize)]
struct SetDefaultLlmArgs {
    profile_id: String,
}

async fn set_default_llm(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    use crate::state::AppState;
    use tauri::Manager;

    let args: SetDefaultLlmArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid set_default_llm args: {e}")))?;

    let state = app.state::<AppState>();
    let config_dir = state.config_dir.clone();
    let journal = state.changelog_path.clone();
    let target_id = args.profile_id.clone();

    let (label, model_id) =
        tokio::task::spawn_blocking(move || -> Result<(String, String), String> {
            let profiles = crate::llm_profiles::load(&config_dir);
            let target = profiles.iter().find(|p| p.id == target_id).ok_or_else(|| {
                let known: Vec<&str> = profiles.iter().map(|p| p.id.as_str()).collect();
                format!("profile '{target_id}' not found. configured profiles: {known:?}")
            })?;

            let section = crate::hermes_config::HermesModelSection {
                default: Some(target.model.clone()),
                provider: Some(target.provider.clone()),
                base_url: if target.base_url.is_empty() {
                    None
                } else {
                    Some(target.base_url.clone())
                },
            };
            crate::hermes_config::write_model(&section, Some(&journal))
                .map_err(|e| format!("write hermes config: {e}"))?;

            // Hermes' agent loop reads `HERMES_MODEL` from `~/.hermes/.env`
            // (NOT config.yaml) when a chat request lands with
            // `model="hermes-agent"`. Without this env var, Hermes
            // forwards `"hermes-agent"` literally to the upstream LLM API
            // and the provider returns 400. Writing it here keeps the
            // chat path agent-mode + tool-injection healthy on every
            // LLM switch. Gateway restart is required for Hermes to
            // pick up the new env value (HD-9: no hot-reload).
            crate::hermes_config::write_env_key(
                "HERMES_MODEL",
                Some(&target.model),
                Some(&journal),
            )
            .map_err(|e| format!("write HERMES_MODEL env: {e}"))?;

            let label = if target.label.is_empty() {
                target.id.clone()
            } else {
                target.label.clone()
            };
            Ok((label, target.model.clone()))
        })
        .await
        .map_err(|e| (-32603, format!("set_default_llm join: {e}")))?
        .map_err(|e| (-32602, e))?;

    // **DO NOT auto-restart Hermes Gateway here.** This MCP tool
    // runs INSIDE Hermes' agent loop while the user's chat stream
    // is mid-flight. Restarting Hermes Gateway from inside a tool
    // call kills the SSE socket — the chat reply hangs forever.
    //
    // Instead: emit `corey_native:model_changed` and let the frontend
    // listener decide when to bounce the gateway (after the active
    // chat turn closes, on user confirmation, etc.). The .env write
    // already happened; the new HERMES_MODEL takes effect on the
    // NEXT gateway boot.
    //
    // The reply text below tells the user to expect a deferred
    // restart so they don't think nothing happened.

    // Notify the GUI so the topbar model badge / AgentSwitcher pill
    // updates immediately instead of waiting for the slow poll. The
    // listener (`useDeepLinkListener`) re-runs `refreshModel`.
    use tauri::Emitter;
    let _ = app.emit(
        "corey_native:model_changed",
        json!({ "profile_id": args.profile_id, "model": model_id }),
    );

    Ok(json!({
        "ok": true,
        "profile_id": args.profile_id,
        "label": label,
        "model": model_id,
        "note": "config.yaml + .env written. Hermes Gateway restart required for the new HERMES_MODEL to take effect — frontend will surface a 'restart now' prompt after this chat turn finishes.",
    })
    .to_string())
}

#[derive(Debug, Deserialize)]
struct OpenRouteArgs {
    path: String,
}

async fn open_route(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    let args: OpenRouteArgs = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid open_route args: {e}")))?;

    let path = args.path.trim();
    if !path.starts_with('/') {
        return Err((
            -32602,
            format!("path must start with '/': got {:?}", args.path),
        ));
    }

    use tauri::Emitter;
    app.emit("corey_native:open_route", path.to_string())
        .map_err(|e| (-32603, format!("emit open_route: {e}")))?;

    Ok(format!("Asked Corey GUI to navigate to {}.", path))
}

// ─── AI Browser handlers ────────────────────────────────────────────
//
// All four wrap the same `browser_cdp::*_sync` helpers used by the
// `#[tauri::command]` IPC entry points, but pass `restart_gateway=false`
// because we're inside an in-flight agent loop. Restarting Hermes
// Gateway from here would tear down the SSE socket the user is reading
// from and the chat reply would hang — exactly the bug we already fixed
// in `set_default_llm`. Instead we emit `corey_native:browser_changed`
// so the frontend can prompt for a restart after the chat turn closes,
// and the reply text always tells the user "next turn picks it up".
//
// The handlers all share the same shape: pull `AppState` for the
// changelog journal path, run the blocking sync function on the
// blocking pool, format a chat-friendly response. Errors are mapped
// from `IpcError` to MCP's `(code, message)` tuple verbatim — Hermes
// puts the message back into the chat, so the user sees actionable
// strings like "Please quit the AI Browser window first".

fn ipc_err_to_mcp(e: crate::error::IpcError) -> (i32, String) {
    // Pick code -32603 (internal) for everything; the *message* is
    // what reaches the user. Splitting validation vs internal here
    // would gain nothing since the agent never branches on the code.
    // `IpcError` doesn't implement `Display` (it's serde-serialized
    // for the IPC envelope), so we serialize to JSON for a stable
    // chat-readable form. The variants we hit here are dominated by
    // `Internal { message }`, which serializes to a short blob the
    // user can act on (e.g. "Please quit the AI Browser window first").
    let msg = serde_json::to_string(&e).unwrap_or_else(|_| format!("{e:?}"));
    (-32603, msg)
}

async fn browser_status(_app: AppHandle) -> Result<String, (i32, String)> {
    let status = tokio::task::spawn_blocking(crate::ipc::browser_cdp::build_status)
        .await
        .map_err(|e| (-32603, format!("status join: {e}")))?;

    Ok(json!({
        "running": status.running,
        "port": status.port,
        "env_configured": status.env_configured,
        "chrome_path": status.chrome_path,
        "logged_in_domains": status.logged_in_domains,
        "summary": if status.running && status.env_configured {
            format!(
                "AI Browser is running on localhost:{} and wired to Hermes. \
                 Logged in to {} site(s).",
                status.port,
                status.logged_in_domains.len()
            )
        } else if status.env_configured {
            "BROWSER_CDP_URL is configured but Chrome isn't currently \
             listening — call corey_browser_launch to start it.".to_string()
        } else {
            "AI Browser is not configured. Call corey_browser_launch to \
             open a dedicated Chrome and have the user sign in."
                .to_string()
        }
    })
    .to_string())
}

async fn browser_launch(app: AppHandle) -> Result<String, (i32, String)> {
    use tauri::{Emitter, Manager};
    let state = app.state::<crate::state::AppState>();
    let journal = state.changelog_path.clone();

    let result =
        tokio::task::spawn_blocking(move || crate::ipc::browser_cdp::launch_sync(&journal, false))
            .await
            .map_err(|e| (-32603, format!("launch join: {e}")))?
            .map_err(ipc_err_to_mcp)?;

    let _ = app.emit(
        "corey_native:browser_changed",
        json!({ "action": "launch" }),
    );

    Ok(json!({
        "ok": true,
        "running": result.status.running,
        "env_configured": result.status.env_configured,
        "logged_in_domains": result.status.logged_in_domains,
        "message": result.message,
        "next_step": "User should sign into each backend in the Chrome \
                      window that just opened. Hermes Gateway needs a \
                      restart for the wiring to take effect on the \
                      NEXT chat turn — the GUI will surface a prompt \
                      after this turn finishes.",
    })
    .to_string())
}

async fn browser_stop(app: AppHandle) -> Result<String, (i32, String)> {
    use tauri::{Emitter, Manager};
    let state = app.state::<crate::state::AppState>();
    let journal = state.changelog_path.clone();

    let status =
        tokio::task::spawn_blocking(move || crate::ipc::browser_cdp::stop_sync(&journal, false))
            .await
            .map_err(|e| (-32603, format!("stop join: {e}")))?
            .map_err(ipc_err_to_mcp)?;

    let _ = app.emit("corey_native:browser_changed", json!({ "action": "stop" }));

    Ok(json!({
        "ok": true,
        "env_configured": status.env_configured,
        "message": "BROWSER_CDP_URL cleared. The Chrome window is left \
                    open (the user may still want their tabs); from \
                    the next chat turn onward the agent will use its \
                    built-in ephemeral browser. Hermes Gateway will \
                    pick up the change on its next restart.",
    })
    .to_string())
}

async fn browser_clear(app: AppHandle) -> Result<String, (i32, String)> {
    use tauri::Emitter;
    let status = tokio::task::spawn_blocking(crate::ipc::browser_cdp::clear_cookies_sync)
        .await
        .map_err(|e| (-32603, format!("clear join: {e}")))?
        .map_err(ipc_err_to_mcp)?;

    let _ = app.emit("corey_native:browser_changed", json!({ "action": "clear" }));

    Ok(json!({
        "ok": true,
        "running": status.running,
        "logged_in_domains": status.logged_in_domains,
        "message": "AI Browser profile wiped. All cookies and saved \
                    sign-ins are gone; the user will need to sign in \
                    again next time the AI Browser is used.",
    })
    .to_string())
}

async fn browser_clear_domain(app: AppHandle, args: Value) -> Result<String, (i32, String)> {
    use tauri::Emitter;
    #[derive(Deserialize)]
    struct Args {
        domain: String,
    }
    let args: Args = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid clear_domain args: {e}")))?;
    let domain = args.domain.clone();
    let status =
        tokio::task::spawn_blocking(move || crate::ipc::browser_cdp::clear_domain_sync(&domain))
            .await
            .map_err(|e| (-32603, format!("clear_domain join: {e}")))?
            .map_err(ipc_err_to_mcp)?;

    let _ = app.emit(
        "corey_native:browser_changed",
        json!({ "action": "clear_domain", "domain": args.domain }),
    );

    Ok(json!({
        "ok": true,
        "domain": args.domain,
        "logged_in_domains": status.logged_in_domains,
        "message": format!(
            "Cleared sign-in cookies for {}. Other domains untouched.",
            args.domain
        ),
    })
    .to_string())
}

async fn browser_aliases_list() -> Result<String, (i32, String)> {
    let entries = tokio::task::spawn_blocking(crate::ipc::browser_aliases::list_sync)
        .await
        .map_err(|e| (-32603, format!("aliases list join: {e}")))?
        .map_err(ipc_err_to_mcp)?;

    // Return as a structured list — the agent matches against `alias`
    // and uses `url`. We include `updated_at` so the agent can prefer
    // the freshest match when two aliases overlap.
    let items: Vec<Value> = entries
        .into_iter()
        .map(|e| {
            json!({
                "alias": e.alias,
                "url": e.url,
                "updated_at": e.updated_at,
            })
        })
        .collect();
    Ok(json!({
        "count": items.len(),
        "aliases": items,
    })
    .to_string())
}

async fn browser_aliases_set(args: Value) -> Result<String, (i32, String)> {
    #[derive(Deserialize)]
    struct Args {
        alias: String,
        url: String,
    }
    let args: Args = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid aliases_set args: {e}")))?;

    let alias_clone = args.alias.clone();
    let url_clone = args.url.clone();
    let saved = tokio::task::spawn_blocking(move || {
        crate::ipc::browser_aliases::upsert_sync(&alias_clone, &url_clone)
    })
    .await
    .map_err(|e| (-32603, format!("aliases set join: {e}")))?
    .map_err(ipc_err_to_mcp)?;

    Ok(json!({
        "ok": true,
        "alias": saved.alias,
        "url": saved.url,
        "message": format!(
            "Saved: \"{}\" → {}. Next time the user mentions this name, \
             call browser_navigate with that URL.",
            saved.alias, saved.url
        ),
    })
    .to_string())
}

async fn browser_aliases_remove(args: Value) -> Result<String, (i32, String)> {
    #[derive(Deserialize)]
    struct Args {
        alias: String,
    }
    let args: Args = serde_json::from_value(args)
        .map_err(|e| (-32602, format!("invalid aliases_remove args: {e}")))?;
    let alias_clone = args.alias.clone();
    let removed =
        tokio::task::spawn_blocking(move || crate::ipc::browser_aliases::remove_sync(&alias_clone))
            .await
            .map_err(|e| (-32603, format!("aliases remove join: {e}")))?
            .map_err(ipc_err_to_mcp)?;

    Ok(json!({
        "ok": true,
        "alias": args.alias,
        "removed": removed,
        "message": if removed {
            format!("Removed alias \"{}\".", args.alias)
        } else {
            format!("No alias named \"{}\" was found.", args.alias)
        },
    })
    .to_string())
}
