# 00 · Vision

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
- **Vector recall**: semantic search across sessions (augments Hermes' FTS5).
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

- **M1**: Phase 1 ships, a user can run Hermes + Corey and never need to touch the Hermes TUI again.
- **M2**: Phase 4 ships, at least one feature (multi-model compare, skill editor, or trajectory timeline) is demonstrably better than any alternative in the ecosystem.
- **M3**: Phase 5 ships, Corey can drive at least two non-Hermes agents through the same UI.
- **Perf**: lighthouse-equivalent smoothness on a $200 Chromebook-class device.

## Brand

- **Name**: `Corey`
- **Mark**: stylized C, single-line geometry, gold on obsidian.
- **Voice**: precise, unembellished, no emoji, no exclamation marks.
