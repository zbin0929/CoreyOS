# Phase 7 · Agent Expansion

**Goal**: Surface three Hermes-native capabilities (MCP, memory, skills hub) through Corey-specific GUIs, plus one additive feature (skill-from-conversation distillation). Post-product-audit this phase is mostly **GUI wrappers over features Hermes already ships**, not parallel engines.

**Est.**: ~1.5 weeks solo (post-audit, see `docs/10-product-audit-2026-04-23.md`). Was 3–4 weeks before T7.1 LangGraph adapter was replaced with MCP manager and T7.3 qdrant was replaced with `MEMORY.md` editor.

**Depends on**: Phase 6 complete (multi-instance Hermes, feedback loop, channels fixed, Scheduler wrapped).

## Guiding principle

**Wrap Hermes, don't duplicate it.** Phase 7 reads upstream docs first, codes second. Per `docs/10-product-audit-2026-04-23.md`:
- LangGraph (planned as its own adapter) → replaced by **MCP server manager UI** since Hermes supports MCP natively and any LangGraph pipeline can expose itself over MCP.
- Long-term memory (planned as qdrant + RAG) → replaced by **`MEMORY.md` + `USER.md` + `session_search` GUI** since Hermes already ships all three.
- Skills hub import (planned as ClawHub client) → replaced by **GUI wrapper around `hermes skills browse/install/audit` CLI** since Hermes already federates 7+ hub sources.
- Skill-from-conversation → **kept** (Corey-unique: user-initiated distillation button is a UX complement to Hermes' agent-initiated `skill_manage`).

## Exit criteria

1. **MCP manager UI**: users can list/add/remove/enable MCP servers that Hermes will connect to. Read/write `~/.hermes/` MCP config. No sidecar Python process.
2. **"Save conversation as Skill" button** in session header: runs a distillation prompt, opens the resulting SKILL.md in the Skills editor pre-filled, writes to `~/.hermes/skills/` on confirm so Hermes picks it up natively.
3. **Memory page**: a GUI editor for `~/.hermes/MEMORY.md` (agent notes) and `~/.hermes/USER.md` (user profile), plus a search UI on top of Hermes' `session_search`. No local qdrant, no separate embedding pipeline.
4. **Skills import**: Skills page grows a "Browse / Install" tab wrapping `hermes skills` CLI — search across official / skills-sh / github / clawhub / lobehub / claude-marketplace / well-known sources; inspect; install with security scan prompt. Output lands in `~/.hermes/skills/` and refreshes Corey's Skills list.

## Task breakdown

### T7.1 — MCP server manager UI · ✅ **Shipped 2026-04-23 pm**

New `/mcp` page reads/writes the `mcp_servers:` section of `~/.hermes/config.yaml`. Schema verified against upstream docs (hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes) before coding: no invented fields; config is an opaque JSON blob per server so new upstream keys ride through. Stdio + URL transports, inline JSON edit textarea, restart-gateway nudge banner, id frozen post-create. 3 Rust unit tests + 2 Playwright smokes green. Reachability probe + enabled toggle **deferred** (upstream has no enabled concept; probing requires a full MCP client). See `CHANGELOG.md` under the T7.1 heading.

### T7.1 — Original plan (for reference) · ~3 days (replaced LangGraph adapter 2026-04-23 pm)

**Re-scoped from ~6 days LangGraph adapter to ~3 days MCP manager.** Hermes natively supports MCP servers (see upstream `docs/user-guide/features/mcp`). LangGraph, CrewAI, AutoGen can all be invoked via MCP. Building a parallel sidecar-Python adapter for one specific framework is worse than letting the user wire any MCP server they want.

- **Read Hermes' MCP config location** (likely `~/.hermes/mcp.json` or a section in `config.yaml` — confirm by reading upstream docs before coding).
- **UI surface**: new Settings › MCP page listing configured MCP servers with columns `name`, `command/url`, `enabled`, `last reachable`, `tool count`.
- **CRUD**: add / edit / remove / enable-toggle. Form takes MCP standard JSON (stdio command or URL transport).
- **Reachability probe**: a "Test" button attempts to connect and lists tools; cached for the list view.
- **Hermes restart nudge**: MCP changes typically need gateway restart — reuse the existing `hermes_gateway_restart` prompt from Phase 3.
- **Chat-side surfacing**: no change needed. When Hermes invokes an MCP tool, it already emits a `ToolProgress` event; `TrajectoryView` already renders it.
- **Tests**: 2 Rust (parse Hermes MCP config, round-trip upsert) + 1 Playwright (add a local MCP echo server, toggle enable, restart prompt appears).
- **Explicitly NOT doing**: executing MCP servers ourselves. Hermes runs them. We just let the user configure which ones.

### T7.2 — Skill-from-conversation distillation · ~3 days (kept)

This is Phase 7's one purely additive feature — Hermes has agent-initiated `skill_manage` but no user-initiated "save this chat as skill" button.

- **Trigger**: new button in session header — "Save as Skill". Available on sessions with ≥ 2 turns.
- **Pipeline** (all client-side, no new Rust IPC):
  1. Collect session messages.
  2. Ship them to the active adapter via `chat_once` with a system prompt:
     > "Analyse the following conversation. Extract a reusable skill. Output a SKILL.md file with frontmatter (`name`, `description`, `triggers`, `required_inputs`) and a body describing the skill."
  3. Open the Skills editor pre-filled with the returned SKILL.md.
  4. User confirms → write to `~/.hermes/skills/<slug>/SKILL.md` so Hermes picks it up natively (**no longer writes to Corey's own SQLite**; schema alignment with T7.4 / Skills surface refactor).
- **Graceful degradation**: if the adapter returns unparseable output, fall back to opening the Skills editor with the conversation as free-text so the user can trim manually.
- **i18n**: 6 new keys.

### T7.3 — Memory page (GUI over Hermes' native memory) · ✅ **Shipped 2026-04-23 pm**

Landed as a two-tab Markdown editor at `/memory`. Reuses the Skills CodeMirror 6 instance; writes through `memory_read` / `memory_write` IPC commands backed by `fs_atomic::atomic_write`. Rust-side cap of 256 KiB, UTF-8 byte-accurate capacity meter in the UI (critical for CJK note-takers). Chinese i18n complete. 2 Playwright smokes + 3 Rust unit tests green. **Session-search panel deferred to T7.3b** once the Hermes FTS5 tool name is pinned. See `CHANGELOG.md` entry dated 2026-04-23 under the T7.3 heading for details.

### T7.3 — Original plan (for reference) · ~3 days (re-scoped 2026-04-23 pm)

**Re-scoped from ~6 days qdrant + RAG to ~3 days GUI over Hermes' existing stack.** Hermes already ships:
- `~/.hermes/MEMORY.md` — agent's personal notes, appears in every system prompt.
- `~/.hermes/USER.md` — user profile, same surface.
- `session_search` tool — FTS5 over past sessions.
- Optional Honcho dialectic modeling for deeper user models.

We don't need our own vector DB. We need a clean GUI over these files.

- **Memory page layout** (left sidebar + right editor):
  - Two tabs: `MEMORY.md` (agent) / `USER.md` (user profile).
  - Markdown editor (reuse the CodeMirror 6 setup from Skills T4.2b).
  - Capacity meter showing size vs Hermes' configured cap.
  - "Add entry" button that appends a timestamped bullet.
- **Session search panel** (bottom of same page or its own subtab):
  - Search input hits Hermes' session_search via the chat API or via direct DB access if Hermes exposes one (TBD during implementation).
  - Results list with session id, timestamp, snippet, link to full session.
- **No `AgentAdapter::recall` trait addition.** Hermes handles injection itself once MEMORY.md is written.
- **Tests**: 2 Rust (read/write MEMORY.md with lockfile, capacity check) + 1 Playwright (edit a memory entry, verify file on disk, run session_search).

### T7.4 — Skills page refactor: wrap `hermes skills` CLI · ~3 days (final scope 2026-04-23 pm)

Our Phase 4 Skills editor stores skills in a local SQLite table. Hermes' native `hermes skills` CLI supports:

- `hermes skills browse` (list from official, skills-sh, well-known, github, clawhub, lobehub, claude-marketplace)
- `hermes skills search <query> --source <hub>`
- `hermes skills inspect <slug>` (preview before install)
- `hermes skills install <slug>` (with security scan)
- `hermes skills list --source hub` (list installed)
- `hermes skills check` / `update` (upstream updates)
- `hermes skills audit` (re-scan for security)
- `hermes skills publish` (push to GitHub)
- `hermes skills reset` (un-stick a bundled skill)

T7.4 refactors Corey's Skills page to **wrap this CLI** rather than duplicate it.

- **File storage change**: user-authored skills now write to `~/.hermes/skills/<slug>/SKILL.md` instead of our SQLite `skills` table. The local SQLite mirror remains as a **cache** for fast listing only; source of truth is the filesystem.
- **New "Browse" tab** in the Skills page: wraps `hermes skills browse` output with a search bar (per `--source`), inspect preview, install button (triggers a security-scan confirmation dialog).
- **New "Installed from hub" section**: lists hub-installed skills separately from user-authored ones. Shows ⚠️ if `hermes skills check` reports an upstream update.
- **Backend**: Rust calls out to `hermes skills --json` (or equivalent structured output flag — verify during implementation). No re-implementing the hub protocols.
- **Tests**: 3 Rust (parse SKILL.md frontmatter, listing, install-error path) + 1 Playwright (browse, install a test skill from a mock hub).

## Test totals target (post-audit)

- Rust unit: **+10** (2 MCP manager, 2 skill-from-chat, 2 memory file editor, 3 skills CLI wrapper, 1 migration)
- Playwright: **+4** (MCP add/enable, save-as-skill round-trip, memory editor, skills browse+install)

## Deltas vs the original brainstorm

| Brainstorm item | Landed in Phase 7 as |
|-----------------|----------------------|
| 1️⃣ openclaw 集成 | **DROPPED** — merged into Hermes Agent upstream. |
| 4.1 技能学习 | T7.2 (user-initiated distillation; complements Hermes' agent-initiated `skill_manage`). |
| 4.4 知识沉淀 | T7.3 (GUI over Hermes' native `MEMORY.md` + `USER.md` + `session_search` — no local qdrant). |
| 5.1 任务 DAG | T7.1 (**MCP server manager UI**, not a LangGraph-specific adapter). |
| Skills ecosystem import | T7.4 (wrap `hermes skills` CLI; 7+ hub sources come free). |

## Explicitly deferred out of Phase 7

- **Visual drag-and-drop DAG editor**: Hermes doesn't need one; MCP servers are configured via JSON. React Flow editor remains follow-up only if a real user signals demand.
- **Local qdrant memory**: dropped permanently. Hermes' memory stack is the source of truth.
- **Automatic skill-suggestion cards in chat**: symmetric with the dropped T6.6. Hermes' `skill_manage` tool already handles the agent-initiated half.

## Demo script (end-of-phase)

1. Open Settings › MCP. Add a local MCP server (e.g. the official filesystem MCP). Toggle enable. Restart the gateway when prompted.
2. In chat, ask "list the files in my Downloads folder". Watch Hermes invoke the MCP filesystem tool and render progress in the Trajectory pane.
3. Mid-session click "Save as Skill". Review the pre-filled SKILL.md. Save. Verify a new file at `~/.hermes/skills/<slug>/SKILL.md` and that the Skills page lists it.
4. Open the Memory page. Add a bullet "I prefer TypeScript over Python" to USER.md. Save. Start a new session, ask "write me a quick script". Observe that the assistant picks TypeScript without being told.
5. On the Skills page, open the Browse tab. Search "1password" under the `official` source. Inspect the preview. Install it (security-scan prompt appears). Verify it lands in the Installed-from-hub list.
6. Run a session_search for "sparse attention" from the Memory page; click a result to open the full session.
