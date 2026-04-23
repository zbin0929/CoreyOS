# Phase 6 · Orchestration Core

**Goal**: Turn Corey from a single-agent control panel into a **multi-Hermes orchestration plane**. Users can run several Hermes instances side-by-side, have one instance delegate to others, and feed the results back through a single chat pane. Also lands the 👍/👎 feedback loop, rules-based routing, channel schema repair + e2e proof, and a Scheduler refactor to wrap Hermes' native cron.

**Est.**: ~2 weeks solo (post-audit, see `docs/10-product-audit-2026-04-23.md`). Was 3–4 weeks before the SURFACE/DROP reclassifications.

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

### T6.3 — Surface Hermes' native delegation · ~2 days (refactored 2026-04-23 pm)

**Re-scoped from ~5 days of building our own orchestration protocol to ~2 days of visualisation.** Reason: Hermes Agent natively ships a `delegate_task` tool that spawns isolated subagents for parallel workstreams (see [Hermes README features table](https://github.com/NousResearch/hermes-agent#readme) and `docs/user-guide/features` upstream). Building a parallel JSON-line protocol on top would be pure duplication.

- **No Orchestrator meta-adapter.** Drop the `adapters/orchestrator/` plan. `HermesAdapter` stays single-instance.
- **Multi-instance UX still matters** (T6.2 is independent). User can pick which Hermes instance receives a turn; routing (T6.4) can auto-pick.
- **What we add on top**: when a Hermes assistant turn includes `delegate_task` tool calls in its SSE stream, render them as a nested tree in the existing `TrajectoryView` with:
  - One parent node per top-level assistant turn.
  - Child nodes for each `delegate_task` call, each expandable to show the sub-turn's messages + tool calls (recursive).
  - Live progress via the existing `ChatStreamEvent::ToolProgress` plumbing — no new event types needed.
- **Chat bubble flavour**: if a turn contains delegations, `MessageBubble` grows an "N sub-tasks" pill that opens the tree.
- **Tests**: 2 Rust (parse `delegate_task` tool-call shape, nested progress propagation) + 1 Playwright (send a prompt that triggers a real delegation, verify sub-tree renders).

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

### T6.6 — Conversational scheduler — **DROPPED** (2026-04-23 pm)

**Reason**: Hermes cron natively supports natural-language creation. From the upstream docs:

> Ask Hermes normally: "Every morning at 9am, check Hacker News for AI news and send me a summary on Telegram." Hermes will use the unified `cronjob` tool internally.

Reimplementing this with a regex gate + secondary LLM call + suggestion card would be strictly worse. When Corey's Scheduler page is refactored to wrap `~/.hermes/cron/jobs.json` (T6.8 below), the "conversational creation" path becomes trivial: the user just talks to Hermes as usual; Corey's page refreshes when a new job lands in the JSON file.

Reclaimed: ~4 days.

### T6.7 — Channel schema audit + e2e verification · ~5 days (was ~3)

**Progress (2026-04-23 pm)**:
- ✅ **T6.7a shipped** — channel schema hotfix. Catalog reconciled vs `hermes-agent` upstream; 3 live bugs gone; WeChat QR stack deleted. 146 Rust tests pass, +2 new schema-lock tests (`no_channel_uses_qr_login_post_t6_7a`, `t6_7a_schema_fixes_in_place`). Frontend: TSC clean, lint clean, Vitest 27/27.
- ⏳ T6.7b — Telegram smoke test + `channels_verified.json` + badges.
- ⏳ T6.7c — Discord / Slack / CN channel verification.



**Scope expanded on 2026-04-23 pm** after reading the Hermes Agent upstream docs (`docs/hermes-reality-check-2026-04-23.md`). T6.7 now covers both fixing silently-broken channels and proving at least one end-to-end.

### T6.8 — Scheduler refactor (wrap Hermes native cron) · ~2 days (NEW, replaces T6.6)

**Progress (2026-04-23 pm)**:
- ✅ **T6.8 shipped** — deleted Rust worker (`src-tauri/src/scheduler.rs`) + SQLite `scheduler_jobs` table + related IPCs. Reimplemented as thin wrapper over `~/.hermes/cron/jobs.json` via new `hermes_cron.rs` module. Added Runs drawer to Scheduler page that surfaces `~/.hermes/cron/output/{job_id}/*.md` with previews. DB migration v7 exports legacy rows to JSON if `jobs.json` doesn't exist. 150 Rust tests pass, +4 new tests in `hermes_cron.rs`. Frontend: TSC clean, lint clean, Vitest 27/27.

### T6.1 — Feedback loop (👍/👎 per assistant reply) · ~2 days

**Progress (2026-04-23 pm)**:
- ✅ **T6.1 shipped** — per-message rating: DB migration v8 adds `feedback TEXT` column to `messages` (nullable; legal values `'up' | 'down' | NULL`), `set_message_feedback` DB method + `db_message_set_feedback` IPC command, `upsert_message` COALESCEs to preserve ratings across content-only upserts. Frontend: `FeedbackButtons` under every completed assistant bubble (click to toggle, click same to clear), `setMessageFeedback` zustand action fire-and-forgets IPC. Analytics: new `FeedbackStrip` card showing 👍 count, 👎 count, Helpful-rate %, and coverage vs lifetime messages. 153 Rust tests pass, +3 new tests (`t61_*`). Frontend: TSC clean, lint clean, Vitest 27/27. Deferred: "why was this bad?" freetext, per-adapter ratio rollups, RLHF export.



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

### T6.8 — Scheduler refactor: wrap Hermes' native cron · ~2 days (NEW, 2026-04-23 pm)

**Motivation**: the Scheduler MVP shipped this morning duplicates Hermes' native cron. Hermes stores jobs in `~/.hermes/cron/jobs.json`, runs `cronjob(action=...)` as an agent-facing tool, accepts natural-language schedules, and writes run outputs to `~/.hermes/cron/output/{job_id}/{timestamp}.md`. Corey shipping its own Rust worker + SQLite table is pure duplication (see `docs/10-product-audit-2026-04-23.md`).

- **Delete** `src-tauri/src/scheduler.rs` + the `scheduled_jobs` SQLite table + related IPC (`scheduler_list`, `scheduler_upsert`, `scheduler_delete`).
- **Add** a JSON-file accessor over `~/.hermes/cron/jobs.json`:
  - `scheduler_list()` → deserialise `jobs.json`.
  - `scheduler_upsert(job)` → serialise + atomic write back. `job` matches Hermes' schema (fields: `id`, `schedule`, `prompt`, `skills[]`, `name`, `model`, `provider`, `paused`, `repeat`, etc.).
  - `scheduler_delete(job_id)` → atomic remove.
  - `scheduler_runs(job_id)` → list files under `~/.hermes/cron/output/{job_id}/` with parsed front-matter + preview. **New capability** only Corey has — a GUI log browser for cron output.
- **Update the Scheduler page**: unchanged layout, but the underlying IPCs now read/write Hermes' state. A new "Runs" drawer on each job card surfaces the last 10 `.md` outputs.
- **Migration path**: any jobs in the legacy SQLite table get auto-exported to `jobs.json` format on first boot after T6.8 ships. One-time on-screen notice.
- **Bonus**: because Hermes' schedule format accepts `"every 2h"`, `"30m"`, ISO timestamps, and classic cron expressions (see upstream docs), we get richer scheduling than our hand-rolled cron crate supported.
- **Tests**: 3 Rust (roundtrip `jobs.json`, migration from SQLite, atomic write on corrupt file) + 1 Playwright (create a job from the GUI, verify it appears in `~/.hermes/cron/jobs.json`; click a run to see its `.md` content).

## Test totals target (post-audit)

- Rust unit: **+15** (3 feedback + 4 multi-instance + 2 delegation-surface + 6 routing + 3 scheduler-refactor + 1 sandbox)
- Playwright: **+6** (feedback, multi-instance, delegation tree, routing pill, sandbox isolation, scheduler-wrapped-cron)
- Manual smoke: ≥ 1 channel e2e verified with recorded `channels_verified.json` entry.
- No orchestrator conformance suite (no new adapter).

## Deltas vs the original brainstorm

| Brainstorm item | Landed in Phase 6 as |
|-----------------|----------------------|
| 2️⃣ 多 Agent 实例管理 (主管/员工) | T6.2 (multi-instance) + T6.3 (surface Hermes' native `delegate_task`) |
| 3.1 模型池 | T6.2 (each instance declares its model) |
| 3.2 智能路由 | T6.4 (rules-based, no ML) |
| 3.4 模型级联 | T6.3 (piggybacks on Hermes delegation; routing if needed) |
| 4.2 反馈回路 | T6.1 |
| 5.2 安全/权限 (per-agent 沙盒) | T6.5 |
| 5.4 策略配置 (失败 N 次切换) | T6.4 rules can include `after_n_failures` predicate as a follow-up |
| 对话式创建定时任务 | **DROPPED** — Hermes cron natively accepts natural language. |
| 平台通道真实打通验证 (post-Phase-3 debt) | T6.7 (Telegram first, reusable smoke-test recipe, `channels_verified.json`) |
| Scheduler UI shipped 2026-04-23 am | T6.8 (refactor to wrap `~/.hermes/cron/jobs.json`, delete duplicate engine) |

## Explicitly deferred out of Phase 6

- **Failure-count-based automatic fallback** (5.4 variant): `after_n_failures` predicate. Needs a failure-tracking layer that Phase 6 doesn't build; schedule for Phase 7 follow-up or later.
- **ML-driven routing**: deliberately no model in the path. Advanced users can author rules.
- **Cross-instance session sharing**: each instance's sessions still live in that instance's Hermes. Phase 7 memory layer may unify.

## Demo script (end-of-phase)

1. Open Settings › Agent. Add a second Hermes instance pointing at a different model. Save.
2. Open AgentSwitcher — see both instances listed, each with a role label.
3. Send a complex prompt ("Refactor this Python file and then write a unit test for it") to the default instance. If it invokes `delegate_task`, see a nested sub-tree in the `TrajectoryView` showing each delegated subagent's turn.
4. 👍 the final answer. Reopen Analytics, see the 👍 rate blip up.
5. Open Settings › Routing. Add a rule `lang == zh → hermes-deepseek`. Send a Chinese message; see the "Routed to: deepseek" pill.
6. In chat, say "Every morning at 9am, check HN for AI news and send me a summary on Telegram." Hermes creates the cron job natively. Open Scheduler page — the new job is there, sourced from `~/.hermes/cron/jobs.json`.
7. Click the job. See its last runs as a `.md` preview drawer (sourced from `~/.hermes/cron/output/...`).
8. Open Channels page. See ✅ "Verified 2026-MM-DD against Hermes @<sha>" on Telegram. Send "hello" to the registered bot from your phone; Corey's inbox shows the AI reply within a few seconds.
