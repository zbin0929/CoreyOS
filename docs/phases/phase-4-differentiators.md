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

### T4.1 — Multi-model compare (2–3 days)

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
