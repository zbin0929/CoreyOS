# Migration — Hermes 0.13.0 `/v1/runs` endpoint

> **Status**: ✅ **DONE (2026-05-12, commits `5aef48c` + `67631ce`)** — kept for archeology.
>
> End-to-end verification:
> - `cargo test` 555 passed (incl. 9 new `RunEvent` parsing tests + 6 `gateway_pid` tests)
> - 2026-05-12 01:08 真人 UI 实测：`rm /tmp/foo` → Corey UI 弹审批卡片 ✅
> - 2026-05-12 01:08 真人 UI 实测：`rm ~/Desktop/1.txt` → 双层防御都拦下（corey-guards + Hermes DANGEROUS_PATTERNS）✅
> - Hermes 0.13.0 gateway restart 已做，新 `/v1/runs` 端点验证活的
> - SOUL.md 第二组 C 反虚构铁律加入：agent.log 实证从昨晚 5min/0 工具/虚构 → 今晚 10s/4 工具/如实陈述
>
> 接下来 Hermes 升级时无需再迁移；本文件保留作上下文记录。后续修订写入 `docs/status/hermes-deps.md` § 14 changelog（v5.1）。
>
> **Trigger**: 2026-05-11 session — Corey stopped patching Hermes source, so we lost `patch_approval_sse` that used to inject approval events into `/v1/chat/completions`. The only native path for approval events in Hermes 0.13.0 is `/v1/runs`.
> **Scope**: Corey's adapter layer (chat streaming + approval response) migrates from `/v1/chat/completions` to `/v1/runs` + `/v1/runs/{run_id}/events`.
> **Owner**: ~~Next session~~ → Done.
> **Actual effort**: ~3 hours of work spread across two sessions (2026-05-11 PM + 2026-05-12 AM), plus 30 min E2E debugging (the Hermes gateway needed manual restart after `git pull` upgrade).

## Why this migration

### Background

Corey's approval UI (`src/features/chat/ApprovalCard.tsx`) needs to show a confirmation card when the agent detects a dangerous command (e.g. `rm -rf /`). It subscribes to `hermes.approval` SSE events from Corey's adapter in `src-tauri/src/adapters/hermes/gateway/mod.rs:453`.

Before 2026-05-11, Corey's gateway startup ran `patch_approval_sse()` which mutated `~/.hermes/hermes-agent/gateway/platforms/api_server.py` to inject:
- A `_on_approval` callback that pushed `("__approval__", data)` into the SSE stream queue
- A `_handle_approval_respond` HTTP endpoint at `POST /api/approval/respond`
- A `_handle_approval_pending` HTTP endpoint at `GET /api/approval/pending`

This patching pattern was **retired on 2026-05-11** because Hermes updates frequently (1296 commits between our old local version and upstream head), and every update could shift the patch anchor strings, silently breaking Corey on customer machines.

### Why `/v1/chat/completions` can't just be fixed with a patch

Hermes 0.13.0's `/v1/chat/completions` handler (`api_server.py:971-2800`) is 100% OpenAI-compat streaming. It has **no approval hook points** — no `register_gateway_notify`, no `_on_approval` callback. Approval events are deliberately routed to the `/v1/runs` endpoint, which Hermes treats as the "structured event stream" alternative to OpenAI compat.

Upstream's architecture intent:
- **`/v1/chat/completions`** = OpenAI drop-in (for external clients that just want to swap base_url)
- **`/v1/runs`** = Hermes-native structured events (for first-class Hermes clients like Corey)

Corey is a first-class client. We should be on `/v1/runs`.

## What `/v1/runs` gives us

### Request

**`POST /v1/runs`** with JSON body:

```json
{
  "input": "user message text OR [{role, content}, ...]",
  "instructions": "ephemeral system prompt (optional)",
  "conversation_history": [{"role": "user|assistant|system", "content": "..."}],
  "previous_response_id": "for session continuation (optional)",
  "session_id": "optional"
}
```

Returns 202 immediately with `run_id`:

```json
{
  "run_id": "run_abc123...",
  "status": "queued",
  "created_at": 1234567890
}
```

(See `gateway/platforms/api_server.py:2803-3099` for the full handler.)

### SSE stream

**`GET /v1/runs/{run_id}/events`** streams these event types (see `api_server.py` grep for `"event":`):

| Event | When | Payload |
|---|---|---|
| `message.delta` | Assistant text streams in | `{event, run_id, timestamp, delta: "chunk"}` |
| `tool.started` | Tool call begins | `{event, run_id, timestamp, tool, args?, emoji?, label?}` |
| `tool.completed` | Tool call returns | `{event, run_id, timestamp, tool, result?}` |
| `reasoning.available` | Thinking chunk | `{event, run_id, timestamp, reasoning}` |
| **`approval.request`** | Dangerous command detected | `{event, run_id, timestamp, command, description, pattern_key, pattern_keys, choices: ["once", "session", "always", "deny"]}` |
| `approval.responded` | User responded | `{event, run_id, timestamp, choice}` |
| `run.completed` | Run done OK | `{event, run_id, timestamp, output, usage: {input_tokens, output_tokens, total_tokens}}` |
| `run.failed` | Run errored | `{event, run_id, timestamp, error}` |
| `run.cancelled` | User stopped | `{event, run_id, timestamp}` |

**Note**: No `[DONE]` sentinel. Stream ends with `run.completed` / `run.failed` / `run.cancelled`, then the SSE connection closes with a `: stream closed\n\n` comment.

### Approval response

**`POST /v1/runs/{run_id}/approval`** (`api_server.py:3164-3260`) with JSON body:

```json
{
  "choice": "once" | "session" | "always" | "deny",
  "all": false  // optional; resolves all pending approvals for this run
}
```

Aliases accepted for `choice`: `"approve"` / `"approved"` / `"allow"` → normalized to `"once"`.

Returns 200 on success, 404 if run not found, 409 if no pending approval.

### Cancel a run

**`POST /v1/runs/{run_id}/stop`** (`api_server.py:3250`) with empty body. Interrupts the agent.

## Files to modify

### Backend Rust

#### 1. `src-tauri/src/adapters/hermes/gateway/types.rs`

Add new structs for the `/v1/runs` API:

```rust
/// Response from POST /v1/runs
#[derive(Debug, Deserialize)]
pub(super) struct RunStartResponse {
    pub run_id: String,
    // ignore other fields
}

/// Event envelope from GET /v1/runs/{run_id}/events.
/// Use serde's internally-tagged enum on the "event" field.
#[derive(Debug, Deserialize)]
#[serde(tag = "event")]
pub(super) enum RunEvent {
    #[serde(rename = "message.delta")]
    MessageDelta { delta: String, #[serde(default)] timestamp: f64 },
    #[serde(rename = "tool.started")]
    ToolStarted { tool: String, #[serde(default)] args: Option<serde_json::Value>, #[serde(default)] emoji: Option<String>, #[serde(default)] label: Option<String> },
    #[serde(rename = "tool.completed")]
    ToolCompleted { tool: String, #[serde(default)] result: Option<serde_json::Value> },
    #[serde(rename = "reasoning.available")]
    ReasoningAvailable { #[serde(default)] reasoning: String },
    #[serde(rename = "approval.request")]
    ApprovalRequest {
        #[serde(default)] command: String,
        #[serde(default)] description: String,
        #[serde(default)] pattern_key: Option<String>,
        #[serde(default)] pattern_keys: Vec<String>,
        #[serde(default)] choices: Vec<String>,
        run_id: String,
    },
    #[serde(rename = "approval.responded")]
    ApprovalResponded { #[serde(default)] choice: String },
    #[serde(rename = "run.completed")]
    RunCompleted { #[serde(default)] output: Option<String>, #[serde(default)] usage: Option<RunUsage> },
    #[serde(rename = "run.failed")]
    RunFailed { error: String },
    #[serde(rename = "run.cancelled")]
    RunCancelled {},
}

#[derive(Debug, Deserialize)]
pub(super) struct RunUsage {
    #[serde(default)] pub input_tokens: u32,
    #[serde(default)] pub output_tokens: u32,
    #[serde(default)] pub total_tokens: u32,
}
```

Update `HermesApprovalRequest` (keep for compatibility but add `run_id`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HermesApprovalRequest {
    #[serde(default)] pub command: String,
    #[serde(default)] pub pattern_key: Option<String>,
    #[serde(default)] pub pattern_keys: Vec<String>,
    #[serde(default)] pub description: String,
    /// NEW in v0.13.0: run_id for /v1/runs/{run_id}/approval endpoint.
    #[serde(default)] pub run_id: Option<String>,
    /// Which choices Hermes accepts. Native emits ["once", "session", "always", "deny"].
    #[serde(default)] pub choices: Vec<String>,
    /// DEPRECATED: was from our old patch. Set to None going forward.
    #[serde(rename = "_session_id", default)]
    pub session_id: Option<String>,
}
```

#### 2. `src-tauri/src/adapters/hermes/gateway/mod.rs`

Rewrite `chat_stream()` (lines 307-676). Two-step flow:

**Step 1**: POST `/v1/runs` with translated request body (convert OpenAI `messages[]` to `{input, conversation_history}`).

**Step 2**: Open SSE at GET `/v1/runs/{run_id}/events`, parse `RunEvent` enum, map to existing `ChatStreamEvent` variants:
- `RunEvent::MessageDelta { delta }` → `ChatStreamEvent::Delta(delta)`
- `RunEvent::ReasoningAvailable { reasoning }` → `ChatStreamEvent::Reasoning(reasoning)`
- `RunEvent::ToolStarted { tool, label, emoji, ... }` → `ChatStreamEvent::Tool(HermesToolProgress { tool, emoji, label })`
- `RunEvent::ApprovalRequest { .., run_id, .. }` → `ChatStreamEvent::Approval(HermesApprovalRequest { run_id: Some(run_id), .. })`
- `RunEvent::RunCompleted { usage }` → break loop, return `ChatStreamDone { usage.input_tokens as prompt_tokens, usage.output_tokens as completion_tokens, .. }`
- `RunEvent::RunFailed { error }` → return `Err(AdapterError::Upstream { .. })`

**Store `session_id → run_id` mapping** in adapter state so `hermes_approval_respond` can look up the run_id when the frontend posts a choice.

Consider keeping `chat_once()` on the old `/v1/chat/completions` path (single-turn non-streaming is stable, and `/v1/runs` is overkill for one-shot queries).

#### 3. `src-tauri/src/ipc/chat.rs`

Update `hermes_approval_respond`:

```rust
// URL: /v1/runs/{run_id}/approval
// Body: {choice}  (session_id → run_id lookup via shared adapter state)
pub async fn hermes_approval_respond(
    state: State<'_, AppState>,
    args: ApprovalRespondArgs,
) -> IpcResult<serde_json::Value> {
    // Look up run_id for this session_id. Fallback to treating args.session_id
    // AS run_id if caller already resolved it client-side (future-proof).
    let run_id = state.resolve_run_id(&args.session_id)
        .ok_or_else(|| IpcError::NotConfigured {
            hint: format!("no active run for session {}", args.session_id),
        })?;
    let base_url = state.config.read()?.base_url.clone();
    let url = format!("{}/v1/runs/{}/approval",
        base_url.trim_end_matches('/').trim_end_matches("/v1"),
        run_id);
    let body = serde_json::json!({"choice": args.choice});
    // POST + parse response as before
}
```

Delete `hermes_approval_pending` (no native equivalent; the only use was recovery after Corey UI reconnect, which is no longer needed because `/v1/runs` is stateful on the server).

#### 4. `src-tauri/src/lib.rs`

Remove `ipc::chat::hermes_approval_pending,` from the invoke_handler block (search for it).

#### 5. `src-tauri/src/adapters/hermes/gateway/tests.rs`

- Add test: POST `/v1/runs` URL construction
- Add test: SSE event parsing for each `RunEvent` variant
- Add test: approval flow (mock HTTP: start run → receive approval.request → respond → receive approval.responded)
- Update existing SSE tests that check for `hermes.approval` event name

### Frontend TypeScript

#### 6. `src/lib/ipc/chat.ts`

- Remove `hermesApprovalPending` export + interface (lines ~174-191)
- Update `ChatApprovalRequest` to include `run_id?: string` and `choices?: string[]`

#### 7. `src/features/chat/ApprovalCard.tsx`

Line 21 currently reads:
```tsx
args: { sessionId: approval._session_id || sessionId, choice },
```

Keep as-is if backend maps sessionId → run_id. No frontend change needed.

If backend instead expects runId directly, change to:
```tsx
args: { sessionId: approval.run_id || sessionId, choice },
```

### Tests

- `src-tauri/src/adapters/hermes/gateway/tests.rs` — new test cases (see above)
- E2E Playwright: `tests/e2e/approval-flow.spec.ts` — trigger a dangerous command in chat, verify approval card appears, click "Allow Once", verify command executes

### Docs updates after migration completes

- `docs/status/hermes-deps.md` — remove patched endpoints, add `/v1/runs` endpoints
- `docs/archive/audits/hermes-v0.12-impact-analysis.md` — mark as historical
- Delete `docs/migrations/hermes-v0.13-runs-endpoint.md` (this file) once done

## Known unknowns (verify during implementation)

1. **Exact field names** on `tool.started` / `tool.completed`. I read `api_server.py` but the `event_cb` function that emits them is in `agent/` and I didn't trace through. The Rust structs above are a best guess — refine when first real response arrives.

2. **Whether `run.completed.usage`** uses `{input_tokens, output_tokens, total_tokens}` or OpenAI-style `{prompt_tokens, completion_tokens, total_tokens}`. Line 2989 in api_server.py suggests Hermes native names (input_tokens etc.), but the run.completed event emission at line 3019 wraps it differently. Check at runtime.

3. **How `run.failed.error`** is shaped. Plain string? Object with `{message, type, code}`? Copy whatever Hermes gives, don't normalize.

4. **Timeout + retry semantics**. Current `chat_stream` retries connect on `Unreachable` 3 times before giving up (lines 608-670). Needs same treatment for `/v1/runs` + SSE.

5. **Session ID handling**. Corey passes `X-Hermes-Session-Id` header on `/v1/chat/completions` for session continuation. `/v1/runs` uses `previous_response_id` or `session_id` in body. Need to map.

6. **Does `/v1/chat/completions` stay as fallback?** If migration is incomplete at some branch, flag-gate the new path (e.g. env var `COREY_USE_RUNS_ENDPOINT=1`) so rollback is one flag flip.

## Upstream proposals (file after migration)

Even after we migrate to `/v1/runs`, these Hermes upstream changes would help:

### Proposal 1: emit approval events on `/v1/chat/completions` too

Problem: external OpenAI-compat clients can't show approval UI because approval events are absent on the standard endpoint. Even with our migration, any future third-party integration using Corey's Hermes gateway would hit the same wall.

Suggested change: add `register_gateway_notify` around the agent.run() call in `_handle_chat_completions`, emit `event: approval.request` on the OpenAI SSE stream.

### Proposal 2: `gateway/run.py:15066` plain-text approval prompt should use `locales/*.yaml`

Hermes 0.13.0 added 16 locales (commit c39168453) but didn't migrate this specific fallback message. Chinese IM users (WeChat / Slack) still see English "Dangerous command requires approval" jargon.

Suggested change: `msg = t("gateway.approval.fallback_prompt", cmd=cmd_preview, desc=desc)` where `fallback_prompt` lives in each `locales/{lang}.yaml`.

### Proposal 3: user-configurable DANGEROUS_PATTERNS

Problem: `tools/approval.py:305` hardcodes the DANGEROUS_PATTERNS list. Corey used to patch-inject extra patterns (rm/mv/cp/sed). Now that we don't patch, these broader patterns have no extension point.

Suggested change: `approvals.extra_patterns` key in config.yaml, each entry `{pattern: regex, description: str}`, merged into DANGEROUS_PATTERNS at load time.

### Proposal 4: more granular pre-tool hooks

See existing `docs/upstream-proposals/hermes-hook-granularity.md` — proposes `pre_file_ops` / `pre_shell` / `pre_code_execution` / `pre_browser_write` events instead of single `pre_tool_call` that fires on everything.
