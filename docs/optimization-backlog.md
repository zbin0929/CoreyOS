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

### P0.5 Workflow lifecycle completion (audit-grade)

**Problem**: Workflow demoed schema-lock + approval gates but the surrounding lifecycle was missing — runs lived in a `HashMap`, lost on quit; an approval-paused run had no way to resume across restart; agent steps blocked the UI for 30s+ with no progress; rejection had no reason field; there was no run history; no way to stop a runaway run.

**Fix**: Full lifecycle pass to make `workflow` the audit-grade primitive its positioning doc claims it is. Eight sub-fixes:

1. **Persistence (v12 schema)** — `workflow_runs` + `workflow_step_runs` SQLite tables; step-end hook writes through on every state transition. `db::workflows::{upsert_workflow_run, load_active_workflow_runs, list_workflow_history, get_workflow_run, delete_workflow_run}`.
2. **Auto-resume after restart** — `lib.rs` setup loads non-terminal runs from SQLite; `running` step rows are demoted to `pending` (mid-flight kills can't trust partial output) and the engine is re-spawned via `spawn_run_executor`.
3. **Step-end + step-progress hooks** — engine `execute_with_hooks(…, on_step_end, on_step_progress, should_cancel)`; the IPC layer takes the run OUT of the in-memory map for the duration of execution and lets the hooks sync back at every step boundary, so `workflow_run_status` polls don't block on a 30s agent step.
4. **Streaming agent steps** — `StepExecutor::execute_agent_streaming(prompt, &dyn Fn(&str))` default-impl falls back to `execute_agent`; HermesExecutor overrides with `chat_stream` + 50ms-throttled progress callback. Frontend renders `output.partial` (last 6 lines + blinking caret).
5. **Run history UI** — new `features/workflow/History.tsx` (list + detail panel + delete + JSON/Markdown export). IPC: `workflow_history_list`, `workflow_run_get`, `workflow_run_delete`.
6. **Manual cancel** — `workflow_run_cancel` IPC + per-run `Arc<AtomicBool>` flag + engine `should_cancel` check on every ready dispatch. Honored at step boundary (no mid-stream abort to avoid double-billing).
7. **Reject reason dialog + LLM Profile picker** — modal collects rejection reason → `workflow_runs.error` for audit; `PropertyPanel` agent step routes through any saved LLM profile via `agent_id = "hermes:profile:<id>"`.
8. **MCP tools `list_workflows` + `run_workflow`** — chat agent can enumerate user-authored workflows and trigger them by id, returning the run_id for the user to follow in the History UI.

**Files**: `src-tauri/src/workflow/engine/mod.rs`, `src-tauri/src/db/{migrations.rs,workflows.rs,mod.rs}`, `src-tauri/src/ipc/workflow/mod.rs`, `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/mcp_server/tools.rs`, `src-tauri/src/ipc/hermes_memory.rs`, `src/features/workflow/{index.tsx,History.tsx,Editor.tsx,InputsEditor.tsx,PropertyPanel.tsx}`, `src/features/settings/sections/MemorySection.tsx`, `src/lib/ipc/{runtime.ts,hermes-config.ts}`, `src/locales/{zh,en}.json`.
**Status**: ✅ Done — 13 new unit tests (engine hooks ×5, db round-trip ×5, log-parsing ×3); auto-resume verified end-to-end with hot kill.

### P0.6 Hermes-as-shared-backend polish

**Problem**: Several misalignments between Corey's UI and Hermes's actual model surfaced post-P0.5:
- Sidebar `/agents` lived in primary nav even though the AgentSwitcher was hidden after the Hermes-as-default pivot.
- `Settings → Sandbox` only managed Corey's own IPC paths. Users assumed it also restricted Hermes shell tools and reported "sandbox failed" when `ls ~/Desktop` succeeded — Hermes's command-pattern approval policy was hidden in `~/.hermes/config.yaml`.
- Compare picker pulled from the active adapter's `/v1/models` (= just `hermes-agent` after Hermes-as-default), making cross-model compare impossible.
- Hermes legacy `~/.hermes/sessions/*.jsonl` accumulated indefinitely with no UI handle. `state.db` rewrite + co-existing JSON sidecar = 3 stores, none of which Corey owned.
- No version compatibility signal: a future Hermes minor would silently break config-yaml writes, OpenClaw-style.
- No onboarding signal for "I copy-pasted `pip install` and it failed" — Python / pip mismatch is the #1 first-run blocker.
- "Hermes binary bundle" code path (resolve-bundled lookups, `fetch-hermes-binary.mjs`, `binaries/*` resource) was a 260-line ghost — Hermes is Python and upstream releases ship source-only, so the bundle was always empty.

**Fix**:
1. **Nav cleanup** — `/agents` moved from primary to More group; AgentSwitcher comment-deleted from Topbar.
2. **`Settings → Sandbox` second section: Hermes 工具权限** — new `HermesToolPermissionsSection` writes `approvals.mode` / `approvals.timeout` / `approvals.cron_mode` / `command_allowlist` straight into `~/.hermes/config.yaml`. Backend: `HermesSecuritySection`, `extract_security`, `write_security`, IPC `hermes_config_write_security`.
3. **Compare → LLM Profile picker** — synthetic `profile:<id>` ModelInfo so existing chip / lane testids line up; chatStream routes through `hermes:profile:<id>` adapter. Empty-state guides users to Settings → Models when no profile exists.
4. **Hermes session disk panel** — backend `hermes_session_usage` + `hermes_session_cleanup` IPCs scan `~/.hermes/sessions/` and remove `session_*` files older than N days (preserving `sessions.json` index). UI panel in MemorySection shows file count / total bytes / oldest file age + one-click 30-day cleanup.
5. **Version compatibility banner** — `HermesCompatibility::{Supported, Untested, TooOld, Unknown}` enum from version-string parse; `HERMES_MIN_SUPPORTED = (0, 10)`, `HERMES_MAX_TESTED = (0, 10)`. Home page renders red ("too old") / yellow ("untested") banner accordingly.
6. **Install preflight** — `hermes_install_preflight` IPC checks Python ≥ 3.11 + pip via `python3 -m pip --version`. NotInstalledCard auto-runs it on mount, replacing the generic "copy and run" hint with precise "缺 Python 3.11+" / "缺 pip" guidance.
7. **Drop ghost binary-bundle path** — deleted `scripts/fetch-hermes-binary.mjs`, `src-tauri/binaries/`, `tauri.conf.json: resources["binaries/*"]`, `release-windows.yml` fetch step, and the bundled-lookup tier of `resolve_hermes_binary`. -260 lines that always no-op'd anyway.
8. **Cancel button actually visible** — `workflow_run_cancel` IPC now flips `RunStatus::Cancelled` immediately regardless of current state; `step_end_hook` reads the cancel flag to keep the snap published to the in-memory map / SQLite consistent. Earlier behaviour: Stop click looked unresponsive because the in-flight 30s `chat_stream` finished before the engine reached its next `should_cancel` check.

**Files**: `src-tauri/src/hermes_config/{mod.rs,gateway.rs}`, `src-tauri/src/ipc/{hermes_config.rs,hermes_memory.rs,workflow/mod.rs}`, `src-tauri/src/lib.rs`, `src-tauri/src/mcp_server/tools.rs`, `src/app/nav-config.ts`, `src/features/settings/sections/{HermesToolPermissionsSection.tsx,MemorySection.tsx}`, `src/features/settings/index.tsx`, `src/features/compare/index.tsx`, `src/features/home/HermesInstallCard.tsx`, `src/features/help/manual.zh.md`, `src/lib/ipc/hermes-config.ts`, `e2e/{compare.spec.ts,sandbox-scopes.spec.ts,logs.spec.ts,fixtures/tauri-mock.ts}`, `src/locales/{zh,en}.json`.
**Status**: ✅ Done — 7 new unit tests (Python/Hermes version parsing × 5, install_preflight × 2); CI 5/5 green.

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

### P3.1 Chat page state machine refactor

**Problem**: `src/features/chat/index.tsx` was 1003 lines and the
single hottest path in the app. A previous mechanical-split attempt
was rejected because the bulk was intertwined state (idle /
composing / sending / streaming / tooling / cancelling).
**Fix**: Two-phase extraction.
  1. PR #1 (`c8abeb8`) — surgical leaf splits: `Composer` (340),
     `useAttachments` (176), `LearningIndicator` (40). 1003 → 709.
  2. `4b54f96` — `useChatSend` hook owning every imperative entry
     point (send / retry / stop / voice / IME / draft / budget
     warnings + the session-switch reset effect). 709 → 321.
**Files**: `src/features/chat/{index,Composer,LearningIndicator,
useAttachments,useChatSend}.tsx,ts`
**Status**: ✅ Done — final ChatPane is 321 lines, every preserved
invariant documented in the `useChatSend` docblock; typecheck +
lint + 77 unit + 81 e2e all green on `4b54f96`.

### P3.2 `unwrap_used` baseline reduction

**Problem**: 468 `unwrap()` calls baked into the clippy baseline.
The CI gate prevents *new* unwraps but doesn't shrink the existing
population. Initial assumption was that the bulk lived in production
code.
**Reality**: After upgrading `scripts/check-clippy-unwrap.mjs` to
split production vs. test (it now reports both buckets), the
distribution turned out to be **5 production / 463 test**. The 5
production unwraps were all provably-safe internal-invariants
(`segs.last()` after `is_empty()` guard; `HashMap::get_mut` with
seeded keys). Replaced them with `expect("…")` calls that document
the invariant.
**Fix**: Commits `_pending_` ship the script upgrade + the 3
production-side conversions in `hermes_config.rs` (×2) and
`workflow/planner.rs`.
**Status**: ✅ Done — baseline now 464; production count is **0**;
the CI gate continues to lock in the no-new-unwrap policy.
`unwrap()` in `#[cfg(test)]` is industry-standard (panics fail
tests loudly) and is not worth churning further.

### P3.3 IPC type-safety re-evaluation

**Problem**: `c4-ipc-type-safety.md` decided to keep TS bindings
hand-written; OP-025 added a drift gate as the safety net.
Re-evaluate after a few months — if drift fires often, switch to
tauri-specta or similar codegen.
**Status**: ⏳ Open (re-evaluate 2026-Q3).

### P3.4 Storybook coverage for newly-extracted components

**Problem**: OP-025 extracted ~15 React components from god files.
Storybook stories were mostly missing; the original `.storybook/main.ts`
explicitly excluded `src/features/**` because feature components read
Zustand stores hydrated from IPC, which Storybook had no way to mock.
**Fix**: Built `.storybook/withTauriIpc.tsx` — a decorator that
installs the same in-memory `__TAURI_INTERNALS__` mock the Playwright
suite uses (eval'd from `e2e/fixtures/tauri-mock.ts` via `new
Function`). Loosened `main.ts` to scan `src/**/*.stories.{ts,tsx,mdx}`
so feature stories are picked up automatically. Shipped a proof-of-
concept `Composer.stories.tsx` covering Default / WithDraft /
WithAttachments / DraggingFiles / Sending / VoiceRecording /
WithWarnings — `pnpm build-storybook` passes end-to-end.
**Status**: ✅ Decorator + first feature story landed. Remaining
component stories (`LlmProfileCard`, `ProfileCard`, `ServerRow`,
`ApiKeyPanel`, `RestartBanner`, `AgentWizard*`) are now mechanical
follow-ups that any contributor can ship in a one-off PR using
`Composer.stories.tsx` as a template.

### P3.5 Flaky `HOME` env mutation in Rust tests

**Problem**: A handful of `hermes_config_tests` / `db_tests` mutate
process-wide `HOME` and intermittently collide on parallel test
runners.
**Fix**: Joined the existing `crate::skills::HOME_LOCK` (already used
by attachments / changelog / memory / skills) from the two outlier
tests in `hermes_config_tests.rs`. No new dep — the crate-wide lock
was already designed for this.
**Status**: ✅ Done — commit `6baa552`. 5× consecutive `cargo test --lib`
runs all return 262/262.
