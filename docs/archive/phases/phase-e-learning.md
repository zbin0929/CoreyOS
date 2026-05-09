# Phase E · Agent 自我学习与进化

**Status**: ✅ Shipped

**Goal**: 让 Agent 从对话中学习，积累知识，优化行为。四阶段递进。

---

## 架构概览

```
用户对话 ──→ chat stream ──→ onDone
                               │
                ┌──────────────┤
                ▼              ▼
          P0: 自动摘要     P1: Feedback 信号
          → MEMORY.md     → LEARNINGS.md
                                │
                ┌───────────────┤
                ▼               ▼
          P2: 语义检索       P3: 自动 Skill 生成
          → embedding 索引   → skills/*.md
                                │
                                ▼
                          P4: 自适应进化
                          → routing/prompt/工具优化
```

## 现有基础设施

| 组件 | 文件 | 状态 |
|---|---|---|
| Memory 编辑器 | `src/features/memory/` | ✅ 可用 |
| MEMORY.md / USER.md | `~/.hermes/` | ✅ Hermes 注入 system prompt |
| Feedback (👍👎) | SQLite `messages.feedback` | ✅ 采集 + 存储 |
| Skill 系统 | `~/.hermes/skills/*.md` | ✅ CRUD + 版本历史 |
| SQLite DB | `state.db` | ✅ 所有对话持久化 |
| Chat Stream | `gateway.rs` → `ChatStreamEvent` | ✅ SSE 流式 |

## 任务

### P0: 对话摘要 → Memory 自动写入

**原理**: 每轮对话完成后，自动提取值得记住的信息追加到 `MEMORY.md`。

**子任务**:
- E-P0-1: Rust 端新增 `learning` 模块 — `learn_from_conversation` IPC
- E-P0-2: 前端 chat `onDone` 后异步触发学习
- E-P0-3: Memory 页面显示"自动学习"条目标记（区分手动 vs 自动）
- E-P0-4: 去重逻辑 — 不重复写入已有知识

**关键设计**:
- 学习判断：不是每轮都写。通过 prompt 让 LLM 判断"这轮是否包含值得记住的信息"
- 写入格式：`## [auto] YYYY-MM-DD` 分节，每条 `- bullet point`
- 去重：对比 MEMORY.md 已有内容，新内容与已有条目 Jaccard 相似度 > 0.7 则跳过
- 限制：每次最多写入 3 条，单条不超过 100 字

### P1: Feedback → 学习信号

**原理**: 👍👎 不只是统计，而是学习信号。

**子任务**:
- E-P1-1: Rust 端新增 `LEARNINGS.md` 读写 — `learning_read/write` IPC
- E-P1-2: Feedback 触发学习提取 — 👍 提取"好的模式"，👎 提取"避免模式"
- E-P1-3: LEARNINGS.md 注入 system prompt（需 Hermes 配合，先预留）
- E-P1-4: 前端 Memory 页面新增 "Learnings" tab

**关键设计**:
- `LEARNINGS.md` 格式：
  ```markdown
  ## preferred (👍 patterns)
  - 当用户问架构问题时，先画图再给代码
  ## avoided (👎 patterns)
  - 不要在没有确认的情况下删除文件
  ```
- 每个 pattern 带来源 session_id + 时间戳
- 定期精简：超过 50 条时自动合并相似条目

### P2: 历史对话语义检索

**原理**: 新对话开始时，从历史中检索相似场景注入上下文。

**子任务**:
- E-P2-1: SQLite 新增 `embeddings` 表 — 存储 message embedding
- E-P2-2: Rust 端 embedding 计算接口 — 调用本地/远程 embedding 模型
- E-P2-3: 新对话启动时 top-k 检索 — 注入 system prompt
- E-P2-4: 前端显示"参考了 N 条历史对话"提示

**关键设计**:
- embedding 模型：优先用 Hermes gateway 的 `/v1/embeddings`，fallback 到 TF-IDF
- 检索时机：仅用户消息入库时计算 embedding（增量）
- 检索范围：top-5 相关历史片段，总 token 不超过 500

### P3: 自动 Skill 生成

**原理**: Agent 发现自己反复执行某个任务时，自动生成可复用 Skill。

**子任务**:
- E-P3-1: Rust 端"模式检测"— 识别重复的任务模式（N≥3 次相似请求）
- E-P3-2: 自动生成 Skill markdown — 提取输入/步骤/输出
- E-P3-3: 前端 Skill 页面显示"AI 生成"标记 + 确认/编辑流程
- E-P3-4: 定期回顾 — 清理低使用率自动 Skill

### P4: 自适应进化

**原理**: Agent 基于学习信号自动调整行为规则。

**子任务**:
- E-P4-1: 自适应 Routing — 观察模型切换模式，建议 routing rules
- E-P4-2: Prompt 自优化 — 定期精简 MEMORY.md 和 LEARNINGS.md
- E-P4-3: 工具使用优化 — 追踪工具调用成功率，调整策略

---

## 风险

| 风险 | 缓解 |
|---|---|
| 学习内容质量低 | 每次最多 3 条，单条 ≤100 字，用户可编辑 |
| MEMORY.md 膨胀 | 256KB 硬上限 + 定期精简 |
| P2 embedding 成本 | 优先本地模型，远程 API 仅 fallback |
| P3 生成无用 Skill | 需 N≥3 次重复 + 用户确认 |
| P4 行为漂移 | 所有变更需用户确认，可回滚 |
