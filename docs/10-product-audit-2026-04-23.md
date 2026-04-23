# Product audit · 2026-04-23 pm

Every feature Corey ships or plans to ship, classified as:

- **KEEP** — genuinely unique to Corey, Hermes can't/doesn't do it.
- **SURFACE** — Hermes already does the work; Corey should wrap the upstream capability in a nice UI rather than build a parallel implementation.
- **DROP** — fully redundant with Hermes; abandon.

The goal of this audit is to stop shipping code that duplicates what Hermes already does better, and to redirect effort toward what only Corey can uniquely provide.

**Context**: triggered by `docs/hermes-reality-check-2026-04-23.md`, which surfaced that three of our eight channels are silently broken AND that several major planned features duplicate Hermes-native capabilities we weren't aware of.

## Guiding principle

> Corey is a desktop **UI** on top of Hermes. When Hermes owns the logic, Corey owns the pixels. We don't run parallel engines.

Exceptions (KEEPs) are features where either:
1. Hermes genuinely has nothing comparable, OR
2. Hermes has a CLI/TUI version but a desktop GUI form is a meaningful UX unlock, OR
3. The feature orchestrates *multiple* Hermes instances or *non-Hermes* adapters.

## Already-shipped features

| Feature | Status | Classification | Action |
|---------|--------|----------------|--------|
| Tauri desktop shell + ⌘K palette + dark gold design | Phase 0 shipped | **KEEP** | Core identity; Hermes doesn't have a GUI. |
| Chat core (SSE, sessions, attachments) | Phase 1 shipped | **KEEP** | GUI chat ≠ terminal chat. Desktop UX unlock. |
| Models page (Hermes `/v1/models` + env var editor) | Phase 2 shipped | **KEEP** | GUI around env keys + capability badges. |
| Analytics | Phase 2 shipped | **KEEP** | Hermes has `/usage` slash but no graph. |
| Logs viewer | Phase 2 shipped | **KEEP** | GUI log tail with search. |
| Settings (Sandbox, general) | Phase 2 shipped | **KEEP** | Wraps `config.yaml` editing. |
| **Profiles (multi-Hermes-install)** | Phase 2 shipped | **KEEP** | Hermes assumes one install. Corey manages N. Unique. |
| **Channels page (8 channels)** | Phase 3 shipped | **KEEP** (with T6.7a fixes) | Hermes has `hermes gateway setup` TUI wizard; GUI form + live status pill + verified badge is a real UX improvement. Must fix schema drift first. |
| `/health/channels` probe (log-parsed) | Phase 3 shipped | **KEEP** | Hermes exposes no native endpoint; we parse logs. Valuable until Hermes adds one. |
| Gateway restart | Phase 3 shipped | **KEEP** | GUI button around `hermes gateway stop/start`. |
| **Compare (multi-model side-by-side)** | Phase 4 shipped | **KEEP** | Hermes is one model per turn. Parallel comparison is a genuine Corey-only feature. |
| **Skills editor (CRUD + CodeMirror 6)** | Phase 4 shipped | **SURFACE needed** ⚠️ | Hermes has a full `hermes skills` CLI with browse/search/install from 7+ hub sources (official, skills-sh, well-known, github, clawhub, lobehub, claude-marketplace). We currently only edit a local SQLite table. **Action**: T7.4 plus a Skills refactor — read/write `~/.hermes/skills/**/SKILL.md` directly; add hub browse/install UI wrapping the CLI. Local SQLite mirror can stay for fast listing. |
| Runbooks | Phase 4 shipped | **KEEP** | Different concept from Hermes Skills — one-shot task templates with runtime param prompts. Not the same as reusable SKILL.md. |
| Budgets (80/100% gate) | Phase 4 shipped | **KEEP** | Hermes has `/usage` display but no enforcement. Budget cap is Corey-unique. |
| Trajectory (tree + replay) | Phase 4 shipped | **KEEP** | Hermes logs traces; GUI tree + replay is the value. |
| Terminal (PTY + multi-tab) | Phase 4 shipped | **KEEP** | In-app shell for quick ops; independent of Hermes. |
| Multi-agent console (Hermes + Claude Code + Aider) | Phase 5 shipped | **KEEP** | Hermes is itself one agent. Fronting N agents side-by-side is the signature Corey move. |
| Unified inbox (cross-adapter sessions) | Phase 5 shipped | **KEEP** | Only Corey has sessions from multiple backends in one list. |
| **Scheduler MVP (cron jobs with SQLite)** | Shipped 2026-04-23 am | **DROP** ❌ | Duplicates Hermes native cron entirely. See below for refactor proposal. |

## Planned features (Phase 6-8)

### Phase 6 · Orchestration

| Task | Classification | Action |
|------|----------------|--------|
| T6.1 Feedback loop 👍/👎 | **KEEP** | Chat-message feedback UI — Hermes has no equivalent. Stays in Phase 6. Note: if Scheduler is DROPped, T6.1 still delivers data for model/skill quality tracking. |
| T6.2 Multi-instance Hermes | **KEEP** | Only Corey manages N Hermes instances at once. |
| **T6.3 Supervisor/worker orchestration** | **SURFACE** ⚠️ | Hermes has native `delegate_task` tool with subagent spawning. **Refactor**: T6.3 becomes "visualise Hermes' native delegation tree in the Trajectory pane", not "build our own JSON-line protocol on top". Estimate: ~2 days (UI only) instead of ~5 days (protocol + UI). |
| T6.4 Rules-based routing | **KEEP** | Applies at Corey's multi-instance level (before dispatch). Hermes single-instance doesn't need it. |
| T6.5 Per-agent sandbox isolation | **KEEP** | Cross-instance `PathAuthority` is a Corey-level concern. Hermes has per-instance `config.yaml`, we need per-instance-in-one-process scoping. |
| **T6.6 Conversational scheduler** | **DROP** ❌ | Hermes cron already supports "Every morning at 9am, check HN and send me a summary on Telegram" natively via the `cronjob` tool. We'd be reimplementing Hermes' feature with worse coverage. |
| T6.7a Channel schema hotfix | **KEEP** | Must-do — fixes live bugs. ~1.5 days. |
| T6.7b Telegram e2e verification | **KEEP** | Fundamental validation. ~1.5 days. |
| T6.7c Extend to Discord/Slack/CN channel | **KEEP** | ~2 days. |

### Phase 7 · Expansion

| Task | Classification | Action |
|------|----------------|--------|
| T7.1 LangGraph adapter (sidecar Python) | **DROP / replace with MCP manager** ❌→🔄 | Hermes supports MCP natively. LangGraph can be exposed as an MCP server. Better work: build a **MCP server manager UI** (list, install, enable/disable) that wraps `~/.hermes/`'s MCP config. Estimate ~3 days instead of ~6. |
| T7.2 Skill-from-conversation distillation | **KEEP** (but re-aim) | Hermes has an `skill_manage` tool that creates skills autonomously, but it's agent-initiated. Corey's "Save this chat as skill" button is a user-initiated counterpart and complements it. Write output to `~/.hermes/skills/` directly so Hermes picks it up. |
| **T7.3 Long-term memory (qdrant + RAG)** | **SURFACE** ⚠️ | Hermes already has MEMORY.md + USER.md + session_search + optional Honcho dialectic modeling. **Refactor**: T7.3 becomes "Memory page" — a GUI editor for MEMORY.md and USER.md plus a search UI over `session_search`. No qdrant. Estimate ~3 days instead of ~6. |
| T7.4a OpenClawAdapter | **DROPPED** (already) | OpenClaw merged into Hermes. |
| T7.4b Skills importer | **SURFACE** 🔄 | Hermes has `hermes skills browse / search / install / inspect / audit` across 7+ hub sources. Corey's job is to GUI-wrap that CLI, not duplicate it. Estimate stays ~3 days. |

### Phase 8 · Multimodal (conditional)

| Task | Classification | Action |
|------|----------------|--------|
| T8.1 Push-to-talk voice | **KEEP** | Hermes has ElevenLabs TTS but no GUI push-to-talk. Desktop GUI unlock. |
| T8.2 TTS playback | **SURFACE** 🔄 | Hermes already has TTS via gateway; Corey UI just needs a speaker button that triggers upstream TTS, not a second TTS client. |
| T8.3 Video attachment surfacing | **KEEP** (tiny) | GUI pass-through; Hermes handles processing. |
| T8.4-5 Permission + audit | **KEEP** | Corey-layer concerns. |

## Scheduler — what to actually do

Our Scheduler MVP (shipped this morning, commit `7ea3ef4`) uses its own Rust worker + SQLite (`scheduled_jobs` table) + tokio cron. Hermes stores jobs in `~/.hermes/cron/jobs.json` and has its own scheduler. **This is pure duplication.**

**Proposed refactor** (call it T6.8, ships after T6.7):

1. **Delete** the Rust scheduler worker (`src-tauri/src/scheduler.rs`), the `scheduled_jobs` SQLite table, and the related IPC.
2. **Add** a thin JSON file reader/writer against `~/.hermes/cron/jobs.json`. Corey's Scheduler page becomes a GUI on top of that file + surfaces `~/.hermes/cron/output/{job_id}/*.md` runs.
3. **Bonus**: the page also shows the last N runs with output preview — we're the only GUI that makes those `.md` run logs easy to browse.
4. **Conversational job creation** (was T6.6) moves to a simple passthrough: user types the natural-language request → we POST it to Hermes' `cronjob` tool via the standard chat API. No secondary LLM call, no intent detection regex, no suggestion cards. **~0.5 days instead of ~4 days.**

Estimated work: ~2 days to rewrite Scheduler as Hermes-native wrapper, including migration of any locally-created jobs.

## Net impact on the roadmap

### Phase 6 · was 3–4 weeks → **1.5–2 weeks** after audit

| Task | Was | Now |
|------|-----|-----|
| T6.1 Feedback | 2d | 2d |
| T6.2 Multi-instance | 4d | 4d |
| T6.3 Orchestration | 5d | **2d** (visualise native delegate_task) |
| T6.4 Routing | 2d | 2d |
| T6.5 Sandbox | 3d | 3d |
| T6.6 Conversational scheduler | 4d | **0.5d** (reuse Hermes cronjob tool) |
| T6.7 Channel audit + e2e | 5d | 5d |
| **NEW T6.8 Scheduler refactor (Hermes-native)** | — | **2d** |
| **Total** | ~25d | ~20.5d |

### Phase 7 · was 3–4 weeks → **1.5 weeks** after audit

| Task | Was | Now |
|------|-----|-----|
| T7.1 LangGraph | 6d | **3d** (MCP manager UI instead) |
| T7.2 Skill distillation | 3d | 3d |
| T7.3 Memory | 6d | **3d** (GUI for MEMORY.md + session_search) |
| T7.4a OpenClawAdapter | 5d | **0d** (dropped) |
| T7.4b Skills importer | 2d | 3d (surface `hermes skills` CLI) |
| **Total** | ~22d | ~12d |

### Total Phase 6-8 solo estimate

Was ~13–15 weeks Phase 0 through 8. **Now ~11–12 weeks.**

This is ~3 weeks reclaimed that should NOT go into shipping more features. Instead:
- **Polish the KEEPs**: Compare, Trajectory, Budgets, Multi-agent console are Corey's signature. They deserve refinement passes.
- **Documentation**: `docs/hermes-reality-check-2026-04-23.md` proves we've been guessing. Document the integration contract with Hermes explicitly so this doesn't happen again.
- **User acquisition**: if the product is "Hermes' desktop GUI", we need real users of Hermes to validate it. Time spent on onboarding, demos, Discord presence might be worth more than more features.

## Decisions needed from the user

1. **Approve the classifications** above (especially the DROPs: Scheduler MVP refactor, T6.6 conversational scheduler, T7.1 LangGraph adapter → MCP manager).
2. **Approve the proposed T6.8** (Scheduler refactor to wrap Hermes cron). If yes, this probably goes in before T6.1.
3. **Approve proceeding with T6.7a first** (channel schema hotfix) since it's uncontroversial and fixes live bugs.
4. **Decide on Skills editor refactor timing** — Phase 7 or earlier? The current SQLite-backed Skills page isn't broken, just misaligned.

## Lessons (echoed from reality-check)

- Every upstream-dependent feature needs a **docs URL + source file citation** in its task spec. No more inferred behaviour.
- Default should be "wrap Hermes" not "build parallel". Only escalate to parallel if we can articulate *why* Hermes' version is insufficient.
- Doing a reality check AFTER shipping the Scheduler is less painful than doing it after shipping T6.6 + T7.1 + T7.3. Earlier is cheaper.

## What happens next

Once you approve this audit, I'll:

1. Update `@/Users/zbin/AI项目/hermes_ui/docs/05-roadmap.md` with the new estimates.
2. Update `@/Users/zbin/AI项目/hermes_ui/docs/phases/phase-6-orchestration.md` with the refactored T6.3, DROP'd T6.6, new T6.8.
3. Update `@/Users/zbin/AI项目/hermes_ui/docs/phases/phase-7-expansion.md` with SURFACE-ified T7.1 / T7.3.
4. Ship a one-line `@/Users/zbin/AI项目/hermes_ui/docs/06-backlog.md` note flagging the Scheduler MVP as "pending refactor to T6.8".
5. Then stop writing docs and wait for your greenlight to start T6.7a code.
