# 09 · Conversational scheduler (design)

> **Status**: Design only (2026-04-23). Not yet implemented. Filed as a
> Phase 6+ roadmap item. The current Scheduler page (shipped the same
> day) requires users to hand-write cron expressions; this doc proposes
> how to let them create jobs via natural conversation instead.

## Goal

Let users create, update, and delete `scheduler_jobs` rows without ever
opening the Scheduler page — purely by chatting with the agent:

> **User**: 帮我每天早上 9 点总结昨晚的 GitHub Issues
>
> **Assistant**: 好的，我已经为你创建了一个定时任务，每天 09:00 执行。

And on the Scheduler page a new row appears, pre-configured with a sane
cron expression and the distilled prompt.

## Non-goals

- Replacing the Scheduler UI. The form-based editor stays as the
  authoritative management surface; conversational creation is additive.
- Fully-automated execution without user confirmation. Every
  conversation-driven write must go through an explicit user approval
  step (either a confirm button or a tool-call consent dialog). We will
  not write to `scheduler_jobs` purely from LLM intent.
- Scheduling non-Hermes adapters. Same constraint as the base
  Scheduler — only adapters with `capabilities().scheduler == true` are
  eligible, and today that's only Hermes.

## Candidate approaches compared

| Option | Mechanism | Cost | UX quality | External dependencies |
|--------|-----------|------|------------|-----------------------|
| **A. Post-turn intent detection** | After each assistant reply, fire a second `chat_once` asking the LLM "does this conversation imply a scheduled job?". Return strict JSON. Render an inline suggestion card under the message if confidence ≥ threshold. | Low (~300 LOC TS, +1 `chat_once` per gated turn) | Good — zero intrusion, user-initiated confirmation | None — reuses existing `chat_once` + `scheduler_upsert_job` |
| **B. Tool calling (OpenAI-compatible)** | Register a `create_scheduled_job` tool with Hermes. LLM decides when to invoke. Caduceus intercepts the `tool_calls` delta, pops a consent dialog, writes DB, returns the tool result to the model for a follow-up assistant turn. | Medium — requires extending the Hermes gateway + `ChatStreamEvent` enum with a `ToolCall` variant + an IPC to submit tool results | Excellent — truly conversational, single-turn | **Hermes-side change**: gateway must emit OpenAI-compatible `tool_calls` deltas in SSE. Hermes does not expose this today (only `tool.progress` progress events). |
| **C. Slash command** | `/schedule <cron> <prompt>` intercepted by the chat input before send. Same semantics as the Scheduler "new" button. | Trivial (~50 LOC) | OK — reliable but not "conversational"; users must learn syntax | None |
| **D. Keyword heuristic** | Frontend regex matches "每天/每周/定时/schedule/every day/…" in the user's message. If matched, show a subtle suggestion chip next to the send button. | Low | Weak — high false-positive rate (e.g. "每天都在加班"); no semantic understanding | None |

**Recommended path**: `C (immediately)` → `A (short-term)` → `B (long-term)`.
This mirrors how other LLM products evolved: hotkey → agent-initiated
suggestion → native tool-use.

## Recommended route

### Stage 1 — slash command `/schedule` (no LLM involved)

Smallest possible unlock. Users who already know cron can type:

```
/schedule 0 0 9 * * * 总结昨晚 GitHub Issues 的讨论
```

…and the chat input intercepts this before calling the adapter,
calling `schedulerUpsertJob()` directly and posting a system message in
the chat like "✅ Created job 'Daily GitHub summary' (cron `0 0 9 * * *`).
View in Scheduler page."

**Scope**:
- `src/features/chat/ChatInput.tsx` parses the prefix; validates cron
  via the existing `schedulerValidateCron` IPC before submitting.
- Failed parse → inline error under the input, nothing sent to Hermes.
- Successful → job written, system message appended locally (not part
  of the conversation history sent to the LLM).

**Why it matters**: buys power users a keyboard-only path, and lets us
validate the plumbing (chat → scheduler IPC → DB → worker reload) in a
minimal-surface feature before adding LLM intelligence on top.

### Stage 2 — post-turn intent detection (LLM-assisted suggestion)

After `chat_stream` completes its `done` event, run one more
`chat_once` with the following system prompt:

```
You are a background analyzer. The user just had the exchange below
with an assistant. Decide if the USER is requesting that something be
done on a recurring / scheduled basis (every day, every hour, every
Monday, etc.).

If YES, respond with STRICT JSON:
{
  "want_schedule": true,
  "name": "<short title, ≤ 40 chars>",
  "cron_expression": "<6-field cron: sec min hour dom mon dow>",
  "prompt": "<the exact text to send to the agent on each fire>",
  "confidence": <0.0 to 1.0>
}

If NO, respond with:
{ "want_schedule": false }

Use UTC for cron. If the user specifies a specific timezone, convert.
```

**Gating** (avoid firing this on every turn):
- Skip if user message < 20 chars.
- Skip if user message contains no time-adjacent keywords
  (`每天 每周 每月 每日 每小时 定时 周期 schedule daily weekly monthly hourly every …`).
- Skip if the previous turn already produced a suggestion (one per
  conversation window).
- Settings toggle: `chat.suggest_scheduled_tasks` (default: on).

**Rendering** — inline suggestion card under the assistant message:

```
┌──────────────────────────────────────┐
│ 🕐 看起来这是一个周期性任务           │
│ Daily GitHub summary                 │
│ 每日 09:00 UTC · confidence 0.92    │
│ [创建定时任务] [忽略]                │
└──────────────────────────────────────┘
```

Click "创建定时任务" → navigate to `/scheduler?name=…&cron=…&prompt=…`
with the form pre-filled. User clicks **Save** as normal — the critical
design point is that **we never write without an explicit form-level
save**, which also catches bad cron expressions through the existing
live validator.

**Data model**:
- `messages.schedule_suggestion_json TEXT` — DB v7 migration. Cache the
  JSON on the assistant message row so navigating away and back doesn't
  re-spend tokens re-detecting.
- Suggestion is part of the rendered message until the user clicks
  "忽略" (sets a separate `schedule_suggestion_dismissed INTEGER`
  column) or "创建定时任务" (leaves it; a small ✓ badge replaces the
  call-to-action after the form is saved).

**Estimated scope**: ~400 LOC TS, one DB migration, zero Rust IPC
changes (reuses `chat_once` + existing `scheduler_*` IPC). Settings
page gains one toggle + i18n keys.

### Stage 3 — native tool calling

This is the end-state and becomes available only after the Hermes
gateway emits OpenAI-compatible `tool_calls` deltas in its SSE stream.
Tracked separately in the Hermes backlog.

**Interaction**:

```
[user]   帮我每天早上 9 点总结昨晚的 GitHub Issues

[assistant attempts tool call]
  ┌─────────────────────────────────────┐
  │ 🔧 Assistant wants to call a tool   │
  │                                     │
  │ create_scheduled_job                │
  │   name: Daily GitHub summary        │
  │   cron: 0 0 9 * * *                 │
  │   prompt: 总结昨晚 GitHub Issues…  │
  │                                     │
  │ [Allow] [Deny] [Always allow]       │
  └─────────────────────────────────────┘

[user clicks Allow → tool runs → result fed back]

[assistant] 已为你创建定时任务 "Daily GitHub summary",
           每天早上 9 点会自动执行。
```

**Plumbing changes**:

1. **Hermes gateway** — emit `tool_calls` deltas per OpenAI Chat
   Completions spec. Register `create_scheduled_job`,
   `update_scheduled_job`, `delete_scheduled_job`, `list_scheduled_jobs`
   as available tools when the client advertises support.
2. **Rust adapter** — extend `ChatStreamEvent` with:

   ```rust
   ToolCall { id: String, name: String, arguments_json: String }
   ToolCallResult { id: String, result_json: String }  // outbound
   ```

   Thread results back via a new `chat_tool_result` IPC.

3. **Frontend** — new `ToolCallBubble` component renders the consent
   dialog. On allow: dispatch to a tool router (keyed by `name`), which
   for `create_scheduled_job` calls `schedulerUpsertJob()` and posts
   the row back as tool output via `chatToolResult(callId, resultJson)`.
   Hermes resumes the assistant generation with that result in context.

4. **Security** — tool calls always require consent. An "Always allow"
   option stores per-tool, per-adapter trust in `settings.trusted_tools`
   (new table) so power users can opt out of the per-call prompt for
   low-risk tools like `create_scheduled_job`.

5. **Audit** — every tool call gets logged to `changelog.jsonl` with
   the full arguments. Revert-able from the Changelog page alongside
   config writes.

**Estimated scope**: 1–2 weeks, half on Hermes, half on Caduceus.

## Handling the "natural language time" problem

Both Stage 2 and Stage 3 rely on the LLM producing a valid 6-field cron
expression. Reality: LLMs routinely botch cron, especially around day-
of-week vs day-of-month, second-field presence, and timezones.

**Mitigations** (applied in this order):

1. **Prompt examples**: include a handful of gold examples in the
   system prompt (`"每天 9 点" → "0 0 9 * * *"`,
   `"每周一 10:30" → "0 30 10 * * MON"`).
2. **Backend validation**: the IPC already rejects invalid cron via
   `schedulerValidateCron`. In Stage 2 we show the error in the
   suggestion card instead of the cron preview, inviting the user to
   open the editor and fix it.
3. **Timezone disambiguation**: default to the user's system TZ
   (available via `Intl.DateTimeFormat().resolvedOptions().timeZone`).
   Include it in the system prompt so the LLM can convert
   "每天早上 9 点" from local to UTC. Store the user-visible form (local)
   alongside the canonical (UTC) cron so the Scheduler page can display
   "每天 09:00 (UTC+08:00)" rather than the raw cron.
4. **Fallback**: if parsing fails twice, the suggestion card degrades
   to "I noticed you mentioned a recurring task — [open scheduler
   prefilled with prompt only]". The user manually picks the cron.

## Open questions

- **Should we run the intent detector on the same Hermes model as the
  main conversation, or on a cheaper sidecar model?** Probably a
  settings knob: `chat.suggest_model` defaults to "same as chat" but
  advanced users can point it at a cheaper model.
- **How do suggestions interact with attachments?** A user who
  uploaded `backlog.md` and said "remind me weekly about this" should
  carry the attachment reference into the scheduled prompt. Decision:
  attachments are **not** carried — scheduled runs are fresh single
  turns, so the prompt must be self-contained. The detector is
  instructed to inline relevant context into `prompt`.
- **Do we support editing existing jobs conversationally?** Stage 2
  does not — the detector only emits `want_schedule: true` for creation
  intents. Stage 3 (tool calling) can naturally handle
  "delete the GitHub summary job" via `delete_scheduled_job` with
  lookup by name.
- **How does this play with Phase 6 memory?** If long-term memory is in
  scope, we might skip the detector and instead have the memory layer
  surface past scheduling intents. Deferred.

## Rollout plan

| Stage | PR size | User-visible | Feature flag | Owner |
|-------|---------|--------------|--------------|-------|
| 1. slash `/schedule` | XS | Power user only | off by default behind `chat.enable_slash_commands` | single-session work |
| 2. post-turn detection | M | All chat users | `chat.suggest_scheduled_tasks` (default on) | single-session work |
| 3. tool calling | L | All chat users | `chat.enable_tool_calls` (default off until Hermes exposes it) | joint Hermes + Caduceus |

## References

- Current Scheduler implementation: `src-tauri/src/scheduler.rs`,
  `src/features/scheduler/index.tsx` (shipped 2026-04-23, see
  CHANGELOG).
- Cron crate: <https://docs.rs/cron/0.12.1/cron/>
- OpenAI tool-calling spec: <https://platform.openai.com/docs/guides/function-calling>
- Hermes `tool.progress` SSE event (existing): see
  `src-tauri/src/adapters/hermes/gateway.rs` (`ChatStreamEvent::ToolProgress`).
