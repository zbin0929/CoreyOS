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
**Fix**: Add step-level progress bar to workflow run panel. Add "step N/M" to browser automation.
**Files**: `src/features/workflow/index.tsx`
**Status**: ⏳ Pending

### P1.2 Batch operations

**Problem**: No multi-select on Agents/Workflows/Sessions list pages.
**Fix**: Add checkbox column + "Delete selected" action to list pages.
**Files**: `src/features/workflow/index.tsx`, `src/features/agents/index.tsx`, `src/features/chat/SessionsPanel.tsx`
**Status**: ⏳ Pending

### P1.3 Unified async state hook

**Problem**: Mixed state patterns (page state + store + IPC loading). Some pages have loading/error, others don't.
**Fix**: Extract `useAsyncState<T>` hook with consistent loading/error/dirty/refetch pattern.
**Files**: New `src/lib/useAsyncState.ts`, then adopt in 5+ pages
**Status**: ⏳ Pending

### P1.4 Browser runner environment diagnostics

**Problem**: Browser automation fails silently when Node/browser/profile is missing.
**Fix**: Settings Browser section gets "Check Environment" button that tests: Node path, browser-runner path, browser binary, profile dir.
**Files**: `src/features/settings/BrowserSection.tsx` (new), `src-tauri/src/ipc/browser_config.rs`
**Status**: ⏳ Pending

### P1.5 API key validation on save

**Problem**: Invalid API keys are saved without verification; user only discovers at send-time.
**Fix**: Settings save for Hermes/LLM profiles pings `/v1/models` before committing.
**Files**: `src/features/settings/HermesInstancesSection.tsx`, `src/features/models/LlmProfilesSection.tsx`
**Status**: ⏳ Pending

### P1.6 Structured tracing on critical paths

**Problem**: Rust side has <10 `tracing` calls total. Chat stream, workflow run, browser step have no structured logs.
**Fix**: Add `tracing::info!` with structured fields to: chat_stream start/done, workflow step start/done/error, browser step start/done/error.
**Files**: `src-tauri/src/ipc/chat.rs`, `src-tauri/src/ipc/workflow.rs`, `src-tauri/src/workflow/engine.rs`
**Status**: ⏳ Pending

---

## P2 — Longer-term polish

### P2.1 Terminology unification
Agent/Profile/Adapter concept boundaries. UI naming consistency.

### P2.2 Resource relationship visualization
Show impact when deleting/modifying a Profile or Agent.

### P2.3 Agent routing decision transparency
"Why did this go to Agent X?" explanation in chat.

### P2.4 Knowledge/Memory/Learning product closure
Answer citation sources, memory write notifications, learning audit trail.

### P2.5 File intelligence quality control
Per-file-type extraction quality hints, structured result display, extraction cache.

### P2.6 Document classification
Tag docs as plan/current/changelog. Add "last verified" timestamps.

### P2.7 Development constraints & evolution rules
Write into `.trae/rules/project_rules.md`: no logic dumping in core pages, service/hook first, contract definitions required, diagnostics required.
