# Document Index

All documentation classified by type and last-verified date.

> Looking for a guided entry point instead of an inventory? See
> [`README.md`](./README.md).

## Types
- **plan**: Planning / scope / why — describes what we intend to build
- **current**: Current facts — describes the system as it actually is
- **changelog**: Change records — what was done, when

## Root Documents

| File | Type | Last Verified | Description |
|------|------|---------------|-------------|
| `00-vision.md` | plan | 2026-04-23 | Product vision and positioning |
| `01-architecture.md` | current | 2026-05-01 | System architecture overview + Pack Architecture (v2.0+) |
| `02-design-system.md` | current | 2026-04-23 | Design system tokens and patterns |
| `03-agent-adapter.md` | current | 2026-04-23 | Agent/adapter abstraction docs |
| `04-hermes-integration.md` | current | 2026-04-23 | Hermes gateway integration |
| `05-roadmap.md` | plan + current | 2026-04-30 | Roadmap with shipped status per phase + release history through v0.1.12 |
| `06-backlog.md` | plan | 2026-04-23 | Feature backlog |
| `06-testing.md` | current | 2026-04-23 | Testing strategy |
| `07-release.md` | current | 2026-04-23 | Release process |
| `08-sandbox.md` | current | 2026-04-23 | Sandbox isolation design |
| `09-conversational-scheduler.md` | plan | 2026-04-23 | Scheduler design doc |
| `10-product-audit-2026-04-23.md` | current | 2026-04-23 | Product audit snapshot |
| `current-feature-quality-review-2026-04-26.md` | current | 2026-04-26 | Code quality review |
| `bug-history.md` | current | 2026-05-01 | Archived bug fixes (split from global-todo v1) |
| `competitor-maiduo-ai.md` | current | 2026-04-30 | MaiduoX AI (eccang) competitive research + product implications |
| `customization-plan.md` | plan | 2026-04-29 | White-label / customer.yaml customization product plan |
| `global-todo.md` | plan + current | 2026-05-01 | v2.0 — locked product direction (custom-only) + base v3 TODO + Pack roadmap |
| `hermes-dependency-map.md` | current | 2026-04-29 | Hermes upstream dependency surface map |
| `hermes-reality-check-2026-04-23.md` | current | 2026-04-23 | Hermes integration reality check |
| `hermes-webui-analysis.md` | current | 2026-04-23 | EKKOLearnAI/hermes-web-ui competitive analysis |
| `icon-audit.md` | current | 2026-04-23 | Icon inventory |
| `licensing.md` / `licensing.zh.md` | plan | 2026-04-29 | Licensing strategy (en + zh) |
| `logo.md` | current | 2026-04-23 | Logo assets |
| `optimization-backlog.md` | plan + current | 2026-04-26 | Prioritized UX/platform improvements |
| `glossary.md` | current | 2026-04-26 | Terminology definitions |

## Plans (`plans/`)

Per-version implementation plans. Live until shipped, then linked from `05-roadmap.md` Release history.

| File | Target Version | Status |
|------|----------------|--------|
| `plans/v0.1.11-bge-m3-rag.md` | v0.1.11 | Shipped 2026-04-30 |
| `plans/v0.2.0-b4-analytics.md` | v0.2.0 | Planned |

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

## Agent Analysis (`agent/`)

| File | Type | Last Verified |
|------|------|---------------|
| `00-操作日志.md` | changelog | 2026-04-23 |
| `01-项目分析.md` | current | 2026-04-23 |
| `02-产品问题诊断.md` | current | 2026-04-23 |
| `03-优化计划.md` | plan | 2026-04-23 |
