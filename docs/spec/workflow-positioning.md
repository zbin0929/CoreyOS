# Workflow 定位决策（v9 audit）

**日期**：2026-04-27  
**状态**：DECIDED — 走"运营自动化 niche"路线  
**适用**：所有未来动 `src-tauri/src/workflow/` 或 `src/features/workflow/` 的人

---

## TL;DR

**Workflow 不是另一种 chat，是给"运营/自动化用户"的可重复任务引擎**。

它和 Hermes 的关系不是替代，是**互补**：

- Hermes：自适应 / 对话式 / agent loop（覆盖日常 80% 场景）
- Workflow：schema-lock / cron / approval / audit（覆盖 20% 高确定性场景）

如果一个新需求两边都能做，**默认走 Hermes**。Workflow 只在以下任一情形启用：

1. 需要**严格可重复**（每次输出格式必须一致，例如对账、合规检查）
2. 需要**人工审批**（approval step 暂停等用户点确认）
3. 需要**事后审计**（每步的 input/output/duration 全部留痕）
4. 需要**非技术用户用 GUI 配置**（运营同事不会写 markdown skill）

---

## 调研依据

### Hermes 已经覆盖什么

| 能力 | Hermes 实现 |
|---|---|
| 多步任务（"先 A 再 B 再 C"） | LLM 自己 plan + agent loop 调 tool |
| Cron 触发 | `hermes scheduler` 自带 |
| 调外部工具 | Hermes tools + MCP |
| 技能模板 | 25 个内置 skills + 用户自定义 markdown |
| Channels（Telegram/Slack 触发） | 内置 |
| 历史 / 上下文记忆 | sessions + memory |

### Hermes 做不到的（workflow 真正补的洞）

| 缺口 | Hermes 为什么做不到 |
|---|---|
| Schema-locked 输出 | LLM 是概率性的，每次输出格式可能略不同 |
| 审计追溯 | session/trajectory 是对话流，不是"step run with metadata" |
| 人工审批门 | Hermes 没有 native pause-for-user-action 概念 |
| 显式 DAG（branch/parallel/loop） | Hermes agent loop 是模型驱动，不是硬编码图 |
| GUI 可视化编辑 | Hermes skill 是 markdown，对小白用户不友好 |

### 当前 6 个 demo workflow 的问题

`~/.hermes/workflows/` 里的 6 个 demo（ups-tracking、daily-news-digest、douyin-hot-videos、competitor-price-monitor、code-review-pipeline、ai-comic-pipeline）**全部都在 Hermes 能做的 80% 那边**。

这是**错的卖点**——它让 workflow 看起来像是"另一种 chat"，反而模糊了它的真正 niche。

---

## 决策

### 保留

- 整套 `WorkflowDef` schema（id/name/description/version/trigger/inputs/steps）
- 7 个 step types：agent / tool / browser / parallel / branch / loop / approval
  - 4 个高级 type（parallel/branch/loop/approval）**冻结但不删**：
    - **不删的理由**：删了未来真要用还得重写；现在留着不影响任何流程
    - **冻结的标志**：在 `WorkflowStep::step_type` 的注释里标 `// advanced — ops use only`
- store / engine / executor / GUI editor / GenerateDialog
- cron 触发
- 所有 IPC 命令

### 即将删的（小清理，下一次 commit）

- `workflow_extract_intent` IPC 里硬编码 6 个 demo workflow id 的关键词匹配（`ups-tracking` / `daily-news-digest` / 等）—— 这是 dead code，新 workflow 接不上来；意图识别留给 LLM 做
- 5/6 demo workflow yaml（保留 1 个真有 schema-lock + approval 价值的）

### 即将做的（v10 之前）

- 重写 demo workflows，让它们真正展示 schema-lock + approval + audit 价值
  - 候选：合规审批流、SLA 监控告警、月度对账、API key 轮换
- workflow `/workflow` 路由首屏的描述文案：从泛泛的"自动化任务"改成明确的"可审计的运营流程"

### 不做的（避免过度工程）

- 不去补 branch/parallel/loop/approval 的 e2e 测试（没真用户用之前没意义）
- 不去重写节点编辑器（够用即可）
- 不去做"workflow vs skill 自动转换"（两个机制定位不同，不该混）

---

## 给后续维护者

1. 见到任何"workflow 是不是和 Hermes 重叠"的讨论，先翻这个文档。
2. 见到要往 workflow 加新 step type 的 PR，先问"非 Hermes 路径下用户为什么会选这个？"如果答不上来，**默认拒**。
3. 见到 demo 又写一个"chain of agent calls"的 yaml，**默认拒**——那是 Hermes skill 的活。
4. 想推一个新需求到 workflow，先问"它要 schema-lock / approval / audit / GUI-edit 中的哪个？"一个都答不上 → 走 Hermes。

---

## 衍生 todo（不阻塞当前迭代）

- [ ] 删 `workflow_extract_intent` 的硬编码关键词分支，改用 jaccard 通用匹配（如果留这个 IPC 的话）或干脆删除整个 IPC（让 LLM 在 chat 中通过工具调用触发）
- [ ] 砍 6 个 demo workflow → 1 个有真价值的
- [ ] `/workflow` 路由首屏文案改写
- [ ] WorkflowStep 注释标 advanced types
