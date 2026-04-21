# Changelog

Dated, human-readable log of shipped work. One entry per substantive milestone — not per commit. Feeds Phase retro notes and release notes.

Format: `## YYYY-MM-DD — <title>` → `### Shipped` / `### Fixed` / `### Deferred`.

---

## 2026-04-21 — Phase 1 Sprint 2: sessions, stop, syntax highlighting

### Shipped

- **Stop button**: Send button swaps to a Stop icon while streaming. Click (or submit) cancels the client-side `ChatStreamHandle` — event subscriptions tear down immediately; backend task runs to completion but its events are ignored. Already-streamed content is kept; the `thinking…` state clears.
- **Client-side session management** (`src/stores/chat.ts`): zustand store with `persist` middleware to `localStorage` (key `caduceus.chat.v1`). State: `sessions: Record<id, ChatSession>`, `orderedIds` (MRU), `currentId`. Actions: `newSession()`, `switchTo()`, `deleteSession()`, `renameSession()`, `appendMessage()`, `patchMessage()`. Titles auto-derive from the first user message (truncated to 40 chars). Bumping a session via `appendMessage` moves it to MRU top.
- **Sessions side panel** (`src/features/chat/SessionsPanel.tsx`): 240px left pane inside the Chat route. Header row with **New** button; scrollable MRU list with hover-revealed delete (with confirm). Active session highlighted in `gold-500/10`.
- **Chat page refactor**: `ChatRoute` now mounts `SessionsPanel` + a `ChatPane` bound to the current session. Composer state (`draft`, `sending`, `streamRef`, `pendingRef`) resets on session switch so switching mid-stream is clean. Message render still uses `MessageBubble` — extracted to its own file to keep `index.tsx` focused on orchestration.
- **Code syntax highlighting**: `rehype-highlight@7` + `highlight.js@11` integrated into the Markdown renderer. Auto language detection on block code. `highlight.js/styles/github-dark.css` loaded globally; block code renders on a fixed `#0d1117` backdrop + `#e6edf3` ink so colors read correctly under both light and dark app themes. Inline code unaffected.
- **Message DTO change (breaking, internal only)**: `UiMessage` moved from Chat page to `src/stores/chat.ts`, added `createdAt: number`. IPC payload still maps down to `{ role, content }`.

### Verified

- `pnpm {typecheck,lint,test,build}` all green. 11 vitest tests still passing. Bundle grew to ~238 KB gzip (from react-markdown + remark-gfm + highlight.js); Phase 2 code-splitting candidate.

### Deferred to Sprint 2B / Phase 2

- **Server-side (Rust) session storage** in SQLite — still frontend-only.
- **Tool call rendering** (folded cards for Hermes `tool_call` events).
- **Attachments** (drag-drop files + image preview).

---

## 2026-04-21 — Phase 1 Sprint 1: real Hermes chat (streaming)

### Shipped

- **Hermes gateway integration live**: Caduceus now talks to a real local Hermes gateway (`http://127.0.0.1:8642`) backed by DeepSeek. Gateway install + DeepSeek config documented; `API_SERVER_ENABLED=true` enables the OpenAI-compatible HTTP platform.
- **Rust `HermesGateway` client** (`src-tauri/src/adapters/hermes/gateway.rs`): reqwest-based, supports `GET /health`, `POST /v1/chat/completions` (non-streaming via `chat_once`, streaming via `chat_stream` using `eventsource-stream`).
- **`HermesAdapter` live mode**: new `HermesAdapter::new_live(base_url, api_key, default_model)` constructor wired through `build_hermes_adapter()` in `lib.rs`. Reads `HERMES_GATEWAY_URL` / `HERMES_GATEWAY_KEY` / `HERMES_DEFAULT_MODEL` env overrides; falls back to stub on construction failure. Stub mode preserved for tests and offline dev.
- **`AgentAdapter` trait extended**: added default-unsupported `chat_once(turn)` and `chat_stream(turn, tx)` methods. `ChatTurn` + `ChatMessageDto` DTOs live in `adapters/mod.rs`.
- **IPC commands**: `chat_send` (non-streaming) + `chat_stream_start` (streaming). Streaming emits three per-handle events: `chat:delta:{handle}`, `chat:done:{handle}`, `chat:error:{handle}`. Handle is caller-supplied from the frontend to eliminate the "first delta before listener attached" race.
- **Frontend IPC wrappers** (`src/lib/ipc.ts`): `chatSend()`, `chatStream(args, { onDelta, onDone, onError })` returning a `ChatStreamHandle` with `cancel()`. `ipcErrorMessage()` converts the Rust `IpcError` envelope into human-readable strings.
- **Chat UI** (`src/features/chat/index.tsx`): real chat page with composer (Enter / Shift+Enter), gold user bubbles with fixed dark ink, assistant bubbles rendering GFM markdown (tables, lists, inline/block code, blockquotes, links) via `react-markdown` + `remark-gfm`. Empty-state hero with suggested prompts. Auto-scroll, pending `thinking…` placeholder until first delta.
- **End-to-end verified**: ⌘1 → Chat → type → streaming DeepSeek reply with markdown rendering + multi-turn context preserved client-side.

### Not in scope (deferred to Sprint 2)

- **Server-side sessions**: frontend is the source of truth for history. Persistence + resume lands in Sprint 2.
- **Cancel mid-stream**: `chatStream()` returns a `cancel()` handle but the UI doesn't yet surface a stop button.
- **Tool calls / attachments / voice / skills**: Sprint 2+ milestones.

### Notes

- Gateway install hiccups during session: GitHub clone from CN required `ghfast.top` mirror; pip via `https://pypi.tuna.tsinghua.edu.cn/simple`; browser tools (playwright + camoufox) skipped — optional for chat.
- First Tailwind token sweep caught `bg-surface` / `text-muted` / `bg-accent` which don't exist in our design tokens — replaced with real tokens (`bg-bg-elev-1`, `text-fg-muted`, `bg-gold-500`).

---

## 2026-04-21 — Phase 0.5 quality gates

### Shipped

- **Windows path correctness**: Added `dunce` dependency and swapped all `std::fs::canonicalize` call sites in `src-tauri/src/sandbox/mod.rs`. On Windows this strips the `\\?\` verbatim prefix so hard-denylist entries like `C:\Windows\System32\` actually match canonicalized paths. On macOS/Linux `dunce::canonicalize` delegates to std, so it is a zero-cost change there.
- **Rust lint gate**: `cargo clippy --lib --all-targets -- -D warnings` passes clean. Removed manual `Default for Capabilities` in favour of `#[derive(Default)]`; added crate-level `#![allow(dead_code)]` with a TODO(phase-1-end) note to cover Phase 0 scaffold APIs that Phase 1+ will wire up.
- **Rust format gate**: `cargo fmt --check` passes clean; first fmt pass applied across `src-tauri/src/**`.
- **Vitest harness**: `vitest@^2` + `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` installed. `vitest.setup.ts` injects a `MemoryStorage` polyfill for `window.localStorage` / `window.sessionStorage` (jsdom 29 omits these) plus a `matchMedia` stub, so zustand/persist hydrates cleanly under tests. `tsconfig.json` now includes `vitest/globals` + `jest-dom` types.
- **Unit tests (11 passing)**: `src/lib/cn.test.ts` (4), `src/stores/palette.test.ts` (3), `src/stores/ui.test.ts` (4). Covers twMerge semantics, persist-free store mutation, theme toggle DOM side-effects.
- **CI matrix (`.github/workflows/ci.yml`)**: two parallel jobs × 3 OSes (macOS / Ubuntu / Windows). Frontend job runs `pnpm {typecheck,lint,test,build}`; Rust job installs Linux WebKit deps, uses `Swatinem/rust-cache@v2`, runs `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test --lib`. Concurrency cancels in-flight on force-push.
- **Global route shortcuts**: `src/app/useNavShortcuts.ts` mounts in `AppShell`, reads `NAV[].shortcut` as the single source of truth, and binds ⌘0..9 + ⌘, (macOS) / Ctrl variants elsewhere. Skips when the event target is an input/textarea/contenteditable to not fight typing; ignores Shift/Alt combos so it doesn't collide with ⌘⇧L theme toggle or ⌘K palette.

### Deferred (not in 0.5 scope)

- **Playwright e2e** — deferred to early Phase 1; a Tauri-window e2e smoke is more valuable once there's a real chat turn to drive.
- **Storybook / Ladle** — deferred; visual review through the running app is sufficient at Phase 0 component count.
- **pnpm build end-to-end installer verification** — needs platform signing decisions first (Phase 2 release track).

### Notes

- 11 frontend unit tests + 3 Rust sandbox tests = **14 gated tests** locally and in CI.
- Verified locally on macOS 14 arm64: all 5 CI gates (typecheck, lint, test, clippy, cargo test) green.

---

## 2026-04-21 — Phase 0 foundation + sandbox plumbing

### Shipped

- **Toolchain scaffold**: pnpm 9, TypeScript 5.9 strict, Vite 5, Tailwind 3 with design tokens, ESLint 9 flat config, Prettier, Tauri 2 + Rust stable.
- **Design system**: `src/styles/tokens.css` + `globals.css`; light/dark themes via `[data-theme]`; no hard-coded colors in components.
- **App shell**: `AppShell / Sidebar / Topbar / PageHeader`; 12 navigation entries (Home + 11 feature routes); 10 placeholder routes + Home landing.
- **Command palette**: `cmdk` wrapper with route-jump group + preferences (theme toggle). ⌘K / Ctrl+K global shortcut. ⌘⇧L toggles theme.
- **i18n**: `react-i18next` with `en.json` / `zh.json`, language auto-detect with localStorage persistence.
- **State**: Zustand stores for UI (theme, sidebar) and palette; persisted via middleware.
- **Rust core**: `AgentAdapter` trait + `AdapterRegistry`; `HermesAdapter` Phase 0 stub with JSON fixtures (3 sessions, 5 models); 5 IPC commands (`health_check`, `session_list`, `session_get`, `model_list`, `chat_send_stub`).
- **Sandbox plumbing** (`docs/08-sandbox.md`): `PathAuthority` with cross-platform hard denylist (macOS/Linux/Windows) + home-relative credential paths (.ssh, .aws/credentials, .kube/config, .gnupg, .docker/config.json, .netrc); `sandbox::fs` middleware (`read_to_string`, `read_dir_count`, `write`); 3 unit tests green.
- **Demo IPC**: `home_stats` command + `lib/ipc.ts` wrapper + Home-page badge showing `$HOME` entry count and sandbox mode — proves React ↔ Tauri IPC ↔ Rust fs round-trip.
- **Window chrome**: `titleBarStyle: Overlay` with `data-tauri-drag-region` on Topbar + Sidebar brand; 80px left inset to clear macOS traffic lights.
- **Placeholder icons**: Python-stdlib PNG generator (`scripts/generate-placeholder-icon.py`) + `pnpm tauri icon` fan-out.
- **Capabilities**: Tauri 2 minimal permission set (`core:default`, window drag, event, shell).
- **Docs**: `SETUP.md`, updated `README.md`, new `docs/08-sandbox.md`, updated `docs/05-roadmap.md` + `docs/phases/phase-0-foundation.md` with shipped status.

### Fixed

- Denylist missed "the directory itself" — `.ssh/` rule didn't catch `~/.ssh` (no trailing slash after canonicalization). Caught by unit test during self-check.
- `Path::starts_with` semantic fix — string `starts_with` would false-match `.sshfoo/` against `.ssh/`.
- Windows mixed separators — `PathBuf::join` replaces `format!("{home}/{rel}")`.
- `LucideIcon` type incompatibility in `Sidebar` / `Palette` — previous `ComponentType<{size,strokeWidth}>` too narrow.
- `generate_context!()` at compile-time requires icons and `frontendDist` dir on disk. Added placeholder `dist/.gitkeep` and icons fan-out.
- Window non-draggable with `Overlay` title bar — added `data-tauri-drag-region` attributes.

### Deferred to Phase 0.5

- GitHub Actions CI matrix (macOS / Ubuntu / Windows).
- Storybook / Ladle with ≥ 8 primitive stories.
- Playwright + Tauri webdriver e2e ("open → palette → goto settings").
- Vitest unit tests for React components.
- `rustup component add clippy` + CI gate.
- Windows `\\?\` verbatim-prefix normalization via `dunce` crate + `#[cfg(windows)]` sandbox tests.
- Global `Cmd+1..9` route-jump listener (currently hint-only in palette).
- `pnpm build` end-to-end installer verification.

### Notes

- Runtime verified: macOS 14 arm64 (`pnpm tauri:dev` boots, window renders, IPC round-trip succeeds).
- Not yet verified: Linux, Windows (no CI runners yet).
- Git: repo is **not** yet initialized — first `git init && git commit` pending user action.
