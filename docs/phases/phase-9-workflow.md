# Phase 9 · Workflow Engine

**Goal**: 让用户能定义多步骤、多 Agent 协同的自动化工作流。支持顺序执行、并行执行、条件分支、循环迭代、人工审批。通过可视化拖拽编辑器或 YAML 文件定义工作流，引擎负责解析依赖、调度步骤、传递上下文。

**Est.**: ~3 weeks solo.

**Depends on**: Phase 6（多 Instance、Routing Rules）、Phase 7（Skills、Memory）、Phase 7.5（LlmProfile、AgentWizard）全部完成。

**Product direction pivot**: 此前 `06-backlog.md` 将 "Self-built task-DAG framework" 标记为 "Will not do"，理由是 LangGraph/CrewAI 已有成熟方案。2026-04-25 重新评估：这些框架都是 Python 库，需要写代码；CoreyOS 作为桌面 GUI 应用，面向的是**非技术用户**（企业运营、内容创作者），他们需要的是**可视化编排**而非 SDK。Dify（100k+ Stars）的成功证明了这个方向的商业价值。CoreyOS 的差异化在于：**桌面原生 + 多 Agent Instance + 已有 RAG/Skills/Scheduler 基础设施**。

## Positioning

CoreyOS 从 "多 Agent 控制面板" 升级为 "AI 工作流自动化平台"。用户不需要写代码，通过拖拽节点就能编排复杂的 AI 自动化流程。每个企业都可以根据自己的业务流程定制工作流。

对标产品：
- **Dify**（100k+ Stars）：Python+React，可视化 DAG 编辑器，40+ 节点类型，SaaS 部署
- **n8n**（75k+ Stars）：TypeScript，通用工作流自动化，已加 AI 节点
- **CrewAI**（30k+ Stars）：Python，角色驱动多 Agent 协作，Sequential/Hierarchical 两种模式
- **Mastra**（20k+ Stars）：TypeScript，`.then()/.branch()/.parallel()/.suspend()` 链式 API

CoreyOS 的差异化：
- **桌面原生**（Tauri 2），不是 Web SaaS，数据在本地
- **已有 Agent 基础**：Hermes Instance、Routing Rules、Skills、Scheduler 全部就绪
- **Rust 执行引擎**：比 Python 框架快、省资源
- **中文优先**：国产 LLM 原生支持（Phase 7.5 已有 6 个国产模板）

## Exit criteria

1. 用户可以通过 YAML 文件定义工作流（6 种节点类型：agent / tool / parallel / branch / loop / approval）
2. 引擎能解析步骤依赖图，按拓扑序调度执行，步骤间通过 `{{step.output}}` 传递数据
3. 前端有工作流列表页，展示已定义的工作流、支持新建/编辑/删除/手动触发
4. 前端有可视化流程编辑器（React Flow），支持拖拽节点、连线、编辑节点属性
5. 工作流执行有实时状态展示（每个步骤的 running/done/error 状态）
6. 定时任务（Scheduler）可以绑定工作流（Trigger type: cron）
7. 人工审批节点能暂停执行，通过系统通知提醒用户，用户确认后继续
8. 所有面向用户的文案有中英文 i18n

## Task breakdown

### T9.1 — 工作流数据模型 + YAML 定义 · ~2 days

工作流的持久化格式。参考 Dify DSL + Mastra API 设计。

#### 文件存储

```
~/.hermes/workflows/
  ├── ai-comic-pipeline.yaml     # 每个工作流一个 YAML 文件
  ├── daily-news-digest.yaml
  └── content-review.yaml

~/.hermes/workflow-runs/         # 执行记录（SQLite）
  # 由 Rust 引擎写入 DB，不在文件系统
```

#### 数据模型

```rust
// ─── 工作流定义 ───

struct WorkflowDef {
    id: String,              // URL-safe slug
    name: String,            // 显示名称
    description: String,     // 描述
    version: u32,            // 版本号

    trigger: WorkflowTrigger,
    inputs: Vec<WorkflowInput>,

    steps: Vec<WorkflowStep>,
}

enum WorkflowTrigger {
    Manual,                              // 手动触发
    Cron { expression: String },         // 定时触发
    Webhook { path: String },            // Webhook 触发（Phase 2）
}

struct WorkflowInput {
    name: String,            // 变量名
    label: String,           // 显示名
    input_type: InputType,   // string | number | enum | boolean
    default: Option<String>,
    required: bool,
    options: Option<Vec<String>>,  // enum 类型的选项
}

// ─── 步骤定义 ───

struct WorkflowStep {
    id: String,              // 步骤唯一 ID
    name: String,            // 显示名称
    step_type: StepType,     // 节点类型

    // 依赖关系
    after: Vec<String>,      // 前序步骤 ID 列表

    // agent 类型专用
    agent_id: Option<String>,      // 绑定哪个 Hermes Instance
    prompt: Option<String>,        // Prompt 模板
    skills: Option<Vec<String>>,   // 加载哪些技能
    model: Option<String>,         // 覆盖模型

    // tool 类型专用
    tool_name: Option<String>,     // IPC 工具名
    tool_args: Option<serde_json::Value>,  // 工具参数模板

    // parallel 类型专用
    branches: Option<Vec<WorkflowStep>>,   // 并行分支

    // branch 类型专用
    conditions: Option<Vec<BranchCondition>>,  // 条件分支

    // loop 类型专用
    max_iterations: Option<u32>,           // 最大循环次数
    body: Option<Vec<WorkflowStep>>,       // 循环体步骤
    exit_condition: Option<String>,        // 退出条件表达式

    // approval 类型专用
    timeout_minutes: Option<u32>,          // 超时时间（分钟）
    approval_message: Option<String>,      // 审批提示

    // 输出
    output_format: Option<OutputFormat>,   // text | json | markdown
}

enum StepType {
    Agent,       // 调用 Agent Instance
    Tool,        // 直接调用 IPC 工具
    Parallel,    // 并行执行多个分支
    Branch,      // 条件分支
    Loop,        // 循环
    Approval,    // 人工审批
}

struct BranchCondition {
    expression: String,      // 条件表达式，如 "review.approved == true"
    goto: String,            // 跳转到的步骤 ID
}

enum OutputFormat {
    Text,
    Json,       // 尝试解析为 JSON
    Markdown,
}
```

#### YAML 示例

```yaml
# ~/.hermes/workflows/ai-comic-pipeline.yaml
id: ai-comic-pipeline
name: AI漫剧自动制作
description: 搜索热门视频 → 分析爆款规律 → 并行创作 → 人工审核 → 制作发布
version: 1

trigger:
  type: manual

inputs:
  - name: topic
    label: 主题关键词
    type: string
    default: "搞笑短剧"
    required: true
  - name: platform
    label: 目标平台
    type: enum
    options: [tiktok, youtube, douyin]
    default: tiktok

steps:
  - id: search
    name: 搜索热门视频
    type: agent
    agent_id: hermes-default
    prompt: |
      搜索 {{platform}} 上关于「{{topic}}」的热门短视频，
      找到播放量最高的5个，提取标题、文案、点赞数。
    output_format: json

  - id: analyze
    name: 分析爆款规律
    type: agent
    after: [search]
    agent_id: hermes-default
    prompt: |
      基于以下热门视频数据，分析爆款规律：
      {{search.output}}
    output_format: json

  - id: create
    name: 并行创作
    type: parallel
    after: [analyze]
    branches:
      - id: script
        name: 写脚本
        type: agent
        agent_id: hermes-default
        prompt: "根据分析结果写短剧脚本：{{analyze.output}}"
      - id: storyboard
        name: 生成分镜
        type: agent
        agent_id: hermes-default
        prompt: "根据分析结果生成分镜描述：{{analyze.output}}"

  - id: review
    name: 人工审核
    type: approval
    after: [create]
    timeout_minutes: 1440
    approval_message: |
      脚本：{{script.output}}
      分镜：{{storyboard.output}}
      请审核以上内容。

  - id: route
    name: 路由
    type: branch
    after: [review]
    conditions:
      - expression: "review.approved == true"
        goto: produce
      - expression: "review.approved == false"
        goto: revise

  - id: revise
    name: 修改内容
    type: loop
    max_iterations: 3
    body:
      - id: fix_script
        name: 修改脚本
        type: agent
        agent_id: hermes-default
        prompt: "根据审核反馈修改脚本：{{review.feedback}}"
    exit_condition: "fix_script.score >= 8"
    after_done: review

  - id: produce
    name: 制作视频
    type: agent
    after: [route]
    agent_id: hermes-default
    prompt: |
      基于审核通过的脚本和分镜制作视频。
      脚本：{{script.output}}
      分镜：{{storyboard.output}}
```

#### 交付物

- `src-tauri/src/workflow/model.rs` — 数据模型 + serde 序列化
- `src-tauri/src/workflow/parser.rs` — YAML 解析 + 校验（依赖环检测、ID 唯一性、类型字段完整性）
- `src-tauri/src/workflow/store.rs` — 文件系统 CRUD（list / get / save / delete）
- 10+ Rust 单元测试

---

### T9.2 — 执行引擎 · ~3 days

工作流运行时的核心调度逻辑。参考 Dify DAG 执行模型 + Mastra XState 状态机。

#### 执行模型

```
                    ┌──────────┐
                    │ Engine   │
                    │ 调度核心  │
                    └────┬─────┘
                         │
            ┌────────────┼────────────┐
            ↓            ↓            ↓
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ Context   │ │ Planner  │ │ Executor │
      │ 全局上下文 │ │ 依赖解析  │ │ 步骤执行  │
      └──────────┘ └──────────┘ └──────────┘
```

**Context（全局上下文）**：
```rust
struct RunContext {
    workflow_id: String,
    run_id: String,
    inputs: serde_json::Value,       // 用户输入的参数
    step_outputs: HashMap<String, serde_json::Value>,  // 各步骤的输出
    status: RunStatus,
}
```

**Planner（依赖解析）**：
- 构建 DAG，拓扑排序
- 找出当前可执行的步骤（所有 after 依赖已完成）
- 支持 parallel 分支同时启动

**Executor（步骤执行）**：
- `agent` 类型：调用 Hermes Instance 的 chat API，注入渲染后的 prompt
- `tool` 类型：直接调用 IPC 函数
- `parallel` 类型：同时启动所有分支，等所有完成
- `branch` 类型：评估条件表达式，走对应路径
- `loop` 类型：重复执行 body，检查退出条件
- `approval` 类型：暂停执行，标记状态等待外部信号

#### 执行记录（SQLite）

```sql
CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,          -- UUID
    workflow_id TEXT NOT NULL,    -- 工作流 ID
    status TEXT NOT NULL,         -- pending | running | paused | completed | failed | cancelled
    inputs TEXT,                  -- JSON，用户输入的参数
    trigger_type TEXT,            -- manual | cron | webhook
    started_at INTEGER,
    completed_at INTEGER,
    error_message TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflow_defs(id)
);

CREATE TABLE workflow_step_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,        -- 对应 WorkflowStep.id
    status TEXT NOT NULL,         -- pending | running | completed | failed | skipped
    input TEXT,                   -- JSON，渲染后的输入
    output TEXT,                  -- JSON，步骤输出
    error_message TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id)
);
```

#### 模板引擎

变量引用语法：`{{expression}}`

支持的引用：
- `{{inputs.topic}}` — 用户输入参数
- `{{search.output}}` — 步骤的完整输出
- `{{search.output.videos[0].title}}` — 步骤输出的特定字段
- `{{review.approved}}` — approval 步骤的审批结果
- `{{review.feedback}}` — approval 步骤的用户反馈

渲染逻辑：
```rust
fn render_template(template: &str, ctx: &RunContext) -> String {
    // 用 serde_json::Value 做 path lookup
    // 找不到的变量替换为空字符串（不报错）
}
```

#### 交付物

- `src-tauri/src/workflow/engine.rs` — 执行引擎主逻辑
- `src-tauri/src/workflow/context.rs` — RunContext + 模板渲染
- `src-tauri/src/workflow/planner.rs` — DAG 构建 + 拓扑排序 + 可执行步骤计算
- `src-tauri/src/workflow/executor.rs` — 各 StepType 的执行逻辑
- `src-tauri/src/workflow/db.rs` — SQLite 执行记录读写
- 15+ Rust 单元测试（DAG 解析、模板渲染、并行调度、条件分支）

---

### T9.3 — IPC 命令 · ~1 day

前端调用的 Tauri IPC 接口。

```rust
// 工作流 CRUD
workflow_list() -> Vec<WorkflowSummary>
workflow_get(id: String) -> WorkflowDef
workflow_save(def: WorkflowDef) -> WorkflowDef       // 新建或更新
workflow_delete(id: String) -> ()
workflow_validate(def: WorkflowDef) -> ValidationResult

// 执行控制
workflow_run(id: String, inputs: Value) -> RunInfo      // 手动触发
workflow_cancel(run_id: String) -> ()                    // 取消执行
workflow_approve(run_id: String, step_id: String, approved: bool, feedback: Option<String>) -> ()  // 审批

// 执行记录
workflow_run_list(workflow_id: String, limit: u32) -> Vec<RunSummary>
workflow_run_get(run_id: String) -> RunDetail            // 含每个步骤的状态
```

#### 交付物

- `src-tauri/src/ipc/workflow.rs` — 上述 IPC 命令实现
- `src-tauri/src/lib.rs` — 注册新命令
- `src/lib/ipc.ts` — 前端 IPC 类型定义

---

### T9.4 — 前端工作流列表页 · ~2 days

侧边栏新增 "工作流" 入口，列表页展示所有工作流。

#### 页面结构

```
/workflows
  ├── 列表视图
  │   ├── 卡片：名称、描述、步骤数、上次运行时间、状态
  │   ├── 操作：编辑、删除、立即运行、启用/禁用
  │   └── 新建按钮 → 空白模板 / 从模板市场选
  │
  └── 运行历史抽屉
      ├── 工作流维度的运行列表
      └── 每次运行的步骤状态时间线
```

#### 新建/编辑弹窗（MVP，非可视化）

Phase 1 先用表单编辑，不依赖可视化编辑器：
- 基本信息：名称、描述
- 触发方式：手动 / 定时（cron 表达式）
- 输入参数：动态列表，每项有 name/label/type/default
- 步骤列表：每步可配置类型、Agent、Prompt、依赖关系
- 保存时调用 `workflow_validate` 校验

#### 交付物

- `src/features/workflow/index.tsx` — 列表页
- `src/features/workflow/WorkflowCard.tsx` — 卡片组件
- `src/features/workflow/WorkflowForm.tsx` — 新建/编辑表单
- `src/features/workflow/RunHistory.tsx` — 运行历史抽屉
- `src/locales/zh.json` + `en.json` — i18n keys

---

### T9.5 — 可视化流程编辑器 · ~3 days

基于 React Flow 的拖拽节点编辑器。参考 Dify 的 Canvas 设计。

#### 技术选型

- **@xyflow/react**（React Flow v12）：MIT 协议，成熟稳定，Dify 也用它
- 节点 = WorkflowStep，边 = after 依赖关系

#### 节点类型

每种 StepType 对应不同的节点外观：

| 类型 | 颜色 | 图标 | 特殊 UI |
|------|------|------|---------|
| agent | 蓝色 | 🤖 | Agent 选择器 + Prompt 编辑器 |
| tool | 绿色 | 🔧 | 工具选择器 + 参数表单 |
| parallel | 紫色 | ⚡ | 内嵌子节点（分支） |
| branch | 橙色 | 🔀 | 条件表达式编辑 |
| loop | 黄色 | 🔄 | 最大次数 + 退出条件 |
| approval | 红色 | ✋ | 超时 + 审批提示 |

#### 交互

- 左侧面板：节点类型工具栏，拖拽到画布
- 画布：节点连线（从 source handle 拖到 target handle）
- 右侧面板：选中节点的属性编辑器
- 工具栏：保存、校验、运行、撤销/重做
- 变量引用：输入 `{{` 时弹出自动补全（列出所有上游步骤的输出）

#### 数据同步

```
React Flow nodes/edges ←→ WorkflowDef.steps/after
```

编辑器维护 React Flow 状态，保存时转换为 WorkflowDef 格式。
加载时将 WorkflowDef 转换为 React Flow nodes/edges。

#### 交付物

- `src/features/workflow/Editor.tsx` — 编辑器主组件
- `src/features/workflow/nodes/` — 各类型节点组件
- `src/features/workflow/PropertyPanel.tsx` — 属性编辑面板
- `src/features/workflow/useFlowSync.ts` — Flow ↔ WorkflowDef 双向转换 hook

---

### T9.6 — 执行状态实时展示 · ~2 days

工作流运行时，实时展示每个步骤的状态。

#### 运行视图

```
┌─────────────────────────────────────────────┐
│  运行中: AI漫剧自动制作 #12                   │
│  开始时间: 2026-04-25 10:30:00               │
├─────────────────────────────────────────────┤
│                                             │
│  ✅ search (搜索热门视频)      0:05 完成     │
│  ✅ analyze (分析爆款规律)     0:12 完成     │
│  🔄 create (并行创作)          进行中...     │
│    ├─ 🔄 script (写脚本)       进行中...     │
│    └─ ⏳ storyboard (生成分镜) 等待中        │
│  ⏳ review (人工审核)           等待中        │
│  ⏳ route (路由)               等待中        │
│  ⏳ produce (制作视频)          等待中        │
│                                             │
├─────────────────────────────────────────────┤
│  [取消执行]                    [查看日志]     │
└─────────────────────────────────────────────┘
```

#### 实时更新方案

- 方案 A：前端轮询 `workflow_run_get`（每 2 秒），简单可靠
- 方案 B：Tauri 事件系统（`app.emit("workflow-step-update", payload)`），实时性更好

Phase 1 先用方案 A，后续优化到方案 B。

#### 人工审批交互

当执行到 approval 节点时：
1. 运行状态变为 `paused`
2. 系统通知弹出（macOS Notification Center / Windows Toast）
3. 用户在运行视图中看到审批面板：显示审批内容 + 通过/拒绝按钮 + 可选反馈文本
4. 点击通过 → 调用 `workflow_approve` → 引擎恢复执行

#### 交付物

- `src/features/workflow/RunView.tsx` — 运行状态页面
- `src/features/workflow/ApprovalPanel.tsx` — 审批交互组件
- Rust 端审批通知逻辑

---

### T9.7 — Scheduler 集成 · ~1 day

让定时任务能绑定工作流。

#### 变更

1. `HermesJob` 新增可选字段：
```rust
pub workflow_id: Option<String>,      // 绑定的工作流
pub workflow_inputs: Option<serde_json::Value>,  // 工作流输入参数
```

2. 当 `workflow_id` 有值时，Cron 触发不再发送 prompt 给 Hermes，而是调用 `workflow_run(workflow_id, inputs)`

3. Scheduler 页面新增"绑定工作流"选项

#### 交付物

- `src-tauri/src/hermes_cron.rs` — 新增字段
- `src-tauri/src/ipc/scheduler.rs` — upsert 逻辑适配
- `src/features/scheduler/index.tsx` — UI 新增工作流绑定

---

### T9.8 — 预置模板 · ~1 day

提供常用工作流模板，降低用户上手门槛。

#### 模板列表

| 模板 | 步骤 | 说明 |
|------|------|------|
| AI漫剧制作 | 搜索→分析→并行创作→审批→发布 | 搜索热门视频，分析后自动制作 |
| 每日新闻摘要 | 搜索→摘要→发送 | 定时搜索新闻生成摘要 |
| 代码审查流水线 | 拉取代码→审查→报告 | PR 提交后自动审查 |
| 内容翻译发布 | 翻译→校对→发布 | 多语言内容分发 |
| 数据分析报告 | 查询→分析→可视化→报告 | 定期生成数据报告 |

#### 交付

- `src-tauri/src/workflow/templates.rs` — 内置模板定义
- 前端新建时可选"从模板创建"

---

## 文件结构总览

```
# Rust 后端
src-tauri/src/
  workflow/
    mod.rs              # 模块入口
    model.rs            # 数据模型 (WorkflowDef, WorkflowStep, RunInfo...)
    parser.rs           # YAML 解析 + 校验
    store.rs            # 文件系统 CRUD
    engine.rs           # 执行引擎主逻辑
    context.rs          # RunContext + 模板渲染
    planner.rs          # DAG 构建 + 拓扑排序
    executor.rs         # 各 StepType 执行器
    db.rs               # SQLite 执行记录
    templates.rs        # 预置模板
  ipc/
    workflow.rs         # Tauri IPC 命令

# React 前端
src/
  features/
    workflow/
      index.tsx             # 列表页
      Editor.tsx            # 可视化编辑器
      RunView.tsx           # 运行状态页
      WorkflowCard.tsx      # 卡片组件
      WorkflowForm.tsx      # 表单编辑器（MVP）
      PropertyPanel.tsx     # 属性编辑面板
      ApprovalPanel.tsx     # 审批交互
      RunHistory.tsx        # 运行历史
      useFlowSync.ts        # Flow ↔ YAML 同步
      nodes/
        AgentNode.tsx
        ToolNode.tsx
        ParallelNode.tsx
        BranchNode.tsx
        LoopNode.tsx
        ApprovalNode.tsx
  lib/
    ipc.ts                 # 新增 workflow 相关类型和 invoke
```

## 实施顺序

```
T9.1 数据模型 + YAML     ──┐
                           ├── Phase 1（MVP，~1 week）
T9.2 执行引擎            ──┤
                           │
T9.3 IPC 命令             ──┤
                           │
T9.4 前端列表页           ──┘
                                    ↓
T9.5 可视化编辑器        ──┐
                           ├── Phase 2（~1.5 weeks）
T9.6 执行状态展示        ──┤
                           │
T9.7 Scheduler 集成       ──┘
                                    ↓
T9.8 预置模板             ──── Phase 3（~0.5 week）
```

## 和现有系统的集成

| 现有能力 | 集成方式 |
|----------|---------|
| **Hermes Instance** | Step type: agent 通过 `agent_id` 绑定 Instance |
| **Skills（技能）** | Agent 节点可选加载 Skill（`skills` 字段） |
| **Scheduler（定时任务）** | Cron Job 的 `workflow_id` 字段触发工作流 |
| **Routing Rules** | Branch 节点可复用路由规则引擎 |
| **IPC Functions** | Tool 节点直接调用 IPC（如 `knowledgeSearch`） |
| **RAG / 知识库** | Agent 节点的 Prompt 中可注入知识检索结果 |
| **LlmProfile** | Agent 节点可选覆盖模型 |
| **Sandbox** | Agent 节点继承 Instance 的沙箱范围 |

## 参考

- Dify Workflow DSL: https://docs.dify.ai/guides/workflow
- Mastra Workflow API: https://mastra.ai/docs/workflows
- CrewAI Process: https://docs.crewai.com/concepts/processes
- LangGraph StateGraph: https://docs.langchain.com/oss/python/langchain/multi-agent
- Google ADK Agent Types: https://google.github.io/adk-docs/agents/
- React Flow: https://reactflow.dev/
