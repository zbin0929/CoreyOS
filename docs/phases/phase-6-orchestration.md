# Phase 6 · Orchestration Core

**Goal**: Turn Corey from a single-agent control panel into a **multi-Hermes orchestration plane**. Users can run several Hermes instances (different models, roles, permissions) side-by-side, have one instance delegate to others, and feed the results back through a single chat pane. Also lands the long-overdue 👍/👎 feedback loop, a rules-based routing layer, conversational scheduling, and — critically — the first real end-to-end channel verification.

**Est.**: 3–4 weeks solo.

**Depends on**: Phase 5 complete (adapter registry, per-session `adapter_id`, AgentSwitcher, unified inbox).

## Positioning

This phase is where Corey's "control plane" story becomes **provably differentiated** from ChatGPT desktop / Claude Code / any single-agent UI. Competitors either run one agent well (Cursor, Claude Code) or stop at trace viewing (LangSmith, Langfuse). Phase 6 makes the **orchestration itself** a first-class visible-and-editable artifact on the desktop.

## Exit criteria

1. A single `AdapterRegistry` can hold **multiple live Hermes instances** simultaneously, each with its own `base_url`, role label, and model preference. `GatewayConfig` evolves from a single struct to `Vec<HermesInstance>` with one marked `default`.
2. A new **Orchestrator adapter** (internal, meta-adapter) presents as a regular `AgentAdapter` to the UI but internally fans out to multiple instances. When selected in AgentSwitcher, one chat turn may produce multiple inner turns rendered as a mini-trajectory.
3. Every assistant message in chat has a **👍 / 👎 button**. Feedback persists to SQLite (`message_feedback` table v7 migration) and surfaces in Analytics as "👍 rate per model / per adapter / per skill".
4. Routing rules — a user-editable YAML or JSON list — can direct a chat turn to a specific instance based on content triggers (code detection, language detection, attachment presence). No ML involved; pure declarative.
5. Each Hermes instance gets its own `PathAuthority` scope (per-instance workspace roots) so an "employee" instance can't silently read files outside the "manager" instance's sandbox.
6. At least **one platform channel is proven end-to-end** with a real bot token and a real human-sent message round-tripping through Hermes to an AI reply.
7. Users can say "每天早上 9 点发一份 GitHub issue 摘要" in chat and get a scheduled job created — without hand-writing a cron expression. (Stage 1 + Stage 2 of `docs/09-conversational-scheduler.md`.)
8. All user-facing strings land in `i18n` with zh/en parity from day 1.

## Task breakdown

### T6.1 — Feedback loop (👍/👎 on assistant messages) · ~2 days

The smallest, highest-leverage item on the phase. Ships alone as the first PR.

- **DB**: `message_feedback` table — `(message_id PK, session_id, rating INT {-1,0,1}, note TEXT NULLABLE, created_at, updated_at)`. Migration v7.
- **Rust**: three IPC — `feedback_get(message_id)`, `feedback_set(message_id, rating, note?)`, `feedback_summary(filter)` (aggregates per adapter / model / skill for Analytics).
- **Frontend**:
  - `MessageBubble.tsx` — add two buttons at the bottom-right of assistant bubbles (👍/👎, outline when unset, filled when set). Optional text-note popover on 👎.
  - Analytics page — add a row: "Thumbs-up rate by model" with the existing chart primitives.
- **Tests**: 3 Rust unit tests (round-trip, summary aggregation, NULL-note handling) + 1 Playwright e2e (click 👍 → reload session → still green).
- **i18n**: 5 new keys (`feedback.up`, `feedback.down`, `feedback.note_placeholder`, `feedback.thanks`, `analytics.feedback_title`).

### T6.2 — Multi-instance Hermes · ~4 days

- **Config schema v2**: `GatewayConfig.instances: Vec<HermesInstance>` where each instance has `id`, `name`, `base_url`, `role` (free-text: "manager" | "worker" | "reviewer" | custom), `model_hint` (optional), `sandbox_scope_id`. One instance is `default: true`.
- **Migration**: legacy single-`base_url` config auto-upgrades into `[{id: "default", name: "Default", base_url: <old>, role: "general"}]` on first load; write back on next save.
- **Adapter layer**: `HermesAdapter` becomes `HermesAdapter::new(instance_config)`; `AdapterRegistry::register("hermes-default", ...)` + `register("hermes-worker-1", ...)` ad lib. Registry maps ID → adapter arc.
- **Settings UI**: the current Settings › Agent page becomes a list with add/remove/reorder; per-row editor has the fields above + a "Test" button hitting `config_test` for that one instance.
- **Chat routing**: `chat_stream_start` already takes an `adapter_id`; that's now any instance ID, not just `hermes`. AgentSwitcher lists all instances grouped by adapter type.
- **Tests**: Rust — round-trip `GatewayConfig` v1 → v2 migration; registry can hold 3 simultaneous live Hermes mocks. Playwright — create a second instance, switch to it, send a message, verify the adapter-id on the resulting session row.
- **Docs**: update `04-hermes-integration.md` with the multi-instance section.

### T6.3 — Supervisor / worker orchestration · ~5 days

The core of the phase. Ships behind a feature flag (`orchestrator.enabled`) until it's proven.

- **Orchestrator adapter** (`src-tauri/src/adapters/orchestrator/`): an `AgentAdapter` impl that:
  - Reads an `OrchestrationPolicy` from disk (per-session or global).
  - On `chat_stream`, calls a **manager instance** (a specific Hermes instance ID, configurable) with the user's turn + a system prompt that teaches it how to delegate.
  - Watches the manager's output for a **delegation marker** — we'll reuse an existing mechanism. Simplest v1: the manager emits JSON-lines `{"delegate": "worker-1", "prompt": "..."}`  in its stream; we parse those out, stream `chat_stream` on the named worker, and inject the worker's reply back into the manager's next turn.
  - Emits a custom `OrchestrationEvent` on the SSE stream (extension of `ChatStreamEvent`) so the frontend can render a nested tree in the chat pane.
- **Frontend**:
  - New `OrchestrationBubble.tsx` renders a collapsible "manager → worker" tree under a single assistant turn. Click to expand/collapse each worker's full output. Reuses `TrajectoryPill` primitives.
  - Settings › Orchestration page — policy editor (YAML textarea for v1, structured form later). Lists manager & eligible workers.
- **Limits**:
  - Depth-cap at 3 (manager → worker → sub-worker). Deeper delegations are rejected with a clear error.
  - Timeout-cap at 5 min per worker call.
  - Cost-cap via Budgets (already scoped per adapter; orchestrator turns bill the manager adapter + sum across workers).
- **Tests**: Rust — orchestrator emits correct events for a 1-manager-1-worker scenario using mocked adapters. Playwright — orchestrator policy → manager delegates to worker → both responses render in the same bubble.
- **Security**: orchestrator cannot be the manager AND a worker in the same turn (detected via ID comparison). Prevents infinite self-delegation.

### T6.4 — Rules-based routing · ~2 days

- Rules live in `routing.yaml` in the config dir. Schema:
  ```yaml
  rules:
    - if: "content_contains_code"
      then: "hermes-claude-sonnet"
    - if: "lang == zh"
      then: "hermes-deepseek"
    - if: "attachment.type starts_with image/"
      then: "hermes-gpt4o"
  default: "hermes-default"
  ```
- **Predicates** (hardcoded v1 set): `content_contains_code`, `content_length_gt(N)`, `lang == <code>`, `attachment.type starts_with <prefix>`, `attachment_count_gt(N)`.
- **Execution**: evaluated in `chat_stream_start` before the adapter is picked. UI shows a "Routed to: <instance name>" pill above the response if the chosen instance differs from the UI-selected one.
- **Editor**: Settings › Routing — YAML textarea with live validation via a new `routing_validate` IPC (returns parse errors + a preview of the rule evaluation against the current turn).
- **Tests**: 6 Rust unit tests covering each predicate + one Playwright e2e (add a rule, send a code message, verify the "Routed to" pill).

### T6.5 — Per-agent sandbox isolation · ~3 days

Currently `PathAuthority` is a singleton on `AppState`. Split it:

- **Scopes**: `SandboxScope { id, roots: Vec<WorkspaceRoot>, denylist_extras: Vec<String> }`. Each `HermesInstance` points to a `sandbox_scope_id`. A default scope is shared by legacy paths.
- **Runtime check**: `authority.check(path, op)` becomes `authority.check(scope_id, path, op)`. Adapters capture their scope ID at construction; every `sandbox::fs::*` call threads it.
- **UI**: Settings › Sandbox grows a scope tab. Default scope is the current behaviour; adding an instance with a custom scope is opt-in.
- **Security property**: a worker instance misbehaving (e.g. prompted to `rm -rf`) can't touch paths outside its scope. Demonstrated via a Playwright e2e where a worker with no roots tries to read `~/.ssh` and gets `sandbox_denied`.

### T6.6 — Conversational scheduler (natural-language job creation) · ~4 days

The base Scheduler (shipped 2026-04-23) makes users hand-write cron expressions. T6.6 adds two of the three stages from `docs/09-conversational-scheduler.md` — Stage 3 (native `tool_calls` in SSE) stays deferred until Hermes exposes it.

- **Stage 1: `/schedule` slash command** (~1 day)
  - New chat-input grammar: typing `/schedule` opens a lightweight form inline. Fields prefilled from surrounding context (if user pasted "every weekday 9am ...", parse attempts to pre-fill).
  - On submit, calls the existing `scheduler_upsert` IPC — zero new backend surface.
  - Tests: Playwright — slash-command opens form, submit creates a job visible on Scheduler page.

- **Stage 2: Post-turn intent detection + suggestion card** (~3 days)
  - After each user turn, a **cheap secondary LLM call** (the same active adapter, minimal system prompt: "Is this a request to schedule a recurring task? If yes, return strict JSON `{cron, prompt, name}`. If no, return `{skip: true}`.") evaluates whether to show a suggestion card.
  - Only triggers when the user message contains timing keywords (每天 / 每周 / every / daily / 定时 / schedule / remind ...). Cheap regex gate avoids wasting a round-trip on obvious non-matches.
  - Suggestion card appears below the assistant reply with "Create schedule" and "Dismiss" buttons. Never creates jobs automatically.
  - **Consent**: opt-in via Settings › Scheduler → "Suggest schedules from chat". OFF by default for privacy (every suggestion = one extra LLM call billed to active budget).
  - **Rate limit**: 1 suggestion per 5 turns per session, to avoid nagging.
  - Tests: Rust — regex gate + JSON-parse robustness. Playwright — enable the toggle, say "每天早上 9 点提醒我喝水", see the card, click Create, verify the job lands on the Scheduler page with the right cron + prompt.

- **Stage 3 explicitly deferred**: native `tool_calls` in the Hermes SSE stream. Reopens when Hermes exposes OpenAI-compatible tool calling on its gateway streams. Until then Stage 2's separate LLM call is the production path.

### T6.7 — Channel schema audit + e2e verification · ~5 days (was ~3)

**Scope expanded on 2026-04-23 pm** after reading the Hermes Agent upstream docs (`docs/hermes-reality-check-2026-04-23.md`). T6.7 now covers both fixing silently-broken channels and proving at least one end-to-end.

#### T6.7a — Channel schema hotfix · ~1.5 days

Three of our 8 channel configurations never reach Hermes because the env names don't match upstream:

- **WhatsApp**: replace `WHATSAPP_TOKEN` with `WHATSAPP_ENABLED` (bool), `WHATSAPP_MODE` (`bot`/`self-chat`), `WHATSAPP_ALLOWED_USERS`, `WHATSAPP_ALLOW_ALL_USERS`.
- **WeCom**: rename `WECOM_BOT_SECRET` → `WECOM_SECRET`. Add `WECOM_WEBSOCKET_URL`, `WECOM_ALLOWED_USERS`.
- **WeChat (→ WeiXin)**: **delete** `WECHAT_SESSION` + the entire QR provider stack (`src-tauri/src/wechat.rs`, `src-tauri/src/ipc/wechat.rs`, `src/features/channels/WeChatQr.tsx`). Replace with a plain text-input card using `WEIXIN_ACCOUNT_ID`, `WEIXIN_TOKEN`, `WEIXIN_BASE_URL` (default `https://ilinkai.weixin.qq.com`), `WEIXIN_DM_POLICY`, `WEIXIN_GROUP_POLICY`. Update i18n keys.
- **Slack**: add optional `SLACK_APP_TOKEN` (Socket Mode) alongside the existing `SLACK_BOT_TOKEN`. Show both as required with a hint "Socket Mode requires both".
- Update `src-tauri/src/channel_status.rs` to recognise the new slug `weixin` as a synonym for the old `wechat` (or migrate the slug cleanly).
- **Migration**: any user who filled `WECHAT_SESSION` or `WECOM_BOT_SECRET` or `WHATSAPP_TOKEN` in their `.env` gets a one-time migration notice on startup — "Your Hermes channel config has schema drift. See Settings → Channels." No silent rewrite of credentials.

#### T6.7b — Smoke-test protocol + Telegram first · ~1.5 days

- Write `@/Users/zbin/AI项目/hermes_ui/docs/channels-smoke-test.md` with per-channel recipes (credential source, Corey UI steps, Hermes restart, expected log lines, test message, fail modes).
- Run Telegram end-to-end first: BotFather → fill env → restart gateway → phone sends "hello" → AI reply shows up in Corey's inbox.
- Ship `channels_verified.json` in the Corey repo: `{ channel_id, last_verified_at, hermes_commit_sha, verifier, notes }`. Channels page renders ✅/⚠️ badges from this file.

#### T6.7c — Extend to Discord, Slack, and one CN channel · ~2 days

- Discord + Slack (with the new App Token field): validate with real bot tokens.
- Pick one CN channel (Feishu or DingTalk — DingTalk is a new card, see below) and verify.
- For each verified channel, append an entry to `channels_verified.json`.

#### Optional — surface missing Hermes channels

If T6.7a-c finishes ahead of schedule, add cards for any of these Hermes-native channels we don't currently expose: **Signal, Email, DingTalk, QQ, Mattermost, BlueBubbles (iMessage), Home Assistant, Webhooks**. Each is a ~1h addition to `channels.rs` + i18n. Deferred if time is tight — log in backlog instead.

**Explicit non-goal**: maintaining live test credentials in CI. One-time manual verification per channel, documented recipe, dated badge. Re-verify on demand (e.g. after a Hermes upgrade).

## Test totals target

- Rust unit: **+20** (3 feedback + 4 multi-instance + 6 orchestrator + 6 routing + 1 conversational-intent regex/parse)
- Playwright: **+7** (feedback, multi-instance, orchestrator tree, routing pill, sandbox isolation, `/schedule` flow, suggestion-card accept)
- Manual smoke: ≥ 1 channel e2e verified with recorded `channels_verified.json` entry.
- Conformance: orchestrator adapter must pass the existing suite.

## Deltas vs the original brainstorm

| Brainstorm item | Landed in Phase 6 as |
|-----------------|----------------------|
| 2️⃣ 多 Agent 实例管理 (主管/员工) | T6.2 (multi-instance) + T6.3 (orchestration) |
| 3.1 模型池 | T6.2 (each instance declares its model) |
| 3.2 智能路由 | T6.4 (rules-based, no ML) |
| 3.4 模型级联 | T6.3 (reuses the orchestrator rather than a separate feature) |
| 4.2 反馈回路 | T6.1 |
| 5.2 安全/权限 (per-agent 沙盒) | T6.5 |
| 5.4 策略配置 (失败 N 次切换) | T6.4 rules can include `after_n_failures` predicate as a follow-up |
| 对话式创建定时任务 (P3 backlog) | T6.6 (Stage 1 + 2; Stage 3 still deferred until Hermes `tool_calls`) |
| 平台通道真实打通验证 (post-Phase-3 debt) | T6.7 (Telegram first, reusable smoke-test recipe, `channels_verified.json`) |

## Explicitly deferred out of Phase 6

- **Failure-count-based automatic fallback** (5.4 variant): `after_n_failures` predicate. Needs a failure-tracking layer that Phase 6 doesn't build; schedule for Phase 7 follow-up or later.
- **ML-driven routing**: deliberately no model in the path. Advanced users can author rules.
- **Cross-instance session sharing**: each instance's sessions still live in that instance's Hermes. Phase 7 memory layer may unify.

## Demo script (end-of-phase)

1. Open Settings › Agent. Add a second Hermes instance pointing at a different model. Save.
2. Open AgentSwitcher. See both instances listed.
3. Switch to Orchestrator adapter. Send "Refactor this Python file and then write a unit test for it." Expect to see a tree in the bubble: manager → worker ("Refactor") → worker ("Test"). All three nodes expandable.
4. 👍 the final answer. Reopen the Analytics page, see the 👍 rate blip up for this session's adapter.
5. Open Settings › Routing. Add a rule `lang == zh → hermes-deepseek`. Send a Chinese message; observe the "Routed to: deepseek" pill.
6. Enable "Suggest schedules from chat" in Settings › Scheduler. Say "每天早上 9 点提醒我喝水" in chat. See the suggestion card below the reply; click Create; verify the job on the Scheduler page.
7. Open the Channels page. See the ✅ "Verified 2026-MM-DD against Hermes @<sha>" badge on Telegram. Pick up your phone, send "hello" to the registered bot, observe an AI reply arriving in Corey's inbox within a few seconds.
