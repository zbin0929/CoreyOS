# Session 存储职责边界

**日期**：2026-04-28
**状态**：DECIDED — 三份独立存储，互不同步
**适用**：所有未来动 chat history / workflow run history / hermes session 相关代码的人

---

## TL;DR

Corey + Hermes 一共维护 **3 份不同维度的会话相关数据**。它们故意保持独立，**不同步**。这是设计选择，不是技术债——明白这点能省 1-2 周的"统一存储"重构。

| 谁存 | 存哪 | 存什么 | 谁读 |
|---|---|---|---|
| **Corey** | `<app_data>/caduceus.db` （SQLite）| chat sessions / messages / tool_calls / attachments / feedback / workflow_runs / workflow_step_runs | Corey UI |
| **Hermes** | `~/.hermes/state.db` （SQLite + FTS5）| agent loop trajectory / 内部 session metadata / messages（带全文索引）| Hermes agent loop |
| **Hermes legacy** | `~/.hermes/sessions/*.jsonl` （文件）| per-session transcript（兼容老版本 Hermes 的工具）| Hermes legacy compatibility |

---

## 三份各自的职责

### 1. Corey 的 caduceus.db

**目的**：Corey UI 需要的所有数据。
**特征**：Corey 自己设计的 schema，有 `sessions` / `messages` / `tool_calls` / `attachments` / `feedback` 等表，全是为了**渲染 UI** + **导出报告** + **analytics 统计**。

例：
- 会话列表左边栏 — 读 `sessions` 表
- chat 气泡 — 读 `messages` 表
- 附件预览 — 读 `attachments` 表 + 文件系统
- 用户对消息按 👍/👎 — 写 `messages.feedback`
- analytics 统计「本月用了多少 token」 — 聚合 `messages.usage`
- 工作流历史页 — 读 `workflow_runs` + `workflow_step_runs`

**特点**：
- **同步写**：每条 chat 消息发出去 / 收到都立刻 INSERT
- **删除友好**：用户在 Corey UI 删一条会话 → DELETE 这条
- **schema 由 Corey 控制**：Hermes 升级不影响

### 2. Hermes 的 state.db

**目的**：Hermes agent loop 内部用的 session 持久化。
**特征**：Hermes v0.10 引入的 SQLite 后端（之前是纯文件），含 `sessions` / `messages` / `messages_fts*` 表，schema **属于 Hermes**——升级 Hermes 时可能改。

例：
- agent reasoning chain 的 checkpoint
- 跨 channel 的 session 路由（`session_<id>` 关联到 telegram chat / slack thread / etc.）
- Hermes TUI / CLI 自己的 session 列表
- Hermes 内置的全文搜索（`/search` 命令、FTS5 倒排索引）

**特点**：
- **Hermes 写，Corey 不写**
- **schema 私有**——Corey 跨进程读 SQLite 文件没问题，但读它就把命运绑在 Hermes schema 稳定上
- v0.11 起 **startup 自动 prune 老 session + VACUUM**

### 3. Hermes 的 sessions/*.jsonl 文件

**目的**：兼容 Hermes 老版本和外部工具。
**特征**：每个 session 一个 JSONL 文件，纯文本，Hermes 双写到这里 + state.db。

例：
- 老版本 Hermes / 第三方 wrapper（OpenClaw / Mojito 等）只读 JSONL
- Hermes 自己的 session export 工具
- 调试时人手 grep 单个 session 的文本

**特点**：
- **会无限累积**——v0.11 起 startup auto-prune 介入，但仍可能堆积
- **Corey 不写、不读**，但**提供清理面板**（`Settings → Memory → Hermes 历史会话`，30 天阈值的安全清理）

---

## 为什么不统一成一份

历史选择回顾。这两条路各有重要缺陷：

### 选项 A：Corey 全用 Hermes 的 state.db（不再自存）

- ✅ 真正单源
- ❌ Corey 命运绑死 Hermes schema：Hermes 一升级 schema → Corey 立刻坏（OpenClaw 事故剧本）
- ❌ Corey 自加的字段（feedback / tool_call 关联 / attachment 元数据）没地方放
- ❌ FTS5 跨进程读小心 shadow table 可见性，不可避免引入怪 bug

工作量：**1-2 周**，且引入永久维护负担（每次 hermes minor 升级都要测）。

### 选项 B：让 Hermes 写 Corey 的 caduceus.db

- ❌ 不可能且不该做：Corey 是 Hermes 的下游 GUI 之一，不能让上游依赖下游 schema

### 选项 C：双向同步

- ❌ 每次写要双写 → 性能、一致性问题
- ❌ schema 不对齐时映射逻辑爆炸

### 选项 D（采用）：保留三份 + 明确边界 + 清理面板

- ✅ Corey schema 自由演进
- ✅ Hermes 升级不影响 Corey UI
- ✅ 用户感知到的痛点（"删除不干净"、"磁盘累积"）通过 `Settings → Memory → Hermes 历史会话` 面板解决
- ❌ 三份冗余（**用户不可见**——每个 session ~20-100 KB，半年累计百 MB 量级）

---

## 用户操作的语义

明确"用户操作哪份"避免下次有人困惑：

| 用户动作 | 触碰哪份 |
|---|---|
| 在 Corey 左侧 Sessions 列表删一条会话 | 仅 caduceus.db |
| 通过 Workflow History 页删 run | caduceus.db (`workflow_runs` + `workflow_step_runs`) |
| `Settings → Memory → 一键清理 30 天前会话` | 仅 sessions/*.jsonl（保留 sessions.json 索引） |
| 重置 Corey 数据库（删 caduceus.db） | 仅 Corey 这份；Hermes 那两份不动 |
| `hermes /clear` / `hermes session reset` | Hermes 自己的（state.db + sessions/*.jsonl）；Corey 不动 |
| 用户手工 `rm ~/.hermes/state.db` | Hermes 自己的；Corey 还有自己的会话历史 |

---

## 何时考虑改这个决定

明确决策**不做**的前提是 OpenClaw 风险 > 三份冗余成本。两个事件会让这个权衡反转，到时候再讨论：

1. **Hermes 长期保证 schema 稳定**（出现像 SQL standard 一样的兼容承诺）→ 选项 A 风险变小
2. **磁盘冗余成为真问题**：sessions/ 多到吃 GB 级 + 用户复诉
   - 但 v0.11 起 Hermes 自己 startup auto-prune，所以这个事件触发不太可能

---

## 相关代码入口

| 模块 | 文件 |
|---|---|
| Corey 写自己的 sessions/messages | `@/Users/zbin/AI项目/CoreyOS/src-tauri/src/db/{sessions.rs,messages.rs}` |
| Corey 写自己的 workflow runs | `@/Users/zbin/AI项目/CoreyOS/src-tauri/src/db/workflows.rs` |
| Hermes session 占用扫 + 清理 | `@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/hermes_memory.rs:355-503` |
| Memory section UI | `@/Users/zbin/AI项目/CoreyOS/src/features/settings/sections/MemorySection.tsx` |
| Hermes state.db schema 探测（如果未来要做） | _未实现_ |
