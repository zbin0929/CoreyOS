# CoreyOS

[![CI](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml/badge.svg)](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml)
**English** | [中文](./README.zh-CN.md)

> A developer-first AI control plane built on [Hermes Agent](https://github.com/NousResearch/hermes-agent).
>
> Chat across any model, manage industry Skill Packs, orchestrate workflows, and route across messengers — all from one keyboard-first macOS / Windows app.

**Tauri 2** desktop app · **15 MB** binary · **50–100 MB** RAM · macOS 12+ / Windows 10+

---

## Features

### Chat & Multi-Agent

- 🤖 **Multi-model chat** — streaming SSE, tool progress, markdown rendering, syntax highlighting. Switch between DeepSeek, GPT-4o, Claude, Qwen, Kimi, Gemini, and local Ollama from the composer.
- 🔀 **Multi-agent console** — run multiple Hermes instances side-by-side, each with its own LLM profile, adapter, and budget.
- 📎 **File attachments** — drag-drop, paste, or file picker. PDF/Word/Excel content extraction. Per-agent sandbox scopes.
- 🔄 **Compare** models side-by-side — one prompt, N models in parallel.

### Knowledge & Memory

- 📚 **Knowledge base (RAG)** — upload documents, auto-chunk, search with Jaccard keyword matching or optional BGE-M3 semantic vector search with RRF fusion. Injected into every chat turn.
- 🧠 **Memory editor** — `MEMORY.md` + `USER.md` with syntax highlighting, capacity meter, FTS5 session search. Holographic fact store stats (fact count, categories, decay).
- 🎙️ **Voice** — push-to-talk ASR + TTS (OpenAI, Zhipu, Groq, Edge TTS).

### Workflow & Automation

- ⚡ **Workflow engine** — DAG-based workflow editor with conditional branching, loops, browser automation steps, and parallel execution.
- ⏰ **Scheduler** — cron prompts with output captured as Markdown.
- ✅ **Tasks & Approvals** — track agent-initiated tasks, approve or deny dangerous operations.
- 🛡️ **File Guard** — cross-platform file-ops-guard blocks destructive operations (delete/overwrite) on Desktop/Documents/Downloads with native confirmation dialog.

### Skills & MCP

- 🧩 **Skills Hub** — browse + install from 7+ community sources by wrapping the `hermes skills` CLI.
- 📦 **Skill Packs** — industry-specific bundles (views, skills, workflows, MCP servers, schedules) loaded via `manifest.yaml`. White-label via `customer.yaml`.
- 🔌 **MCP server manager** — stdio + URL transports, per-Pack MCP auto-registration, desktop-native tools (notifications, file picker, deep links).

### Observability

- 📊 **Analytics** — token usage, cost estimation, latency tracking, error rates, health radar, CSV export.
- 🕸️ **Trajectory** — visualize past sessions as a timeline of messages and tool calls. Nested subagent delegation trees. Per-message token/latency stats.
- 💰 **Budgets** — per-model / per-profile spend caps with 80% warnings.
- 📜 **Logs** — real-time gateway + agent log viewer.

### Platform & Channels

- 📡 **16 messaging gateways** — Telegram, Discord, Slack, WeCom, WeChat, Feishu, Matrix, WhatsApp, Signal, DingTalk, Email, SMS, iMessage, Mattermost, Webhooks, Home Assistant.
- 🧰 **LLM profile library** — define `{provider, base_url, model, api_key_env}` once on `/models`, reuse across agents. 11 pre-built provider templates including 6 domestic Chinese LLMs.
- ⌨️ **Keyboard-first** — `⌘K` palette, every page reachable by shortcut.
- 🌏 **中文 + English** — full zh-CN localization; auto-detects locale.

---

## Screenshots

_Screenshots coming with v0.3.0 release._

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

## Pages

| Page | Description |
|------|-------------|
| **Chat** | Multi-model streaming chat with tool progress, slash commands, attachments, and token tracking |
| **Home** | Dashboard with onboarding checklist, Hermes status, and quick actions |
| **Workflows** | DAG workflow editor with browser automation, conditionals, and scheduling |
| **Tasks** | Agent-initiated task tracking with approval flow |
| **Models** | LLM profile library — define once, reuse across agents |
| **Skills** | Browse, install, and manage Hermes skills from 7+ sources |
| **Knowledge** | Upload documents → auto-chunk → keyword/semantic search → inject into chat |
| **Memory** | Edit MEMORY.md / USER.md, view holographic fact store stats |
| **MCP** | MCP server manager — stdio + URL transports, desktop-native tools |
| **Channels** | 16 messaging gateways (Telegram, Discord, WeCom, etc.) |
| **Trajectory** | Session timeline — messages, tool calls, subagent trees, token/latency stats |
| **Analytics** | Token usage, cost, latency, error rates, CSV export |
| **Logs** | Real-time gateway + agent log viewer |
| **Budgets** | Per-model / per-profile spend caps |
| **Settings** | Provider config, profiles, voice, scheduler, runbooks, terminal, and more |

---

## Status

| Milestone | Status |
|---|---|
| Phase 0–12 (Foundation → File Intelligence) | ✅ All shipped |
| v0.2.0 (White-label + Pack loader + 12 view templates + license + analytics) | ✅ Shipped |
| v0.2.13 (Windows file-ops-guard fix, cross-platform dialog) | ✅ Released |
| v0.3.0 (Cross-border e-commerce Pack) | 🔧 In progress |

Test totals: Rust **555** · Vitest **112** · Playwright **77** · all green.

Full roadmap in [`docs/05-roadmap.md`](./docs/05-roadmap.md); changelog in [`CHANGELOG.md`](./CHANGELOG.md).

---

## Architecture

Tauri 2 desktop app (single binary, no Electron).

- **Rust** (`src-tauri/`): 193+ IPC commands, SQLite session store, sandbox gate, Pack loader, workflow engine, MCP stdio bridge, knowledge base (Jaccard + BGE-M3 RAG), file-ops-guard, adapter layer for Hermes `/v1/chat/completions`.
- **TypeScript** (`src/`): React 18 + TanStack Router, zustand stores, Tailwind + shadcn-style components, 12 Pack view templates.
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
