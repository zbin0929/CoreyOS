# Document Index

All documentation classified by type and last-verified date.

> Last full audit: **2026-05-02**.
> Looking for a guided entry point instead of an inventory? See
> [`README.md`](./README.md).

## Types
- **plan**: Planning / scope / why — describes what we intend to build
- **current**: Current facts — describes the system as it actually is
- **changelog**: Change records — what was done, when

## Root Documents

| File | Type | Last Verified | Description |
|------|------|---------------|-------------|
| `00-vision.md` | plan | 2026-05-02 | Product vision and positioning |
| `01-architecture.md` | current | 2026-05-01 | System architecture overview + Pack Architecture (v2.0+) |
| `02-design-system.md` | current | 2026-04-23 | Design system tokens and patterns |
| `03-agent-adapter.md` | current | 2026-04-23 | Agent/adapter abstraction docs |
| `04-hermes-integration.md` | current | 2026-04-23 | Hermes gateway integration |
| `05-roadmap.md` | plan + current | 2026-05-02 | Roadmap with shipped status per phase + release history through v0.2.2 |
| `06-backlog.md` | archive | 2026-04-23 | Feature backlog (pre-v0.2.0, largely superseded by global-todo.md) |
| `06-testing.md` | current | 2026-04-23 | Testing strategy |
| `07-release.md` | current | 2026-04-23 | Release process |
| `08-sandbox.md` | current | 2026-04-23 | Sandbox isolation design |
| `09-conversational-scheduler.md` | archive | 2026-04-23 | Scheduler design doc (shipped, merged into Phase 6) |
| `10-product-audit-2026-04-23.md` | archive | 2026-04-23 | Product audit snapshot (historical) |
| `current-feature-quality-review-2026-04-26.md` | archive | 2026-04-26 | Code quality review (actions completed) |
| `bug-history.md` | current | 2026-05-01 | Archived bug fixes |
| `competitor-maiduo-ai.md` | archive | 2026-04-30 | MaiduoX AI competitive research (findings absorbed into global-todo.md) |
| `customization-plan.md` | archive | 2026-04-29 | White-label plan (implemented in v0.2.0, see 01-architecture.md) |
| `global-todo.md` | plan + current | 2026-05-02 | v2.0 locked product direction + base v3 TODO + Pack roadmap |
| `hermes-dependency-map.md` | current | 2026-04-29 | Hermes upstream dependency surface map |
| `hermes-reality-check-2026-04-23.md` | archive | 2026-04-23 | Hermes integration reality check (issues fixed in Phase 6) |
| `hermes-v0.12-impact-analysis.md` | current | 2026-05-01 | Hermes v0.12 upgrade impact analysis |
| `hermes-webui-analysis.md` | archive | 2026-04-23 | hermes-web-ui competitive analysis (historical) |
| `icon-audit.md` | archive | 2026-04-23 | Icon inventory (issues resolved) |
| `licensing.md` / `licensing.zh.md` | current | 2026-04-29 | Licensing strategy (en + zh) |
| `logo.md` | archive | 2026-04-23 | Logo assets |
| `optimization-backlog.md` | archive | 2026-04-26 | UX improvements (actions completed in post-Phase-12 refactoring) |
| `glossary.md` | current | 2026-04-26 | Terminology definitions |
| `uninstall-guide.md` | current | 2026-05-01 | Uninstall instructions (Windows + macOS) |
| `ui-revamp-v1.md` | plan | 2026-05-02 | UI 全盘改造执行文档（v1） |

## Plans (`plans/`)

Per-version implementation plans. Live until shipped, then linked from `05-roadmap.md` Release history.

| File | Target Version | Status |
|------|----------------|--------|
| `plans/v0.1.11-bge-m3-rag.md` | v0.1.11 | Shipped 2026-04-30 |
| `plans/v0.2.0-b4-analytics.md` | v0.2.0 | Shipped 2026-05-01 |

## Phase Documents (`phases/`)

All phase documents are **plan** type — they describe what was planned for each phase.
The `05-roadmap.md` file tracks which phases have shipped.

| File | Phase | Status |
|------|-------|--------|
| `phase-0-foundation.md` | 0 | Shipped |
| `phase-1-chat.md` | 1 | Shipped |
| `phase-2-config.md` | 2 | Shipped |
| `phase-3-channels.md` | 3 | Shipped |
| `phase-4-differentiators.md` | 4 | Shipped |
| `phase-5-multi-agent.md` | 5 | Shipped |
| `phase-6-orchestration.md` | 6 | Shipped |
| `phase-7-expansion.md` | 7 | Shipped |
| `phase-7.5-multi-agent.md` | 7.5 | Shipped |
| `phase-8-optional.md` | 8 | Shipped |
| `phase-9-workflow.md` | 9 | Shipped |
| `phase-a-nav-home.md` | A | Shipped |
| `phase-c-quality.md` | C | Shipped |
| `phase-d-polish.md` | D | Shipped |
| `phase-e-learning.md` | E | Shipped |
| `c4-ipc-type-safety.md` | — | Shipped |

## Change Records

| File | Type | Description |
|------|------|-------------|
| `CHANGELOG.md` | changelog | Dated log of shipped milestones |

## Agent Analysis (`agent/`) — historical AI analysis notes

| File | Type | Last Verified | Notes |
|------|------|---------------|-------|
| `00-操作日志.md` | archive | 2026-04-25 | Rolling journal of AI agent operations |
| `01-项目分析.md` | archive | 2026-04-25 | Project analysis snapshot (pre-v0.2.0) |
| `02-产品问题诊断.md` | archive | 2026-04-25 | Product diagnosis (issues largely addressed) |
| `03-优化计划.md` | archive | 2026-04-25 | Optimization plan (executed in Phase A-E) |
| `auto-compress.md` | current | 2026-04-27 | Hermes auto-compress context strategy |
| `memory-strategy.md` | current | 2026-04-27 | Memory backend decision (holographic) |
| `session-storage.md` | current | 2026-04-28 | Session storage boundary decision |
| `workflow-positioning.md` | current | 2026-04-27 | Workflow vs Hermes positioning decision |
