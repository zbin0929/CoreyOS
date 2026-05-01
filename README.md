# CoreyOS

[![CI](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml/badge.svg)](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml)

> A developer-first AI control plane built on [Hermes Agent](https://github.com/NousResearch/hermes-agent).
>
> Chat across any model, manage industry Skill Packs, orchestrate workflows, and route across messengers — all from one keyboard-first macOS / Windows app.

---

## Screenshots

_Screenshots coming with v0.3.0 release._

---

## What it does

- 🤖 **Multi-agent console** — run multiple Hermes instances side-by-side, each backed by its own LLM profile. Switch between DeepSeek, GPT-4o, Claude, Qwen, Kimi, and local Ollama from the chat composer.
- � **Skill Packs** — industry-specific bundles (views, skills, workflows, MCP servers, schedules) loaded via `manifest.yaml`. 12 built-in view templates. White-label via `customer.yaml`.
- �💬 **Chat** with any OpenAI-compatible model — streaming, multi-turn, with session history in a local SQLite DB.
- 🧩 **LLM profile library** — define `{provider, base_url, model, api_key_env}` once on `/models`, reuse across agents. 11 pre-built provider templates including 6 domestic Chinese LLMs.
- 📎 **Attach files** via drag-drop, paste, or file picker. PDF/Word/Excel content extraction. Per-agent sandbox scopes.
- 🧰 **Skills Hub** — browse + install from 7+ community sources by wrapping the `hermes skills` CLI.
- 🧠 **Memory editor** — `MEMORY.md` + `USER.md` with syntax highlighting, capacity meter, FTS5 search.
- 🔌 **MCP server manager** — stdio + URL transports, per-Pack MCP auto-registration.
- 📡 **Platform channels** — Telegram, Discord, Slack, WeCom, WeiXin, Feishu, Matrix, WhatsApp.
- 🔄 **Compare** models side-by-side — one prompt, N models in parallel.
- 📊 **Analytics** — token usage, cost estimation, latency tracking, error rates, health radar, CSV export.
- ⏰ **Scheduled jobs** — cron prompts, output captured as Markdown.
- 💰 **Budgets** — per-model / per-profile spend caps with 80% warnings.
- 🎙️ **Voice** — push-to-talk ASR + TTS (OpenAI, Zhipu, Groq, Edge TTS).
- ⌨️ **Keyboard-first** — ⌘K palette, every page reachable by shortcut.
- 🌏 **中文 + English** — full zh-CN localization; auto-detects locale.

---

## Install

Download the latest release from [GitHub Releases](https://github.com/zbin0929/CoreyOS/releases). For building from source, see **[SETUP.md](./SETUP.md)**.

### Prerequisites (runtime)

- **Hermes Agent** installed and reachable on its local gateway (usually `http://127.0.0.1:8642`). Install from [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/docs/quickstart). CoreyOS without Hermes runs in read-only stub mode — useful for tinkering but most features won't work.
- **Operating system**: macOS 12+ / Windows 10+.

### First run

Open the app → Home page. The onboarding checklist auto-detects:

1. **Connect to Hermes** — green chip = gateway reachable. Settings page if not.
2. **Pick a model** — any OpenAI-compatible provider, configured in Hermes itself.
3. **Start your first chat** — send a prompt. That's it.
4. **Set up your profile** — write one or two lines in Memory → User profile so the agent knows who you are.
5. **Connect a messenger** (optional) — Telegram / Discord / etc. from Channels.

Press `⌘K` anywhere to fuzzy-search across every page + runbook. Click the `?` icon next to any page title for in-context help.

---

## Status

| Milestone | Status |
|---|---|
| Phase 0–12 (Foundation → File Intelligence) | **✅ All shipped** |
| v0.2.0 (White-label + Pack loader + 12 view templates + license + analytics) | **✅ Shipped** |
| v0.2.2 (Current release) | **✅ Released** |
| v0.3.0 (Cross-border e-commerce Pack) | **🔧 In progress** |

Test totals: Rust **419** · Vitest **112** · Playwright **77** · all green.

Full roadmap in [`docs/05-roadmap.md`](./docs/05-roadmap.md); changelog in [`CHANGELOG.md`](./CHANGELOG.md).

---

## Architecture

Tauri 2 desktop app (single binary, no Electron).

- **Rust** (`src-tauri/`, 137 files, ~40K lines): 193 IPC commands, SQLite session store, sandbox gate, Pack loader, workflow engine, MCP stdio bridge, adapter layer for Hermes `/v1/chat/completions` + CLI.
- **TypeScript** (`src/`, 295 files, ~44K lines): React 18 + TanStack Router, zustand stores, Tailwind + shadcn-style components, 12 Pack view templates.
- **Data**: all state in `~/.hermes/` (config, skills, workflows, memory, MCP servers). No remote server.

More in [`docs/01-architecture.md`](./docs/01-architecture.md).

---

## Contributing

Start here:

- **[SETUP.md](./SETUP.md)** — build from source (Node 20, pnpm 9, Rust stable).
- **[`docs/01-architecture.md`](./docs/01-architecture.md)** — Rust ↔ TypeScript split, Pack architecture, data flow.
- **[`docs/03-agent-adapter.md`](./docs/03-agent-adapter.md)** — the `AgentAdapter` trait.
- **[`CHANGELOG.md`](./CHANGELOG.md)** — dated milestone entries.

Run `pnpm tauri:dev:clean` and start poking.

---

## Name

**CoreyOS** is the project. The Rust crate is `caduceus` (legacy name, not worth renaming). The app bundle is `Corey`.

---

## License

See [`docs/licensing.md`](./docs/licensing.md) for details.
