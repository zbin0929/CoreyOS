# 01 · Architecture

## High-level

```
┌───────────────────────────────────────────────────────────────────┐
│                         Caduceus (Tauri app)                      │
│                                                                   │
│  ┌──────────────────────────┐      ┌──────────────────────────┐   │
│  │  Frontend  (React SPA)   │◄────►│  Rust core  (Tauri 2)    │   │
│  │                          │ IPC  │                          │   │
│  │  • shadcn/ui + Tailwind  │      │  • HTTP client (reqwest) │   │
│  │  • TanStack Router/Query │      │  • SSE / WS streams      │   │
│  │  • Zustand (UI state)    │      │  • File I/O (~/.hermes)  │   │
│  │  • ⌘K command palette    │      │  • PTY (portable-pty)    │   │
│  │  • i18n (en / zh)        │      │  • Keychain (secrets)    │   │
│  └──────────────────────────┘      │  • AgentAdapter registry │   │
│                                    └──────────┬───────────────┘   │
└───────────────────────────────────────────────┼───────────────────┘
                                                │
                                                ▼
                 ┌───────────────────────────────────────────────┐
                 │  AgentAdapter implementations                 │
                 │                                               │
                 │  • HermesAdapter                              │
                 │     ├─ Gateway HTTP :8642 (OpenAI-compatible) │
                 │     ├─ Hermes CLI (sessions, logs, version)   │
                 │     └─ ~/.hermes/{auth.json, config.yaml,.env}│
                 │                                               │
                 │  • ClaudeCodeAdapter  (Phase 5)               │
                 │  • AiderAdapter       (Phase 5)               │
                 │  • OpenHandsAdapter   (Phase 5)               │
                 └───────────────────────────────────────────────┘
```

Key contrast with `hermes-web-ui`: no separate Koa BFF. Rust core owns everything the BFF did (proxy, SSE, file I/O, PTY, config writes), and the frontend talks to it via typed Tauri commands — no HTTP round-trip for local operations.

## Process model

- **1 process** (Tauri) with two logical halves: webview + Rust main.
- **0 long-lived subprocesses** owned by Caduceus. Hermes Gateway runs under its own profile manager; Caduceus only starts/stops it on demand.
- **Web-only mode** (`pnpm dev` without Tauri): Rust core is replaced by a thin Node shim that exposes the same command surface over HTTP, for VPS / phone scenarios. Designed from day 1 so adapters don't care which transport they're on.

## Tech stack (locked)

| Layer            | Choice                                     | Why                                              |
|------------------|--------------------------------------------|--------------------------------------------------|
| Shell            | Tauri 2                                    | Small binary, Rust core, native menus, auto-update |
| Frontend build   | Vite 5                                     | Fast HMR, canonical for Tauri                    |
| UI framework     | React 18                                   | Ecosystem, shadcn/ui availability                |
| Language         | TypeScript (strict)                        | Safety, refactorability                          |
| Router           | TanStack Router                            | Type-safe routes, search-param state             |
| Data fetching    | TanStack Query                             | Cache, streaming, retries                        |
| UI state         | Zustand                                    | Minimal, no context churn                        |
| Components       | shadcn/ui                                  | Own the source, restyle freely                   |
| Styling          | Tailwind CSS 3 + CSS variables             | Token-driven theming                             |
| Icons            | Lucide + custom glyph set                  | Consistent line weight                           |
| Charts           | Recharts (+ D3 for trajectory tree)        | Declarative for dashboards, D3 where needed      |
| Markdown         | react-markdown + remark-gfm + shiki        | Server-free syntax highlighting                  |
| Virtualization   | TanStack Virtual                           | 10k-message chat, 1k-row tables                  |
| Command palette  | cmdk                                       | Battle-tested, a11y-correct                      |
| Forms            | react-hook-form + zod                      | Type-safe validation                             |
| i18n             | react-i18next                              | en / zh out of the box                           |
| Animation        | Framer Motion                              | Layout transitions, modal motion                 |
| Testing          | Vitest + Testing Library + Playwright      | Unit + e2e; Playwright drives Tauri via webdriver |
| Rust HTTP        | reqwest + tokio + eventsource-stream       | SSE support, async-first                         |
| Rust PTY         | portable-pty                               | Cross-platform terminal                          |
| Rust IPC types   | specta + tauri-specta                      | TS types generated from Rust                     |
| Rust config      | serde_yaml, toml, dotenvy                  | Read/write Hermes configs                        |
| Rust secrets     | keyring                                    | OS keychain for tokens when possible             |

## Data flow — three canonical paths

### A. Chat streaming (hot path)

```
User input ─► Frontend Chat store
                │
                ▼
     invoke('chat_send', { sessionId, message })
                │
                ▼
     Rust: HermesAdapter.sendMessage()
                │
          POST /v1/chat/completions (stream=true) to Hermes gateway
                │
     SSE chunks ─► Tauri event 'chat:delta' with session-scoped payload
                │
                ▼
     Frontend subscribes via useChatStream(sessionId)
                │
                ▼
     React reducer appends deltas, re-render is virtualized
```

- Backpressure: Rust side buffers with a bounded channel (capacity 256 chunks) and drops intermediate re-renders if frontend is behind; final message is always consistent.
- Cancellation: `invoke('chat_cancel', { sessionId })` drops the HTTP connection and emits `'chat:cancelled'`.

### B. Configuration write (safety-critical)

```
User edits form (Telegram token) ─► react-hook-form + zod validate
                │
                ▼
     invoke('config_set', { path: '.env', key: 'TELEGRAM_BOT_TOKEN', value })
                │
                ▼
     Rust:
       1. load existing ~/.hermes/.env
       2. write atomically (tmpfile + rename)
       3. fsync
       4. compute diff, return { before, after }
                │
                ▼
     Frontend shows diff modal, user confirms gateway restart
                │
                ▼
     invoke('gateway_restart', { profileId })
```

Every config write is atomic, produces a diff, and is journaled to `~/.caduceus/changelog.jsonl` for undo.

### C. Terminal (PTY)

```
Frontend opens tab ─► invoke('pty_spawn', { cwd, cols, rows, env })
                          │
                          ▼
     Rust spawns shell via portable-pty, returns ptyId
                          │
                          ▼
     Bidirectional:
       • frontend → 'pty:input'  event → Rust writes to PTY
       • Rust reader → 'pty:output:{id}' Tauri event → xterm.js writes
                          │
                          ▼
     Resize: invoke('pty_resize', { ptyId, cols, rows })
     Close:  invoke('pty_kill',   { ptyId })
```

## Repo layout (after Phase 0)

```
caduceus/
├── README.md
├── docs/                          # this folder
├── pnpm-workspace.yaml
├── package.json
├── src-tauri/                     # Rust core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── ipc/                   # Tauri command handlers, typed via specta
│       │   ├── chat.rs
│       │   ├── config.rs
│       │   ├── model.rs
│       │   ├── session.rs
│       │   ├── pty.rs
│       │   └── log.rs
│       ├── adapters/
│       │   ├── mod.rs             # AgentAdapter trait
│       │   ├── hermes/
│       │   │   ├── mod.rs
│       │   │   ├── gateway.rs     # HTTP + SSE
│       │   │   ├── cli.rs         # `hermes` command wrapper
│       │   │   ├── config.rs      # ~/.hermes/config.yaml
│       │   │   ├── env.rs         # ~/.hermes/.env
│       │   │   └── auth.rs        # ~/.hermes/auth.json
│       │   ├── claude_code/       # Phase 5
│       │   ├── aider/             # Phase 5
│       │   └── openhands/         # Phase 5
│       ├── store/                 # SQLite (sqlx) for Caduceus-local data
│       │   ├── mod.rs
│       │   ├── migrations/
│       │   ├── sessions.rs
│       │   ├── usage.rs
│       │   └── budgets.rs
│       ├── secrets.rs             # keyring wrapper
│       ├── fs_atomic.rs           # atomic writes + journal
│       └── error.rs
│
├── src/                           # React frontend
│   ├── main.tsx
│   ├── app/
│   │   ├── routes.tsx             # TanStack Router tree
│   │   ├── providers.tsx          # Query client, theme, i18n
│   │   └── shell/                 # AppShell, sidebar, topbar
│   ├── features/
│   │   ├── chat/
│   │   ├── models/
│   │   ├── analytics/
│   │   ├── scheduler/
│   │   ├── skills/
│   │   ├── memory/
│   │   ├── logs/
│   │   ├── settings/
│   │   ├── profiles/
│   │   ├── channels/              # Phase 3
│   │   ├── compare/               # Phase 4 multi-model
│   │   ├── trajectory/            # Phase 4
│   │   ├── budgets/               # Phase 4
│   │   └── terminal/              # Phase 4
│   ├── components/                # shared shadcn wrappers
│   │   ├── ui/                    # shadcn primitives
│   │   ├── command-palette/
│   │   ├── kbd/
│   │   ├── diff/
│   │   └── …
│   ├── lib/
│   │   ├── ipc.ts                 # generated from specta
│   │   ├── agent/                 # AgentAdapter TS types, re-exported
│   │   ├── sse.ts
│   │   ├── cn.ts
│   │   └── formatters.ts
│   ├── stores/                    # Zustand stores
│   │   ├── chat.ts
│   │   ├── ui.ts
│   │   └── palette.ts
│   ├── styles/
│   │   ├── globals.css
│   │   └── tokens.css             # design tokens
│   └── locales/
│       ├── en.json
│       └── zh.json
│
├── scripts/
│   ├── gen-bindings.ts            # run tauri-specta to emit TS
│   └── release.ts
├── .github/workflows/
│   ├── ci.yml                     # lint, test, build matrix
│   └── release.yml                # tag → sign → upload
└── tests/
    ├── e2e/                       # Playwright
    └── visual/                    # Playwright screenshots
```

## State management rules

- **Server state** (sessions, models, usage, configs) lives in TanStack Query. Single source of truth, cache-first, invalidated by mutations.
- **UI state** (palette open, sidebar collapsed, current theme) lives in Zustand.
- **Stream state** (chat deltas) is a per-session reducer inside a Zustand slice, fed by Tauri event listeners.
- **Form state** is react-hook-form; never mix with Zustand.
- **URL state** (active route, filters) is TanStack Router search params.

## Security

- **Tauri allowlist**: explicit permissions (`fs: ~/.hermes/**`, `shell: none`, `http: only configured agent endpoints`).
- **Secrets**: provider API keys stored in OS keychain via `keyring`. Never plain in `.env` when we can avoid; for Hermes compatibility we still read/write `~/.hermes/.env` but always with 0600 perms.
- **CSP**: strict; no `unsafe-eval`. Shiki uses pre-compiled grammars.
- **External fetches**: frontend cannot fetch arbitrary URLs; all network calls go through Rust, which enforces the adapter's configured endpoint.
- **Update channel**: Tauri updater with minisign signatures; manifest on GitHub Releases.

## Performance budgets

| Metric                        | Target       |
|-------------------------------|--------------|
| Cold start → interactive      | < 1.0 s      |
| Route transition              | < 100 ms     |
| First chat delta render       | < 80 ms after receipt |
| Idle RAM                      | < 100 MB     |
| 10k-message session scroll    | 60 fps       |
| Bundle (frontend gzipped)     | < 1.5 MB     |
| Installer size (macOS arm64)  | < 20 MB      |

Measured in CI via Playwright tracing + `performance.now()` marks. Phase 0 sets up the measurement rig.

## Observability (self)

- Rust `tracing` → rolling file at `~/.caduceus/logs/caduceus.log`.
- Frontend errors captured and forwarded to Rust via `invoke('log_frontend_error', ...)`.
- Opt-in local-only "debug bundle" export: logs + redacted configs for bug reports.
- No external telemetry. Ever.
