# CoreyOS

[![CI](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml/badge.svg)](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml)

> A premium desktop control plane for [Hermes Agent](https://github.com/NousResearch/hermes-agent) and every other AI agent in your toolbox.
>
> Chat across any model, route across messengers, edit skills + memory + MCP servers, all from one keyboard-first macOS / Windows / Linux app.

---

## What you can do in 5 minutes

1. **Chat** with any OpenAI-compatible model (OpenAI, Anthropic, DeepSeek, local Ollama, …) — streaming, multi-turn, with session history in SQLite.
2. **Attach files** via drag-drop, paste, or file picker. Per-agent sandbox scopes keep secrets isolated.
3. **Browse & install skills** from 7+ hubs (official, skills-sh, clawhub, lobehub, …) — wraps the `hermes skills` CLI.
4. **Edit memory** — `~/.hermes/MEMORY.md` (what the agent remembers) and `USER.md` (your profile) — in a real editor with syntax highlighting, not `vim`.
5. **Configure MCP servers** — give any agent access to Stripe, GitHub, Puppeteer, local filesystem, etc. via one config page.
6. **Route platform channels** — Telegram / Discord / Slack / WeCom / WeiXin / Feishu / Matrix / WhatsApp, all from the same sidebar.
7. **Compare models side-by-side** — one prompt, N models in parallel, winner highlights.
8. **Save conversations as skills** — optional LLM distillation one-click.

---

## Quick start

### Prerequisites

- **Hermes Agent** installed (`hermes --version`). If you don't have it: [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/docs/quickstart). CoreyOS talks to Hermes over its local gateway — without Hermes the app runs in read-only stub mode.
- Node 20 + pnpm 9 + Rust stable. See [`SETUP.md`](./SETUP.md) for platform-specific details.

### Install + run

```bash
git clone git@github.com:zbin0929/CoreyOS.git
cd CoreyOS
pnpm install
pnpm tauri:dev        # first build: ~1–2 min, then seconds
```

First launch shows an onboarding-light Home page. If Hermes is running on `http://127.0.0.1:8642` you'll see `Gateway online`; otherwise you can start it from the Home page (or `hermes gateway` in a terminal).

### First things to try

| I want to… | Where |
|---|---|
| Send my first prompt | **Chat** (⌘1) |
| See which models are detected | **LLMs** (⌘⇧M) |
| Edit what the agent remembers about me | **Memory** → `User profile` tab |
| Connect Telegram / Slack / … | **Channels** (⌘9) |
| Run a recurring prompt (daily standup, weekly digest) | **Scheduler** (⌘8) |
| Add an MCP server (filesystem, GitHub, …) | **MCP** → `Add server` |
| Find a past conversation | **Memory** → `Search history` tab |

Press `⌘K` anywhere for the command palette — fuzzy search across all pages + runbooks.

---

## Languages

- **中文 (zh-CN)** ✅ complete — auto-detected from browser locale
- **English** ✅ complete

Switch via `View → Language` (or the menu will follow the OS locale on first boot).

---

## Architecture (one paragraph)

CoreyOS is a Tauri 2 desktop app. The **Rust** side (`src-tauri/`) owns IPC, the SQLite session/attachment store, the sandbox gate, and the thin adapter layer that speaks to Hermes' OpenAI-compatible `/v1/chat/completions` + its CLI for skills/cron. The **TypeScript** side (`src/`) is React 18 + TanStack Router, zustand stores, tailwind + shadcn-style components. No Electron, no sidecar processes, no remote server — it's one binary talking to your local `~/.hermes/`.

Full architecture details in [`docs/01-architecture.md`](./docs/01-architecture.md).

---

## Documentation map

```
docs/
├── 00-vision.md              Product vision, positioning
├── 01-architecture.md        Rust ↔ TypeScript split, data flow, repo layout
├── 02-design-system.md       Design tokens, typography, motion
├── 03-agent-adapter.md       The AgentAdapter interface — how to wire a new agent
├── 04-hermes-integration.md  How CoreyOS talks to hermes-agent
├── 05-roadmap.md             Phase-by-phase status (Phase 0–7 shipped, 8 conditional)
├── 06-testing.md             Unit / e2e / visual regression strategy
├── 07-release.md             Build, code-signing, auto-update
├── 10-product-audit-2026-04-23.md   Upstream-overlap audit that reshaped Phase 6/7
└── phases/phase-N-*.md       One doc per phase with task-level detail
```

For changes, see [`CHANGELOG.md`](./CHANGELOG.md) — dated entries, one per milestone.

---

## Phase status

| Phase | Title | Status |
|---|---|---|
| 0 – 7 | Foundation → Agent expansion | **✅ All shipped** (2026-04-23) |
| 8 | Multimodal (voice / video) | Conditional — gated on product direction |

Test totals: Rust **192** · Vitest **46** · Playwright **72** · all green. See `docs/05-roadmap.md` for the full status matrix.

---

## Development

```bash
pnpm tauri:dev         # desktop app, hot-reload
pnpm tauri:dev:clean   # kills stale cargo/vite processes first
pnpm dev               # web-only preview (IPC calls no-op)
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint
pnpm test              # vitest
pnpm test:e2e          # playwright
cd src-tauri && cargo test    # rust
```

New to the codebase? Start at [`docs/01-architecture.md`](./docs/01-architecture.md), then read whichever `phases/phase-N-*.md` covers the area you want to touch.

---

## License

MIT (planned — formal license file pending).

---

## Name

**CoreyOS** is the project. The Rust crate is still named `caduceus` (from an earlier placeholder — renaming it would cascade through every `use caduceus_lib::…` in the codebase). The macOS / Windows app bundle is `Corey`. These are intentional and not a mistake you'd fix.
