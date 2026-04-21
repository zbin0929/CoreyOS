# Caduceus

> A premium, cross-platform control plane for AI agents.
> Starts with [Hermes Agent](https://github.com/NousResearch/hermes-agent), grows into a universal agent console.

**Status**: Phase 0 core shipped · runs via `pnpm tauri:dev` after install (see `SETUP.md`). CI / Storybook / e2e deferred to Phase 0.5 — see `CHANGELOG.md` for the full shipped/deferred breakdown.
**Tech**: Tauri 2 + Vite + React 18 + TypeScript + shadcn-style UI + Tailwind + TanStack Router/Query + Zustand.
**License** (planned): MIT.

---

## Why another Hermes UI?

The existing web UI [`EKKOLearnAI/hermes-web-ui`](https://github.com/EKKOLearnAI/hermes-web-ui) already covers 10 modules and 8 channel integrations. Caduceus is not a reskin — it aims to win on four axes simultaneously:

1. **Design** — Linear/Raycast-class visual quality, keyboard-first, ⌘K everywhere, polished mobile.
2. **Features** — multi-model side-by-side, visual skill editor, trajectory timeline, cost budgets & alerts, vector recall.
3. **Architecture** — single-process desktop app (Tauri), end-to-end type safety, plugin system, <100 MB RAM idle.
4. **Scope** — pluggable `AgentAdapter`: Hermes first, then Claude Code / Aider / OpenHands / custom.

---

## Documentation map

Start at `docs/00-vision.md` and read in order. Each Phase doc is self-contained and lists concrete tasks, acceptance criteria, file-level outputs, and rough estimates.

```
docs/
├── 00-vision.md              Product vision, positioning, differentiation
├── 01-architecture.md        System architecture, tech stack, data flow, repo layout
├── 02-design-system.md       Design tokens, typography, components, motion
├── 03-agent-adapter.md       The AgentAdapter interface (core abstraction)
├── 04-hermes-integration.md  How Caduceus talks to hermes-agent (gateway, CLI, files)
├── 05-roadmap.md             All phases at a glance, milestones, exit criteria
├── 06-testing.md             Unit / integration / e2e / visual regression strategy
├── 07-release.md             Build, code-signing, auto-update, distribution
└── phases/
    ├── phase-0-foundation.md       Project skeleton + shell + command palette
    ├── phase-1-chat.md              Real Chat + SSE + sessions + tool calls
    ├── phase-2-config.md            Models + Settings + Analytics + Logs + Profiles
    ├── phase-3-channels.md          8 platform channel integrations
    ├── phase-4-differentiators.md   Multi-model compare, skill editor, trajectory, budgets, terminal
    └── phase-5-multi-agent.md       Adapters for Claude Code / Aider / OpenHands
```

---

## Quick start

See `SETUP.md` for prerequisites (Node 20, pnpm 9, Rust stable, platform-specific webview deps).

```bash
pnpm install
pnpm tauri:dev        # desktop app
pnpm dev              # web-only preview (IPC calls will no-op)
```

First boot compiles Rust (~1–2 min). Subsequent runs take seconds.

---

## Phase status

| Phase | Title                     | Status               | Est. effort |
|------:|---------------------------|----------------------|-------------|
| 0     | Foundation                | **Core shipped**     | 1–2 days    |
| 0.5   | Hardening (CI, stories, e2e) | Open              | 1–2 days    |
| 1     | Chat core                 | Planned              | 3–4 days    |
| 2     | Config & Ops              | Planned | ~1 week     |
| 3     | Platform channels         | Planned | ~1 week     |
| 4     | Differentiators           | Planned | 1–2 weeks   |
| 5     | Multi-agent console       | Planned | ~1 week     |

Total: ~6 weeks of focused solo work.

---

## Naming

`Caduceus` (the twin-snake staff carried by Hermes) is a placeholder; it broadens the brand beyond a single agent. Swap globally via repo-wide rename if rejected.
