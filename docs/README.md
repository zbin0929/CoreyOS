# CoreyOS 文档索引

> 产品：本地部署的 B2B 定制 AI 控制平面（Tauri 2 + React 18 + Rust）
> 面向读者：维护本项目的开发者 / 集成方 / 白标客户交付团队
> 面向终端用户的文档请看 [`user/`](./user/)

## 目录结构

```
docs/
├── spec/       规格 —— 描述"应该是什么"，很少改动
├── status/     现状 —— 描述"当下实际是什么"，每月校验
├── log/        日志 —— 只追加不修改
├── plans/      按版本的实施计划
├── user/       面向终端用户
└── archive/    历史快照（只读，不代表当下事实）
```

## 我想快速定位……

| 我要知道 | 看这里 |
|---|---|
| **现在处于什么版本、哪些功能可用** | [`status/CURRENT-STATE.md`](./status/CURRENT-STATE.md) |
| **当前应该做什么（P0/P1/P2）** | [`status/TODO.md`](./status/TODO.md) |
| **路线图和已发布历史** | [`status/roadmap.md`](./status/roadmap.md) |
| **已知问题 / 未修复 bug** | [`status/known-issues.md`](./status/known-issues.md) |
| **产品定位与愿景** | [`spec/vision.md`](./spec/vision.md) |
| **系统架构 + Pack 架构铁律** | [`spec/architecture.md`](./spec/architecture.md) |
| **设计系统 / 组件规范** | [`spec/design-system.md`](./spec/design-system.md) |
| **Agent 抽象层** | [`spec/agent-adapter.md`](./spec/agent-adapter.md) |
| **Hermes 集成方式** | [`spec/hermes-integration.md`](./spec/hermes-integration.md) |
| **Hermes 依赖面（上游升级前必看）** | [`status/hermes-deps.md`](./status/hermes-deps.md) |
| **Pack 开发指南** | [`spec/pack-development.md`](./spec/pack-development.md) |
| **沙箱隔离设计** | [`spec/sandbox.md`](./spec/sandbox.md) |
| **Licensing 策略** | [`spec/licensing.md`](./spec/licensing.md) |
| **测试策略** | [`spec/testing.md`](./spec/testing.md) |
| **发布流程** | [`spec/release.md`](./spec/release.md) |
| **术语表** | [`spec/glossary.md`](./spec/glossary.md) |
| **工作流相对 Hermes 的定位** | [`spec/workflow-positioning.md`](./spec/workflow-positioning.md) |
| **Hermes 自动压缩上下文策略** | [`spec/auto-compress.md`](./spec/auto-compress.md) |
| **Memory 后端决策** | [`spec/memory-strategy.md`](./spec/memory-strategy.md) |
| **会话存储边界决策** | [`spec/session-storage.md`](./spec/session-storage.md) |
| **MCP 工具步骤测试** | [`spec/testing-mcp-tool-step.md`](./spec/testing-mcp-tool-step.md) |
| **历代 AI 代理操作日志** | [`log/operations.md`](./log/operations.md) |
| **按版本的实施计划** | [`plans/`](./plans/) |
| **历史快照（审计 / phase 归档 / 旧方案）** | [`archive/`](./archive/) |

## 写新文档时的决策树

```
你要写的内容描述：
├─ "未来应该怎样设计"         → spec/
├─ "当下系统是什么状态"       → status/
├─ "某年某日做了某事"         → log/
├─ "v0.x.y 版本的实施清单"    → plans/
├─ "给终端用户看的操作指南"   → user/
└─ "一次性审计 / 已完成的计划 / 历史分析" → archive/
```

## 硬规则（防止再乱）

1. **根目录只允许本文件**。任何新 markdown 进子目录。
2. **archive/ 只进不出**。归档后不再修改内容，只追加归档原因。
3. **spec/ 每 180 天至少校验一次**，过期由下一个接触者校验或归档。
4. **status/ 每 30 天至少校验一次**，过期视作不可信。
5. **一个主题只有一个文档**。发现重复立刻合并。
6. **以数字前缀命名的文档不再新增**，按主题命名（如 `vision.md`、`architecture.md`）。

## 整理历史

- **2026-05-09**：docs 大整理。根目录从 33 个 .md 缩到 1 个；建立 spec/status/log/archive 四分法；17 个 phase 文档、15+ 审计 / 旧方案类文档全部归档；删除冗余的 `document-index.md`。详见 [`archive/README.md`](./archive/README.md)。
