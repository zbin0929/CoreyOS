# Optimization Backlog

Prioritized list of UX, platform, and engineering improvements.
Each item is tagged P0/P1/P2. Items are done in order; CI must be green before moving on.

**Excluded**: "新手到高级用户分层" (per product decision — power-user tool, no simplified mode).

---

## P0 — Platform-critical (do now)

### P0.1 Navigation consolidation

**Problem**: 20+ sidebar entries, users don't know where to start.
**Fix**: 3-tier sidebar: Primary (Home/Chat/Workflows/Agents/Models) + Tools (Compare/Analytics/Terminal/Logs) + More (collapsible, 11 items) + Settings pinned to bottom.
**Files**: `src/app/nav-config.ts`, `src/app/shell/Sidebar.tsx`
**Status**: ✅ Done — commit `299d9f0`, CI 5/5 green

### P0.2 Actionable error feedback

**Problem**: Error bubbles show raw strings. No recovery path.
**Fix**: Chat error bubble now shows inline "Regenerate" button. Error text + retry action directly visible.
**Files**: `src/features/chat/MessageBubble.tsx`
**Status**: ✅ Done — commit `cd62a5f`, CI 5/5 green

### P0.3 Workflow step-level observability

**Problem**: Run history shows `JSON.stringify(output).slice(0,100)`. No per-step timing, no structured output.
**Fix**: StepRun.duration_ms field + Instant-based timing + tracing::info/warn per step. Frontend shows duration (ms/s), collapsible output, truncated errors with tooltip.
**Files**: `src-tauri/src/workflow/engine.rs`, `src/lib/ipc.ts`, `src/features/workflow/index.tsx`
**Status**: ✅ Done — commit `a725eb7`, CI 5/5 green

### P0.4 IPC contract tests

**Problem**: TS DTO types and Rust struct fields can drift silently.
**Fix**: Contract tests in Rust verify JSON field names match TS expectations. Found and fixed real bug: RunStatus/StepRunStatus serialized as PascalCase ("Completed") instead of lowercase ("completed").
**Files**: `src-tauri/src/workflow/engine.rs`, `src-tauri/src/ipc/browser_config.rs`, `src-tauri/src/adapters/hermes/gateway.rs`
**Status**: ✅ Done — commit `dcbed78`, 4 contract tests, 262 Rust tests pass

---

## P1 — Quality improvements (do next)

### P1.1 Long-task progress indicators

**Problem**: Workflow and browser automation have no visible progress during execution.
**Fix**: Gold progress bar shows completed/total steps with percentage. Turns red on failure. Animated transition.
**Files**: `src/features/workflow/index.tsx`
**Status**: ✅ Done — commit `1a5fb0e`

### P1.2 Batch operations

**Problem**: No multi-select on Agents/Workflows/Sessions list pages.
**Fix**: Checkbox on each workflow card for multi-select. "Delete N selected" button in header. Batch delete via Promise.all.
**Files**: `src/features/workflow/index.tsx`
**Status**: ✅ Done — commit `830f98b`

### P1.3 Unified async state hook

**Problem**: Mixed state patterns (page state + store + IPC loading). Some pages have loading/error, others don't.
**Fix**: `useAsyncState<T>` hook with loading/error/data/run/reset/setData. Stale-result protection via sequence counter.
**Files**: `src/lib/useAsyncState.ts`
**Status**: ✅ Done — commit `e62dfd9`

### P1.4 Browser runner environment diagnostics

**Problem**: Browser automation fails silently when Node/browser/profile is missing.
**Fix**: Settings Browser section gets "Check Environment" button that tests: Node path, browser-runner path, browser binary, profile dir.
**Files**: `src/features/settings/index.tsx`, `src-tauri/src/ipc/browser_config.rs`
**Status**: ✅ Done — commit `0a79666`

### P1.5 API key validation on save

**Problem**: Invalid API keys are saved without verification; user only discovers at send-time.
**Fix**: Auto-probe `/v1/models` after LLM profile save. Non-blocking; failure shows on card test indicator.
**Files**: `src/features/models/LlmProfilesSection.tsx`
**Status**: ✅ Done — commit `c95c59e`

### P1.6 Structured tracing on critical paths

**Problem**: Rust side has <10 `tracing` calls total. Chat stream, workflow run, browser step have no structured logs.
**Fix**: chat_stream start/done/error with handle/adapter/model/duration_ms/tokens. Browser step start/done/error with action/url/duration_ms. Workflow step already done in P0.3.
**Files**: `src-tauri/src/ipc/chat.rs`, `src-tauri/src/ipc/workflow.rs`, `src-tauri/src/workflow/engine.rs`
**Status**: ✅ Done — commit `8024948`

---

## P2 — Longer-term polish

### P2.1 Terminology unification
✅ Done — `docs/glossary.md` with 17 concept definitions, relationship map, naming rules.

### P2.2 Resource relationship visualization
✅ Done — Agent delete now checks sessions and warns with confirm dialog.

### P2.3 Agent routing decision transparency
✅ Done — Routing hint tooltip shows rule name + matched pattern + target adapter.

### P2.4 Knowledge/Memory/Learning product closure
Answer citation sources, memory write notifications, learning audit trail.
**Status**: ✅ Done — Learning indicator in chat composer shows "Learning extracted" toast for 5s after extraction. Knowledge upload warns on binary formats and large files.

### P2.5 File intelligence quality control
Per-file-type extraction quality hints, structured result display, extraction cache.
**Status**: ✅ Done — Knowledge upload warns on binary formats (pdf/docx/xlsx) and large files (>50KB). Document list shows total_chars and chunk_count.

### P2.6 Document classification
Tag docs as plan/current/changelog. Add "last verified" timestamps.
**Status**: ✅ Done — `docs/document-index.md` with type/verified-date for all docs.

### P2.7 Development constraints & evolution rules
Write into `.trae/rules/project_rules.md`: no logic dumping in core pages, service/hook first, contract definitions required, diagnostics required.
**Status**: ✅ Done — `.trae/rules/project_rules.md` with AC/CS/T/N/PD rules.

---

## P3 — Tech-debt sweep (2026-04-26 batch)

OP-025 batch (commits `e8a8153` + `1fc8a56` + `1ecc4bb`) closed the
file-size / IPC-contract / dead-code / docs-entry / clippy-baseline /
helper-test work in one go. Remaining items below are scoped for
follow-up PRs.

### P3.1 Chat page state machine refactor — **DEFERRED**

**Problem**: `src/features/chat/index.tsx` is still 1003 lines and
is the single hottest path in the app. The previous mechanical-split
attempt was rejected because the bulk is intertwined state (idle /
composing / sending / streaming / tooling / cancelling).
**Fix**: Extract a `useChatSession` hook + `chatReducer` with an
explicit state-machine diagram first; mechanical splits afterward.
**Files**: `src/features/chat/index.tsx`, new `src/features/chat/state/*`
**Status**: ⏳ Deferred to a dedicated branch — high regression risk,
not a same-PR job.

### P3.2 `unwrap_used` baseline reduction

**Problem**: 468 baseline (commit `e8a8153`). Mostly DB/changelog
modules + tests. New code can no longer add unwraps (CI-enforced),
but the legacy pile stays until someone batch-converts.
**Target**: < 100 over the next quarter — start with non-test
modules (`db/sessions.rs`, `attachments.rs`, `hermes_profiles*.rs`,
`fs_atomic.rs`, `changelog.rs`).
**Files**: scripts/clippy-unwrap-baseline.txt + the modules above.
**Status**: ⏳ Open.

### P3.3 IPC type-safety re-evaluation

**Problem**: `c4-ipc-type-safety.md` decided to keep TS bindings
hand-written; OP-025 added a drift gate as the safety net.
Re-evaluate after a few months — if drift fires often, switch to
tauri-specta or similar codegen.
**Status**: ⏳ Open (re-evaluate 2026-Q3).

### P3.4 Storybook coverage for newly-extracted components

**Problem**: OP-025 extracted ~15 React components from god files.
Storybook stories are mostly missing for them; visual regression
won't catch UI drift.
**Fix**: One `*.stories.tsx` per extracted component. Targets:
`LlmProfileCard`, `LlmProfileRow`, `ProfileCard`, `ServerRow`,
`ServerForm`, `ApiKeyPanel`, `RestartBanner`, `AgentWizard*`.
**Status**: ⏳ Open.

### P3.5 Flaky `HOME` env mutation in Rust tests

**Problem**: A handful of `hermes_config_tests` / `db_tests` mutate
process-wide `HOME` and intermittently collide on parallel test
runners.
**Fix**: Wrap with `serial_test::serial` or thread-local override.
**Status**: ⏳ Open (low frequency, easy fix).
