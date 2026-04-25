# Phase A · 导航瘦身与首页优化

**Status**: 执行中

**Goal**: 降低用户认知负荷，提升首次体验转化率。侧边栏从 18 个入口精简到 ~10 个；首页从静态清单改为渐进式引导。

**Est.**: 2–3 天。

**Depends on**: Phase 0–7.5 全部完成。

---

## 退出标准

1. 侧边栏主区域 ≤ 10 个独立导航项，低频功能合并到 Settings 子页面或折叠分组。
2. 首页具备渐进式引导 — 用户明确知道"下一步该做什么"，且能在 30 秒内完成首次对话。
3. 所有现有功能可访问 — 没有任何页面被删除，只是被重新组织。
4. `pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm test:e2e` 全绿。
5. 中英文 i18n 同步更新。
6. 快捷键 `Cmd+1..9` 覆盖前 10 个导航项，其余通过 ⌘K 访问。

---

## 当前问题

### P1: 侧边栏 18 个入口过于臃肿

当前 `NAV` 数组 ([nav-config.ts](file:///Users/zbin/AI项目/CoreyOS/src/app/nav-config.ts)) 定义了 18 个导航项：

- **primary (5)**: Home, Chat, Compare, Skills, Trajectory
- **ops (13)**: Analytics, Logs, Terminal, Scheduler, Channels, Models, Agents, Profiles, Runbooks, Budgets, Memory, MCP, Settings

13 个 ops 项需要滚动才能看完，违背了"键盘优先"和"信息密度"原则。

### P2: 首页 Onboarding 缺渐进引导

当前 [Home 页面](file:///Users/zbin/AI项目/CoreyOS/src/features/home/index.tsx) 的问题：
- 5 个步骤同时展示，用户不知道先做哪个
- "通道"步骤 `done: false` 硬编码，永远无法自动完成 — UX 陷阱
- 缺少"30 秒内跑通第一次对话"的引导流

---

## 任务拆解

### A1 · 侧边栏精简 — 合并低频页面到 Settings 子路由

**~1.5 天**

**策略**：将低频管理类功能（Profiles、Runbooks、Budgets、Memory、MCP）合并为 Settings 页面的子路由，侧边栏只保留高频核心入口。

**精简后的侧边栏结构**：

```
primary:
  首页 /        (⌘0)
  对话 /chat    (⌘1)
  多模对比 /compare (⌘2)

ops:
  技能 /skills      (⌘3)
  轨迹 /trajectory   (⌘4)
  数据看板 /analytics (⌘5)
  终端 /terminal     (⌘6)
  平台通道 /channels  (⌘7)
  大模型 /models      (⌘8)
  Agents /agents      (⌘9)
  设置 /settings      (⌘,)
    → 子路由: 外观 / 网关 / 路由 / 调度器 / 预算 / 运行手册 / 记忆 / MCP / 配置集 / 沙箱
```

**合并规则**：
| 原入口 | 去向 | 理由 |
|---|---|---|
| Profiles | Settings → 配置集子路由 | 管理类操作，低频 |
| Runbooks | Settings → 运行手册子路由 | 编辑类操作，低频 |
| Budgets | Settings → 预算子路由 | 配置类操作，低频 |
| Memory | Settings → 记忆子路由 | 编辑类操作，低频 |
| MCP | Settings → MCP 子路由 | 配置类操作，低频 |
| Scheduler | Settings → 调度器子路由 | 配置类操作，低频 |
| Logs | 保留（高调试价值） | 开发者高频查看 |

**涉及文件**：
- `src/app/nav-config.ts` — 精简 NAV 数组
- `src/app/routes.tsx` — Settings 下新增子路由
- `src/app/shell/Sidebar.tsx` — 调整分组
- `src/features/settings/index.tsx` — 改造为带子路由的 Settings 容器
- `src/app/useNavShortcuts.ts` — 更新快捷键映射
- `src/locales/en.json` + `src/locales/zh.json` — 新增 Settings 子导航 i18n key
- `src/components/command-palette/Palette.tsx` — 确保合并的页面仍可通过 ⌘K 到达

**测试**：
- Playwright: 现有的 profiles/budgets/runbooks/memory/mcp/scheduler e2e spec 路径更新为新路由
- 手动验证: ⌘K 搜索仍能找到所有功能
- 手动验证: Settings 子页面导航正常

### A2 · 首页 Onboarding 重设计 — 渐进式引导

**~1 天**

**策略**：将静态 5 步清单改为渐进式引导流，聚焦"30 秒内跑通第一次对话"。

**新首页设计**：

```
┌─────────────────────────────────────┐
│          Corey Logo + 金色光晕        │
│        "欢迎来到 Corey"               │
│     "AI Agent 控制台"                │
│                                      │
│     ┌─── Gateway 状态芯片 ───┐       │
│     │  ● 在线 · 42ms        │       │
│     └────────────────────────┘       │
│                                      │
│  ┌─ 快速体验卡（首次用户可见）──────┐  │
│  │  "发送你的第一条消息"            │  │
│  │  [预填提示词建议卡片 x3]        │  │
│  │  → 点击直接跳转到 Chat          │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌─ 配置进度（渐进式）────────────┐  │
│  │  Step 1: ✅ 连接 Hermes         │  │
│  │  Step 2: ○  选择模型  ← 当前    │  │
│  │  Step 3: ○  第一次对话          │  │
│  │  Step 4: ○  个人资料            │  │
│  │  (通道步骤移除，不阻塞进度)      │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌─ HermesInstallCard ──────────┐   │
│  └───────────────────────────────┘   │
│  ┌─ PresetCard ─────────────────┐   │
│  └───────────────────────────────┘   │
│                                      │
│     GitHub README 链接               │
└─────────────────────────────────────┘
```

**关键变化**：
1. 移除"通道"步骤（`done: false` 硬编码的陷阱）
2. 添加"快速体验"卡片 — 3 个预填提示词建议，点击直接跳转 Chat 并填入
3. 渐进式进度 — 只高亮"下一步"，已完成的灰显带删除线，未完成的淡色
4. 全部完成后首页自动展示简洁的"就绪"状态

**涉及文件**：
- `src/features/home/index.tsx` — 重写 Onboarding 逻辑
- `src/locales/en.json` + `src/locales/zh.json` — 新增 i18n key

**测试**：
- 现有 `smoke.spec.ts` 中 home 相关测试更新
- 手动验证: 4/4 完成后显示"就绪"状态

### A3 · 导航分组与快捷键优化

**~0.5 天**

- 更新 `useNavShortcuts.ts` — ⌘0..9 映射到新的 10 个入口
- 更新 ⌘K 命令面板 — 确保合并到 Settings 的功能仍可通过搜索到达
- Sidebar 分组标签更新 — primary 改名为"核心"，ops 改名为"工具"

---

## 风险

| 风险 | 缓解 |
|---|---|
| 合并到 Settings 后功能可发现性下降 | ⌘K 搜索 + Settings 内侧边栏双重保障 |
| E2E 测试路径需批量更新 | 逐个 spec 修改，确保全部通过后再提交 |
| 用户习惯了旧导航 | 变更日志中说明调整原因和新路径 |

## 不做的事

- **不删除任何功能页面** — 只是重新组织导航层级
- **不改变 Settings 内部 UI** — 子页面复用现有组件
- **不做移动端适配** — 本次聚焦桌面侧边栏
