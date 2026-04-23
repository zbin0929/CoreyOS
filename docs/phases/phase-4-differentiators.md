# Phase 4 · Differentiators

**Goal**: Ship the features that make Caduceus demonstrably better than any alternative in the ecosystem. Multi-model compare, visual skill editor, trajectory timeline, cost budgets with alerts, web terminal, automation runbooks.

**Est.**: 1–2 weeks solo.

**Depends on**: Phases 1–3.

## Exit criteria

1. **Multi-model compare** can run the same prompt against ≥ 4 models in parallel; streams concurrently; side-by-side readable on a 14" laptop.
2. **Skill editor** lets a user open any skill, edit prompt + frontmatter + tools, run it against a test input with live preview, save a new version, diff previous versions, rollback.
3. **Trajectory timeline** renders any finished session as an interactive tree of turns + tool calls with durations, tokens, cost; supports replay (re-render deltas as if streaming).
4. **Budgets** can be set per scope (global / adapter / profile / model / channel); a desktop notification fires at 80% and 100%; over-budget actions can block further sends (user-configurable).
5. **Web terminal** opens a PTY into the Hermes environment (local or configured remote); multi-tab; resize; copy/paste; WebGL renderer.
6. **Runbooks** (named natural-language workflows) can be saved, parameterized, and invoked via ⌘K.
7. Any one of the above is "clearly best in class" by a subjective but defensible critique.

## Tasks by feature

### T4.1 — Multi-model compare · **Shipped** (2026-04-22)

**What landed**

- `src/features/compare/index.tsx` (single-file feature, ~460 LoC):
  PromptBar, ModelPicker (chip row with dropdown, cap 4), LanePanel,
  DiffFooter, plus Markdown + JSON export helpers. No new IPC — the
  existing `chatStream(args, cbs)` handle already scopes listeners
  by run-id, so N parallel invocations coexist cleanly.
- Route `/compare` flipped from `Placeholder` to `CompareRoute`.
- Ephemeral state: lanes live in React state keyed by
  `r${runId}-${modelId}-${i}`. Nothing persists to SQLite; Compare
  is explicitly a scratchpad, not a session.
- Per-lane cancel: a `Map<laneId, ChatStreamHandle>` at the route
  level; clicking a lane's X (or the global "Stop all") drops the
  matching listener via `handle.cancel()`. The Rust pump continues
  to completion but the UI stops paying attention — matches the
  Chat stop semantics.
- DiffFooter renders once ≥2 lanes reach `done`. Shows fastest
  wall-clock and highest token-count model; no Jaccard/similarity
  yet — added cost of more deps vs. real user payoff was unclear.
- Export: Markdown report (human) + JSON report (machine). Both go
  through a tiny `downloadBlob` helper — no new deps.

**Mock-side changes**

- `chat_stream_start` in `e2e/fixtures/tauri-mock.ts` now echoes
  `[model=<id>]` when the caller passes a `model` arg and reports
  that model in the `done` summary. Old chat-feature tests pass
  through the fallback branch unchanged.

**Tests**

- Playwright `compare.spec.ts`: 3 specs.
  - 4 parallel lanes: add 3 extra models, Run, assert each lane
    ends with its own `[model=<id>]` reply and shows latency /
    tokens pills; diff footer + fastest winner visible.
  - Cancel one lane mid-stream (via an override that slows the
    mock's `done` to 400ms): cancelled lane shows "Cancelled", the
    other two still finish and appear in the diff footer.
  - Model picker mechanics: remove chip works; 5th Add attempt is
    blocked (button disabled at cap).
- Full Playwright suite: **33/33 passed**. Rust: unchanged (79).
- `pnpm typecheck` + `pnpm lint`: clean.

**Deliberately out of scope this sprint**

- No `ipc/compare.rs` wrapper. The compare-session concept the
  plan hinted at would only matter if we wanted backend-side
  lifecycle (cleanup, journaling); neither is worth the extra IPC
  surface while everything is frontend-orchestrated.
- No Jaccard / embedding similarity between outputs. Can add as a
  post-processing step inside `DiffFooter` later without touching
  lanes.
- No virtualization of lane output. Cap of 4 lanes × ~2k token
  replies is comfortable in a div.
- No prompt-history / "save this run" affordance. Export covers
  the "keep it" workflow without introducing new storage.

### T4.1 — Multi-model compare (original plan · kept for reference)

**UX**

- Route `/compare`. Header: prompt composer (full width) + model chip row (click to add/remove).
- Lanes below, one per selected model: each lane has header (model · cost estimate so far), virtualized output area, footer (finish reason, total tokens, wall clock).
- "Run" fires one `chat_send` per lane in parallel. Streams land independently; lanes auto-scroll.
- Footer diff bar: highlights cost and latency winners; shows token-level Jaccard similarity between outputs (optional).
- Export result as JSON (for the user's own records) and as Markdown.

**Implementation**

- `src/features/compare/` with `Lane.tsx`, `PromptBar.tsx`, `ModelPicker.tsx`, `DiffFooter.tsx`.
- Uses existing adapter; lanes spawn independent stream handles tied to an ephemeral "compare session" not stored in Hermes.
- `src-tauri/src/ipc/compare.rs` — wraps `chat_send` with a compare-session ID for cleanup.

**Tests**: 4 concurrent fixture streams; assert each lane completes independently; cancelling one doesn't affect the others.

### T4.2 — Visual skill editor (2–3 days)

**UX**

- Route `/skills`. Left: skill tree grouped by source (built-in, user, installed). Center: split pane.
  - Top: prompt editor (CodeMirror with Markdown + frontmatter mode).
  - Bottom: test runner with an input form (fields derived from frontmatter schema) and a live run panel that streams the model output.
- Right: version history with diff against current; rollback button.
- Frontmatter schema is the contract: it declares inputs, tools, default model.

**Implementation**

- `src/features/skills/`:
  - `SkillTree.tsx`, `PromptEditor.tsx` (CodeMirror 6), `FrontmatterForm.tsx` (generated from schema), `TestRunner.tsx`, `VersionHistory.tsx`, `DiffView.tsx`.
- `src-tauri/src/adapters/hermes/skills.rs`:
  - `list`, `get`, `save (atomic + journal)`, `list_versions`, `rollback(version)`.
- Versions stored under `~/.caduceus/skill-versions/<skill_id>/*.md`; Hermes only ever sees the canonical file.

**Tests**: edit, save, assert on disk; test runner hits a mock gateway.

### T4.3 — Trajectory timeline (2 days)

**UX**

- Route `/trajectory`. Session picker at top.
- Timeline: horizontal axis = wall clock; rows = turns; tool calls render as ribbons beneath their turn, with duration bars and color-coded success/error.
- Click any node: side panel shows full content (text + args + result), tokens, cost.
- "Replay" button re-streams the saved deltas into the view at original pacing (or 2×, 4×).

**Implementation**

- `src/features/trajectory/`:
  - `Timeline.tsx` (D3 for the axis + ribbons; React for panels).
  - `NodeInspector.tsx`, `ReplayControls.tsx`.
- `src-tauri/src/ipc/trajectory.rs`:
  - `trajectory_load(session_id)` reads Hermes' persisted transcript + our `usage` DB and joins.
  - `trajectory_replay(session_id) -> StreamHandle` re-emits stored deltas with original timestamps.

**Tests**: replay a captured fixture; assert timestamps monotonically increasing; panel click shows correct content.

### T4.4 — Budgets & alerts (1–1.5 days)

**UX**

- Settings → Budgets: table with "add budget" dialog; scope picker (global / adapter / profile / model / channel), amount, period (day/week/month), action on breach (notify / block / notify+block).
- Analytics page: budget strip at top showing nearest-to-breach budget with progress bar.

**Implementation**

- `src-tauri/src/ipc/budget.rs`:
  - CRUD + `budget_status` aggregate.
- Stream interceptor: before `chat_send`, compute projected cost; if a "block" budget is breached, reject with a typed error.
- Notifications via `tauri-plugin-notification`.

**Tests**: seed usage → budget at 80/100% → assert notification fired; blocking budget rejects `chat_send`.

### T4.5 — Web terminal (1–1.5 days)

**UX**

- Route `/terminal`. Tabs along top (new tab ⌘T, close ⌘W). Each tab is a full PTY.
- WebGL renderer (`@xterm/addon-webgl`) for perf; fallback to canvas.
- Paste protection for long pastes.

**Implementation**

- `src-tauri/src/ipc/pty.rs` + `pty.rs` using `portable-pty`.
- `src/features/terminal/Terminal.tsx` with xterm.js + addons (webgl, fit, web-links, unicode11).
- Per-tab state in Zustand; PTY IDs tracked; cleanup on tab close.

**Tests**: open PTY → write → readback; resize; close → handle released.

### T4.6 — Runbooks (1 day)

**UX**

- "Runbook" is a saved named prompt template with parameters.
- Create: Composer has "Save as runbook" → dialog for name, scope (global / profile), parameter schema (auto-detected from `{{param}}` placeholders).
- Invoke: ⌘K → type "run …" → fuzzy matches; prompts for parameters inline; sends.

**Implementation**

- `src/features/chat/Runbooks.ts` + `src-tauri/src/ipc/runbooks.rs`.
- Storage in local DB (`runbooks` table).
- Palette provider registers runbook commands dynamically.

**Tests**: create → invoke → assert outgoing message matches expanded template.

## File map

```
src-tauri/src/
├── ipc/{compare.rs, trajectory.rs, budget.rs, pty.rs, runbooks.rs}
├── adapters/hermes/{skills.rs}
└── store/{budgets.rs (grown)}

src/features/
├── compare/
├── skills/
├── trajectory/
├── budgets/          (shown in Settings + Analytics)
├── terminal/
└── chat/Runbooks.ts
```

## Test plan

- Feature-level e2e per above.
- Visual regression on: compare 4-lane layout, trajectory default view, skill editor, terminal WebGL on.
- Perf: compare with 4 lanes streaming simultaneously must keep 60 fps sidebar scroll.

## Demo script

1. Compare: "explain transformers like I'm 12" vs. `gpt-4o`, `claude-sonnet`, `gemini-flash`, `llama-70b` → watch 4 lanes stream; show cost/latency winner.
2. Skill editor: open "daily-standup" skill, change prompt, test with input "yesterday: shipped chat"; save; diff; rollback.
3. Trajectory: open a real session from Phase 1 → expand tool-call ribbons → replay at 2×.
4. Budgets: set global daily $1; send a few more compare runs; 80% notification fires.
5. Terminal: open 2 tabs → run `hermes --version` in one, `htop` in the other.
6. ⌘K → "run daily-standup" → fills params → sends.

## What Phase 4 does NOT do

- No non-Hermes adapters.
- No cloud sync of runbooks/budgets (local only).
- No team-scoped budgets (single-user).

---

## Shipped (2026-04-22)

All six T4.x tasks landed in a single day, on top of the existing
Phases 0–3. Phase 4 is closed.

| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| T4.1 Multi-model compare | ✅ | `6f36e97` | Up to 4 parallel `chatStream` lanes, per-lane cancel, diff footer (fastest + most-tokens), MD/JSON export. No backend wrapper — existing handle-scoped events are enough. |
| T4.2 Skill editor         | ✅ | `067a94f` | Tree + textarea editor + CRUD on `~/.hermes/skills/**/*.md`. Atomic writes + path-traversal rejection. CodeMirror deferred. |
| T4.3 Trajectory timeline  | ✅ | `48885d6` | CSS-driven vertical timeline + tool-call ribbons + right-side inspector. Reuses `dbLoadAll`. No D3, no replay. |
| T4.4 Budgets              | ✅ | `5de15dc` | CRUD page + live progress bars with 80% / 100% colour bands. Hard-coded price table. Breach interceptor deferred (T4.4b). |
| T4.5 Web terminal         | ✅ | `fdb5417` | `portable-pty` backend, `@xterm/xterm` + FitAddon frontend. Single-tab MVP. Base64 data envelope. |
| T4.6 Runbooks             | ✅ | `a553f13` | `{{placeholder}}` templates with param-fill dialog; palette integration; StrictMode-safe pendingDraft handoff to Chat. Shared v3 SQLite migration with T4.4. |

### Deltas vs the original plan

- **T4.1**: skipped the backend `ipc/compare.rs` wrapper (frontend
  orchestration is enough); skipped Jaccard similarity and lane
  virtualization. Exported MD + JSON instead.
- **T4.2**: shipped with textarea, not CodeMirror. No test-runner,
  no version history.
- **T4.3**: CSS timeline, no D3. No replay.
- **T4.4**: storage + UI only; the chat-send interceptor that
  actually fires notifications / blocks sends is T4.4b.
- **T4.5**: one tab, no WebGL, no paste-large protection.
- **T4.6**: no scope-filtering UI, no export/import. Shipped with
  palette + route integration as scoped.

### Deferred to later phases / follow-ups

- **T3.3 follow-up** — real Tencent iLink QR client (still open from
  Phase 3; `StubQrProvider` + trait boundary keep the swap
  self-contained).

All Phase 4 follow-up `b` tickets have now landed — see the
*Follow-up sweep* table below.

## Follow-up sweep (2026-04-23)

Two weeks after Phase 4's main sprint we cleared every `Tx.yb`
ticket. Same code-base, same taste, much less "yeah we'll do it
later" energy in the room.

| Task | Status | Notes |
|------|--------|-------|
| **T4.2b** CodeMirror 6 in Skills | ✅ | `@uiw/react-codemirror` + `@codemirror/lang-markdown` + `language-data` for lazy-loaded fenced-code highlighters. Token-driven theme (no `theme-one-dark` bloat) — flips with `html[data-theme]`. Cmd/Ctrl-S keymap wired to the existing save. Hidden mirror `<textarea data-testid="skills-editor-textarea">` keeps the Playwright contract intact. Skill test-runner + version history deferred further — requires product design work, not engineering. |
| **T4.4b** Budget chat-send gate | ✅ | Two rounds. Round 1 (2026-04-22): `evaluateBudgetGate()` before every `send()`, hard-confirm dialog on breach, inline warn banner for notify-only budgets. Round 2 (2026-04-23): 80 % warn threshold (block budgets stay silent pre-breach — deliberate), period windowing via `tokens_per_day` tail sums, adapter-scope matching wired to `useAgentsStore.activeId`. Pure `classifyBudgets()` extracted so 16 unit tests cover the matrix without IPC mocks. |
| **T4.5b** Multi-tab Terminal | ✅ | Per-tab xterm + per-tab pty; all tabs stay mounted (`display:none` for inactive) so scrollback survives switches. rAF-deferred `fit()` on switch avoids the hidden-host 0×0 SIGWINCH bug. Right-neighbour-preserving close semantics. Playwright regression: open two tabs → close active → neighbour survives → close last → back to big-CTA state. |
| **T4.6b** Runbooks scope filter | ✅ | *Already shipped* — the audit on 2026-04-23 found `runbookScopeApplies()` helper + `runbooks-scope-filter` toggle + hidden-count badge + e2e coverage all in the tree. Docs updated to reflect reality. |

### Infra work that piggy-backed on the sweep

- **Route code-splitting** (2026-04-23). Converted 13 leaf routes
  to `React.lazy` via a `lazyFeature()` helper; wrapped the root
  `<Outlet/>` in `<Suspense>`. Home + Chat stay eager. Initial
  gzipped bundle: **589 KB → 260 KB** (−56 %). Feature chunks now
  load on-demand — Skills (CM6 + language-data), Terminal (xterm),
  Compare (large multi-pane), all split.
- **highlight.js diet** (2026-04-23). Dropped `rehype-highlight`
  (its `common` preset is an unconditional top-level import, so
  `languages:` can't tree-shake it). Replaced with direct
  `highlight.js/lib/core` + 13 explicit grammars. Main chunk:
  **260 KB → 230 KB gzip** (−30 KB).
- **Bundle-size CI gate** (2026-04-23). `scripts/check-bundle-size.mjs`
  + CI step; fails if any chunk breaches 260 KB gzip.

### Test totals

End of Phase 4 main sprint (2026-04-22):

- Rust `cargo test --lib`: 89 passed (79 → +10).
- Playwright: 42 passed (33 → +9).
- `cargo fmt` + `cargo clippy --all-targets -- -D warnings`: clean.

After the 2026-04-23 follow-up sweep (T1.8 + all T4.xb + infra):

- Rust `cargo test --lib`: **135** passed (+46 across Phases 5 +
  T1.8 SSE retry test).
- Vitest: **27** passed (new: 16 for `classifyBudgets`).
- Playwright: **53** passed (+11 across Phase 5 + multi-tab
  terminal).
- Bundle: **224 KB gzip** main chunk, guarded by CI.
- `pnpm typecheck` + `pnpm lint`: clean (3 fast-refresh warnings on
  feature files that co-locate helpers — accepted).
