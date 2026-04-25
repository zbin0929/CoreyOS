# 06 · Backlog (post-Phase-4)

Living list of everything we consciously **deferred** out of Phases 0–4.
Each item carries a priority, the reason it's parked, and — when
applicable — the trigger that should re-open it.

The six items we actually closed out before Phase 5 (T1.5c/d/e, T4.4b,
T4.6b, P2 profile revert) are documented in `CHANGELOG.md` and their
respective `docs/phases/phase-N-*.md` files; they're **not** listed
here.

Categories, newest-phase first:

- [Will not do (2026-04-23 reaffirmation)](#will-not-do-2026-04-23-reaffirmation)
- [T8 (Phase 7.5) follow-ups](#t8-phase-75-follow-ups)
- [P4 follow-ups](#p4-follow-ups)
- [P3 follow-ups](#p3-follow-ups)
- [P2 follow-ups](#p2-follow-ups)
- [P1 follow-ups](#p1-follow-ups)
- [Cross-cutting](#cross-cutting)

---

## Will not do (2026-04-23 reaffirmation)

On 2026-04-23 a brainstorm surfaced 8 major expansion directions
(multi-agent orchestration, smart routing, self-evolution, harness
engineering, video, voice, digital human/avatar, openclaw). After
weighing each against the `00-vision.md` Control-Plane positioning,
the following items are **explicitly rejected**. Re-opening any of
them requires a product-direction pivot, not an engineering decision.

### Digital human / avatar (the entire "8️⃣ AI 人" brainstorm item)

- **Why rejected**: conflicts with the "control plane for AI agents"
  positioning. Digital-human UX (2D/3D rigs, lip-sync, emotion
  expression, desktop floating window) is consumer-product surface
  area; every serious competitor (HeyGen, D-ID, Character.ai, Live2D
  ecosystems) is 100% consumer-facing and has 10× our team size.
- **Architectural mismatch**: Tauri single-window model doesn't
  accommodate a persistent desktop pet; embedding Unity / UE / even
  three.js + VRM rigs would bloat the bundle by 5–10×.
- **What we'd ship instead if this direction matters**: a separate
  product, `Corey Companion`, consuming Hermes via the same adapter
  surface. Not merged into this repo.
- **Re-open trigger**: **none**. This is a positioning decision, not a
  backlog item.

### Self-rewriting prompts / meta-optimisation (4.3 from brainstorm)

- **Why rejected**: research-frontier territory (DSPy, TextGrad,
  PromptAgent). Not a stable engineering capability. Building a
  half-working version ships worse UX than "user writes their own
  system prompt".
- **Re-open trigger**: a proven OSS implementation emerges that we
  can wrap as a skill, not build from scratch.

### Self-built task-DAG framework (5.1 from brainstorm)

- **Why rejected**: LangGraph, CrewAI, AutoGen, MetaGPT all have
  full-time teams and ≥ 2 years of momentum. Building our own
  orchestrator is NIH that we can't win.
- **What we ship instead**: T7.1 adapts LangGraph (or equivalent) as
  an `AgentAdapter` so Corey's UI can drive it without owning the
  graph runtime. See `docs/phases/phase-7-expansion.md`.
- **Re-open trigger**: existing DAG frameworks all die / pivot, and
  no alternative exists.
- **⚠️ RE-OPENED 2026-04-25**: Product direction pivot. These frameworks are all Python SDKs requiring code; CoreyOS targets non-technical users who need visual drag-and-drop orchestration. Dify (100k+ Stars) proved the commercial value. Phase 9 now owns this: `docs/phases/phase-9-workflow.md`.

### Desktop-side video processing (all of brainstorm item 6️⃣)

- **Why rejected**: ffmpeg-class dependencies would grow the Tauri
  bundle from ~30 MB to ~300 MB+. Local video analysis is also better
  served by cloud multimodal APIs (Gemini 2, GPT-4o) that are strictly
  out of Corey's data path (our job is to display results, not
  compete on model quality).
- **What we ship instead**: Phase 8 includes **surfacing Hermes video
  capabilities in the UI** (upload → show Hermes' video-analysis
  result). Corey itself never touches frames / codecs.
- **Re-open trigger**: Hermes gains first-class video tools and we
  need local pre-processing for bandwidth / privacy reasons.

### Always-on voice wake word (7.1 from brainstorm)

- **Why rejected**: a developer tool that listens to the microphone
  continuously is a trust non-starter. Battery drain, OS permission
  fatigue, and macOS privacy-indicator dot during coding sessions all
  compound.
- **What we ship instead** (conditional on Phase 8 running):
  push-to-talk only, via cloud ASR (OpenAI Realtime / Gemini Live).
- **Re-open trigger**: none. Push-to-talk stays the ceiling.

---

## T8 (Phase 7.5) follow-ups

### 字节豆包 (Volcengine Ark) provider template
- **Priority**: medium
- **Why parked**: vendor is OpenAI-compatible on paper but requires
  the user to create an "inference endpoint" in the Volcengine
  console first; the model field in our template has to then hold
  an opaque `ep-20XXXXXX…` reference, not a model name. Shipping a
  template without special UI (a "paste your endpoint id" affordance
  with a link to the console) would fail first-run for every user.
- **Re-open when**: a user requests it, or we decide to do a UI
  accommodation round for non-standard OpenAI-compat vendors
  (豆包 + Qianfan + possibly Mistral's European residency mode).

### 百度文心 (Qianfan) provider template
- **Priority**: low-medium
- **Why parked**: authentication is split across legacy AK/SK
  pair-auth (for classic ERNIE APIs) and newer Bearer tokens (for
  the V2 / OpenAI-compat mode). Our current template contract
  assumes "one env var with a Bearer token"; serving Qianfan
  cleanly needs an adapter-side branch in `adapters::*`, not a
  template entry.
- **Re-open when**: there's user demand and we're already touching
  adapter auth.

### Masonic card grid + side-Drawer editor
- **Priority**: low
- **Why parked**: user explicitly picked the lightweight
  "cards → full-screen focused edit" UX over the animated Masonic
  grid with a right-side Drawer. Current impl reads well in both
  light and dark mode and responds down to 1-col mobile.
- **Re-open when**: the /agents or /models page grows dense enough
  (20+ entries) that "full-screen edit takes you away from your
  grid" starts mattering.

### AgentWizard DetailsStep cardification
- **Priority**: low
- **Why parked**: Step 2 is still a vertical form stack. Splitting
  the id/label/api-key/model fields into grouped cards would help
  visual scanning but doesn't unlock new capability. Punt until a
  user complains about it specifically.

### Reachability badges on LLM profile cards
- **Priority**: low
- **Why parked**: `LlmProfileCard` currently doesn't know whether
  the most recent `hermes_instance_test` against that profile
  succeeded. A ✅/⚠ badge would be useful UX but needs either a
  background probe worker or a lazy-on-first-render ping, both of
  which add complexity.
- **Re-open when**: the grid grows past ~5 entries and users start
  losing track of which ones are actually live.

### Profile import/export + bulk env-var edit
- **Priority**: low
- **Why parked**: power-user sugar. Import/export (YAML or JSON
  round-trip) would help sharing configs across machines; a "rename
  env var X → Y across all profiles" bulk action would help API-key
  rotation. Neither unlocks new capability today.

---

## Upstream-alignment audits (2026-04-23 pm)

### Hermes native feature overlap audit
- **Priority**: high — affects Phase 6/7 scope.
- **Context**: `docs/hermes-reality-check-2026-04-23.md` surfaced that
  Hermes Agent already ships cron scheduling, Skills Hub, subagent
  delegation, FTS5 session search + memory, and MCP integration.
  Corey currently builds (or plans to build) parallel features for
  most of these.
- **What to do**: before starting each of T6.3 (orchestrator), T7.3
  (memory), and before touching Scheduler further, decide per-feature:
  **surface Hermes' native capability** vs **build parallel
  client-side**. Default should be "surface" unless the native
  capability is absent or UX-unsuitable.
- **Re-open when**: kicking off Phase 6 or revisiting the Scheduler.

### Missing Hermes channels to expose
- **Priority**: low-medium.
- **Context**: Hermes supports Signal, SMS (Twilio), Email, DingTalk,
  QQ, Mattermost, BlueBubbles (iMessage), Home Assistant, and
  Webhooks — none exposed in Corey's Channels page.
- **Re-open when**: T6.7 finishes ahead of schedule, or a user asks
  for any specific one.

---

## P4 follow-ups

### T4.2b · Skill editor — CodeMirror 6 + test-runner + version history
- **Priority**: low
- **Why parked**: `<textarea>` is fully sufficient for Markdown editing;
  CodeMirror is a heavyweight integration (syntax extensions, theming,
  a11y tuning). Test-runner and rollback need a skills-history schema
  that doesn't exist yet.
- **Re-open when**: a user hits a concrete UX wall (slow paste on 10k-
  line skills, need for multi-cursor, or explicit rollback demand).

### T4.5b · Web terminal — multi-tab / WebGL / paste-large / session restore
- **Priority**: low
- **Why parked**: single-tab MVP is adequate for "quick `ls`, `pwd`,
  `git status`" flows. Multi-tab needs a tab container + spawn/kill
  plumbing across IDs; WebGL renderer has a large bundle cost;
  paste-large guard and session restore are quality-of-life, not
  capability.
- **Re-open when**: the terminal starts getting used as a primary shell
  (then tab support moves above Phase 5).

### T4.6b · Runbook extras — JSON export/import, inline preview
- **Priority**: low
- **Why parked**: the scope filter (the primary T4.6b ask) shipped.
  Export/import is rare ops; preview is a polish item.
- **Re-open when**: users start sharing runbooks out-of-band.

### T4.4b · Budget interceptor — per-period windowing + per-model cost
- **Priority**: medium
- **Why parked**: `analyticsSummary` currently returns **lifetime**
  totals only, so honouring `budget.period` (day/week/month) would lie
  more than it helps. Per-model cost needs per-model token counts in
  the same summary.
- **Re-open when**: `analyticsSummary` gains a per-period bucket **and**
  per-model token breakdown. Both are small backend changes; the
  gate in `src/features/chat/budgetGate.ts` already has commented-out
  `// period-windowing` slots.

---

## P3 follow-ups

### Tencent iLink — real QR client
- **Status**: **CLOSED AS OBSOLETE on 2026-04-23 pm**.
- **Reason**: per `docs/hermes-reality-check-2026-04-23.md`, Hermes
  Agent's personal WeChat integration (WeiXin) hits
  `https://ilinkai.weixin.qq.com` directly with a plain token, no QR
  flow. Our entire `StubQrProvider` + future iLink client plan was
  based on a fictional flow. T6.7a deletes the QR stack and replaces
  it with a plain text-input card bound to `WEIXIN_ACCOUNT_ID` /
  `WEIXIN_TOKEN` / `WEIXIN_BASE_URL`.

### Explicit "Clear secret" button for env keys
- **Priority**: low
- **Why parked**: current flow (changelog revert or hand-editing
  `~/.hermes/.env`) is adequate. An explicit button ships cleanly
  only once we stop using "token presence" as the single source of
  truth in the UI — that cleanup is a larger refactor.
- **Re-open when**: the settings panel is being rewritten anyway.

### `/health/channels` probe
- **Priority**: low
- **Why parked**: Hermes doesn't expose this endpoint yet; our current
  `channel_status.rs` backend parses logs which works fine for
  present-day Hermes.
- **Re-open when**: Hermes ships `/health/channels`. The backend
  shortcircuit is a ~30-line addition.

### WhatsApp env name (`WHATSAPP_TOKEN` placeholder)
- **Status**: **ANSWERED on 2026-04-23 pm — folded into T6.7a**.
- **Reality**: Hermes has NO `WHATSAPP_TOKEN`. Real keys are
  `WHATSAPP_ENABLED` / `WHATSAPP_MODE` (`bot`/`self-chat`) /
  `WHATSAPP_ALLOWED_USERS` / `WHATSAPP_ALLOW_ALL_USERS`. Our save
  currently writes to a variable Hermes doesn't read.

---

## P2 follow-ups

### Profile data restoration on delete-revert
- **Priority**: low
- **Why parked**: `hermes.profile.delete` is `remove_dir_all` — the
  data is *gone*. Restoration needs either pre-delete snapshotting
  or a filesystem-level undo layer. The revert now recreates the
  shell with a seed `config.yaml`; users at least get their Hermes
  install back to a parseable state.
- **Re-open when**: we grow a snapshot/restore subsystem (potentially
  shared with Skills history in T4.2b).

### UI hint for irreversible-data reverts
- **Priority**: medium
- **Why parked**: shippable alongside anything that touches the Logs
  panel; out of scope for the dispatch-only P2 pass.
- **Re-open when**: next Logs panel redesign, OR if a user nukes
  important data by mistake.

### Profile tar.gz import / export
- **Priority**: low
- **Why parked**: needs a Tauri file-picker integration + a
  manifest-preview dialog. Niche until the user has many profiles.

### Per-profile gateway start / stop with port auto-resolution
- **Priority**: medium
- **Why parked**: gateway lifecycle is a cross-cutting concern we
  punted from Phase 3 too — needs a port-broker + process supervisor
  in Rust.
- **Re-open when**: active-profile switching is prioritised.

### Active profile switching
- **Priority**: medium
- **Why parked**: `~/.hermes/active_profile` is Hermes-owned; swapping
  safely requires first quiescing the gateway. Tied to the per-profile
  gateway work above.

### Streaming log tail (notify + SSE)
- **Priority**: low
- **Why parked**: manual refresh is adequate up to single-digit-MB log
  files. Streaming needs a `notify`-based watcher on the backend and
  an SSE/long-poll channel to the frontend.
- **Re-open when**: log volume genuinely warrants it.

---

## P1 follow-ups

### T1.5 advanced — configurable preview cap, lightbox, cache
- **Priority**: low
- **Why parked**: the hard-coded 5 MB cap and remount-per-image IPC
  are fine for current session sizes; upgrading them is strictly
  optimisation.
- **Re-open when**: profiling shows IPC storms, or users request a
  full-size view.

### T1.8 · Reconnect auto-poll
- **Priority**: low
- **Why parked**: the app works on next send after a gateway restart.
  An auto-health-poll that reconnects in the background is polish,
  not capability.
- **Re-open when**: users start running long-lived sessions against
  flaky gateways.

### T1.9 · 10k-message session virtualisation
- **Priority**: low
- **Why parked**: current `overflow-y-auto` with smooth scroll is
  comfortable up to a few thousand messages on an M1. Virtualisation
  is complex (breaks find-in-page, a11y quirks, etc.) and we have no
  user report of a perf wall yet.
- **Re-open when**: a user hits the wall.

---

## Cross-cutting

### Storybook + component catalog
- **Status**: **SHIPPED 2026-04-26 (Phase 11 T11.6)**. 8 component stories (Button, Kbd, EmptyState, Input, Select, Drawer, Card, Textarea).

### Vision-capability backfill from `/v1/models`
- **Status**: **SHIPPED 2026-04-26 (Phase 11 T11.4)**. `llm_profile_probe_vision` IPC probes `/v1/models`, detects vision-capable models, persists `vision: bool` on `LlmProfile`, renders purple "Vision" badge on profile cards.

### Attachment thumbnail caching across remounts
- **Status**: **SHIPPED 2026-04-26 (Phase 11 T11.5)**. `attachment_thumbnail` IPC caches base64 data-URLs at `~/.hermes/cache/thumbnails/`, keyed by path+mtime. Frontend uses cached version.

### Runbook scope filter — palette-mode toggle
- **Priority**: low
- **Why parked**: we deliberately pinned the palette to the active
  profile (no "show all" toggle) because palette UX should be
  tight. A future "/scope all" modifier could unlock it.
- **Re-open when**: users start using runbooks cross-profile in
  the palette.

(Icon batch-refactor shipped 2026-04-23; see CHANGELOG entry
"Brand · Corey logo + Icon wrapper + Dock/window polish".)

### Conversational scheduler (natural-language job creation)
- **Status**: **Stage 1 shipped 2026-04-26 (Phase 9 T9.9)**. Keyword-based
  `scheduler_extract_intent` + `workflow_extract_intent` IPCs detect schedule
  and workflow intents from chat messages, render inline SuggestionCard with
  one-click confirm. Stages 2–3 (LLM-assisted detection + tool calling) from
  `docs/09-conversational-scheduler.md` remain backlog items.
- **Design doc**: `docs/09-conversational-scheduler.md`.

### Platform channel e2e verification (post-Phase-3 debt)
- **Status**: **promoted into Phase 6 as T6.7** on 2026-04-23 pm.
- **What was missing**: Phase 3 shipped 8 channel configuration UIs
  but we never ran a real bot-token round-trip on any of them. Only
  configuration-write correctness was tested. Whether Hermes actually
  turns those creds into a working Telegram/Discord/Slack/... bot
  was unknown.
- **What T6.7 does**: ship `docs/channels-smoke-test.md`, prove
  Telegram end-to-end first, record outcomes in `channels_verified.json`,
  render a "✅ Verified / ⚠️ Not yet verified" badge on the Channels
  page. WhatsApp env-name ambiguity resolved as a side effect.
- **Re-open when**: a Hermes upgrade or a new channel is added. Each
  verified channel gets a fresh dated entry.
