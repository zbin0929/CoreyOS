# 00 · Vision

**Status as of 2026-04-23 pm**: Phase 0 – 7 shipped. M1 / M2 / M3 metrics (below) all hit. Phase 8 (multimodal) is conditional. Product direction is stable; next phase is polishing, documentation, and early user acquisition rather than more feature work. See `CHANGELOG.md` for dated milestone entries and `10-product-audit-2026-04-23.md` for the audit that reshaped Phase 6/7.

## One-line

> The control plane AI agents deserve — beautiful, fast, keyboard-first, and not locked to a single agent.

## Who it's for

- **Power users** running Hermes Agent (or any agent) as a personal assistant across Telegram/Discord/Slack/WhatsApp, on a VPS, laptop, or serverless.
- **Developers** building agents who need a clean cockpit to inspect traces, compare models, and iterate on skills.
- **Small teams** sharing a cost budget across multiple agents and models, who want visibility without standing up Grafana.

Non-goals: enterprise RBAC, multi-tenant SaaS, browser-only hosted offering. Single-user desktop-first, with an optional headless web mode for VPS scenarios.

## Positioning vs. existing tools

| Tool                          | What it is                              | Where Corey wins |
|-------------------------------|------------------------------------------|---------------------|
| `EKKOLearnAI/hermes-web-ui`   | Web dashboard for Hermes (Vue + Koa BFF) | Design, desktop integration, multi-agent, differentiators |
| Hermes built-in TUI           | Terminal interface for Hermes            | Rich UI, non-devs can use, cross-platform gateway visibility |
| LangSmith / Langfuse          | Observability for LLM apps               | End-user agent operations (channels, skills, cost), not just traces |
| OpenWebUI / LibreChat         | Chat UI for LLMs                         | Agent-native (skills, tools, schedulers, trajectories), not just chat |
| ~~OpenClaw~~ | ~~Peer competitor~~ → **superseded 2026-04-23 pm**. Per `hermes-agent`'s README (`hermes claw migrate`), OpenClaw is being **merged/migrated into Hermes Agent**, not a competitor. The previous "peer competitor" framing was based on reading OpenClaw's README without cross-checking Hermes'. See `docs/hermes-reality-check-2026-04-23.md` for the correction. |

## Differentiation axes (all four, staged)

### 1. Design
- Dark-first, gold accent (nod to Hermes' staff; distinct from the purple/blue AI UI crowd).
- Linear/Raycast information density, not "AI chat bubble" style.
- ⌘K command palette is the primary navigation; mouse is optional.
- Polished mobile (phones via the hosted web mode; Tauri mobile later).

### 2. Features the original lacks
- **Multi-model side-by-side**: same prompt, N models, stream all at once, diff the outputs.
- **Visual skill editor**: edit the prompt, tools, inputs/outputs of a skill with live preview; diff + rollback.
- **Trajectory timeline**: conversation rendered as a tree of turns + tool calls with durations, token costs, and replay.
- **Cost budgets & alerts**: per-model / per-profile / per-channel budgets; desktop notifications.
- ~~**Vector recall**: semantic search across sessions~~ → dropped 2026-04-23 pm per audit. Hermes ships native FTS5 + `MEMORY.md` / `USER.md`; we surface those instead (see Memory page, T7.3).
- **Automation runbook**: named, parameterized natural-language workflows, one-click run.

### 3. Architecture
- **Single process**: Tauri shell + Rust backend replaces the separate Koa BFF.
- **End-to-end typed IPC**: Tauri commands typed via `specta` → generated TS bindings.
- **Plugin system**: any `AgentAdapter` (or UI panel) can be dropped in without forking.
- **Performance budgets**: cold start <1 s, idle RAM <100 MB, 60 fps scroll on 10k-message sessions (virtualized).

### 4. Scope
- `AgentAdapter` interface decouples UI from Hermes specifics.
- Hermes adapter ships in Phase 1. Claude Code / Aider / OpenHands adapters in Phase 5.
- Users can run multiple adapters simultaneously; sessions from all agents unified in one inbox.

## What Corey explicitly is *not*

- Not a Hermes fork or rewrite. We consume Hermes via its public surface (gateway HTTP, CLI, config files).
- Not a hosted SaaS. Single-binary desktop app + optional self-hosted web mode. No accounts, no telemetry by default.
- Not an LLM router. Model routing lives in Hermes / your provider. We show, configure, and budget.

## Success metrics (self-imposed)

- **M1** ✅ (Phase 1, 2026-04-22): run Hermes + CoreyOS and never touch the Hermes TUI again — chat, sessions, channels, skills all accessible from the GUI.
- **M2** ✅ (Phase 4, 2026-04-22): at least one feature is demonstrably better than any alternative in the ecosystem. Candidates shipped: multi-model compare, trajectory timeline, cost-budget alerts.
- **M3** ✅ (Phase 5, 2026-04-23): drive ≥ 2 non-Hermes agents through the same UI. Claude Code + Aider adapters ship as mocks; users can add any OpenAI-compatible endpoint as a "Hermes instance" (T6.2) for real usage.
- **M4 (new, 2026-04-23 pm)**: wrap Hermes' native capabilities rather than duplicate them. MCP (T7.1), Memory (T7.3), Skill Hub (T7.4), and Scheduler (T6.8) all shipped as thin GUIs over upstream, not parallel engines.
- **Perf**: still self-imposed, not formally measured. Cold start <1 s and idle RAM <100 MB hold on a 2020 MacBook Air; no Chromebook-class benchmarks run yet.

## Brand

- **Name**: `Corey`
- **Mark**: stylized C, single-line geometry, gold on obsidian.
- **Voice**: precise, unembellished, no emoji, no exclamation marks.
