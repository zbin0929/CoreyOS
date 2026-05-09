# Archive · 历史快照

> ⚠️ 本目录所有文档都是**历史快照**，不代表当下事实，仅作追溯和考古使用。
> 不要根据这里的内容做决策。当下事实请看 [`../status/`](../status/)。
> 不要修改这里的文件内容（可以追加归档说明，但不改正文）。

## 为什么归档

2026-05-09 做了一次 docs 大整理。根目录当时有 33 个 markdown 文件，其中 10+ 个已经在 `document-index.md` 被标为 "archive" 但物理上没有搬走，造成：
- 新人无法区分哪个文档是"当下可信的"
- 同一个主题（如 Hermes 集成、产品审计、TODO 清单）散落多份彼此不一致
- 单个文件上百 KB（`customization-plan.md` 98 KB）仍躺在主视线里

本次整理的规则见 [`../README.md`](../README.md) 顶部"硬规则"。

## 目录映射

### `audits/` — 一次性审计快照

| 文件 | 归档原因 |
|---|---|
| `10-product-audit-2026-04-23.md` | 2026-04-23 产品快照，时效过期 |
| `current-feature-quality-review-2026-04-26.md` | 2026-04-26 代码质量审计，所列整改项已完成 |
| `hermes-reality-check-2026-04-23.md` | Hermes 集成问题已在 Phase 6 修复 |
| `hermes-webui-analysis.md` | hermes-web-ui 竞品分析，产品方向已明确后不再参考 |
| `hermes-v0.12-impact-analysis.md` | 版本特定影响分析，新版本会让它过期 |
| `icon-audit.md` | 图标清查，问题已解决 |

### `phases/` — 历代 phase 实施计划（全部已 shipped）

Phase 0 → E + C4 共 17 个文件。已发布情况见 `../status/roadmap.md` 的发布历史。

### `agent-analysis/` — 一次性 AI 代理分析

| 文件 | 归档原因 |
|---|---|
| `01-项目分析.md` | v0.2.0 之前的项目快照 |
| `02-产品问题诊断.md` | 问题已在 Phase A-E 处理 |
| `03-优化计划.md` | 已在 Phase A-E 执行 |

### 根下文件 — 已完成或被新文档取代

| 文件 | 归档原因 |
|---|---|
| `06-backlog.md` | 旧功能 backlog，已被 `status/TODO.md` 取代 |
| `09-conversational-scheduler.md` | 调度器设计文档，实现已并入 Phase 6 |
| `competitor-maiduo-ai.md` | 麦豆 AI 竞品调研，结论已吸收 |
| `customization-plan.md` | 白标方案，已实装为 Pack 架构，见 `spec/architecture.md` |
| `licensing-en.md` | Licensing 英文版，与中文版 `spec/licensing.md` 内容重复且受众极少 |
| `logo.md` | Logo 设计快照 |
| `optimization-backlog.md` | 优化 backlog，全部整改项已完成 |
| `talk-mode-plan.md` | Talk Mode 实施计划，已在 v0.2.4+ 落地 |
| `ui-revamp-v1.md` | UI 改造 v1 执行文档，对应改动已落地 |

## 如果你要从这里捞东西

可以。但要警惕：
- 事实陈述可能已过期（版本号、功能列表、统计数字）
- 决策和原因通常仍有参考价值
- 如果你发现某份归档内容对今天仍有指导意义，应当把其核心提炼到 `spec/` 或 `status/`，而不是复活这里的文件
