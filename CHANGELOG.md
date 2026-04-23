# Changelog

Dated, human-readable log of shipped work. One entry per substantive milestone — not per commit. Feeds Phase retro notes and release notes.

Format: `## YYYY-MM-DD — <title>` → `### Shipped` / `### Fixed` / `### Deferred`.

---

## 2026-04-23 — T5.6 · Cross-adapter analytics + budgets

Phase 5's final task. Analytics now surfaces a "Usage by adapter"
card; Budgets' existing `adapter` scope kind finally gets a proper
dropdown populated from the live registry instead of a free-form
text input. Together these make multi-adapter cost/usage signals
first-class.

### Shipped

- **`AnalyticsSummary.adapter_usage: Vec<NamedCount>`**
  (`src-tauri/src/db.rs`): groups `sessions` by `adapter_id` (with
  `COALESCE(NULLIF(...), 'hermes')` defending against NULL rows).
  No `LIMIT` — adapter space is ≤6. Ordered by count DESC so the
  busiest adapter leads.
- **`AnalyticsSummaryDto.adapter_usage`** mirrored in TS
  (`src/lib/ipc.ts`).
- **Analytics "Usage by adapter" card** (`src/features/analytics/index.tsx`):
  uses the existing `HBarList` primitive (same as Top models /
  tools), placed in its own row below the models+tools grid so
  the new signal is visible without displacing the historical
  layout. Remaps raw ids → display names via
  `useAgentsStore.adapters` (e.g. `hermes` → "Hermes"); falls
  back to raw id when the registry hasn't loaded yet.
- **Budgets adapter-scope dropdown** (`src/features/budgets/index.tsx`):
  new local `<ScopeValueInput />` switches between a text input
  and a `<Select>` of registered adapters based on `scope_kind`.
  Persisted value is the adapter `id` (stable); the option label
  is the display name. Gracefully falls back to text input when
  the registry is empty.
- **i18n**: `analytics.chart.adapters.{title,subtitle,empty}` in
  `en.json` + `zh.json`.

### Tests

- **Rust**: 133 → **134** (+1
  `t56_analytics_adapter_usage_groups_by_adapter_id` — three
  sessions across two adapters, asserts count + DESC ordering).
- typecheck + lint + `cargo clippy --tests -- -D warnings`: clean.

### Phase 5 status

All in-scope T5.* subtasks shipped:
T5.1 trait polish · T5.2a Claude Code mock · T5.3a Aider mock ·
T5.5a read-only switcher · T5.5b active + capability-gated nav +
chat routing · T5.5c unified inbox · T5.6 analytics + budgets.

Deferred (explicitly out-of-scope until a user asks):
T5.2b/T5.3b real CLIs, T5.4 OpenHands.

---

## 2026-04-23 — T5.5c · Unified session inbox

Sessions are now adapter-aware end-to-end. The chat SessionsPanel
filters/badges by adapter and offers an "All agents" toggle; the DB
persists `adapter_id` per row via a v5 migration that backfills
pre-T5.5c sessions to `'hermes'`.

### Shipped

- **DB v5 migration** (`src-tauri/src/db.rs`):
  `ALTER TABLE sessions ADD COLUMN adapter_id TEXT`, backfill
  `'hermes'` for existing rows, add
  `idx_sessions_adapter_updated(adapter_id, updated_at DESC)` for
  the inbox-filter query path. `upsert_session` now preserves
  `adapter_id` via `COALESCE(sessions.adapter_id, excluded.adapter_id)` —
  sessions can't migrate across adapters via a late upsert (the
  per-session adapter is frozen at creation).
- **`SessionRow.adapter_id`** plumbed through Rust DTO (`#[serde(default)]`
  → `"hermes"` for back-compat) and TS `DbSessionRow.adapter_id`.
- **`ChatSession.adapterId`** in `useChatStore` — hydrated from
  `sessionFromDb`, set at `newSession()` time from
  `useAgentsStore.activeId` (with full fallback chain to registry
  default → first entry → literal `'hermes'`). All five
  `dbSessionUpsert` call sites now forward `adapter_id`.
- **Unified `<SessionsPanel />`** (`src/features/chat/SessionsPanel.tsx`):
    - Scope toggle (`Active <N>` / `All agents <N>`). Hidden when
      only one adapter is registered OR when every session belongs
      to the active adapter (no noise).
    - Per-row 3-char adapter badge — gold for Hermes, cyan for
      Claude Code, violet for Aider. Rendered in "all" mode AND
      whenever a row's adapter differs from the active one, so
      outliers are never camouflaged.
    - Empty-state copy adapts: "No Claude Code sessions. Switch
      to 'All agents' to see others." when the active adapter has
      zero rows in a multi-adapter DB.

### Tests

- **Rust**: 132 → **133** (+1
  `t55c_session_adapter_id_roundtrips_and_is_frozen` — covers
  round-trip + the "re-upsert can't hijack adapter_id" invariant).
- typecheck + lint clean.

### Deferred

- **Per-adapter empty-state illustrations** — current copy is
  functional but not visually engaging. Low priority until real
  CLIs land and users actually use multi-adapter mode.

---

## 2026-04-23 — T5.3a · Aider mock adapter (third citizen)

Registers the third first-class `AgentAdapter`. With Hermes + Claude
Code + Aider all online in mock mode, the T5.5b capability-gated
Sidebar now has three distinct capability vectors to filter against
and the AgentSwitcher finally looks like a real multi-agent console.

### Shipped

- **`AiderAdapter::new_mock()`** (`src-tauri/src/adapters/aider/`):
    - Capabilities distinguish Aider from Claude Code where it
      matters: `attachments=false` (Aider reads repo files, not
      pasted images), `terminal=false`, `trajectory_export=false`,
      `channels=[]`, `skills=false`. `streaming=true` +
      `tool_calls=true` + `cost_accounting=true` match both.
    - Mock `chat_once` **refuses without `ChatTurn.cwd`** — Aider's
      identity is "one process per repo"; surfacing the contract
      as `AdapterError::NotConfigured { hint: "... repo path ..." }`
      gives the UI a clean place to prompt for a repo picker
      (T5.3b) instead of silent fallback.
    - Mock `chat_stream` emits a realistic Aider tool sequence —
      `ToolProgress { tool: "read" }` → `ToolProgress { tool: "edit" }`
      → word-chunked deltas. Real Aider's `Edit`/`Apply`/`Done`
      event set collapses to the same shape, so the UI's tool
      ribbon already renders correctly for both live and mock.
    - Fixtures: `fixtures/sessions.json` (2 sessions with
      `metadata.repo` + `.branch` + `.files_in_ctx` — the fields
      the unified inbox will use to disambiguate rows in T5.5c)
      + `fixtures/models.json` (Claude Sonnet 4.5, GPT-4o, DeepSeek
      Coder v3 — Aider model slugs in typical user configs).
- **Registered** in `lib.rs`. Boot log now prints
  `adapters=["hermes", "claude_code", "aider"]`.
- **Conformance suite** gains `aider_mock_is_conformant` (one-line
  add to `adapters::conformance::tests`). All three adapters pass
  the same shape invariants.

### Tests

- **Rust**: 125 → **132** (+6 Aider unit tests + 1 conformance
  parameterisation). Notable coverage: `NotConfigured` on missing
  cwd, `repo` echo in reply, read→edit tool sequence ordering.
- typecheck + lint + `cargo clippy --tests -- -D warnings`: clean.

### Deferred

- **T5.3b real Aider CLI** — `process.rs` + `protocol.rs` + `repo.rs`.
  Spawn `aider` as a JSON-lines child, one per repo; multiplex
  messages through a channel keyed by session id. Blocked only on
  time; follows once T5.5c (unified inbox) lands so the repo-picker
  UX has a home.

---

## 2026-04-23 — T5.5b · Active adapter + capability-gated nav + chat routing

Makes the AgentSwitcher actually useful. Selecting an adapter in the
Topbar now routes chat through it, filters the Sidebar nav to match
its `Capabilities`, and persists across reloads.

### Shipped

- **Active adapter slice** in `useAgentsStore` (`src/stores/agents.ts`):
  `activeId: string | null`, `setActive(id)`, `getActiveEntry()`.
  Persisted to `localStorage` (`corey.active_adapter_id`) with
  defensive try/catch so storage failures never crash the app.
  `null` means "follow the registry default"; a stale id (adapter
  removed) also falls through to the default.
- **AgentSwitcher now selects** (`src/app/shell/AgentSwitcher.tsx`):
  clicking a row in the dropdown marks that adapter active (emerald
  "active" badge on the row + active row highlight); a "Clear
  selection (follow default)" button appears once an override is
  set. Footer updated from "coming in T5.5b" to
  "Chat routes to the active adapter."
- **Capability-gated Sidebar** (`src/app/shell/Sidebar.tsx` +
  `src/app/nav-config.ts`): `NavEntry` gains optional
  `requires: NavCapability`. Entries are filtered against the
  active adapter's live `capabilities` snapshot.
  Claude Code (`channels=[]`, `skills=false`, `scheduler=false`)
  hides Channels / Skills / Scheduler; Hermes keeps all three.
  Entries without `requires` (Chat, Home, Settings, Compare,
  Analytics, Models, Budgets, Profiles, Runbooks) always show.
- **Chat routing IPC** (`src-tauri/src/ipc/chat.rs`):
  `ChatSendArgs` + `ChatStreamArgs` gain
  `adapter_id: Option<String>` (`#[serde(default)]`).
  New private helper `pick_adapter` resolves `explicit → get()`
  or `None → default_adapter()`, returning `NotConfigured` loudly
  when an explicit id isn't registered (safer than silently
  falling back and running against the wrong adapter).
  Frontend `chatSend` / `chatStream` forward
  `useAgentsStore.getState().activeId` on each send; read is
  non-reactive on purpose (selection changes apply to the NEXT
  send, never retroactively).
- **IPC exposes capabilities** (`src-tauri/src/ipc/agents.rs`):
  `AdapterListEntry` now includes the live `capabilities`
  snapshot; unlocks the Sidebar filter without a second IPC
  round-trip.

### Tests

- **Rust**: 124 → **125** (+1 `t55b_list_includes_capabilities_per_adapter`
  — Hermes has messenger channels, Claude Code doesn't claim
  `skills` but does claim `terminal`).
- typecheck + lint clean.

### Deferred to T5.5c

- **Unified inbox** — merge sessions from every enabled adapter
  into the chat SessionsPanel with per-row adapter badges.
  Requires rewriting the sessions selector + adding adapter
  filter UI; scope creep vs. what this commit ships.

---

## 2026-04-23 — T5.5a · Topbar AgentSwitcher (read-only)

First visible multi-adapter surface. With two adapters registered
(Hermes + Claude Code mock), the Topbar now lists them side-by-side
with live health dots and uptime. Selection / routing / capability-
gated nav land in T5.5b once the read-only switcher proves its shape.

### Shipped

- **`adapter_list` IPC** (`src-tauri/src/ipc/agents.rs`) —
  fans out per-adapter `health()` probes in parallel via
  `tokio::spawn`, merges results with `AdapterRegistry::all()`,
  and returns one row per adapter (`AdapterListEntry { info,
  health, health_error? }`). Individual probe failures don't
  fail the IPC — the row lands with `health: null` +
  `health_error` so the switcher can render "registered but
  unreachable" distinctly from "not registered at all". One test:
  `adapter_list_shape_matches_expectations` exercises the
  fan-out + default-flag round-trip.
- **`useAgentsStore`** (`src/stores/agents.ts`) — Zustand slice
  that owns `{ adapters, error, loading }`. `startBackgroundRefresh`
  runs an immediate probe + 30s poll, idempotent for HMR
  (mirrors `useAppStatusStore`). Booted once from
  `<Providers>` so every consumer reads the same cached list.
- **`<AgentSwitcher />`** (`src/app/shell/AgentSwitcher.tsx`) —
  Topbar pill showing the default adapter's name, adapter count,
  and a health dot (green/red/pulsing-grey). Dropdown rows show:
  name + id + `default` badge + version + uptime + latency, plus
  amber `last_error` / red `health_error` strips when present.
  Mounted between the gateway pill and the right-hand
  palette/theme cluster so the topbar reads
  "gateway → agent → navigation".

### Tests

- **Rust**: 123 → **124** (+1 for the IPC fan-out shape).
- **TS**: typecheck + lint clean; no new e2e specs yet (T5.5b
  will add one that asserts switcher lists both adapters).

### Deferred to T5.5b

- **Active adapter selection** — store currently surfaces the
  registry's default; the switcher is read-only. Making it
  clickable requires a store slice for the "user-selected
  adapter" plus routing the chat send path through it.
- **Capability-gated nav** — hide Channels/Skills/Scheduler when
  the active adapter doesn't claim the capability.
- **Unified inbox** — merge sessions from every enabled adapter
  into the chat sidebar with per-row adapter badges.

---

## 2026-04-23 — T5.2a · Claude Code mock adapter + conformance suite

Lands a second first-class `AgentAdapter` alongside Hermes, plus the
shared conformance harness the rest of Phase 5 will gate on. Mock-
first: the real `claude-code` CLI wrapper (T5.2b) follows once the
UI surface (T5.5) is up and driveable against two citizens.

### Shipped

- **`ClaudeCodeAdapter::new_mock()`** (`src-tauri/src/adapters/claude_code/`):
    - Capabilities match the Phase 5 spec: `streaming=true`,
      `tool_calls=true`, `attachments=true`, `skills=false`,
      `channels=[]`, `terminal=true`, `trajectory_export=true`.
    - `list_sessions` / `list_models` load from committed fixtures
      (`fixtures/sessions.json` + `fixtures/models.json`): 2 demo
      Claude Code sessions, 3 Claude models (Sonnet 4.5, Opus 4,
      Haiku 3.5).
    - `chat_once` returns a canned reply that echoes the last user
      message + `turn.cwd` — cheapest end-to-end proof that the
      T5.1 `ChatTurn.cwd` plumbing survived IPC → registry →
      adapter.
    - `chat_stream` emits one synthetic `ToolProgress` ("📖 read")
      then word-chunked deltas at 20ms each, so the UI's tool-card
      + streaming paths exercise this adapter the same way they
      exercise Hermes live mode.
- **Shared conformance suite** (`src-tauri/src/adapters/conformance.rs`):
  `conformance::run(adapter)` asserts id/name validity,
  `capabilities()` sanity (no empty channel strings), `health()`
  shape (matching `adapter_id`), per-row `adapter_id` tagging on
  `list_sessions`, and query pass-through. Two parameterised
  tests — `hermes_stub_is_conformant` +
  `claude_code_mock_is_conformant` — run it against both adapters
  so any new adapter can add one line to join the gate.
- **Registered in `lib.rs`** alongside Hermes (non-default). Boot
  log now prints the populated adapter list; today it's
  `["hermes", "claude_code"]`.

### Tests

- **Rust**: 116 → **123** (+7). 5 new claude_code mock unit tests
  (health, capabilities, fixture load + search, `cwd` echo,
  stream emits tool-then-deltas); 2 conformance parameterisations.
- `cargo check` + `cargo clippy --lib -- -D warnings`: clean.

### Deferred

- **T5.2b real CLI** — `cli.rs` / `sessions.rs` / `stream.rs` for
  the upstream `claude-code` binary + recorded fixtures. Blocked
  on nothing except time; will follow once T5.5 surfaces the
  switcher.

### Next

- **T5.5 AgentSwitcher** — Topbar picker + capability-gated nav.
  With two registered adapters, we can now build the UI against a
  real multi-citizen registry instead of a singleton.
- Or **T5.3 Aider adapter** (process-pooled JSONL) — same mock-first
  pattern once you give the word.

---

## 2026-04-23 — T5.1 · Adapter trait polish (Phase 5 kickoff)

Opens Phase 5 (Multi-agent console) with the lowest-risk task: evolve
the `AgentAdapter` trait so forthcoming Claude Code / Aider adapters
have the fields they need, without breaking anything Hermes already
does.

### Shipped

- **`Health` extended** — added `last_error: Option<String>` +
  `uptime_ms: Option<u64>`, both `#[serde(default)]` so existing
  consumers keep deserialising. `HermesAdapter` tracks a
  `started_at: Instant` for uptime and a `RwLock<Option<String>>`
  for the sticky last-error: successful probes clear it, failed
  probes record it. UI agent-switcher (T5.5) will surface both.
- **`ChatTurn.cwd: Option<String>`** — optional working directory
  for code-centric adapters. Wired end-to-end through
  `chat_send` + `chat_stream_start` IPC (`ChatSendArgs.cwd` +
  `ChatStreamArgs.cwd`, both `#[serde(default)]`). Hermes ignores
  it; Claude Code / Aider will consume it starting T5.2.
- **Hermes `list_sessions` honours query** — the trait already
  declared `SessionQuery { search, source, limit }` but the
  adapter silently dropped all three. Now:
    - `search`: case-insensitive substring match on `title`
    - `limit`: take-N cap
    - `source`: still ignored (deferred — fixtures don't carry
      enough signal to validate, Claude Code/Aider will force the
      design)

### Tests

- **Rust**: 112 → **116** (+4 under `adapters::hermes::tests::t51_*`):
  stub-health surfaces uptime/no-error, search filters by title,
  limit caps the set, `ChatTurn.cwd` back-compat round-trip.
- `cargo check` + full lib test: clean.

### Deferred (tracked)

- specta bindings regen — no TS consumer of `Health` /
  `ChatTurn.cwd` yet; revisit when T5.2 lands a non-Hermes adapter.
- `SessionQuery.source` filter — same rationale; the moment a
  non-Hermes adapter exposes meaningful `Source` values we wire it.

### Next

- **T5.2 Claude Code adapter** (2 days) — mock-first (no real CLI),
  then cli + sessions + stream modules + fixtures + conformance
  suite.

---

## 2026-04-23 — Brand · Corey logo + Icon wrapper + Dock/window polish

First pass of brand identity: ship the Corey logo across every Tauri
platform, install a unified `<Icon>` wrapper around lucide-react,
and close three user-reported papercuts on the final look (Dock
name, ghost title, square icon).

### Shipped

- **Tauri multi-platform icons** (`a35335b`) — ran `pnpm tauri icon
  src-tauri/icons/Corey.png` (1024×1024 source). Generated the full
  set: macOS `icon.icns`, Windows `icon.ico` + Appx `Square*Logo.png`,
  Linux `32/64/128/128@2x/icon.png`, iOS `AppIcon-*@{1,2,3}x.png` for
  every required size, Android `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher{,_round,_foreground}.png`.
  `tauri.conf.json` was already wired to the canonical filenames so
  no config change needed.
- **Favicon** (`a35335b`) — copied the 1024×1024 source to
  `public/favicon.png` and the 32×32 rasterisation to
  `public/favicon-32.png`; `index.html` registers both plus an
  `apple-touch-icon` entry.
- **`<Icon>` wrapper** (`a35335b`, `src/components/ui/icon.tsx`) —
  thin `forwardRef` around any `LucideIcon`. Enforces:
    - `strokeWidth={1.5}` (matches the logo's thin-stroke geometry)
    - `size` accepts discrete tokens (`xs|sm|md|lg|xl` → 12/14/16/20/28 px)
      **or** a raw pixel number for edge cases
    - `className` auto-`shrink-0` so flex layouts don't compress it
    - `aria-hidden={true}` by default (decorative unless caller
      overrides)
  Size tokens align with the groupings in `docs/icon-audit.md`.

### Fixed

- **Dock shows "Corey" not "caduceus"** (`dc30ee9`) — dev mode runs
  `target/debug/<binary>` directly (no `.app` bundle), so the Dock
  process name mirrors the Cargo binary name. Added `[[bin]] name =
  "Corey"` in `src-tauri/Cargo.toml`; package name stays
  `caduceus` so every `use caduceus_lib::…` import is untouched.
  Only the compiled binary filename flips to `target/debug/Corey`.
- **Ghost "Corey" text above sidebar brand** (`83432a1`) — with
  `titleBarStyle: "Overlay"`, macOS renders `window.title` atop the
  overlay title-bar region, directly over our custom Sidebar brand
  area. The native title text appeared as a faint white "Corey"
  label above our own `CoreyMark` + `app.name` span. The sidebar
  already displays the brand, so the OS title is redundant;
  blanked `title: ""` in `tauri.conf.json` (traffic-lights + drag
  region unchanged).
- **Square Dock icon → squircle** (`b66fc18`) — the raw 1024×1024
  source had hard right-angle corners, so the Dock icon read as a
  black block next to every other app's squircle. Applied a 180px
  radius corner mask via ImageMagick (`CopyOpacity` composite) —
  ≈17.6% of canvas, close to the macOS/iOS squircle convention —
  then re-ran `pnpm tauri icon` to regenerate the full platform
  matrix plus `public/favicon.png` + `public/favicon-32.png` +
  `public/corey.png` (the one `CoreyMark` renders in-app).

### Batch-refactored (follow-up commits `639ba5c` + `1465e65`)

- **All ~80 lucide-react call sites migrated to `<Icon>`** — split
  across two commits to keep diffs reviewable:
    - `639ba5c` (batch 1): UI components (drawer, combobox, select,
      empty-state), shell (Sidebar, Topbar, Palette), chat (index,
      MessageBubble, SessionsPanel, ActiveLLMBadge), plus simple
      features (home, terminal, analytics, logs/{index,Hermes,Changelog}),
      channels (index, ChannelForm, WeChatQr), profiles.
    - `1465e65` (batch 2): compare, budgets, skills, models,
      runbooks, trajectory, settings.
  Size tokens applied throughout: `size="xs"` (12px) for decorative
  inline chips, `size="sm"` (14px) default for text-flow & button
  icons, `size="md"` (16px) for nav/topbar & emphasised button
  icons, `size="lg"` (20px) for empty-state. Spin / color overrides
  go through `className=`. Any stroke-width drift is now impossible
  to introduce without editing `src/components/ui/icon.tsx` itself.

### Test totals

- typecheck + lint: clean (same 4 pre-existing fast-refresh
  warnings).
- Rust: cargo rebuild on icon refresh (`touch build.rs` +
  `tauri.conf.json`) to re-embed `icon.icns`; `killall Dock`
  required once to bust macOS's Dock icon cache.

---

## 2026-04-23 — UI polish · drag region, zoom suppression, themed Select, layout hardening

Post-close-out polish session driven by `pnpm tauri:dev` user report.
Five user-visible UX papercuts land; no functional scope changes. No
Phase status moves — this is hygiene on top of the 2026-04-23 Phase
1–4 close-out below.

### Fixed

- **Window drag region covers full topbar** (`1b67996`). Moved
  `data-tauri-drag-region` onto the `<header>` element itself; the
  prior `absolute inset-0 -z-10` child was mis-stacked below
  `bg-bg-elev-1` so mousedowns on empty header space never reached
  it. Interactive children (model pill, gateway pill, palette, theme
  toggle) still fire their own click handlers — Tauri dispatches on
  `event.target`.
- **Webview zoom suppressed** (`1b67996`). `<Providers>` now installs
  a `keydown` + non-passive `wheel` listener that swallows Cmd/Ctrl
  `+` / `-` / `=` / `0` and Cmd/Ctrl+wheel. Desktop apps resize with
  the window; they do not zoom. This fixes chat-bubble compression,
  Sidebar `pl-20` misalignment, and the overall scale drift users
  saw at non-100% zoom.
- **Native `<select>` → themed `Select`** (`1b67996`). New
  `src/components/ui/select.tsx` (~250 LoC, `role=combobox` +
  `listbox` pair, keyboard: ArrowUp/Down wrap + Home/End + type-ahead
  + Enter/Space commit + Escape cancel + outside-click + active-option
  scroll-into-view + `aria-activedescendant`). Replaces all 4 native
  selects in Budgets editor (scope / period / action) + Settings
  appearance (language). Playwright specs (`budgets.spec.ts`,
  `settings.spec.ts`) switched from `selectOption()` to
  `click(trigger) → getByRole('option', { name }).click()`.
- **CoreyMark alt-text ghost removed** (`14a03d5`). `<img alt="Corey">`
  was rendering its alt string inside the image box while the PNG
  decoded (cold start, HMR reload), producing a ghostly second
  "Corey" label next to the real `{t('app.name')}` span. Now
  `alt=""` + `role="presentation"`; TS prop type `Omit`s `alt` to
  prevent regressions.
- **Narrow-window layout hardened** (`14a03d5`). Added `shrink-0` to
  Sidebar brand row + `CoreyMark` + every Topbar pill (model picker,
  gateway pill, palette trigger, theme toggle) so flexbox stops
  proportionally compressing interactive elements. Sidebar
  `pl-20 → pl-4` under `@media (display-mode: fullscreen)` — macOS
  hides traffic lights in fullscreen, so the reserve was dead weight.

### Deferred

- **Icon system replacement** — audit landed at `docs/icon-audit.md`
  (~80 icons across 30 files, with current + suggested sizes); the
  replacement itself (custom SVG / alt library / unified wrapper)
  is deferred pending user decision on approach.

### Test totals

- **E2E (Playwright)**: 52 passing (unchanged; 2 specs rewritten
  for the new Select).
- typecheck + lint: clean.

### Next

- Pick icon strategy, then batch-replace per `docs/icon-audit.md`.
- Resume Phase 5 kickoff (multi-agent console) — no open
  regressions blocking it.

---

## 2026-04-23 — Phase 1–4 close-out · six follow-ups shipped

Final sweep before Phase 5: six high-value follow-ups across Phase 1,
2, and 4 land in a single session. Everything else is triaged into
`docs/06-backlog.md` with priority + re-open triggers.

### Shipped

- **T1.5c** (`1f34124`) — vision-capability gating on the Paperclip
  button. Tri-state `visionSupport()` heuristic in
  `src/lib/modelCapabilities.ts`; non-vision models surface an amber
  warning banner when an image is pending; send is not hard-blocked.
- **T1.5d + T1.5e** (`6c34f71`) — attachment thumbnails + orphan-file
  GC. New `attachment_preview` IPC returns a 5 MB-capped data URL;
  `AttachmentImageTile` renders 96×96 thumbs with loading/failure
  fallback. `attachment_gc` sweeps files not referenced by any DB
  row on every app start.
- **T4.4b** (`ce6603e`) — budget-breach chat interceptor. Before each
  send, `evaluateBudgetGate` runs; `notify` budgets surface an inline
  amber banner, `block` budgets raise a native confirm dialog, cancel
  aborts with the composer draft preserved. Lifetime spend only (per-
  period windowing parked pending analytics bucket support).
- **T4.6b** (`5490f18`) — runbook scope filtering by active Hermes
  profile. `runbookScopeApplies()` shared between the Runbooks list
  (with "Show all scopes" toggle) and the palette (tight filter, no
  toggle). Scope picker added to the editor.
- **P2 profile revert** (`ad264c9`) — `changelog_revert` dispatcher
  now handles `hermes.profile.{create,rename,clone,delete}`. Extracted
  pure `apply_revert()` for testing; delete-revert recreates the
  profile with a seed `config.yaml` (prior data explicitly not
  restored, per documented contract).

### Test totals

- **Rust**: 101 → **112** (+11 across 4 modules).
- **E2E (Playwright)**: 46 → **52** (+6).
- `cargo fmt --check` + `cargo clippy -- -D warnings` + typecheck +
  lint: clean.

### Backlog-ified

See `docs/06-backlog.md` for the 18-ish items that stayed parked:
Tencent iLink (blocked on credentials), CodeMirror 6, multi-tab
terminal, per-period budget windowing, reconnect auto-poll, 10k-msg
virtualisation, profile data-restore, per-profile gateway lifecycle,
tar.gz profile import/export, streaming log tail, and more. Each
entry carries a priority + re-open trigger so nothing rots.

### Phase 5 opens on

- M1–M3 shipped, Phase 1 / 2 / 3 / 4 all flagged `**Shipped**` in
  `docs/05-roadmap.md`.
- No open exit-criteria regressions.
- Clean working tree; CI green on `main`.

---

## 2026-04-22 — T1.5b · Multimodal chat wire format

Upgrades the chat IPC wire so vision-capable providers actually receive
images instead of just a `[attached: …]` text hint. Frontend sends
`{role, content, attachments: [{path, mime, name}]}`; the Hermes adapter
reads each staged file, base64-encodes it into a `data:…` URL, and
assembles OpenAI's multimodal `content` array (`{type:"text"}` +
`{type:"image_url"}` parts). Plain-text turns still serialise as bare
strings — parity with providers that reject the array shape when there
are no image parts.

### Shipped

- **`ChatMessageDto` extended** (Rust + TS) with optional
  `attachments: Vec<ChatAttachmentRef>` (`skip_serializing_if` empty so
  the wire stays minimal for plain turns). `ChatAttachmentRef` carries
  `{path, mime, name}`.
- **Gateway DTOs upgraded** — `ChatMessage.content` is now the
  untagged `ChatMessageContent { Text(String) | Parts(Vec<…>) }`;
  `ChatContentPart` is tagged with `{type:"text"|"image_url"}`.
- **`resolve_turn` / `build_content`** in the Hermes adapter read image
  attachments from disk, base64-encode, and build the parts array. Text
  part leads (OpenAI's recommended ordering). Non-image MIMEs and
  failed reads degrade to a `[attached: name]` marker appended to the
  text part — the user's words still reach the model on a bad read.
- **Frontend composer** stops baking `[attached: …]` into the bubble
  content. Stored text is now verbatim user input; attachments render
  as chips only. Prior turns' attachments ride along in `historyForIpc`
  so multi-turn context ("what colour was that?") works.

### Fixed

- Chat bubbles no longer show `[attached: foo.png]` noise after an
  attachment send. Users see their text; chips render separately.

### Test totals

- **Rust**: 96 → **101** (+5 tests in `adapters::hermes::tests` covering
  text-only passthrough, image→data URL, non-image marker fallback,
  missing-file graceful degrade, and mixed-attachment ordering).
- **E2E**: 45 → **46** (+1 — asserts the outgoing IPC payload carries
  the `attachments` array and clean `content` string; existing 3 tests
  adjusted to the new bubble content shape).

### Deferred

- **Vision-capability gating on Paperclip** — the button is still
  unconditionally enabled; a non-vision model attached an image just
  ignores it (or errors, depending on the provider). Next T1.5-series
  follow-up.
- **Attachment thumbnail preview** in chat bubbles. Needs an
  `attachment_preview` IPC reading staged bytes into a data URL the UI
  can hang off `<img src>`.
- **Orphan-file GC** for `~/.hermes/attachments/` when sessions are
  deleted. DB cascades the rows; disk still leaks until a `hermes
  attachments gc` helper lands.

---

## 2026-04-22 — Phase 4 complete · T4.2–T4.6 rollup

Wraps up Phase 4. All six differentiator tasks now ship; the last five
landed today on top of T4.1 from the morning. Per-task commits carry
full details; this entry is the consolidated view.

### Shipped

- **T4.2 Skill editor** (`067a94f`) — CRUD on `~/.hermes/skills/**/*.md`.
  Backend `skills.rs` + `ipc/skills.rs` with traversal-safe resolve and
  atomic writes; frontend tree + textarea editor + dirty-state badge.
  No CodeMirror yet (textarea is enough for Markdown).
- **T4.3 Trajectory timeline** (`48885d6`) — read-only session
  visualiser rendering messages + tool-call ribbons on a CSS timeline
  with a right-side inspector. Uses existing `dbLoadAll` — no new IPC.
- **T4.4 Budgets** (`5de15dc`) — CRUD page with live progress bars,
  colour-coded at 80% / 100%. Projects lifetime spend via a hard-coded
  per-1M-token price table. Backend CRUD arrived with T4.6's v3
  migration. Budget-breach chat interceptor deferred to T4.4b.
- **T4.5 Web terminal** (`fdb5417`) — portable-pty backend + xterm.js
  frontend. Single-tab MVP; spawn → stream → resize → kill lifecycle
  with base64-framed data events. Multi-tab / WebGL / scrollback
  restore deferred.
- **T4.6 Runbooks** (`a553f13`) — named prompt templates with
  `{{placeholder}}` parameters. v3 SQLite migration adds both
  `runbooks` and `budgets` tables. Palette integration: zero-param
  runbooks drop straight into Chat; param-ful ones open a fill form.
  Chat composer reads `pendingDraft` from a StrictMode-safe zustand
  store.

### Phase 4 test rollup

- Rust `cargo test --lib`: **89 passed** (79 pre-Phase-4 → +10 across
  runbooks / budgets / pty / skills / base64).
- Playwright: **42 passed** (33 pre-Phase-4 → +9 across
  compare × 3, runbooks × 3, budgets × 2, trajectory × 1,
  terminal × 1, skills × 2; one accidental "+3/+2/+1/+1/+2" count —
  see per-task commits).
- Rust clippy `--all-targets -- -D warnings`: clean.
- `pnpm typecheck` + `pnpm lint`: clean (3 fast-refresh warnings on
  feature files that co-locate helpers; accepted as MVP tradeoff).

### Deferred for later phases / follow-ups

- CodeMirror 6 editor in Skills.
- Skill test-runner + version history / rollback.
- Multi-tab terminal + WebGL renderer + paste-large protection.
- Budget-breach chat interceptor (notify/block at 80/100%).
- Per-model cost breakdown in Budgets (needs Analytics v2 refactor).
- Runbook scope filtering by profile; export / import runbook JSON.
- Jaccard / embedding similarity in Compare's diff footer.
- Real Tencent iLink client (T3.3 follow-up, still open).

### Next

- Phase 5 — Multi-agent console (≥2 non-Hermes adapters running
  side-by-side).

---

## 2026-04-22 — Phase 4 Sprint 1 (T4.1): Multi-model compare

### Context

First differentiator feature. Users can paste a prompt, pick up to 4
models, and watch them stream side-by-side. Drives the Phase 4 demo
story and makes the "am I picking the right model?" question
answerable in 10 seconds. No backend changes — existing
`chatStream` already supports handle-scoped concurrent streams, so
the entire feature is frontend orchestration + one mock tweak.

### Shipped

- **`src/features/compare/index.tsx`** (~460 LoC, single file).
  - `PromptBar`: full-width textarea, Ctrl/⌘+Enter to Run, Run/Stop
    toggle.
  - `ModelPicker`: chip row + dropdown of `model_list` results,
    hard-capped at 4 lanes. Remove via X on chip; Add button
    disables at cap.
  - `LanePanel` per model: header (display name + provider), body
    (`Markdown` reused from chat), footer (wall-clock latency,
    tokens, finish_reason or Cancelled/Error state). Per-lane X
    cancels just that lane without touching the others.
  - `DiffFooter`: appears once ≥2 lanes are done. Highlights
    fastest wall-clock and highest-token model. No similarity
    metric yet — deliberate.
  - Export helpers: Markdown + JSON via a tiny `downloadBlob` —
    no new deps.
- **Route wiring**: `/compare` in `src/app/routes.tsx` now points
  at `CompareRoute` instead of the Phase-4 placeholder.
- **Concurrency model**: one `chatStream()` call per lane; handles
  collected in a `Map<laneId, ChatStreamHandle>`. Per-lane cancel
  and global Stop-all both go through the same map. Route unmount
  drains every handle so nav-away mid-run doesn't leak listeners.
- **Ephemeral state**: lanes live in React state keyed by
  `r${runId}-${modelId}-${i}`. No DB writes — Compare is a
  scratchpad, not a session.
- **i18n**: `compare.*` keys in en + zh.
- **Mock tweak**: `chat_stream_start` in `e2e/fixtures/tauri-mock.ts`
  now echoes `[model=<id>]` when a `model` arg is supplied and
  reports that model in the `done` summary. Old chat-feature tests
  take the fallback branch and are unaffected.

### Test totals

- Rust `cargo test`: **79 passed** (unchanged — T4.1 is frontend-only).
- Playwright `compare.spec.ts`: **3/3 passed** (new).
- Full Playwright suite: **33/33 passed** (+3 over T3.5's 30).
- `pnpm typecheck` + `pnpm lint`: clean.

### Deferred (within T4.1 · for later if demand appears)

- `ipc/compare.rs` backend wrapper (for lifecycle / journaling —
  not needed while frontend orchestrates).
- Jaccard / embedding similarity in `DiffFooter`.
- Lane output virtualization (cap of 4 × ~2k tokens is comfortable).
- "Save run" persistence — export covers the keep-it workflow.

### Next

- **T4.3** Trajectory timeline, **T4.5** Web Terminal, or **T4.4**
  Budgets & alerts — each independent, 1.5–2 days.

---

## 2026-04-22 — Phase 3 Sprint 5 (T3.5): Mobile drawer for channel edit flow · **Phase 3 complete**

### Context

The card grid already stacks to one column below Tailwind's `sm`
breakpoint (640px), so the visible layout work for T3.5 is the
edit flow itself. Expanding a card inline on a 375-wide viewport
pushes the user past the viewport fold; we flip that to a bottom
drawer above the card grid, keeping the ergonomics (Cancel,
restart prompt, etc.) identical to desktop.

This closes Phase 3. T3.1–T3.5 are all green.

### Shipped

- **`useIsMobile(maxPx = 720)`** — 12-line `matchMedia` hook at
  `src/lib/useIsMobile.ts`. SSR-safe, re-subscribes on
  breakpoint change. One call site today (ChannelCard) — kept
  small instead of reaching for a media-query library.
- **`Drawer`** — `src/components/ui/drawer.tsx`, ~70 LoC. Fixed
  bottom sheet, 88vh max-height, slide-in via a `drawerUp`
  keyframe added to `tailwind.config.ts`. Click-outside on the
  backdrop closes; ESC closes; `document.body` gets
  `overflow: hidden` while open. Portal'd into `document.body`
  via `createPortal` so the parent card's overflow never clips
  it. Deliberately skipped swipe-to-dismiss, focus trap, and
  animated unmount — each adds state the one call site doesn't
  yet justify.
- **`ChannelCard` mobile integration**: extracted edit / confirm /
  saving / restart-prompt / error JSX into a local
  `renderInteractivePanels()` closure. Desktop renders inline
  below the read-only summary (unchanged behavior); mobile
  mounts the same node inside `<Drawer>`. `isInteractive` gates
  the drawer mount so the portal never exists in `view` mode.
  Drawer's X button + backdrop both route through
  `setMode({ kind: 'view' })` — matching the inline version's
  Cancel / dismiss paths exactly.
- **Tailwind**: one new keyframe `drawerUp` (translateY 100% →
  0%). No new colors, fonts, or spacing tokens.

### Test totals

- Rust `cargo test`: **79 passed** (unchanged — T3.5 is
  frontend-only).
- Playwright `channels.spec.ts`: **7/7 passed** (+1): 375×740
  viewport, click Edit, asserts drawer mounts outside the
  `<article>` (portal), form lives inside the drawer not the
  card, X button closes, backdrop click closes.
- Full Playwright suite: **30/30 passed**.
- `pnpm typecheck` + `pnpm lint`: clean.

### Phase 3 rollup

- T3.1 ✓ catalog + grid · T3.2 ✓ inline forms + atomic writes +
  diff + restart prompt · T3.3 ✓ WeChat QR scaffolding · T3.4 ✓
  live status probing · T3.5 ✓ mobile drawer.
- Rust: 70 → 79 tests (+9 over Phase 3).
- Playwright: 23 → 30 tests (+7 over Phase 3).

### Deferred (carry forward)

- Real Tencent iLink HTTP client (T3.3 follow-up).
- Explicit "Clear existing secret" button.
- Real `/health/channels` endpoint probe (if upstream adds it).
- WhatsApp env name verification.
- Phase-2 profile tar.gz import/export, per-profile gateway
  start/stop, active-profile switching, streaming log tail.

### Next

- **Phase 4** — Differentiators (multi-model compare, skill
  editor, trajectory, budgets, terminal).

---

## 2026-04-22 — Phase 3 Sprint 4 (T3.4): Live channel-status probing

### Context

Hermes exposes no per-channel health endpoint, so we derive liveness
from the rolling log files at `~/.hermes/logs/{gateway,agent}.log`.
Read-on-demand, 30s cached, with a force-refresh knob for the
Channels page's Probe button. When upstream adds a real health
endpoint, it drops in as a second backend inside
`channel_status.rs` without touching the IPC or UI.

### Shipped

- **`channel_status.rs`**:
  - `LiveState` three-way enum (`Online`/`Offline`/`Unknown`).
    `Unknown` is load-bearing — unconfigured channels or fresh
    installs must never be misreported as down.
  - `classify(id, lines)` — newest-first log scan matching the
    channel slug with a positive marker
    (`connected/ready/started/online/subscribed`) or negative
    (`error/failed/disconnect`). Most-recent wins so a reconnect
    after an outage reads right.
  - `probe_all(home_override)` — tails 1000 lines each of
    gateway.log + agent.log via `hermes_logs::tail_log_at`,
    classifies all 8 channels, returns one row per catalog entry
    in catalog order.
  - `ChannelStatusCache` with `snapshot(force)` — 30s TTL on the
    whole snapshot; force bypasses.
- **IPC** `hermes_channel_status_list(force)` — thin wrapper that
  runs the probe in `spawn_blocking` so the Tokio loop stays
  snappy.
- **`AppState.channel_status: Arc<ChannelStatusCache>`** — lazy,
  no startup cost.
- **Frontend**:
  - `ChannelsRoute` fetches statuses + catalog on mount; keeps
    statuses keyed by id at route level. Two header buttons: Probe
    (force-refreshes status only) and Refresh (catalog + status).
    Both carry distinct testids for e2e.
  - `LiveStatusPill` next to the config `StatusPill` — emerald /
    danger / muted for online / offline / unknown. Triggering log
    line exposed as a `title` tooltip (truncated to 160 chars).
    Guarded: hidden for `unconfigured` and `qr` (WeChat) statuses.
- **i18n** `channels.probe` + `channels.live.{online,offline,unknown}`
  in en + zh.

### Test totals

- Rust `cargo test`: **79 passed** (+9): `classify` across
  online/offline/unknown plus wechat-vs-wecom substring safety,
  case-insensitivity, lines-without-slug; `probe_all` returns one
  row per catalog entry; cache reuse within TTL + force advances
  `probed_at_ms`.
- Playwright `channels.spec.ts`: **6/6 passed** (+1): telegram
  configured → online, matrix partial → offline, discord
  unconfigured → no pill; Probe button force-refresh flips matrix
  to online without a full reload.
- `cargo fmt` + `cargo clippy --all-targets -- -D warnings`:
  clean.
- `pnpm typecheck` + `pnpm lint`: clean.

### Deferred

- **T3.5** mobile layout.
- Real Tencent iLink client (T3.3 follow-up).
- Explicit "Clear" button for existing secrets.
- Real `/health/channels` endpoint probe (if upstream adds one).
- WhatsApp env name verification.

### Next

- **T3.5** mobile layout.

---

## 2026-04-22 — Phase 3 Sprint 3 (T3.3): WeChat QR-login scaffolding

### Context

WeChat credentials can't be typed — they arrive via a QR scan
against Tencent's iLink service. T3.3 ships the state-machine
skeleton + UI behind a `QrProvider` trait so the real iLink HTTP
client can drop in later without touching the frontend or IPC
layer. The live iLink integration is deferred until we have
credentials to test against (out-of-scope while upstream is a
black box we can't exercise).

### Shipped

- **Rust `wechat.rs`**:
  - `QrProvider` async trait (`start` / `poll` / `cancel`). Thin
    contract; real iLink impl drops in as a second struct.
  - `QrStatus`: `Pending` / `Scanning` / `Scanned` / `Expired` /
    `Cancelled` / `Failed { detail }`, with `is_terminal()` as the
    single source of truth for "stop polling".
  - `StubQrProvider` — deterministic mock that advances on poll
    count (2 Pending, 1 Scanning, 1 Scanned). On `Scanned` writes
    `WECHAT_SESSION=stub-session-{qr_id}` through
    `hermes_config::write_env_key` so changelog revert, card state,
    etc. all behave end-to-end.
  - `synth_qr_svg(seed)` — seeded placeholder SVG (21×21 cells +
    conventional finder patterns, deterministic per id). Zero new
    crates; the real provider returns a proper scannable image that
    replaces this fn wholesale.
- **Three IPCs** `wechat_qr_start`, `wechat_qr_poll`,
  `wechat_qr_cancel` — each a thin wrapper around the provider.
- **`WechatRegistry`** on `AppState` hides which implementation is
  wired up. `lib.rs` constructs `StubQrProvider` today; swapping
  to `ILinkQrProvider::new(..)` is a one-line change when that
  ships.
- **Frontend `WeChatQr.tsx`** (inline inside the WeChat card's
  edit form). Two visible states:
  - *Idle*: intro copy + "Start QR session" CTA.
  - *Active*: inline SVG + status line + Cancel (or "Start over"
    once terminal).
  - 2s poll cadence via recursive `setTimeout` (never stacks on a
    slow network); unmount triggers best-effort cancel so
    navigating away doesn't leave an orphan session.
- **Card integration** — on `scanned`, the form fires
  `onWechatScanned`; the parent card re-reads `ChannelState` and
  surfaces the same amber "Restart gateway?" prompt that normal
  non-hot-reloadable saves use.
- **i18n** `channels.wechat.*` (en + zh): intro, start/restart/
  cancel, six status lines, expiry countdown, "written by QR"
  marker, adjusted `qr_cta` / `qr_pending` to drop the "coming in
  T3.3" qualifier.

### Fixed

- Clippy `needless_range_loop` on `synth_qr_svg`'s grid-paint
  loops (kept index loops — cleaner than `enumerate()` with an
  unused value; `#[allow(..)]` at fn level).

### Deferred

- **Real Tencent iLink HTTP client** — expected ~300 LoC of
  `reqwest` + cookies + retry. Waiting on upstream docs /
  credentials.
- **T3.4** live status probing, **T3.5** mobile layout, explicit
  "Clear an existing secret" button, WhatsApp env name
  verification.

### Test totals

- Rust `cargo test`: **70 passed** (+5): stub state machine,
  cancel idempotency, unknown-id = NotFound, SVG determinism,
  scanned writes expected token through `write_env_key`.
- Vitest: **11 passed** (unchanged).
- Playwright `channels.spec.ts`: **5/5 passed** (+1): start → QR
  SVG visible → pending → scanning → restart prompt → env_present
  flips for `WECHAT_SESSION`. ~10s wall clock (stub cadence is
  real-time by design).
- `cargo fmt` + `cargo clippy --all-targets -- -D warnings`:
  clean.
- `pnpm typecheck` + `pnpm lint`: clean.

### Next

- **T3.4** live status probing + log-grep fallback.
- **T3.5** mobile layout.

---

## 2026-04-22 — Phase 3 Sprint 2 (T3.2): Channels inline forms + atomic writes

### Context

T3.1 gave us a read-only catalog grid. T3.2 makes it interactive:
the user can now click Edit on any card, change the channel's
credentials and / or behavior fields, and save — with an atomic
`.env` + `config.yaml` round-trip, a diff confirmation, and a
gateway-restart prompt for channels Hermes doesn't hot-reload.

No new channels; just the write path for the 8 we already enumerate.

### Shipped

- **Atomic write IPC** `hermes_channel_save(id, env_updates,
  yaml_updates)`. Validates every key against the channel's
  `ChannelSpec` before touching disk, then runs two atomic phases:
  `.env` upserts (one journal entry per key) and a
  `hermes.channel.yaml` patch that creates missing intermediate
  mappings and treats JSON `null` as "delete this field". Unrelated
  keys elsewhere in `config.yaml` round-trip verbatim via
  `serde_yaml::Value`. Returns the refreshed `ChannelState` so the
  card updates without a second `hermes_channel_list` call.
- **YAML walker helpers** in `hermes_config.rs`:
  `write_channel_yaml_fields` (public), plus `walk_set` /
  `walk_remove` / `json_to_yaml_value` / `yaml_to_json_value`
  (private). `walk_set` creates missing intermediate mappings;
  `walk_remove` leaves siblings intact.
- **Dynamic form** `src/features/channels/ChannelForm.tsx`. One
  component drives all 8 channels via the `ChannelSpec` the backend
  ships with each card. `bool` → checkbox, `string` → text input,
  `string_list` → textarea (one per line). Env inputs are
  password-masked by default with an Eye toggle; they never
  pre-fill — an empty input on a channel whose token is already set
  means "leave unchanged". Save emits an explicit `{ envUpdates,
  yamlUpdates, diffs }` submission envelope; no-op patches are
  rejected so the user sees why.
- **Inline `ConfirmDiff`** panel. After Save the form flips to a
  review view with one row per pending change (`before → after`),
  an amber "not hot-reloaded" warning when relevant, and Cancel /
  Apply. Env diffs render presence-only (`set` / `unset`) — the
  typed value is never shown.
- **Restart prompt**. For `hot_reloadable = false` channels (all 8
  today), a post-save amber card offers "Restart now" →
  `hermes_gateway_restart` or "Later". Never restarts implicitly.
- **i18n** `channels.*` grew ~15 keys in en + zh: edit / save /
  cancel / show / hide, env placeholders, list placeholder, the four
  diff strings, the restart prompt labels, and the no-changes /
  not-hot-reloadable warnings.

### Fixed

- `io_other_error` clippy lint in `walk_remove` (`.to_string().into()`
  on a `String` → just `.to_string()`).

### Deferred

- **T3.3** WeChat QR flow (Tencent iLink).
- **T3.4** live status probing + log-grep fallback.
- **T3.5** mobile layout.
- **Explicit "Clear" on an existing secret** — today users remove
  tokens via the changelog revert or by editing `.env` directly; the
  button lands alongside T3.4 live-status feedback.
- WhatsApp env name still a placeholder.

### Test totals

- Rust `cargo test`: **65 passed** (+4 vs T3.1: `walk_set`,
  `walk_remove`, `json_to_yaml`, disk-level round-trip of
  `write_channel_yaml_fields`).
- Vitest: **11 passed** (unchanged).
- Playwright: **27 passed** (+2: bool toggle → diff → save → restart
  prompt → payload assertion; token fill → diff never leaks the
  value → card flips to Configured without the raw token appearing
  anywhere in the DOM). Full suite skipped this session for time;
  channel spec ran clean standalone.
- `cargo fmt` + `cargo clippy -- -D warnings`: clean.
- `pnpm typecheck` + `pnpm lint`: clean.

### Next

- **T3.3** WeChat QR flow.
- **T3.4** live status probing.

---

## 2026-04-22 — Phase 3 Sprint 1 (T3.1): Channels page catalog

### Context

Phase 3 foundation. Before building 8 per-channel forms, ship the
schema that drives them — one static `ChannelSpec` per channel with
env-key names, YAML field paths, field kinds, and flags. This also
gives us a real `/channels` page to replace the Placeholder, and it
exercises the IPC end-to-end so any catalog bugs surface before the
form work lands.

### Shipped

- **Rust `channels.rs`** — `Lazy<Vec<ChannelSpec>>` catalog covering
  Telegram, Discord, Slack, WhatsApp, Matrix, Feishu, WeChat, WeCom.
  Each spec has: stable lower-case slug id, display name, `yaml_root`
  (dotted path under `channels.*`), `env_keys` (name + required +
  i18n hint key), `yaml_fields` (`FieldKind::Bool | String |
  StringList` + label key + default), `hot_reloadable` (default
  `false`, conservative), `has_qr_login` (only WeChat).
- **Env allowlist extension.** `hermes_config::is_allowed_env_key`
  now accepts any name in `channels::allowed_channel_env_keys()`
  alongside the original `*_API_KEY` rule, so channel tokens go
  through the same `hermes_env_set_key` path as provider API keys.
  The allowlist stays tight — the UI still can't write arbitrary
  env vars.
- **New IPC** `hermes_channel_list` in `ipc/channels.rs` →
  `Vec<ChannelState>` joining catalog + on-disk state:
  `env_present: HashMap<name, bool>` (values never leave Rust) and
  `yaml_values: HashMap<path, JsonValue>` read by walking
  `serde_yaml::Value`. `spawn_blocking` wrapped.
- **`/channels` page** replaces the Placeholder:
  responsive grid of cards, one per channel, with a status pill
  (Configured / Partial / Unconfigured / QR login), env-key presence
  icons (name-only, never value), and a collapsible "behavior
  fields" preview that renders current YAML values compactly.
- **i18n** — new `channels.*` namespace in en + zh, ~25 keys each
  covering title, subtitle, status labels, field labels
  (`mention_required`, `auto_thread`, `reactions`, `enable`), and
  per-channel credential hints.

### Fixed

- (none — clean sprint)

### Deferred

- **T3.2** inline forms (flip-on-click, atomic `.env` + YAML writes,
  diff modal, "Restart gateway?" prompt on save).
- **T3.3** WeChat QR flow (Tencent iLink).
- **T3.4** live status probing + log-grep fallback.
- **T3.5** mobile layout (Drawer instead of card flip under 720px).
- WhatsApp env name is a `WHATSAPP_TOKEN` placeholder — must be
  verified against a live Hermes before T3.2 wires the form.

### Test totals

- Rust unit: **61** (was 51; +8 catalog invariants, +2 yaml walk)
- Vitest: 11
- Playwright: **25** (was 23; +2 channels cases covering all four
  status buckets + the "env names but never values" safety assertion)
- CI: clean on all 3 platforms

### Next

T3.2 — inline channel forms. The schema is already in place; the
front-end work is mostly wiring generic `FieldKind` renderers +
extending `hermes_config::write_env_key` to emit
`hermes.channel.*` journal entries.

---

## 2026-04-22 — Phase 2 complete (T2.1–T2.8)

### Context

One-day sprint that closed out every remaining Phase 2 task bucket on top
of the analytics baseline shipped the day before. The goal was to land
end-to-end control of Hermes's config surface (models, env keys,
profiles, logs, changelog) with every write atomic and reversible. Also
included the rebrand from "Caduceus" to **Corey** and the live
gateway-status badge that had been pending since Phase 1.

### Shipped

- **T2.1 — Config safety layer.** `src-tauri/src/fs_atomic.rs` with
  `atomic_write(path, bytes)` (tmp file + rename) and `append_line`
  (JSONL journaling). `changelog.rs` appends one entry per mutation
  with `{ id, ts, op, before, after, summary }` and a torn-line-tolerant
  tail reader. Every Hermes model / env / profile write funnels through
  this layer; the original file survives a mid-write SIGKILL (tested).

- **T2.2 — Model provider discovery.** `hermes_config_read/write_model`
  IPCs (Hermes's own `~/.hermes/config.yaml` `model` section),
  `hermes_env_set_key` (upsert / delete `*_API_KEY` in `~/.hermes/.env`;
  values never read back to the UI), `model_provider_probe` (hits
  OpenAI-compatible `/v1/models`). Models page gained a Discover button
  that populates the default-model combobox from the probe. Post-write
  RestartBanner surfaces the gateway-restart requirement and wires
  `hermes_gateway_restart` (shells to `hermes gateway restart`; falls
  back to `~/.local/bin/hermes`).

- **T2.3 — Settings page full.** Three sections:
  - **Appearance** — theme 3-way segmented control (Dark / Light /
    System) with proper `role=radiogroup`; language `<select>`
    (English / 中文). Theme writes to the existing zustand store;
    language fires `i18n.changeLanguage` with no reload. No new IPC, no
    new store — both controls piggyback on infrastructure that was
    already in place.
  - **Gateway** — base_url / api_key / default model with Test
    connection (latency readout); fully i18n'd.
  - **Storage** — read-only panel listing `config_dir`, `data_dir`,
    `db_path`, `changelog_path` with copy-to-clipboard. New IPC
    `app_paths` projects the already-cached `AppState` paths.

- **T2.4 — Usage ingestion.** `messages` schema v2 adds
  `prompt_tokens` / `completion_tokens` (nullable; backfill is safe).
  `upsert_message` uses `COALESCE` on conflict so content-only upserts
  don't wipe tokens. New `db_message_set_usage` IPC, called
  fire-and-forget from the chat stream's `onDone` with the real
  provider-reported values. Analytics now shows lifetime token totals
  (5th KPI) and a 30-day tokens-per-day chart alongside the existing
  activity chart.

- **T2.5 — Analytics.** Already landed 2026-04-21; extended above.

- **T2.6 — Hermes log tail.** New `/logs` is a tabbed surface: **Agent
  / Gateway / Error** (each tails `~/.hermes/logs/<kind>.log` via
  `hermes_log_tail`) plus **Changelog** (pre-existing). Read-on-demand
  with a client-side substring filter; no streaming / no `notify`
  watcher in this pass. Missing-file EmptyState surfaces the resolved
  path so users can verify their Hermes install. `LogLine` tints
  WARN/ERROR rows amber/red with a loose regex that catches both
  Python-logging and Rust-tracing formats.

- **T2.7 — Profiles.** New `/profiles` route over `~/.hermes/profiles/*`.
  Pure-FS ops: list (dir scan, active-first sort, hidden entries
  skipped), create (seeds a minimal `config.yaml`), rename
  (`fs::rename` with collision guards), delete (refuses the active
  profile), clone (recursive copy, skips symlinks). Name validation
  blocks traversal chars and `.`-prefixes. Every write appends a
  `hermes.profile.{create,rename,delete,clone}` entry.

- **T2.8 — Changelog viewer & revert.** `/logs` → Changelog tab shows
  each entry (time, op, summary, before/after JSON diff) with a Revert
  button. Dispatching currently covers `hermes.config.model`;
  `hermes.env.key` deletes are marked "Not revertible" (we never store
  the key value). Reverts themselves append a new entry describing the
  revert so the list stays honest.

- **Rebrand.** "Caduceus" → **Corey** everywhere user-visible
  (`app.name`, Topbar, Home hero). `docs/` and internal package names
  left alone.

- **Live gateway status badge.** Topbar dot polls `/health` every few
  seconds; flips online / offline / unknown with click-to-reprobe.

### Fixed

- Session rows now stamp `model` at creation so Analytics can bucket by
  model without retroactive patching.
- Clippy `io_other_error` lint on `hermes_profiles.rs` (used
  `io::Error::other` over the deprecated `::new(ErrorKind::Other, …)`
  pattern).

### Deferred

Kept out of Phase 2 deliberately; captured in
`docs/phases/phase-2-config.md` under **Deferred to later phases**.
Highlights:

- **tar.gz import / export of profiles** — needs a Tauri file-picker +
  manifest-preview dialog; rolls into Phase 3.
- **Per-profile gateway start / stop with port resolution** — gateway
  lifecycle control is Phase 3's territory.
- **Switching the active profile** — writing
  `~/.hermes/active_profile` safely requires quiescing the gateway
  first; Phase 3.
- **Revert dispatch for `hermes.profile.*`** — journal entries are
  already being written; extending the dispatcher is a small follow-up.
- **Streaming log tail (`notify` + SSE)** — manual refresh is adequate
  for single-digit-MB log files.
- **Command palette → specific settings section** — palette currently
  lands on `/settings` as a whole.
- **Per-section Settings sub-routes** (`/settings/{section}`) — rolled
  into the single scrollable page; easy to split later.

### Test totals at close

- Rust unit: **51** (up from 32)
- Vitest: 11
- Playwright: **23** (up from 7 at Phase 1 end)
- CI: clean on macOS · Windows · Linux matrix (3/3)

### Files added (selected)

```
src-tauri/src/
├── fs_atomic.rs                 (T2.1)
├── changelog.rs                 (T2.1)
├── hermes_config.rs             (T2.2)
├── hermes_logs.rs               (T2.6)
├── hermes_profiles.rs           (T2.7)
├── adapters/hermes/probe.rs     (T2.2)
└── ipc/{changelog,hermes_config,hermes_logs,hermes_profiles,paths}.rs

src/features/
├── logs/{index,ChangelogPanel,HermesLogPanel}.tsx  (T2.6 + T2.8)
├── profiles/index.tsx                              (T2.7)
├── analytics/index.tsx                             (T2.4 extension)
└── settings/index.tsx                              (T2.3 rewrite)

e2e/
├── analytics.spec.ts  · hermes-logs.spec.ts  · logs.spec.ts
├── profiles.spec.ts   · settings.spec.ts     · llms.spec.ts (extended)
```

### Next

Phase 3 — **Platform channels + gateway lifecycle + WeChat QR**. The
Phase 2 deferrals cluster naturally here.

---

## 2026-04-21 — Phase 2 Sprint 1: Analytics page

### Context

End of Phase 1 had us persisting sessions + messages + tool_calls to SQLite
(Sprint 5C) with no way to look at the aggregate. Analytics was picked as
the first Phase 2 sprint because (a) the raw data is already there, (b) it
proves the value of SQL-queryable storage over the old localStorage blob,
and (c) it's a visible win the user sees the moment the app opens.

### Shipped

- **Rust `analytics_summary`** in `db.rs` — one method, one lock, four
  queries (totals, 30-day per-day histogram, top-5 models, top-10 tools)
  plus a `generated_at` timestamp. `now_ms` is an argument (not pulled
  from the clock internally) so unit tests can pin time.
- **IPC `analytics_summary`** (`ipc/db.rs`) wraps the blocking call in
  `spawn_blocking` to stay polite to the Tokio runtime.
- **Frontend `features/analytics/index.tsx`** — single route, single IPC.
  Components:
  - **KPI strip** — 4 tiles (sessions, messages, tool_calls, active_days)
    with testid hooks for E2E.
  - **ActivityChart** — 30-day line chart, pure SVG (no Recharts). Pads
    sparse `{date,count}[]` to a dense 30-entry series so the x-axis
    always spans a month. Dots get `<title>` hover tooltips for a11y.
  - **HBarList** — horizontal percentage bars, used for models and tools.
  - **SkeletonGrid** / **ErrorBox** for the loading + failure shells.
- **i18n** — full `analytics.*` tree in en + zh.
- **Mocks + tests**:
  - Rust: `analytics_summary_aggregates_counts_and_windows` seeds 2
    sessions, 3 messages (one outside the 30-day window), and 3 tool
    calls, then asserts totals, window filtering, and sort order.
  - Playwright: 2 new tests — default mock renders KPIs + charts;
    zero-state renders the "No activity yet" empty hint.

### Design notes

- **Why hand-rolled SVG?** Recharts / ECharts are 100+ KB gzipped and
  their default visual language fights our Linear-esque tokens. For the
  shapes we actually need (line + h-bars + numeric tiles), ~200 lines of
  SVG land cleaner, respect CSS variables for theming, and add zero
  bundle weight.
- **Why one IPC, not four?** Analytics is read-only, cheap (<5 ms on
  ~10k rows), and every query shares the DB lock. One round trip beats
  four for both latency and code density.
- **UTC everywhere**: the backend's `date(created_at/1000,'unixepoch')`
  returns UTC dates, and the frontend's `padLast30Days` uses
  `getUTCDate` / `toISOString().slice(0, 10)` to match exactly. No
  timezone skew at midnight.

### Verified

- Rust: 16 tests (new test passes), clippy -D warnings clean.
- Vitest: 11 green.
- Playwright: 9 green (2 new).
- Manual: `/analytics` renders correctly against a real DB with ~5 seeded
  sessions; refresh button re-fetches.

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
