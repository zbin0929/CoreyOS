# 00 · Vision

**Status as of 2026-05-02**: Phase 0–12 all shipped. v0.2.0 shipped (white-label + Pack loader + 12 view templates + license + analytics). Current release: **v0.2.2**. Next: v0.3.0 (cross-border e-commerce Pack). Business model: **B2B custom delivery only** (no SaaS). See `global-todo.md` for the locked product direction.

## One-line

> The control plane AI agents deserve — beautiful, fast, keyboard-first, and not locked to a single agent.

## Who it's for

- **Developers / heavy AI users** who need a control plane to manage agents, models, skills, and MCP servers.
- **Operations / automation users** who want repeatable workflows with approval gates and audit trails.
- **B2B customers** who need industry-specific Skill Packs (e.g. cross-border e-commerce) with local deployment.

Non-goals: enterprise RBAC, multi-tenant SaaS, consumer chat products, AI digital humans.

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
- Not a hosted SaaS. Single-binary desktop app, local deployment only. No accounts, no telemetry.
- Not an LLM router. Model routing lives in Hermes / your provider.
- Not a consumer product. B2B custom delivery; no app store, no subscription.

## Success metrics (self-imposed)

- **M1** ✅ (Phase 1): replace the Hermes TUI for everyday chat.
- **M2** ✅ (Phase 4): at least one best-in-class feature (multi-model compare, trajectory, cost budgets).
- **M3** ✅ (Phase 5): drive ≥ 2 non-Hermes agents through the same UI.
- **M4** ✅ (Phase 7): wrap Hermes native capabilities (MCP, Memory, Skill Hub, Scheduler) as thin GUIs.
- **M5** ✅ (v0.2.0): Pack architecture + white-label + license = B2B delivery pipeline ready.
- **M6** 🔧 (v0.3.0): first real industry Pack (cross-border e-commerce, 9 capabilities).

## Brand

- **Name**: `Corey`
- **Mark**: stylized C, single-line geometry, gold on obsidian.
- **Voice**: precise, unembellished, no emoji, no exclamation marks.
