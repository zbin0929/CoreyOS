# Changelog

Dated, human-readable log of shipped work. One entry per substantive milestone — not per commit. Feeds Phase retro notes and release notes.

Format: `## YYYY-MM-DD — <title>` → `### Shipped` / `### Fixed` / `### Deferred`.

---

## 2026-04-21 — Sprint 6: Playwright E2E scaffolding

### Context

Eight sprints of UI work with only unit tests (11 vitest + 15 cargo) left us
exposed to regressions that only show up in the full browser — store +
router + IPC wiring. Specifically: the recent infinite-loop we shipped in
Sprint 5C would have been caught instantly by any smoke test that just
opened `/chat`. Time to add an E2E safety net before Phase 2.

### Shipped

- **Runner**: `@playwright/test` (v1.59) targeting system Chrome via
  `channel: 'chrome'` — skips the 170 MB Chromium download. Driven against
  Vite's dev server, not the full Tauri webview, so a full run takes ~17 s.
- **Tauri IPC mock** (`e2e/fixtures/tauri-mock.ts`): a self-contained init
  script that stubs `window.__TAURI_INTERNALS__` with handlers for every
  command the frontend invokes — `home_stats`, `config_*`, `hermes_*`,
  `db_*`, `chat_send`, `chat_stream_start`, plus the `plugin:event|*`
  pub/sub so `@tauri-apps/api/event` works transparently. Tests can mutate
  fixture state via `window.__CADUCEUS_MOCK__.state` or override any
  command per-test via `.on('cmd', handler)`.
- **Suites** (7 tests):
  - `smoke.spec.ts` — shell renders, sidebar nav works, `/chat` loads,
    command palette opens, theme toggle flips `<html data-theme>`.
  - `chat.spec.ts` — full streaming round-trip: compose a prompt, watch
    two deltas + a done event fly through the mocked IPC, assert the
    assistant reply renders in a bubble.
  - `llms.spec.ts` — `/models` reads config on mount, `ApiKeyPanel`
    renders based on `env_keys_present`.
- **Scripts**: `pnpm test:e2e` (headless), `test:e2e:headed`, `test:e2e:ui`.
- **CI-ready**: retries=1 + 2 workers under `$CI`, `forbidOnly=true`,
  HTML report artefact.

### Design notes

- **Why not drive the real Tauri app?** Full-fat E2E via `tauri-driver`
  requires platform-specific webdrivers (Edge on macOS, webkit2gtk on
  Linux) and costs a full Rust rebuild per run. We get 95 % of the
  regression protection for 5 % of the cost by testing the UI + mocked
  IPC. Rust-side IPC contracts are still covered by `cargo test`.
- **Selector discipline**: prefer `getByRole` + accessible name over CSS.
  tanstack-router's `<Link>` proxies `href` weirdly (CSS
  `a[href="/chat"]` times out against a tree where the link definitely
  exists); role-based selection is both more stable and more honest to
  what a screen reader would see.

### Verified

All seven tests green in 17 s. `pnpm {typecheck,lint,test}` still green.

---

## 2026-04-21 — Phase 1 Sprint 5C: SQLite persistence (end of Phase 1)

### Context

Up through Sprint 5B, chat state lived in `localStorage` via `zustand/persist`. That works but has two problems: (1) clearing browser cache or reinstalling wipes every session, and (2) Phase 2's Analytics page needs SQL-queryable structured data, not a JSON blob. This sprint migrates persistence to SQLite, keeping zustand as the in-memory cache and using async IPC for the hot path.

### Shipped

- **Rust `db.rs`**: bundled-sqlite (`rusqlite` with `bundled` feature, zero system deps). Three normalized tables with FK cascades and indices: `sessions(id, title, model, created_at, updated_at)`, `messages(id, session_id, role, content, error, position, created_at)`, `tool_calls(id, message_id, tool, emoji, label, at)`. `Db::load_all()` returns the full tree in one call for app-startup hydration, folding joins into a nested `SessionWithMessages` shape. WAL + NORMAL sync + foreign_keys ON as pragmas.
- **IPC `ipc/db.rs`**: five commands — `db_load_all`, `db_session_upsert`, `db_session_delete`, `db_message_upsert`, `db_tool_call_append`. Each wraps the blocking `rusqlite` call in `tokio::task::spawn_blocking` so the Tokio runtime stays non-blocking.
- **Startup**: `Db::open` runs in the Tauri `setup()` hook against `<app_data_dir>/caduceus.db`. Failure to open (e.g. read-only home) logs loudly and sets `state.db = None` — the UI still works, just without persistence.
- **Frontend**:
  - `dbLoadAll()`, `dbSessionUpsert()`, `dbSessionDelete()`, `dbMessageUpsert()`, `dbToolCallAppend()` wrappers in `src/lib/ipc.ts`.
  - `zustand/persist` middleware removed from `src/stores/chat.ts`. Replaced with:
    - `hydrateFromDb()` action — called once from `ChatRoute` on mount; reads the tree, seeds the store, sets `hydrated: true`. Selects the MRU session as `currentId` automatically.
    - Every mutating action (`newSession`, `deleteSession`, `renameSession`, `setSessionModel`, `appendMessage`, `patchMessage`, `appendToolCall`) now mirrors its change to the DB via a fire-and-forget `fireWrite()` helper that logs failures. The UI stays synchronous; DB writes happen in the background.
  - `ChatRoute` gates the UI on `hydrated` — shows "Loading sessions…" until the first `dbLoadAll` returns, then either creates a fresh session or picks up where the user left off.
- **Tests**: 4 new cargo unit tests (round-trip, MRU ordering, cascade delete, upsert update) bringing total to 15.

### Design notes

- **No transaction batching yet**: each streaming delta currently triggers a `db_message_upsert` — one IPC + one SQLite write per chunk. Fine for human typing speed (hundreds of writes/sec with WAL is cheap) but wasteful. A debounced write or a dedicated "streaming" IPC that batches could cut this by 10×. Left for a future optimization pass.
- **`pending` flag is UI-only**: not mirrored to the DB because it's ephemeral ("waiting on first delta"). Messages that were pending when the app crashed will reload as non-pending (correct — the stream is gone either way).
- **Race-free tool calls**: `appendToolCall` uses a separate store action from `patchMessage` (content accumulation) because SSE interleaves tool events and content deltas; combining them in one patch could drop one of the two updates.

### Verified

- `pnpm {typecheck,lint,test,build}` + `cargo {check,clippy,test,fmt --check}` green. 15 cargo tests + 11 vitest tests passing.
- Manual: create a session, chat, quit the app, relaunch → session + messages + tool calls all restored.

---

## 2026-04-21 — Phase 1 Sprint 5B: tool call rendering (agent visibility)

### Context

Hermes is an *agent*, not just a chat model: it invokes `terminal`, `file_read`, `web_search`, etc. while composing its response. Phase 1 Sprint 1–2's SSE parser captured only the default `chat.completion.chunk` stream, silently dropping Hermes's custom `event: hermes.tool.progress` markers. Users saw the prose but had no idea work was being done on their behalf.

### Investigation

Reverse-engineered Hermes's SSE by triggering a prompt that forced a tool call. Hermes emits `event: hermes.tool.progress\ndata: {"tool": "terminal", "emoji": "💻", "label": "pwd"}` once per tool invocation. The tool's OUTPUT is baked into subsequent assistant `content` deltas by the agent itself (no separate "tool result" event needed).

### Shipped

- **Rust `gateway.rs`**: SSE loop now branches on the `event:` line. Default / `message` events continue as `chat.completion.chunk`; `hermes.tool.progress` events parse as the new `HermesToolProgress` struct. The mpsc channel payload changed from `String` to a new `ChatStreamEvent` enum (`Delta(String) | Tool(HermesToolProgress)`) so deltas and annotations share one ordered stream — preserving their relative sequence for UI rendering.
- **IPC `chat_stream_start`**: emits `chat:tool:{handle}` in addition to the existing `chat:delta:{handle}`. Listeners subscribe to whichever they care about.
- **Frontend `ipc.ts`**: `ChatStreamCallbacks.onTool?` callback + `ChatToolProgress` type. Listener is only registered when the caller provides `onTool`.
- **Chat store**: `UiMessage.toolCalls: UiToolCall[]` + `appendToolCall` action (race-free separation from `patchMessage` since tool events and content deltas may interleave). Persisted across restarts via existing zustand/persist.
- **`MessageBubble`**: new `ToolCallsStrip` rendering a row of pills ABOVE the prose showing `<emoji> <tool> · <label>` (e.g. `💻 terminal · pwd`). Pills are read-only signals — clicking them does nothing for now since the output is already in the text below.
- **ChatRoute**: `onTool` handler on `chatStream()` appends to the assistant message's `toolCalls` and proactively clears the `pending` spinner (the tool event itself proves the stream is alive before any content lands).

### Deferred

- **Expandable tool panels with input/output/duration**: would require Hermes to emit a "tool complete" event with the output payload. Not available in the current Hermes build. Current pills cover the "what did the agent do" question; a proper trajectory view is a Phase 4 feature.
- **Tool-specific renderings** (file viewer, diff, web search results list): same dependency as above.

### Verified

- `pnpm {typecheck,lint,test}` + `cargo {check,clippy,test,fmt --check}` green. 11 vitest + 11 cargo tests still passing.
- Manual: prompt `"Use bash to run pwd and tell me the output"` — pill appears above the response reading `💻 terminal · pwd`.

---

## 2026-04-21 — Phase 1 Sprint 5A: closed-loop LLM switching (.env + restart)

### Context

Sprint 4 let users change the provider/model in `config.yaml`, but adding a new provider still required (1) hand-editing `~/.hermes/.env` for the API key and (2) shelling out to `hermes gateway restart`. This sprint closes that loop.

### Shipped

- **Rust `hermes_config.rs`**: `write_env_key(key, value)` does an upsert-or-delete on `~/.hermes/.env` while preserving every other line (comments, blanks, order). Only `*_API_KEY` names are permitted (server-side allowlist via `is_allowed_env_key`). Writes atomically via tmp + rename, and `chmod 0600`s the file on Unix since it now holds secrets. `gateway_restart()` shells out to `hermes gateway restart`, resolving the binary from `$PATH` → `~/.local/bin/hermes` fallback.
- **IPC**: `hermes_env_set_key(key, value)` + `hermes_gateway_restart()`. The restart IPC runs the blocking `Command::output()` via `tokio::task::spawn_blocking` so it doesn't stall the runtime. Returns the combined stdout/stderr on success.
- **LLMs page — `ApiKeyPanel`**: inline form rendered below the provider dropdown. Collapsed "✓ set" state with a **Rotate** affordance; expanded form is a password input with show/hide, Enter-to-submit, 0600 reminder, and an error row. The key value exists only in local component state — sent directly to the IPC, never persisted elsewhere, cleared on save.
- **LLMs page — restart banner upgraded**: new **Restart now** button calls `hermesGatewayRestart()`, shows a spinner while running, then waits ~1.2s and re-reads Hermes config. Output from the CLI is displayed in a monospaced box when non-empty. Fallback instruction to run it manually is retained.
- **Frontend ipc.ts**: `hermesEnvSetKey()` + `hermesGatewayRestart()` wrappers.
- **Tests**: 2 new cargo unit tests (`is_allowed_env_key_gates_non_api_keys`, `line_matches_key_handles_whitespace_and_comments`) bringing total to 11.

### Safety notes

- **API keys never round-trip through Caduceus**: the read path returns only key NAMES; values live only in `~/.hermes/.env`. The write path is one-way (`hermesEnvSetKey(key, value)` sends, backend stores, UI clears).
- **Allowlist on the write endpoint**: `is_allowed_env_key` rejects anything not matching `/^[A-Z0-9_]+_API_KEY$/`, so this IPC can't be abused to corrupt `API_SERVER_PORT`, `GATEWAY_ALLOW_ALL_USERS`, etc.
- **File perms**: `0600` on Unix after write. The existing file may have already been 0600 (Hermes installer sets that); we preserve the intent.

### Verified

- 11 cargo tests (2 new) + 11 vitest tests green. typecheck + lint + clippy + fmt clean.

### Deferred

- **Gateway health verification after restart**: we re-read Hermes config but don't actively probe `/health`. Hermes's restart is usually < 2s but could fail; a retry loop with exponential backoff is a clean follow-up.
- **Batch API-key import**: no UI for pasting an entire `.env` file at once. Not needed for single-provider flow.

---

## 2026-04-21 — Phase 1 Sprint 4: Hermes config integration (the real LLM knob)

### Context

Hermes Gateway's `/v1/models` returns only `hermes-agent` — the gateway wraps itself as a single virtual model. The actual LLM (DeepSeek, OpenAI, etc.) is configured inside Hermes at `~/.hermes/config.yaml` and its API keys live in `~/.hermes/.env`. Sprint 3's Models page showed `/v1/models` output, which was technically correct but practically useless for switching the underlying LLM.

### Shipped

- **Rust `hermes_config.rs`**: reads `~/.hermes/config.yaml` via `serde_yaml::Value` (preserving all non-`model` fields verbatim so user-edited bits like `fallback_providers`, `auxiliary.*`, etc. survive a round-trip). `HermesModelSection { default, provider, base_url }` is the subset we expose. `write_model()` does atomic tmp+rename. Also parses `~/.hermes/.env` and returns the KEY NAMES of any non-empty `*_API_KEY=` lines — **never the values** (secrets stay out of the IPC channel). 3 new unit tests.
- **IPC**: `hermes_config_read` / `hermes_config_write_model` in `src-tauri/src/ipc/hermes_config.rs`.
- **LLMs page rewritten** (`src/features/models/index.tsx`):
  - **Current card**: shows the file path + current `provider`, `model`, `base_url`.
  - **Change model form**: provider dropdown with 7 pre-populated options (DeepSeek, OpenAI, Anthropic, OpenRouter, Z.AI, Kimi, MiniMax), model id input with per-provider datalist suggestions, optional base_url. Auto-fills base_url when switching between known providers.
  - **API-key presence indicator**: reads `~/.hermes/.env` and shows a green check if the selected provider's key env var is set, or an amber warning telling the user which key to add.
  - **Restart banner**: after saving, shows a prominent instruction to run `hermes gateway restart` (Hermes does NOT hot-reload model config).
  - **Not-present state**: if `~/.hermes/config.yaml` is missing, shows a clear warning rather than failing silently.
- **Frontend ipc.ts**: `hermesConfigRead()` + `hermesConfigWriteModel()` wrappers.

### Trade-offs / deferred

- **No gateway-restart button yet**: Caduceus can't shell out to `hermes gateway restart` without Tauri capability config. Kept as a manual step for this sprint; automation is a clean follow-up.
- **API keys are still hand-edited in `.env`**: we only READ the presence of `*_API_KEY` names. Write support needs careful UX around secrets + atomic updates to an env file — deferred.
- **Chat per-session ModelPicker** (Sprint 3) now shows `hermes-agent` only because `/v1/models` always returns that one entry. Left in place as a status indicator; it'll become useful again in Phase 5 when multiple adapters can register.

### Verified

- 9 cargo tests (3 new) + 11 vitest tests all green. clippy + fmt clean. typecheck + lint clean.

---

## 2026-04-21 — Phase 1 Sprint 3: Models page + per-session model picker

### Shipped

- **Real `/v1/models`**: `HermesGateway::list_models()` hits the OpenAI-compatible endpoint (`GET /v1/models`) and returns `Vec<ModelListEntry>` (id + owned_by + created). `HermesAdapter::list_models()` in live mode maps these to the richer `ModelInfo`, synthesizing `is_default` by comparing the entry id against the adapter's current `default_model`. Stub mode still returns the fixtures for offline dev.
- **Models page** (`src/features/models/index.tsx`): replaces the Phase-0 placeholder. Table of model id / provider / context window with a **DEFAULT** badge on the active one. **Set default** button calls `config_set` (reuses the Settings hot-swap path) and reloads. **Refresh** action in the header. Error state with retry.
- **Per-session model picker** (`src/features/chat/ModelPicker.tsx`): compact dropdown above the composer showing the effective model id. Lazy-fetches the model list on first open (not mount) so idle sessions don't hit the gateway. **SESSION** badge highlights when the session has an override; **Clear** reverts to the gateway default. Outside-click + Escape close.
- **Chat store extension**: `ChatSession.model?: string | null` + `setSessionModel(id, model)` action. Persistent across restarts (zustand/persist). Chat pane passes `model` in the `chatStream` payload only when an override is set — otherwise the Rust side falls through to `HermesAdapter`'s `default_model`.
- **`ModelInfo` + `modelList()` wrappers** in `src/lib/ipc.ts`.

### Verified

- `pnpm {typecheck,lint,test,build}` + `cargo {check,clippy,test,fmt --check}` all green. 11 vitest + 6 cargo tests still passing; bundle grew ~4 KB gzip.

### Notes

- Gateway `/v1/models` is sparse (usually just `id` + `owned_by`). Fields like `context_window`, `display_name`, or tool-use capability need provider-specific enrichment; deferred to a Phase 2 "Model registry" feature that can cross-reference a local manifest.
- Chat picker shows the literal model id as the label. Once display names are enriched, the picker will use the human-readable form.

---

## 2026-04-21 — Phase 1 Sprint 2B: Settings page + runtime gateway config

### Shipped

- **Settings page, real** (`src/features/settings/index.tsx`): replaces the Phase-0 placeholder. Form with **Base URL**, **API key** (password input with show/hide toggle), **Default model** (with datalist suggestions). **Test connection** button probes `/health` without persisting. **Save** applies atomically. Reset button reverts to loaded snapshot. Unsaved-change indicator + inline success/error states.
- **Rust `config.rs`**: new `GatewayConfig` type with `load_or_default(dir)` + atomic `save(dir)`. File lives at `<app_config_dir>/gateway.json` (platform-native, macOS `~/Library/Application Support/com.caduceus.app/`). Env vars (`HERMES_GATEWAY_URL` / `_KEY` / `_MODEL`) remain as a fallback for bootstrap. 3 unit tests covering defaults, roundtrip, missing-file fallback.
- **`AdapterRegistry` hot-swap**: internal `HashMap` moved behind `RwLock` so `register()` takes `&self`. Lets the IPC `config_set` command swap the Hermes adapter without app restart. In-flight streams finish against the old `Arc<HermesAdapter>`; subsequent requests pick up the new one.
- **IPC `config_get` / `config_set` / `config_test`** (`src-tauri/src/ipc/config.rs`): **set** validates URL → builds adapter → persists JSON → hot-swaps atomically. **test** builds a throwaway `HermesGateway` and hits `/health` — zero side effects.
- **`AppState` extension**: now holds `Arc<RwLock<GatewayConfig>>` + `config_dir: PathBuf`. Initialization moved into Tauri's `setup()` hook so `app.path().app_config_dir()` can resolve the platform-native path.
- **Frontend IPC wrappers**: `configGet()`, `configSet()`, `configTest()` in `src/lib/ipc.ts`. `HealthProbe` now `Serialize`-able.

### Verified

- `pnpm {typecheck,lint,test,build}` all green. 11 vitest + 6 cargo tests passing (3 new config tests). `cargo clippy -- -D warnings` clean. `cargo fmt --check` clean.

### Deferred

- **Encrypted API key storage** (keychain / stronghold): current impl is plaintext JSON under user-level app data. Acceptable local-desktop trust boundary for Phase 1; hardening in Phase 2+.
- **Multi-adapter Settings**: only Hermes is registered today. Profiles (multiple saved gateway configs you can switch between) are a Phase 4 dependency for the multi-model compare feature.

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
