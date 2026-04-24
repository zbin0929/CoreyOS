# CoreyOS

[![CI](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml/badge.svg)](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml)

> A premium desktop control plane for [Hermes Agent](https://github.com/NousResearch/hermes-agent) and every other AI agent in your toolbox.
>
> Chat across any model, route across messengers, edit skills + memory + MCP servers — all from one keyboard-first macOS / Windows / Linux app.

---

## Screenshots

_TODO: drop a hero shot + 3 feature screenshots here once we have signed builds._

---

## What it does

- 💬 **Chat** with any OpenAI-compatible model (OpenAI, Anthropic, DeepSeek, local Ollama, …) — streaming, multi-turn, with session history in a local SQLite DB.
- 📎 **Attach files** via drag-drop, paste, or file picker. Per-agent sandbox scopes keep sensitive folders isolated.
- 🧰 **Skills Hub** — browse + install from 7+ community sources (official, skills-sh, clawhub, lobehub, …) by wrapping the `hermes skills` CLI.
- 🧠 **Memory editor** — `~/.hermes/MEMORY.md` + `USER.md` in a real editor with syntax highlighting, capacity meter, FTS5 search across past sessions.
- 🔌 **MCP server manager** — give agents access to Stripe, GitHub, Puppeteer, local filesystem, and any other Model Context Protocol server from one config page.
- 📡 **Platform channels** — Telegram, Discord, Slack, WeCom, WeiXin, Feishu, Matrix, WhatsApp — one sidebar, shared session store.
- 🔄 **Compare** models side-by-side — one prompt, N models in parallel, winner highlights.
- ⏰ **Scheduled jobs** — cron prompts, output captured as Markdown for later review.
- 💰 **Budgets** — per-model / per-profile / per-adapter spend caps with 80% warnings.
- 🎙️ **Keyboard-first** — ⌘K palette, every page reachable by number (⌘1..⌘9), inline `?` help on every complex screen.
- 🌏 **中文 + English** — full zh-CN localization; auto-detects browser locale.

---

## Install

_Releases coming soon._ For now CoreyOS builds from source — see **[SETUP.md](./SETUP.md)** for the developer workflow.

### Prerequisites (runtime)

- **Hermes Agent** installed and reachable on its local gateway (usually `http://127.0.0.1:8642`). Install from [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/docs/quickstart). CoreyOS without Hermes runs in read-only stub mode — useful for tinkering but most features won't work.
- **Operating system**: macOS 12+ / Windows 10+ / any Linux with a recent WebKit2GTK.

### First run

Open the app → Home page. The onboarding checklist auto-detects:

1. **Connect to Hermes** — green chip = gateway reachable. Settings page if not.
2. **Pick a model** — any OpenAI-compatible provider, configured in Hermes itself.
3. **Start your first chat** — send a prompt. That's it.
4. **Set up your profile** — write one or two lines in Memory → User profile so the agent knows who you are.
5. **Connect a messenger** (optional) — Telegram / Discord / etc. from Channels.

Press `⌘K` anywhere to fuzzy-search across every page + runbook. Click the `?` icon next to any page title for in-context help.

---

## Phase status

| Phase | Title | Status |
|---|---|---|
| 0 – 7 | Foundation → Agent expansion | **✅ All shipped** (2026-04-23) |
| 8 | Multimodal (voice / video) | Conditional — gated on product direction |

Test totals: Rust **192** · Vitest **46** · Playwright **72** · all green.

Full roadmap in [`docs/05-roadmap.md`](./docs/05-roadmap.md); dated milestone entries in [`CHANGELOG.md`](./CHANGELOG.md).

---

## Architecture

Tauri 2 desktop app. **Rust** side (`src-tauri/`) owns IPC, the SQLite session/attachment store, the sandbox gate, and a thin adapter layer that speaks to Hermes' OpenAI-compatible `/v1/chat/completions` + CLI. **TypeScript** side (`src/`) is React 18 + TanStack Router, zustand stores, tailwind + shadcn-style components. No Electron, no sidecar processes, no remote server — one binary talking to your local `~/.hermes/`.

More in [`docs/01-architecture.md`](./docs/01-architecture.md).

---

## Contributing

This is a solo hobby project for now, but contributions are welcome. Start here:

- **[SETUP.md](./SETUP.md)** — build from source (Node 20, pnpm 9, Rust stable).
- **[`docs/01-architecture.md`](./docs/01-architecture.md)** — Rust ↔ TypeScript split, data flow.
- **[`docs/03-agent-adapter.md`](./docs/03-agent-adapter.md)** — the `AgentAdapter` trait; add a new agent in ~200 lines.
- **[`CHANGELOG.md`](./CHANGELOG.md)** — read the last few entries to get a sense of pacing + decision-making style.

Run `pnpm tauri:dev:clean` and start poking.

---

## Name

**CoreyOS** is the project. The Rust crate is still named `caduceus` (earlier placeholder; renaming it would cascade through every `use caduceus_lib::…`). The app bundle is `Corey`. These three names are intentional and not a mistake to fix.

---

## License

MIT (planned — formal license file pending).
