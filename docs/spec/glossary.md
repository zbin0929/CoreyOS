# CoreyOS Terminology

Canonical definitions for all domain concepts. UI text must use the **Display Name** column.
Code identifiers use the **Code Name** column.

| Concept | Display Name (EN) | Display Name (ZH) | Code Name | Definition |
|---------|-------------------|-------------------|-----------|------------|
| Agent | Agent | Agent | `Agent`, `HermesInstance` | A registered Hermes instance that routes chats through a specific base URL + model. Each agent = one `~/.hermes/hermes_instances.json` entry. Appears in the top-bar AgentSwitcher. |
| Profile | LLM Profile | LLM 配置文件 | `LlmProfile` | A reusable model configuration (model name + API key + base URL). Stored in `~/.hermes/llm_profiles.json`. Agents reference profiles via `llm_profile_id`. |
| Adapter | Adapter | 适配器 | `Adapter` | The runtime abstraction that implements `chat_send`/`chat_stream`. Hermes is the primary adapter; Aider and Claude Code are mock adapters. Each agent maps to one adapter instance. |
| Workflow | Workflow | 工作流 | `WorkflowDef`, `WorkflowRun` | A multi-step DAG definition (steps + edges). Stored as YAML in `~/.hermes/workflows/`. A **run** is a single execution instance. |
| Step | Step | 步骤 | `WorkflowStep` | A single node in a workflow DAG. Types: agent, tool, browser, parallel, branch, loop, approval. |
| Skill | Skill | 技能 | `Skill` | A Markdown file in `~/.hermes/skills/` that defines a reusable prompt template. Injected into the system prompt when activated. |
| Memory | Memory | 记忆 | `MemoryFile` | The agent's running notes (`MEMORY.md`) and user profile (`USER.md`). Hermes injects these into every system prompt. |
| Knowledge | Knowledge | 知识库 | `KnowledgeBase` | A collection of files indexed by Hermes for RAG retrieval. Stored under `~/.hermes/knowledge/`. |
| Routing Rule | Routing Rule | 路由规则 | `RoutingRule` | A pattern-match rule that redirects specific user inputs to a target adapter. Stored in `~/.hermes/routing_rules.json`. |
| Scheduler | Scheduler | 定时任务 | `CronJob` | A cron-based schedule that triggers workflows or chats. Stored in `~/.hermes/cron/jobs.json`. |
| Sandbox Scope | Sandbox Scope | 沙箱作用域 | `SandboxScope` | An isolation boundary for file system access. Agents are assigned to scopes; file operations are restricted to scope roots. |
| Runbook | Runbook | 操作手册 | `Runbook` | A structured procedure document. Saved as a skill template that the agent follows step-by-step. |
| Budget | Budget | 预算 | `Budget` | A spending limit (period + amount) scoped to an adapter or model. Warns at 80%, blocks at 100%. |
| Session | Session | 会话 | `Session` | A single chat conversation. Persisted in SQLite. Groups messages, attachments, and adapter context. |
| Attachment | Attachment | 附件 | `Attachment`, `StagedAttachment` | A file attached to a chat message. Staged to disk, then referenced by path in the message DTO. |
| Channel | Channel | 渠道 | `Channel` | An external messaging integration (Telegram, Slack, WeChat, etc.). Configured in `~/.hermes/config.yaml`. |
| MCP Server | MCP Server | MCP 服务器 | `McpServer` | A Model Context Protocol server that provides tools/resources to the agent. Configured in `~/.hermes/config.yaml`. |

## Relationship Map

```
Agent ──references──→ LLM Profile
Agent ──assigned──→ Sandbox Scope
Agent ──has──→ Adapter (runtime)
Workflow ──contains──→ Steps
Step (agent type) ──uses──→ Agent
Step (browser type) ──uses──→ Browser LLM Config
Routing Rule ──targets──→ Adapter
Scheduler ──triggers──→ Workflow
Session ──belongs to──→ Adapter
Session ──contains──→ Messages + Attachments
```

## Naming Rules

1. **UI always uses Display Name** — never show code names like `HermesInstance` to users
2. **"Agent" = Hermes Instance** — in the UI, "Agent" always means a registered Hermes instance
3. **"Profile" = LLM configuration** — not the same as "Adapter" or "Agent"
4. **"Workflow" = the definition** — a "Run" is an execution of a Workflow
5. **Consistent casing** — capitalize concept names in UI headers, lowercase in body text
