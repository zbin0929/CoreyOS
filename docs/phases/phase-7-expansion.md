# Phase 7 · Agent Expansion

**Goal**: Build on the Phase 6 orchestration plane with three capability expansions that deepen Corey's differentiation without reinventing upstream frameworks. Visual DAG editor (adapts LangGraph), skill-from-conversation distillation, long-term memory (vector DB + RAG), and openclaw integration.

**Est.**: 3–4 weeks solo.

**Depends on**: Phase 6 complete (multi-instance, orchestrator adapter, feedback loop).

## Guiding principle

**Adapt rather than build.** The original brainstorm proposed building our own task-DAG framework from scratch (item 5.1). Phase 7 explicitly rejects that — LangGraph / CrewAI / AutoGen have funded teams and 2+ years of production use. We wrap one of them as an `AgentAdapter`, letting Corey's UI drive a DAG runtime we don't own. Same logic applies to memory (chroma / qdrant) and conversation-to-skill distillation (reuse the chat IPC, not a new pipeline).

## Exit criteria

1. A `LangGraphAdapter` ships as a first-class `AgentAdapter`: users can load a `.py` graph definition, see nodes execute in real time, inspect node I/O. No forking of LangGraph itself.
2. A "Save conversation as Skill" button appears on any session's header; clicking runs a distillation prompt on the conversation history and creates a Skills entry (prompt template + required inputs extracted).
3. A memory layer with a vector DB (local — qdrant-embedded or similar) captures skill-tagged turns, surfaces them via a `Recall` capability that the orchestrator can call on each new turn.
4. The openclaw project (pending user clarification — see T7.4) is wired in as an adapter or a skill provider, whichever matches its surface.

## Task breakdown

### T7.1 — LangGraph adapter · ~6 days

- **Why not CrewAI/AutoGen**: LangGraph has the cleanest programmatic graph-as-Python-code surface; AutoGen is more "agent-first-conversation", CrewAI less mature. Phase 7 picks LangGraph but the adapter trait leaves room to add the others later.
- **Approach**: ship a sidecar Python process (`langgraph-bridge.py`) launched by Rust via `tokio::process::Command`. Rust ↔ Python over stdin/stdout with JSON-line protocol. Same pattern as `AiderAdapter` uses for its CLI bridge (see `src-tauri/src/adapters/aider/`).
- **User-authored graphs**: graphs live in `~/.corey/graphs/<name>.py`, same directory convention as Skills. On adapter start, each file is a registered "graph" the user can select in a new Chat sub-picker.
- **Streaming**: LangGraph's `astream_events` emits per-node events; the bridge forwards them as `ChatStreamEvent::ToolProgress` (already exists) so the existing Trajectory UI renders the execution live.
- **Security**: Python process runs under the instance's `SandboxScope` (T6.5). Required Python deps pinned in a `requirements.txt` co-located with the bridge; bridge prompts the user for a one-time `pip install` on first launch.
- **Tests**: Rust adapter conformance suite passes with a mock bridge. E2E uses a canned 2-node graph.

### T7.2 — Skill-from-conversation distillation · ~3 days

- **Trigger**: new button in session header — "Save as Skill". Available on sessions with ≥ 2 turns.
- **Pipeline** (all client-side, no new Rust IPC):
  1. Collect session messages.
  2. Ship them to the active adapter via `chat_once` with a system prompt:
     > "Analyse the following conversation. Extract a reusable skill. Output strict JSON: `{name, description, prompt_template, required_inputs: [{name, description, example}], tags: [...]}`."
  3. Open the Skills editor pre-filled with the returned JSON.
  4. User confirms → `skill_upsert` writes to DB.
- **Handles existing Skills pattern** from Phase 4 — no schema changes, just a new UI entry point.
- **Graceful degradation**: if the adapter returns unparseable JSON, fall back to opening the Skills editor with the conversation as free-text so the user can trim manually.
- **i18n**: 6 new keys.

### T7.3 — Long-term memory (vector DB + RAG) · ~6 days

- **Storage**: bundled `qdrant` embedded (single binary, Rust-native, no system deps). Lives under `<data_dir>/qdrant/`.
- **Ingestion**: every assistant turn that gets 👍 (from T6.1) OR every turn the user explicitly marks "save to memory" is chunked, embedded (via the active adapter's `/v1/embeddings` endpoint), and written to qdrant with metadata `{session_id, adapter_id, model, tags, created_at}`.
- **Retrieval capability**: a new trait method `AgentAdapter::recall(query, k) -> Vec<MemoryHit>`. Default impl returns empty. The orchestrator (T6.3) gets a policy knob "inject top-3 recalls into the manager prompt".
- **UI**:
  - New Memory page lists recent entries with source session / adapter / score.
  - Delete / pin / export-as-JSON controls.
  - Search bar hits `/qdrant search` directly.
- **Privacy**: all vectors stay local. No IPC leaks the raw query to a non-adapter endpoint.
- **Migrations**: schema v8 adds `memory_entries` table as a mirror of the qdrant metadata (for fast Analytics without hitting qdrant).
- **Tests**: Rust — round-trip embed → search → retrieve with a mocked embed endpoint. Playwright — 👍 a turn, visit Memory, see the entry; orchestrator run with recall on vs off, different outputs.

### T7.4 — Skills ecosystem integration (was: OpenClaw) · ~3 days

**Major re-scope on 2026-04-23 pm** after reading `docs/hermes-reality-check-2026-04-23.md`. Summary: OpenClaw is being **merged into Hermes Agent** (`hermes claw migrate` in the upstream CLI), not a peer competitor. The previous "OpenClawAdapter" + "ClawHub importer" split is obsolete.

#### T7.4a — `OpenClawAdapter` — **DROPPED**

No parallel control plane to bridge to. The migration path lives inside the Hermes CLI itself. Corey has nothing to add.

#### T7.4b — Skills importer (re-scoped) · ~3 days

Hermes uses <https://agentskills.io> as its open skill standard and migrates OpenClaw skills into `~/.hermes/skills/openclaw-imports/`. The importer targets these **instead of ClawHub**:

- **Local import**: Skills page "Import" button scans `~/.hermes/skills/**/SKILL.md` (including the `openclaw-imports/` subtree) and surfaces discovered skills with a preview + select-to-import flow. Translates the SKILL.md frontmatter to our `SkillRow` shape.
- **Remote import (agentskills.io)**: a second tab on the importer dialog hits the `agentskills.io` registry for community skills. Search → preview → import.
- **Deduplication**: same skill name already in Corey's DB → show a merge/replace/skip prompt.
- **Licensing**: preserved and displayed; no automatic batch-import.
- **Tests**: Rust parser round-trip on sample SKILL.md files. Playwright — scan local skills, import one, verify it appears.

#### Why this re-scope

The original T7.4 was premised on Corey being the console for multiple **agent ecosystems**. Reality is more modest: Corey is the console for **Hermes**, and Hermes itself absorbs adjacent projects. The skills importer still delivers value — it lets users pull in OpenClaw/community skills — but the adapter-level integration fantasy is gone.

## Test totals target

- Rust unit: **+10** (4 LangGraph bridge, 3 memory ingest/retrieve, 3 SKILL.md parser + agentskills.io client). Down from +14 after OpenClawAdapter dropped.
- Playwright: **+5** (LangGraph run, skill-from-chat, memory recall, memory page, skills importer). Down from +6.

## Deltas vs the original brainstorm

| Brainstorm item | Landed in Phase 7 as |
|-----------------|----------------------|
| 1️⃣ openclaw 集成 | T7.4 re-scoped to **SKILL.md + agentskills.io importer** after learning OpenClaw merged into Hermes. OpenClawAdapter dropped. |
| 4.1 技能学习 | T7.2 (conversation distillation; builds on Phase 4 Skills page) |
| 4.4 知识沉淀 | T7.3 (memory layer, feeds recall) |
| 5.1 任务 DAG | T7.1 (**LangGraph adapter, not self-built**) |

## Explicitly deferred out of Phase 7

- **Visual drag-and-drop DAG editor**: T7.1 ships read-only visualisation only. A full graph editor (React Flow or similar) is a separate effort worth ~2 weeks and depends on real user need.
- **Cross-adapter memory**: memory entries today carry `adapter_id`; actually recalling across adapters needs a normalisation layer for embedding spaces. Out of scope.
- **Automatic skill-suggestion cards in chat**: symmetric with `docs/09-conversational-scheduler.md` Stage 2; same trade-offs. Follow-up.

## Demo script (end-of-phase)

1. Create `~/.corey/graphs/research.py` with a 3-node LangGraph (search → summarise → critique). Restart. See `research` in the graph picker.
2. Run it with input "latest papers on sparse attention". Watch the Trajectory pane animate per-node.
3. 👍 the final summary. Open the Memory page. See the entry.
4. Start a new session with the orchestrator adapter, memory-recall enabled. Ask "what were my notes on sparse attention?". The orchestrator injects the memory entry into the manager's prompt; the reply cites it.
5. On an unrelated session, click "Save as Skill" → review → save. Verify the Skills page now has a new entry with extracted inputs.
6. In Settings › Agent, enable the OpenClaw adapter (auto-suggested if `~/.openclaw/` exists). Open AgentSwitcher, see OpenClaw listed alongside Hermes / Claude Code / Aider.
7. Switch to OpenClaw, send a message. Note the reply carries an `openclaw` badge in the unified inbox.
8. On the Skills page, click "Import from ClawHub", search "meeting summary", preview, import. Verify the skill lands in Corey's Skills list with its upstream license displayed.
