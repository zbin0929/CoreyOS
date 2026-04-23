# 05 · Roadmap

## At a glance

| Phase | Title                 | Exit criteria                                          | Est.      | Status |
|------:|-----------------------|--------------------------------------------------------|-----------|--------|
| 0     | Foundation            | App shell + palette + Hermes stub adapter + CI green   | 1–2 days  | **Core shipped** (2026-04-21), 7/10 exit criteria |
| 0.5   | Hardening             | CI matrix + lint/format/test gates + Windows sandbox fix + nav shortcuts | 1–2 days | **Shipped** (2026-04-21); Playwright e2e (52 specs) + Storybook 8 scaffolding added 2026-04-23. See CHANGELOG. |
| 1     | Chat core             | Real SSE chat, sessions, tool calls, attachments       | 3–4 days  | **Shipped** (2026-04-22) — T1.1–T1.7 all green; T1.5 attachments + T1.5b multimodal wire format land; T1.8 initial-connect retry + T1.9 react-virtuoso virtualisation both landed 2026-04-23. **No Phase 1 items remain deferred.** See `docs/phases/phase-1-chat.md`. |
| 2     | Config & Ops          | Models, Analytics, Logs, Settings, Profiles            | ~1 week   | **Shipped** (2026-04-22) — T2.1–T2.8 all green; profile tar.gz import/export + active-profile switching (incl. optional gateway bounce) both landed 2026-04-23. Per-profile gateway PID management explicitly out-of-scope (Hermes owns its own `gateway start/stop` CLI). **No Phase 2 items remain deferred.** |
| 3     | Platform channels     | 8 channels + gateway restart + WeChat QR               | ~1 week   | **Shipped** (2026-04-22) — T3.1–T3.5 all green. Real Tencent iLink client + explicit-clear-secret button + `/health/channels` probe deferred; see `docs/phases/phase-3-channels.md`. |
| 4     | Differentiators       | Multi-model compare, skill editor, trajectory, budgets, terminal | 1–2 weeks | **Shipped** (2026-04-22) — T4.1–T4.6 all green; T4.4b chat-send budget gate (80% warn / 100% block, period windowing, adapter scope) fleshed out 2026-04-23; T4.2b CodeMirror 6 landed in Skills 2026-04-23. Compare / Runbooks / Budgets / Trajectory / Terminal / Skills all land with e2e + Rust tests. T4.5b multi-tab Terminal landed 2026-04-23; T4.6b runbook scope filter was already shipped (verified 2026-04-23 — `runbooks-scope-filter` e2e green, `runbookScopeApplies()` helper in `src/features/runbooks/index.tsx`). No Phase 4 items remain deferred. See `docs/phases/phase-4-differentiators.md`. |
| 5     | Multi-agent console   | 2+ non-Hermes adapters running side-by-side            | ~1 week   | **Shipped** (2026-04-23) — T5.1–T5.6 all green. Trait polish + Claude Code/Aider mocks + conformance suite + AgentSwitcher (selection, capability-gated Sidebar, `adapter_id` chat routing) + unified inbox (DB v5, per-row adapter badges, Active/All-agents scope) + cross-adapter analytics + budget adapter-scope dropdown. Deferred: T5.2b/T5.3b real CLIs, T5.4 OpenHands. |
| 6     | Orchestration core    | Multi-Hermes + feedback loop + routing + per-agent sandbox + channel fixes + **Scheduler wrap** | ~2 weeks | **In progress** (2026-04-23 pm). **T6.7a shipped** — 3 silently-broken channel schemas fixed (WhatsApp/WeCom/WeiXin), WeChat QR stack deleted, Slack App Token added; 146 Rust tests pass, +2 new schema-lock tests. **T6.8 shipped** — Scheduler refactor: deleted Rust worker + SQLite table, now wraps `~/.hermes/cron/jobs.json`; added Runs drawer to surface `~/.hermes/cron/output/{job_id}/*.md`; 150 Rust tests pass, +4 new tests. **T6.1 shipped** — feedback loop: DB v8 + `db_message_set_feedback` IPC + 👍/👎 per assistant reply + Analytics card; 153 Rust tests pass, +3 new tests. **T6.2 shipped** — multi-instance Hermes: `hermes_instances.json` + 4 IPC commands + `AdapterRegistry` refactor (String keys, `register_with_id_and_label`, `unregister`) + Settings CRUD panel; 161 Rust tests pass, +8 new. **T6.4 shipped** — rules-based routing: `routing_rules.json` + 3 IPC commands + pure frontend resolver + Composer hint pill + Settings CRUD; 168 Rust tests (+7) and 37 Vitest (+10). Still planned: T6.3 surface Hermes native `delegate_task`, T6.4 routing, T6.5 sandbox, T6.7b/c Telegram e2e + Discord/Slack/CN. **T6.6 DROPPED**. See `docs/phases/phase-6-orchestration.md` + `docs/10-product-audit-2026-04-23.md`. |
| 7     | Agent expansion       | MCP manager UI + skill-from-chat + Memory page GUI + Skills hub wrapper | ~1.5 weeks | **Planned** (2026-04-23 pm, post-audit). T7.1 **MCP server manager** (replaces LangGraph adapter — Hermes already supports MCP), T7.2 skill-from-chat (writes to `~/.hermes/skills/`), T7.3 **Memory page** wrapping `MEMORY.md`/`USER.md`/`session_search` (no qdrant), T7.4 **Skills refactor** wrapping `hermes skills` CLI across 7+ hub sources. See `docs/phases/phase-7-expansion.md`. |
| 8     | Multimodal (optional) | Voice push-to-talk via cloud APIs + video-as-Hermes-backend-capability | 2–3 weeks | **Conditional** (2026-04-23). Gated on Phase 6/7 landing cleanly AND product staying on the Control Plane track. Voice = cloud ASR/TTS (OpenAI Realtime or Gemini Live), no local wake-word. Video = UI to Hermes backend capability only, no local ffmpeg. See `docs/phases/phase-8-optional.md`. |

Total ~11–12 weeks solo from Phase 0 through Phase 8, sequential (trimmed 2026-04-23 pm after the product audit reclassified large swathes of Phase 6/7 as SURFACE or DROP). Reclaimed ~3 weeks should go to polishing KEEP features, documentation, and user acquisition — not more features.

## Strategic positioning (reaffirmed 2026-04-23)

Corey stays on the **Control Plane** axis per `00-vision.md`. After a
brainstorm that surfaced 8 expansion directions (multi-agent,
routing, self-evolution, harness engineering, video, voice, digital
human, openclaw), we explicitly **reject** the following as
out-of-scope and not-to-be-revisited without a product-direction
pivot:

- **AI digital human / avatar** — conflicts with the developer-tool
  positioning; every major competitor in this space (HeyGen, D-ID,
  Character.ai) has 10× our team size and is purely consumer-facing.
  Belongs to a separate product, not Corey.
- **Self-rewriting prompts / meta-optimisation (4.3 from the original
  brainstorm)** — research-frontier territory (DSPy, TextGrad). Not a
  product feature yet.
- **Self-built task DAG framework (5.1 from the original brainstorm)** —
  LangGraph, CrewAI, AutoGen exist and are funded. We adapt one as an
  adapter in Phase 7, not reinvent.
- **Desktop-side video processing (6 from the original brainstorm)** —
  Tauri bundle blow-up from ffmpeg. Any video feature surfaces Hermes
  backend capability in the UI, never processes video locally.
- **Always-on voice wake word (7.1)** — trust/battery cost too high for
  a developer tool. Push-to-talk only in Phase 8 (if Phase 8 runs).

See `docs/06-backlog.md` § Will not do for rationale per item.

## Milestones

- **M0** (end of Phase 0): running desktop binary that opens the shell, shows a fake chat, has ⌘K working, passes CI.
- **M1** (end of Phase 1): can replace the Hermes TUI for everyday chat; usable by a non-dev.
- **M2** (end of Phase 3): feature-parity with `EKKOLearnAI/hermes-web-ui`.
- **M3** (end of Phase 4): at least one feature is best-in-class in the ecosystem; ready for public release.
- **M4** (end of Phase 5): "universal agent console" claim is defensible.

## Cross-cutting tracks (run throughout)

- **Design quality** — every merged PR touches ≥ 1 Storybook story; screenshots in review.
- **Performance** — a perf bench runs nightly; regressions > 10% block release.
- **Accessibility** — `axe` + manual keyboard pass for each feature before Phase completion.
- **i18n** — every string in the locale file from day 1; no hard-coded copy.
- **Docs** — each feature ships with a user-facing doc in `docs/user/`.

## Risk register

| Risk                                                 | Likelihood | Impact | Mitigation                                                |
|------------------------------------------------------|------------|--------|-----------------------------------------------------------|
| Hermes SSE extension fields change shape             | Med        | High   | Isolate in `adapters/hermes/gateway.rs`, recorded fixtures|
| CLI `--json` output changes across versions          | Med        | Med    | Pin min version, add version-gated parsers                |
| Tauri 2 updater signing complexity on Windows/macOS  | High       | Med    | Spike in Phase 0; document in `07-release.md`             |
| WeChat QR flow breaks (Tencent iLink)                | Med        | Low    | Behind a feature flag; graceful degrade                   |
| Bundle size creep                                    | High       | Low    | CI size budget; Rollup visualizer check on each PR        |

## Phase files

See `docs/phases/`:

- `phase-0-foundation.md`
- `phase-1-chat.md`
- `phase-2-config.md`
- `phase-3-channels.md`
- `phase-4-differentiators.md`
- `phase-5-multi-agent.md`
- `phase-6-orchestration.md`
- `phase-7-expansion.md`
- `phase-8-optional.md`

Each phase file contains: goals, task breakdown (with owner/effort), file-level outputs, acceptance criteria, test plan, demo script.
