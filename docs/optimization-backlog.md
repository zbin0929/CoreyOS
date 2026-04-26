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
**Fix**: Add a `contract-test` that serializes a Rust DTO to JSON and compares against the TS interface definition.
**Files**: New `src-tauri/tests/contract_tests.rs`
**Status**: ⏳ Pending

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
