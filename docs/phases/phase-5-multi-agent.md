# Phase 5 · Multi-Agent Console

**Goal**: Prove Caduceus is genuinely agent-agnostic. Implement at least two additional `AgentAdapter`s and make them first-class citizens: switch between agents in the topbar, unify session inboxes, unify model/usage/budget accounting across adapters.

**Est.**: ~1 week solo.

**Depends on**: Phases 0–4. Any adapter trait evolutions land here as a breaking-ish change inside the repo (no external consumers yet).

## Target adapters

| Adapter            | Surface                                   | Notes                                                       |
|--------------------|-------------------------------------------|-------------------------------------------------------------|
| `ClaudeCodeAdapter`| CLI + file system state                   | Long-running sessions, tool-use heavy, terminal-first       |
| `AiderAdapter`     | CLI (`aider` Python) w/ JSON-lines mode   | Git-aware, file-edit focused                                |
| `OpenHandsAdapter` | HTTP API (FastAPI) of a running instance  | Optional; include if time permits                            |

At minimum **Claude Code + Aider** must ship in Phase 5.

## Exit criteria

1. Topbar gains an **Agent switcher** (separate from profile picker): lists registered adapters with health status.
2. Sessions from all enabled adapters show in a unified inbox when "All agents" is selected; per-adapter filter available.
3. `chat_send` routes to the correct adapter by session.adapter_id; UI features respect per-adapter `Capabilities` (e.g. Aider hides "channels" nav).
4. Usage accounting writes `adapter_id` on every row; Analytics page gains an adapter breakdown.
5. Budgets can be scoped per adapter.
6. Each new adapter ships with: conformance suite passing, mock mode, recorded fixtures, user-facing docs.
7. Disabling an adapter in Settings unloads it cleanly; no orphaned connections.

## Task breakdown

### T5.1 — Adapter trait polish · **Shipped** (2026-04-23)

- `Health` extended with `last_error: Option<String>` + `uptime_ms:
  Option<u64>` (commit to land with the rest of T5.1). Both are
  `#[serde(default)]` so old clients keep deserialising fine.
  `HermesAdapter` now tracks `started_at: Instant` + a `RwLock<Option<String>>`
  for the sticky last-error: successful probes clear it, failed probes
  record the error message.
- `ChatTurn` gains `cwd: Option<String>` (`#[serde(default)]`). Wired
  through both IPC commands (`chat_send` + `chat_stream_start`).
  Hermes ignores it; Claude Code / Aider will consume it in T5.2 / T5.3.
- `SessionQuery.search` was already present — Hermes `list_sessions`
  now honours both `search` (case-insensitive substring on title) and
  `limit` (take-N cap). Source filter still deferred.
- Did **not** regenerate specta bindings — no TS consumers of the
  mutated types yet. Will revisit when T5.2 introduces a real
  non-Hermes adapter.

**Tests**: 4 new unit tests under `adapters::hermes::tests::t51_*`
(stub health, search filter, limit cap, ChatTurn.cwd back-compat);
total lib tests 112 → 116, all green.

### T5.2 — Claude Code adapter (2 days)

**Scope**

- Wrap `claude-code` CLI (assume the upstream official Anthropic CLI). Use its session directories + its streaming JSON output.
- Map `ToolUse`/`ToolResult` events from its stream into our `Delta` enum.
- Sessions are CLI-native directories; `list_sessions` enumerates the known sessions root.

**Tasks**

- `src-tauri/src/adapters/claude_code/{mod,cli,sessions,stream}.rs`.
- Recorded fixtures (real output captured, secrets scrubbed).
- Conformance suite parameterized over `ClaudeCodeAdapter { mock: true }`.

**UX adjustments**

- Its capabilities: `streaming=true`, `tool_calls=true`, `attachments=true`, `skills=false`, `channels=[]`, `terminal=true` (it *is* terminal-first), `trajectory_export=true`.
- Sidebar nav auto-hides Channels/Skills/Scheduler when this adapter is the active context.

### T5.3 — Aider adapter (1.5 days)

**Scope**

- Run `aider` with the JSON-lines protocol. One session ≈ one running `aider` process with an attached repo.
- Session creation requires a repo path; the adapter keeps the process alive in the background and multiplexes messages.

**Tasks**

- `src-tauri/src/adapters/aider/{mod,process,protocol,repo}.rs`.
- Per-session process pool with backpressure + health check.
- Fixtures: 3 captured aider sessions in different repos.

**UX adjustments**

- Capabilities: `streaming=true`, `tool_calls=true` (aider's file-edit actions surface as tool calls), `attachments=false`, `channels=[]`.
- Chat Composer adds a "Repo" picker when the active adapter is Aider.

### T5.4 — OpenHands adapter (optional, 1 day)

- Talks to a running OpenHands instance via HTTP.
- Implement only if Claude Code + Aider landed smoothly with time to spare.

### T5.5 — Unified inbox + agent switcher (1 day)

- `src/app/shell/Topbar.tsx` grows an `AgentSwitcher.tsx` combo (All agents · Hermes · Claude Code · Aider).
- Sessions panel: "All agents" mode merges lists; each session shows a small adapter badge.
- Route-level guards hide nav items based on `capabilities` of the current context (All-agents context = union of hidden items).

### T5.6 — Cross-adapter analytics & budgets (half day)

- Analytics: `Usage mix by adapter` donut + stacked daily bar (per-adapter segments).
- Budgets: scope selector now includes `Adapter: <id>`.
- Rust queries add `adapter_id` filter.

## File map

```
src-tauri/src/
├── adapters/
│   ├── claude_code/{mod,cli,sessions,stream}.rs
│   ├── aider/{mod,process,protocol,repo}.rs
│   └── openhands/{mod,http}.rs       (optional)
├── ipc/agents.rs                     (list, enable/disable, set-default)
└── state.rs                          (AdapterRegistry richer lifecycle)

src/
├── app/shell/AgentSwitcher.tsx
├── features/settings/sections/Agents.tsx
└── features/chat/{RepoPicker.tsx}    (Aider)
```

## Test plan

- Conformance suite runs over every registered adapter in mock mode, every CI build.
- Integration: enable Claude Code mock + Aider mock + Hermes mock simultaneously; send 1 message to each; assert 3 independent streams land correctly.
- Analytics: seed usage rows with mixed `adapter_id`; assert donut percentages and stacked bars.
- Disable adapter at runtime → its sessions disappear from inbox within 1 s; re-enable → reappear.

## Demo script

1. Open topbar → Agent switcher: 3 adapters, Hermes + Claude Code + Aider, all green.
2. Select "All agents" → inbox merges; sessions from each adapter visible.
3. Click a Claude Code session; Composer + Inspector adapt; send a code-related prompt; terminal-like streaming with tool-use cards.
4. Switch to an Aider session in a cloned repo; ask it to refactor a file; watch the file-edit tool calls.
5. Analytics → "Usage by adapter"; budget "Claude Code daily $2" configured; push it to 80% and show the notification.

## What Phase 5 does NOT do

- No second-party adapter SDK / plugin marketplace. The adapters ship in-tree. A proper plugin system with dynamic loading is a post-6-week Phase 6 candidate.
- No unified skills/channels abstraction across adapters (too early; each agent has its own idioms).
- No cross-adapter session linking (e.g. hand off a Hermes session to Claude Code mid-conversation).
