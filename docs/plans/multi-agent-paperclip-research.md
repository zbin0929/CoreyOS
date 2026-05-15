# Paperclip + Hermes Agent 多 Agent 编排调研

> 创建日期：2026-05-16
> 来源：https://github.com/NousResearch/hermes-paperclip-adapter
> 许可证：MIT
> 关联：CoreyOS 多 Agent 路线（企业定制扩展）

## 一句话总结

Paperclip 是一个 AI Agent 编排平台，以"虚拟公司"模型管理多个 Agent。`hermes-paperclip-adapter` 让 Hermes Agent 可以作为 Paperclip 公司的"员工"被调度执行任务，支持 session 持久化、skills 双源合并、结构化输出解析。

## Paperclip 核心概念

| 概念 | 说明 | 对应 CoreyOS |
|------|------|-------------|
| **Company（公司）** | 一个客户/项目，隔离的 Agent 组织 | 一个企业定制客户 |
| **Employee（员工）** | 一个 Agent 实例，有角色和专业技能 | 一个客户专属 Agent |
| **Issue（工单）** | 分配给 Agent 的任务 | Workflow step / Cron job |
| **Heartbeat（心跳）** | 定时调度 Agent 执行 | CoreyOS cron（`jobs.json`）|
| **Comment Wake** | Issue 评论触发 Agent 响应 | Chat 触发 |
| **Org Chart（组织架构）** | Agent 间的层级和协作关系 | 多 Agent 协作（未来） |

## Adapter 架构

```
Paperclip                          Hermes Agent
┌──────────────────┐               ┌──────────────────┐
│ Heartbeat        │               │                  │
│ Scheduler        │──execute()──▶ │ hermes chat -q   │
│                  │               │                  │
│ Issue System     │               │ 30+ Tools        │
│ Comment Wakes    │◀──results─────│ Memory System    │
│                  │               │ Session DB       │
│ Cost Tracking    │               │ Skills           │
│                  │               │ MCP Client       │
│ Skill Sync       │◀──snapshot────│ ~/.hermes/skills │
│ Org Chart        │               │                  │
└──────────────────┘               └──────────────────┘
```

Adapter 执行流程：
1. Paperclip 心跳触发 → `execute()` → spawn `hermes chat -q`
2. 捕获 stdout/stderr，解析 token 用量、session ID、成本
3. 解析原始输出为结构化 `TranscriptEntry`（工具卡片 + 状态图标）
4. 后处理 Hermes ASCII 格式（banner、表格边框）为 GFM markdown
5. 重分类 benign stderr（MCP init 等），避免显示为错误
6. 通过 `--resume` 实现 session 跨 heartbeat 持久化

## 关键设计模式（值得 CoreyOS 借鉴）

### 1. Skills 双源合并

```
Paperclip-managed skills  ──┐
                             ├──▶ 统一 snapshot ──▶ UI 展示
Hermes-native skills (~/.hermes/skills/) ──┘
```

- Paperclip 管理的 skills：可从 UI 开关
- Hermes 原生 skills：`~/.hermes/skills/` 只读，始终加载
- `listSkills` / `syncSkills` API 暴露统一视图

**CoreyOS 对应**：CoreyOS 的 Pack 系统（`skill-packs/*/skills/`）+ Hermes 原生 skills 的关系与此一致。

### 2. Session Codec（会话编解码器）

跨 heartbeat 的 session 状态校验和迁移：
- 结构化验证 session state
- 版本迁移（格式变更时自动升级）
- Session source tagging（标记为 `tool` source，不混入用户交互历史）

**CoreyOS 对应**：多客户 Agent 需要严格隔离 session，每个客户的对话历史、记忆、工作流状态不能混在一起。

### 3. Prompt Template 变量

```javascript
{{agentId}}      // Agent ID
{{agentName}}    // Agent 显示名
{{companyId}}    // 公司/客户 ID
{{taskBody}}     // 任务指令
{{wakeReason}}   // 触发原因
{{#taskId}}...{{/taskId}}  // 条件包含
```

**CoreyOS 对应**：CoreyOS workflow 的 step prompt 可以借鉴这种模板变量系统，让 Pack 开发者更灵活地组合任务指令。

### 4. Benign Stderr 重分类

Hermes Agent 的 MCP init 消息、structured logs 等非错误输出被重分类，不在 UI 中显示为错误。

**CoreyOS 对应**：CoreyOS 的 chat UI 和 task 详情页可以参考，区分真正的错误和正常的状态日志。

### 5. 8 推理提供商

Anthropic、OpenRouter、OpenAI、Nous、OpenAI Codex、ZAI、Kimi Coding、MiniMax —— 自动从 `~/.hermes/config.yaml` 读取模型配置。

**CoreyOS 对应**：CoreyOS 已经读取 Hermes 的 config.yaml，多 Agent 场景下可以为不同客户配置不同模型。

## CoreyOS 多 Agent 路线思考

### 问题：单 Agent 记忆混乱

当前 CoreyOS 只有一个 Hermes Agent 实例，所有客户共享：
- `MEMORY.md` — 混合了所有客户的操作记忆
- `USER.md` — 用户偏好不区分场景
- Session history — 所有对话混在一起
- Skills — 所有 Pack 的 skills 都加载

当企业定制客户增多，单 Agent 会：
1. **记忆串台**：A 客户的操作经验影响 B 客户的决策
2. **Skills 冲突**：不同客户的 Pack 可能有不兼容的 skills
3. **上下文污染**：一个客户的敏感数据可能出现在另一个客户的 session 中
4. **调度混乱**：所有客户的 cron job 在同一个 Agent 实例上竞争

### 方案：每个客户一个专属 Agent

```
CoreyOS
├── Agent: 美正（meizheng-agent）
│   ├── Memory: ~/.hermes/agents/meizheng/MEMORY.md
│   ├── Skills: meizheng Pack + 通用 skills
│   ├── Sessions: 美正专属对话历史
│   ├── Config: 美正专用模型、API keys
│   └── Cron: 美正专属定时任务
│
├── Agent: 客户B（clientb-agent）
│   ├── Memory: ~/.hermes/agents/clientb/MEMORY.md
│   ├── Skills: clientb Pack + 通用 skills
│   ├── Sessions: 客户B专属对话历史
│   └── ...
│
└── Agent: 通用助手（default）
    ├── Memory: ~/.hermes/MEMORY.md（现有）
    ├── Skills: 所有已安装 skills
    └── ...
```

### 关键隔离维度

| 维度 | 当前（单 Agent）| 多 Agent |
|------|-----------------|----------|
| Memory | 共享 `MEMORY.md` | 每客户独立 |
| Skills | 全部加载 | 按客户加载 |
| Sessions | 混合 | 按客户隔离 |
| Config | 全局 `config.yaml` | 每客户可覆盖 |
| Cron | 全局 `jobs.json` | 按客户分组 |
| MCP | 全局 MCP servers | 按客户配置 |

### 实现路径

1. **Phase 1 — 文件系统隔离**：`~/.hermes/agents/<id>/` 目录结构，每个 Agent 有独立的 MEMORY.md、config override
2. **Phase 2 — Gateway 多实例**：每个 Agent 启动独立 Gateway 进程（不同端口）
3. **Phase 3 — Agent 管理界面**：CoreyOS 前端新增 Agent 管理页，创建/配置/监控
4. **Phase 4 — Agent 间协作**：参考 Paperclip Org Chart，实现 Agent 间任务委派

### 与 Paperclip 的差异

| | Paperclip | CoreyOS 多 Agent（规划）|
|---|-----------|------------------------|
| Agent 运行方式 | `hermes chat -q`（单次执行）| Gateway 常驻（持续服务）|
| 编排方式 | 云端 Paperclip 服务器 | 本地 CoreyOS App |
| Agent 通信 | Issue/Comment 系统 | IPC + Chat UI |
| 适用场景 | 开发团队 Agent 协作 | 企业客户 Agent 隔离 |
| 部署模式 | SaaS | 本地桌面 App |

## 相关链接

- hermes-paperclip-adapter：https://github.com/NousResearch/hermes-paperclip-adapter
- Paperclip 平台：https://paperclip.ing/
- Hermes Agent：https://github.com/NousResearch/hermes-agent
- Nous Research：https://nousresearch.com/
