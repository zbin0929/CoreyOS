# 05 · Roadmap

## At a glance

| Phase | Title                 | Exit criteria                                          | Est.      | Status |
|------:|-----------------------|--------------------------------------------------------|-----------|--------|
| 0     | Foundation            | App shell + palette + Hermes stub adapter + CI green   | 1–2 days  | **Core shipped** (2026-04-21), 7/10 exit criteria |
| 0.5   | Hardening             | CI matrix + lint/format/test gates + Windows sandbox fix + nav shortcuts | 1–2 days | **Shipped** (2026-04-21); Playwright e2e (52 specs) + Storybook 8 scaffolding added 2026-04-23. See CHANGELOG. |
| 1     | Chat core             | Real SSE chat, sessions, tool calls, attachments       | 3–4 days  | **Shipped** (2026-04-22) — T1.1–T1.7 all green; T1.5 attachments + T1.5b multimodal wire format land; T1.8 initial-connect retry + T1.9 react-virtuoso virtualisation both landed 2026-04-23. **No Phase 1 items remain deferred.** See `docs/phases/phase-1-chat.md`. |
| 2     | Config & Ops          | Models, Analytics, Logs, Settings, Profiles            | ~1 week   | **Shipped** (2026-04-22) — T2.1–T2.8 all green; tar.gz import/export + per-profile gateway control deferred to Phase 3 (see `docs/phases/phase-2-config.md`) |
| 3     | Platform channels     | 8 channels + gateway restart + WeChat QR               | ~1 week   | **Shipped** (2026-04-22) — T3.1–T3.5 all green. Real Tencent iLink client + explicit-clear-secret button + `/health/channels` probe deferred; see `docs/phases/phase-3-channels.md`. |
| 4     | Differentiators       | Multi-model compare, skill editor, trajectory, budgets, terminal | 1–2 weeks | **Shipped** (2026-04-22) — T4.1–T4.6 all green; T4.4b chat-send budget gate (80% warn / 100% block, period windowing, adapter scope) fleshed out 2026-04-23; T4.2b CodeMirror 6 landed in Skills 2026-04-23. Compare / Runbooks / Budgets / Trajectory / Terminal / Skills all land with e2e + Rust tests. T4.5b multi-tab Terminal landed 2026-04-23; T4.6b runbook scope filter was already shipped (verified 2026-04-23 — `runbooks-scope-filter` e2e green, `runbookScopeApplies()` helper in `src/features/runbooks/index.tsx`). No Phase 4 items remain deferred. See `docs/phases/phase-4-differentiators.md`. |
| 5     | Multi-agent console   | 2+ non-Hermes adapters running side-by-side            | ~1 week   | **Shipped** (2026-04-23) — T5.1–T5.6 all green. Trait polish + Claude Code/Aider mocks + conformance suite + AgentSwitcher (selection, capability-gated Sidebar, `adapter_id` chat routing) + unified inbox (DB v5, per-row adapter badges, Active/All-agents scope) + cross-adapter analytics + budget adapter-scope dropdown. Deferred: T5.2b/T5.3b real CLIs, T5.4 OpenHands. |

Total ~6 weeks solo, sequential. Phases 2/3 can parallelize if 2 devs.

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

Each phase file contains: goals, task breakdown (with owner/effort), file-level outputs, acceptance criteria, test plan, demo script.
