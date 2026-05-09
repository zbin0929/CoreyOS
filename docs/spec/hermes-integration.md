# 04 · Hermes Integration

Concrete spec for `HermesAdapter`. This is the **only** adapter in the repo for Phases 0–4.

## Surfaces Corey consumes

| # | Surface                         | Purpose                                         |
|---|---------------------------------|-------------------------------------------------|
| 1 | Gateway HTTP `:8642`            | Chat completions (OpenAI-compatible), models    |
| 2 | `hermes` CLI                    | Session CRUD, logs, version, profile mgmt       |
| 3 | `~/.hermes/config.yaml`         | Channel behavior configuration                  |
| 4 | `~/.hermes/.env`                | Platform credentials                            |
| 5 | `~/.hermes/auth.json`           | Model provider credential pool                  |
| 6 | `~/.hermes/profiles/*`          | Named profile directories                       |
| 7 | `~/.hermes/skills/*`            | Skill definitions                               |
| 8 | `~/.hermes/logs/*`              | Rolling log files (agent, gateway, error)       |

> Sources of truth for these paths come from the hermes-agent README and the `hermes-web-ui` architecture doc. Must be validated against the actual running Hermes during Phase 1.

## 1. Gateway (chat hot path)

Hermes exposes an OpenAI-compatible endpoint. Corey uses `POST /v1/chat/completions` with `stream: true`.

```rust
// src-tauri/src/adapters/hermes/gateway.rs

pub struct GatewayClient {
    base_url: Url,          // http://127.0.0.1:8642
    http: reqwest::Client,  // with keep-alive, gzip
}

impl GatewayClient {
    pub async fn stream_chat(
        &self,
        session_id: &str,
        req: ChatRequest,
        sink: DeltaSink,
        cancel: CancellationToken,
    ) -> Result<(), AdapterError> { … }

    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, AdapterError>;
    pub async fn health(&self) -> Result<GatewayHealth, AdapterError>;
}
```

### SSE → Delta mapping

OpenAI-style chunks map to our `Delta` as follows:

| OpenAI chunk                               | Corey Delta                              |
|--------------------------------------------|---------------------------------------------|
| first chunk with `role: assistant`         | `MessageStart { role: Assistant, id }`      |
| `delta.content: "…"`                       | `TextChunk { text }`                        |
| `delta.tool_calls[0].function.name` first  | `ToolCallStart { call_id, tool, args: "" }` |
| `delta.tool_calls[i].function.arguments`   | `ToolCallDelta { call_id, args_partial }`   |
| tool result (from Hermes' extension fields)| `ToolCallEnd { call_id, result }`           |
| `finish_reason`                            | `MessageEnd { finish_reason }`              |
| usage block (end or incremental)           | `Usage { input, output, cached, cost? }`    |

Hermes adds non-standard extensions for tool results and reasoning; we consume them from known extension fields (exact names verified in Phase 1 against the live gateway).

### Cancellation

Drop the HTTP response stream → Hermes notices disconnected client and aborts the turn. We additionally emit `chat_cancel` on the gateway if the endpoint exists (to be confirmed).

## 2. CLI wrapper

Not every operation is exposed via the gateway (sessions, logs, profile switching). Corey shells out to `hermes` and parses JSON output.

```rust
// src-tauri/src/adapters/hermes/cli.rs

pub struct HermesCli {
    binary: PathBuf,             // auto-discovered; overridable via settings
    profile: Option<String>,     // --profile flag
    env: HashMap<String, String>,
}

impl HermesCli {
    pub async fn version(&self) -> Result<String, AdapterError>;
    pub async fn session_list(&self, query: &SessionQuery) -> Result<Vec<Session>, AdapterError>;
    pub async fn session_create(&self, req: &CreateSession) -> Result<Session, AdapterError>;
    pub async fn session_rename(&self, id: &str, title: &str) -> Result<(), AdapterError>;
    pub async fn session_delete(&self, id: &str) -> Result<(), AdapterError>;
    pub async fn profile_list(&self) -> Result<Vec<Profile>, AdapterError>;
    pub async fn profile_export(&self, id: &str, out: &Path) -> Result<(), AdapterError>;
    pub async fn profile_import(&self, archive: &Path) -> Result<Profile, AdapterError>;
    pub async fn logs_tail(&self, query: LogQuery, sink: LogSink) -> Result<(), AdapterError>;
    pub async fn gateway_start(&self, profile: &str) -> Result<u16, AdapterError>;  // returns port
    pub async fn gateway_stop(&self, profile: &str) -> Result<(), AdapterError>;
    pub async fn gateway_status(&self, profile: &str) -> Result<GatewayStatus, AdapterError>;
}
```

Each call runs the binary with `--json` (or equivalent machine-readable flag) and uses `tokio::process::Command` with explicit timeout. Stderr is captured and included in `AdapterError::Internal` on failure.

### Discovery

- Look for `hermes` on `PATH`.
- Fallback: `~/.local/bin/hermes`, `/opt/homebrew/bin/hermes`, Windows `%LocalAppData%\...\hermes.exe`.
- Settings allow manual override. Version must satisfy a minimum (`>= x.y.z`, pinned once verified).

## 3. `config.yaml` (channel behavior)

Schema (partial — grown with reality):

```yaml
# ~/.hermes/config.yaml (subset)
channels:
  telegram:
    mention_required: false
    reactions: true
    free_chats: [123456789]
  discord:
    mention_required: true
    auto_thread: true
    reactions: true
    allow_channels: []
    ignore_channels: []
  slack:
    mention_required: true
    handle_bot_messages: false
  matrix:
    homeserver: "https://matrix.org"
    auto_thread: true
    dm_mention_thread: true
  # …
```

`config.rs` handles:

- Schema-validated read via `serde_yaml` + a versioned `HermesConfigV1` struct.
- **Preserve unknown keys** on write (round-trip with `serde_yaml::Value` merge).
- **Atomic write**: tempfile in same directory → `rename`. Never partial.
- Returns a **diff** (JSON Patch) to the caller for UI confirmation.

```rust
pub async fn read_config(path: &Path) -> Result<HermesConfig, ConfigError>;
pub async fn write_config_atomic(
    path: &Path,
    mutate: impl FnOnce(&mut HermesConfig),
) -> Result<ConfigDiff, ConfigError>;
```

## 4. `.env` (platform credentials)

Parsed with `dotenvy`. Writes:

- Atomic (tempfile + rename).
- **Permissions enforced to 0600** post-write on Unix.
- **Preserve comments and ordering** where possible (use an env-file editor crate or a small custom parser; hand-roll if no suitable crate).

Known keys (to be fully catalogued against the live Hermes):

```
TELEGRAM_BOT_TOKEN
DISCORD_BOT_TOKEN
SLACK_BOT_TOKEN
WHATSAPP_*                  # details TBD
MATRIX_ACCESS_TOKEN
MATRIX_HOMESERVER
FEISHU_APP_ID
FEISHU_APP_SECRET
WECHAT_*                    # managed by QR flow
WECOM_BOT_ID
WECOM_BOT_SECRET
# + model provider keys (OPENAI_API_KEY, etc.) if used directly
```

Corey prefers storing credentials in the OS keychain when possible and only projects them into `.env` at gateway start (if the user opts in). Default behavior mirrors the original UI to stay compatible.

## 5. `auth.json` (model credential pool)

Format (verified in Phase 1): list of provider credentials used by the Hermes `model` subsystem. Operations:

- **Read** to compute the model selector list (union of configured providers' available models via `/v1/models`).
- **Write** to add/update/delete providers.
- **OAuth flow** for Codex models: open browser, catch callback via localhost redirect, persist token.

Corey never displays raw API keys after entry; fields show `••••••…last 4`. Editing re-requires the full key (no in-place edit).

## 6. Profiles

Each profile is a directory under `~/.hermes/profiles/<name>/` with its own `config.yaml`, `.env`, DB, etc. Corey:

- Lists profiles (`hermes profile list --json`).
- Switches active profile for the current gateway instance.
- Exports via `tar.gz`; import via extracting into a temp dir then moving.
- Tracks gateway port per profile (allocated by Hermes; we just display).

## 7. Skills

`~/.hermes/skills/<id>/` contains at minimum `skill.md` (prompt + metadata frontmatter) and optional attached files. Corey:

- Lists skills (directory scan + parse frontmatter).
- Reads/edits `skill.md` (respect frontmatter fields).
- Reads attachments (render images, preview text).
- Writes go through the file-safety layer (atomic, journaled to `~/.corey/changelog.jsonl`).

## 8. Logs

Tail log files under `~/.hermes/logs/`. Strategy:

- `notify` crate watches the directory.
- Ring-buffer the last N lines per file in memory.
- Parse each line (best-effort): timestamp + level + source + message; unknown lines pass through as raw.
- Stream to frontend via `log:chunk:{query_id}` events.

## WeChat QR login (Tencent iLink)

Mirrors the original UI behavior: request a QR, poll until scanned, persist credentials to `.env`. Implementation lives in `adapters/hermes/wechat.rs` and is isolated so the legal surface area is small.

## Startup sequence (Hermes adapter)

1. Locate `hermes` binary; if missing → raise `NotConfigured { hint: "install hermes-agent" }`.
2. Read `~/.hermes/config.yaml` (or default if absent) to list known profiles.
3. Ping gateway on each profile's port; populate health.
4. Load model pool from `auth.json`; enrich via `/v1/models` where reachable.
5. Register file watchers for `~/.hermes/{.env,config.yaml,auth.json,skills/**,logs/**}`.
6. Ready.

## Failure modes & UI hooks

| Symptom                              | Adapter raises              | UI action                               |
|--------------------------------------|-----------------------------|-----------------------------------------|
| Binary missing                       | `NotConfigured`             | Empty-state card + install guide        |
| Gateway down                         | `Unreachable`               | Banner with "Start gateway" CTA         |
| `auth.json` has no providers         | `NotConfigured`             | Nudge to Models page                    |
| SSE stream breaks mid-message        | Synthesize `MessageEnd` w/ `finish_reason=Interrupted`; surface toast | Allow retry |
| `.env` write permission denied       | `Internal` w/ detail        | Modal with chmod instruction            |
