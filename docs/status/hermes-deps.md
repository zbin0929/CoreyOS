# Hermes Agent 依赖地图

> 版本：v5.0 · 2026-05-12
> 当前 Hermes 最低支持版本：0.10
> Hermes 最新版本：**0.13.0（2026-05-07）— "The Tenacity Release"**
> Hermes 官方文档：https://hermes-agent.nousresearch.com/docs/
> Hermes GitHub：https://github.com/NousResearch/hermes-agent
> 用途：Hermes 每次更新时，对照此文档快速定位影响范围
> 核对基准：2026-05-12 基于 Hermes 0.13.0 源码（`~/.hermes/hermes-agent/`）逐模块核对，含 `/v1/runs` 迁移落地后的真实端到端依赖
> 关键决策：**永不 patch Hermes 源码**（2026-05-11 拍板）。原 4 个 `patch_*` 函数全部 retire，改用 SOUL.md marker-delimited 注入 + corey-guards 物理拦截层 + `/v1/runs` 原生事件流。

---

## 1. CLI 命令调用

CoreyOS 通过子进程调用的 Hermes CLI 命令。**Hermes CLI 输出格式变更 = Corey 前端显示异常。**

| CLI 命令 | 调用位置 | 用途 | 风险 |
|---------|---------|------|------|
| `hermes skills browse` | `ipc/skill_hub.rs` | 浏览 Skill Hub | 输出格式变更 → 前端渲染异常 |
| `hermes skills search` | `ipc/skill_hub.rs` | 搜索 Skill | 同上 |
| `hermes skills inspect` | `ipc/skill_hub.rs` | 查看 Skill 详情 | 同上 |
| `hermes skills install` | `ipc/skill_hub.rs` | 安装 Skill | 同上 |
| `hermes skills uninstall` | `ipc/skill_hub.rs` | 卸载 Skill | 同上 |
| `hermes skills list` | `ipc/skill_hub.rs` | 列出已安装 Skill | 同上 |
| `hermes skills check` | `ipc/skill_hub.rs` | 检查更新 | 同上 |
| `hermes skills update` | `ipc/skill_hub.rs` | 更新 Skill | 同上 |
| `hermes skills audit` | `ipc/skill_hub.rs` | 安全审计 | 同上 |
| `hermes gateway start` | `hermes_config/gateway.rs` | 启动 Gateway | 命令名/参数变更 → 启动失败 |
| `hermes gateway restart` | `hermes_config/gateway.rs` | 重启 Gateway | 同上 |
| `hermes gateway run` | `hermes_config/gateway.rs` (Windows) | 前台运行 Gateway（Windows 用 `CREATE_NO_WINDOW` + stdout/stderr 重定向到日志文件） | 同上 |
| `hermes -z <prompt>` | `ipc/workflow/mod.rs` | One-shot 执行（workflow） | flag 变更 → workflow 单步执行失败 |
| `hermes update --check` | `hermes_config/gateway.rs` | Hermes 更新检测 | 输出格式变更 → 更新检测误判 |
| `hermes --version` | `hermes_config/gateway.rs` | 版本检测 | 输出格式变更 → 版本解析失败 |
| `python3 -m hermes_cli <args>` | `hermes_config/gateway.rs` | CLI 不在 PATH 时的 fallback | 模块路径变更 → fallback 失效 |

**Corey 的 CLI 安全白名单**（`ipc/skill_hub.rs` → `ALLOWED_SUBCOMMANDS`）：
`browse`, `search`, `inspect`, `install`, `uninstall`, `list`, `check`, `update`, `audit`

### 1.2 Hermes 官方已有但 Corey 未调用的命令

以下命令 Hermes 官方支持，Corey 当前未使用但未来可能需要。**Hermes 删除/重命名这些命令时需评估是否影响 Corey 未来计划。**

| CLI 命令 | 用途 | Corey 未来可能用途 |
|---------|------|-------------------|
| `hermes skills publish` | 发布 Skill 到 Hub | Skill Pack 发布功能 |
| `hermes skills snapshot` | Skill 快照 | Skill 版本管理 |
| `hermes skills tap` | 添加 Skill 源 | 企业私有 Skill 源 |
| `hermes skills config` | Skill 配置 | Skill 设置页面 |
| `hermes gateway setup` | 交互式 Gateway 配置向导 | 首次设置流程 |
| `hermes gateway install` | 安装为系统服务 (systemd/launchd) | 开机自启 |
| `hermes gateway stop` | 停止 Gateway 服务 | 停止按钮（macOS/Linux 用 systemd/launchd，Windows 用 taskkill + port fallback） |
| `hermes gateway status` | 查看 Gateway 状态 | 状态页面 |
| `hermes gateway uninstall` | 卸载系统服务 | 卸载流程 |
| `hermes model` | 模型/Provider 选择向导 | 模型设置页面（交互式 CLI 向导） |
| `hermes tools` | 工具集配置 | 工具管理页面 |
| `hermes setup` | 完整安装向导 | 首次设置流程 |
| `hermes pairing approve/list/revoke/clear-pending` | DM 配对管理 | 频道认证 UI |
| `hermes config show/edit/set/check/migrate` | 配置管理 | 配置迁移辅助 |
| `hermes auth add/list/remove/reset` | 凭证池管理 | 多 Key 轮转 UI |
| `hermes memory setup/status/off` | 记忆提供者管理 | Memory Provider 设置 |
| `hermes mcp add/remove/list/test/serve` | MCP 管理 CLI | MCP 配置 CLI 方式 |
| `hermes cron list/create/edit/pause/resume/run/remove/status` | 定时任务 CLI | Cron CLI 方式 |
| `hermes sessions list/browse/export/delete/prune/stats/rename` | 会话管理 | 会话管理页面 |
| `hermes insights [--days N]` | 使用洞察 | Analytics 页面数据源 |
| `hermes backup` | 备份 | 数据备份功能 |
| `hermes import` | 导入 | 数据迁移 |
| `hermes doctor` | 诊断 | 故障排查 |
| `hermes dump` | 调试信息导出 | 高级诊断 |
| `hermes update` | 自更新 | Hermes 版本更新 |
| `hermes profile` | Profile 管理 | Profile CLI 方式 |
| `hermes status [--all] [--deep]` | 全局状态 | Dashboard 数据源 |
| `hermes webhook subscribe/list/remove/test` | Webhook 管理 | Webhook 集成 |
| `hermes plugins install/update/remove/enable/disable/list` | 插件管理 | 插件市场 |
| `hermes tools [--summary]` | 工具集配置 | 工具管理页面 |
| `hermes version` | 版本号 | 版本检测 |
| `hermes uninstall` | 卸载 | 卸载流程 |

**⚠️ Hermes 更新时重点检查：**
- CLI 子命令名是否变更（如 `gateway start` → `gateway launch`）
- 输出格式是否变更（Corey 直接渲染 CLI stdout）
- `--json` flag 是否稳定（目前未使用，但未来可能依赖）
- Windows 上 `hermes gateway run` 行为是否变化（Corey Windows 启动依赖此前台模式）
- `hermes --yolo` / `hermes --tui` flags 是否影响 Corey 的 CLI 调用
- Corey 白名单中的子命令是否被 Hermes 删除或重命名
- 新增的子命令是否需要加入白名单
- `hermes config set` 是否自动路由到 .env（官方确认：API key 写 .env，其余写 config.yaml）
- `hermes pairing` 命令是否稳定（DM 配对是新功能，未来 Corey 可能需要调用）

**⚠️ Hermes 官方确认不支持原生 Windows：**
- Hermes 仅支持 Unix-like 环境（Linux / macOS / WSL2）
- Corey Windows 版通过 WSL2 或直接安装到 `%LOCALAPPDATA%\hermes\` 的 Python venv 运行
- `resolve_hermes_binary()` 搜索路径：PATH → `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe` → `$HERMES_HOME\hermes-agent\venv\Scripts\hermes.exe` → `<corey_install_dir>\hermes-agent\venv\Scripts\hermes.exe`

---

## 2. Gateway HTTP API

CoreyOS 通过 HTTP 调用的 Hermes Gateway 端点。**API 路径/响应格式变更 = 聊天功能中断。**

Gateway API Server 配置（Hermes 官方）：
- `API_SERVER_ENABLED=true` 启用
- `API_SERVER_PORT=8642` 默认端口
- `API_SERVER_HOST=127.0.0.1` 默认绑定
- `API_SERVER_KEY` 认证密钥
- `API_SERVER_CORS_ORIGINS` CORS 白名单
- `API_SERVER_MODEL_NAME=hermes-agent` 模型名

### 2.1 Corey 当前在用的端点（Hermes 0.13.0）

| 端点 | 方法 | Corey 调用位置 | 用途 | 风险 |
|------|------|---------|------|------|
| `/health` | GET | `adapters/hermes/gateway/mod.rs::health` | Gateway 存活检测 + `latency_ms` 度量 | 响应格式变更 → 状态判断错误 |
| `/v1/models` | GET | `adapters/hermes/probe.rs`, `ipc/hermes_instances.rs` | 模型列表探测（OpenAI 兼容） | 响应格式变更 → 模型列表为空 |
| `/v1/chat/completions` | POST (non-stream) | `adapters/hermes/gateway/mod.rs::chat_once` | 一次性聊天（非流式）— 单轮 / title 生成 | 响应 JSON 变更 → 解析失败 |
| **`/v1/runs`** | **POST** | **`adapters/hermes/gateway/mod.rs::start_run` (2026-05-12 上线)** | **启动一次 agent run，返回 `run_id` (202)** | **请求/响应字段变更 → 流式聊天中断** |
| **`/v1/runs/{run_id}/events`** | **GET (SSE)** | **`adapters/hermes/gateway/mod.rs::connect_run_events`** | **结构化事件流（含 `approval.request`）** | **事件名/字段变更 → UI 显示异常** |
| **`/v1/runs/{run_id}/approval`** | **POST** | **`ipc/chat.rs::hermes_approval_respond`** | **响应审批 (`{choice}`)** | **payload 变更 → 审批失败** |

> **2026-05-12 迁移落地**：流式聊天主路径已从 `/v1/chat/completions` 迁移到 `/v1/runs`，因为 OpenAI-compat 端点无 `approval.request` 事件，审批卡片在 0.12 之后不再触发。`chat_once` 仍走 `/v1/chat/completions`（单轮场景不需要 run 状态机）。

### 2.2 Hermes 0.13.0 已暴露但 Corey 未调用的端点

| 端点 | 方法 | 用途 | Corey 未来可能用途 |
|------|------|------|-------------------|
| `/v1/runs/{run_id}` | GET | 查询 run 当前状态（status / last_event / model / created_at） | 进度监控、断线后恢复 UI 状态 |
| `/v1/runs/{run_id}/stop` | POST | 中断运行（向 in-flight agent 发 cancel） | Stop 按钮升级为服务端中止（当前 `chat_stream_cancel` 仅 abort tokio 任务） |
| `/v1/responses` | POST | OpenAI Responses API（stateful via `previous_response_id`） | Background Sessions / 多 turn 续接 |
| `/v1/responses/{id}` | GET | 查询历史 response | 历史回放 |
| `/messages` (Anthropic 兼容层) | POST | Anthropic Messages 协议 | Claude 客户端兼容 |

### 2.3 v0.13.0 SSE 事件依赖（`/v1/runs/{run_id}/events`）

源码位置：`~/.hermes/hermes-agent/gateway/platforms/api_server.py:2735-3260`

| 事件名 | Payload（核心字段） | Corey 映射 |
|--------|---------------------|------------|
| `message.delta` | `{event, run_id, timestamp, delta}` | `RunEvent::MessageDelta` → `ChatStreamEvent::Delta` |
| `tool.started` | `{event, run_id, timestamp, tool, args?, emoji?, label?}` | `RunEvent::ToolStarted` → `ChatStreamEvent::Tool(HermesToolProgress)` |
| `tool.completed` | `{event, run_id, timestamp, tool, result?}` | `RunEvent::ToolCompleted` (吸收掉，UI 不显示) |
| `reasoning.available` | `{event, run_id, timestamp, reasoning}` | `RunEvent::ReasoningAvailable` → `ChatStreamEvent::Reasoning` |
| `approval.request` | `{event, run_id, timestamp, choices: ["once","session","always","deny"], command, description, pattern_key, pattern_keys}` | `RunEvent::ApprovalRequest` → `ChatStreamEvent::Approval(HermesApprovalRequest)` 含 `run_id` |
| `approval.responded` | `{event, run_id, timestamp, choice}` | 吸收掉（仅 telemetry） |
| `run.completed` | `{event, run_id, timestamp, output, usage: {input_tokens, output_tokens, total_tokens}}` | 终止流；映射 `usage.input_tokens → prompt_tokens` |
| `run.failed` | `{event, run_id, timestamp, error}` | `RunEvent::RunFailed` → `AdapterError::Upstream` |
| `run.cancelled` | `{event, run_id, timestamp}` | 终止流，`finish_reason="cancelled"` |

**注意**：流不发 `[DONE]` sentinel；以 `run.completed/failed/cancelled` 为终结信号，连接随后关闭。

### 2.4 关键 HTTP 头

Hermes 0.13.0 在 `/v1/chat/completions`、`/v1/runs`、`/v1/responses` 上识别这两个头（双向 — 请求传入、响应回显）：

| 头 | 用途 | Corey 是否使用 |
|----|------|----------------|
| `X-Hermes-Session-Id` | 会话延续标识（之前主要用于 `/v1/chat/completions`），可通过 body `session_id` 字段替代（`/v1/runs`） | ⬜ Corey 当前未传；DB 自身有 session_id，可考虑透传以提升压缩窗 |
| `X-Hermes-Session-Key` | **新增** — 长期记忆作用域键（绑定记忆 Provider 的稳定 ID，需 API key 鉴权） | ⬜ Corey 未传；启用时记忆隔离会按 channel/session 自动 scoped |

### 2.5 已 retire 的 Corey patch 端点（不再使用）

| 原 Corey patch 端点 | 撤销原因 |
|---|---|
| ~~`/api/approval/respond` POST~~ | 2026-05-11：永不 patch Hermes 源码；改走 `/v1/runs/{run_id}/approval` |
| ~~`/api/approval/pending` GET~~ | 同上；native Hermes 无等价端点（run 是有状态的，不需要轮询 pending） |

**消息渠道（WeChat / Slack / Telegram / 钉钉 / cron）仍走 Hermes 原生 channel 审批流**（`gateway/run.py` plain-text fallback，文案默认英文 + 7 个新 locale 翻译，但 `gateway/run.py:15066` 的关键 fallback 仍是英文硬编码 — upstream gap，已记录）。

**⚠️ Hermes 更新时重点检查：**
- `/v1/runs` 请求字段：`input` / `instructions` / `conversation_history` / `previous_response_id` / `session_id` 是否变更
- `/v1/runs` 响应字段：`run_id` / `status` / `created_at` 是否变更
- `RunEvent` 9 个变体的事件名 + 字段是否变更（`message.delta` / `tool.started` / `tool.completed` / `reasoning.available` / `approval.request` / `approval.responded` / `run.completed` / `run.failed` / `run.cancelled`）
- `approval.request` 的 `choices` 集合是否扩展（Corey UI 4 个固定按钮）
- `/v1/runs/{run_id}/approval` POST body：`{choice}` 是否新增字段（如 `all` 已存在）
- `usage` 字段名（`input_tokens`/`output_tokens`/`total_tokens`，**与 OpenAI `prompt_tokens`/`completion_tokens` 不同**）
- `/health` 响应是否新增必要字段
- `X-Hermes-Session-Key` 鉴权要求是否变更（需 API key 才生效）
- `API_SERVER_*` 环境变量是否变更默认值

---

## 3. 文件系统依赖

CoreyOS 读写 Hermes 管理的文件。**文件路径/格式变更 = 功能静默失败。**

Hermes 官方目录结构（2026-05-07 核对官方 Installation 文档）：
```
~/.hermes/
├── config.yaml        # 主配置
├── .env               # API Key 和密钥
├── auth.json          # OAuth 凭证 (Nous Portal 等)
├── SOUL.md            # Agent 身份定义 (system prompt slot #1)
├── memories/          # 持久记忆
│   ├── MEMORY.md      # Agent 个人笔记
│   └── USER.md        # 用户画像
├── skills/            # Skill 文件
│   ├── <category>/
│   │   └── <skill>/
│   │       ├── SKILL.md   # 主指令 (必须)
│   │       ├── references/
│   │       ├── templates/
│   │       ├── scripts/
│   │       └── assets/
│   ├── .hub/          # Skills Hub 状态
│   │   ├── lock.json
│   │   ├── quarantine/
│   │   └── audit.log
│   └── .bundled_manifest
├── cron/              # 定时任务
│   ├── jobs.json
│   └── output/{job_id}/{timestamp}.md
├── sessions/          # Gateway 会话
├── logs/              # 日志
│   ├── agent.log
│   ├── gateway.log
│   └── errors.log     # ⚠️ 注意：官方文档写作 errors.log（带 s）
├── profiles/          # Profile 配置
│   └── <name>/
│       └── config.yaml
├── memory_store.db    # Holographic 记忆 SQLite (facts 表)
├── state.db           # 会话 SQLite (messages/sessions/messages_fts)
├── gateway.json       # Gateway 运行时配置（如 reset_by_platform 会话重置策略）
├── pairing/           # DM 配对数据（{platform}-pending.json / {platform}-approved.json）
├── hooks/             # Gateway hooks 目录
├── plans/             # /plan skill 输出目录
├── image_cache/       # 图片缓存
├── audio_cache/       # 音频缓存
├── whatsapp/session/  # WhatsApp bridge 会话（需 Node.js）
├── sandboxes/         # Docker/容器后端持久化数据
└── modal_snapshots.json  # Modal 后端快照跟踪
```

### 3.1 读取（Corey 只读，Hermes 拥有）

| 文件/目录 | 路径 | Corey 用途 | 风险 |
|----------|------|-----------|------|
| Agent 日志 | `~/.hermes/logs/agent.log` | 压缩统计、频道状态探测 | 日志格式变更 → 统计错误 |
| Gateway 日志 | `~/.hermes/logs/gateway.log` | 频道在线状态探测 | 同上 |
| 错误日志 | `~/.hermes/logs/errors.log` | 错误日志查看页（⚠️ 官方文档写作 `errors.log`） | 同上 |
| 会话数据库 | `~/.hermes/state.db` | 全文搜索（FTS5 `messages_fts`）| schema 变更 → 搜索失败 |
| 会话文件 | `~/.hermes/sessions/session_*.json` | 会话磁盘占用统计 | 文件名格式变更 → 统计不准 |
| 会话文件 | `~/.hermes/sessions/session_*_*.jsonl` | 同上 | 同上 |
| 定时任务输出 | `~/.hermes/cron/output/{job_id}/{timestamp}.md` | Scheduler 页面展示运行结果 | 目录结构变更 → 结果不可见 |
| Skill 文件 | `~/.hermes/skills/<category>/<skill>/SKILL.md` | Skill 列表展示 | 目录结构变更 → 列表为空 |
| Skills Hub 状态 | `~/.hermes/skills/.hub/lock.json` | Hub 安装状态 | 格式变更 → 状态不准 |
| 记忆数据库 | `~/.hermes/memory_store.db` | `facts` 表统计 (holographic) | schema 变更 → Memory 页面异常 |
| OAuth 凭证 | `~/.hermes/auth.json` | 目前未读，但 Hermes 用它做 OAuth | 新增 Provider 需 OAuth → Corey 需支持 |
| 压缩日志标记 | `"Context compression triggered"` | 压缩统计 | 日志文本变更 → 统计归零 |
| 压缩日志标记 | `"Compressed: ... tokens saved"` | 同上 | 同上 |

### 3.2 读写（Corey 和 Hermes 共享）

| 文件 | 路径 | Corey 写入内容 | Hermes 读取时机 | 风险 |
|------|------|---------------|---------------|------|
| 主配置 | `~/.hermes/config.yaml` | model/compression/approvals/mcp_servers/channels/memory/plugins | Gateway 启动/重启 | YAML schema 变更 → 写入的字段被忽略或报错 |
| 环境变量 | `~/.hermes/.env` | API Key、Bot Token | Gateway 启动 | 格式变更 → Key 不被识别 |
| 用户画像 | `~/.hermes/memories/USER.md` | 用户编辑自己的画像 (`ipc/hermes_memory.rs`) | 每次会话 system prompt | 格式变更 → 画像不注入 |
| Agent 记忆 | `~/.hermes/MEMORY.md` | 学习提取的事实 (`ipc/learning/mod.rs`) | 每次会话 system prompt | 格式变更 → 记忆不注入 |
| 学习记录 | `~/.hermes/LEARNINGS.md` | 学习提取的事实备份 (`ipc/learning/mod.rs`) | Corey 自用 | — |
| Profile 配置 | `~/.hermes/profiles/<name>/config.yaml` | 创建/克隆/重命名 Profile | Gateway 切换 profile | 目录结构变更 → Profile 切换失败 |
| 定时任务 | `~/.hermes/cron/jobs.json` | CRUD 定时任务 | Gateway 运行时 (60s tick) | JSON schema 变更 → 任务不执行 |
| MCP 注册 | `~/.hermes/config.yaml` → `mcp_servers:` | Corey Native Bridge 自注册 | Gateway 启动/`/reload-mcp` | 写入格式变更 → MCP 不可见 |

### 3.3 写入（Corey 拥有，Hermes 不关心）

| 文件 | 路径 | 说明 |
|------|------|------|
| 附件暂存 | `~/.hermes/attachments/<uuid>.<ext>` | Corey 管理，Hermes 通过 chat API 消费 |
| 缩略图缓存 | `~/.hermes/cache/thumbnails/` | Corey 专用 |
| Corey 数据库 | `<app_data_dir>/caduceus.db` | Corey 专用，Hermes 不读 |
| 变更日志 | `<app_data_dir>/changelog.jsonl` | Corey 专用 |

**⚠️ Hermes 更新时重点检查：**
- `config.yaml` 是否新增必填字段（Corey 未写入 → Gateway 启动失败）
- `config.yaml` 已有字段是否改名（Corey 写旧名 → 被忽略）
- `state.db` 的 `messages` 表和 `messages_fts` 是否 schema 变更
- `memory_store.db` 的 `facts` 表 schema 是否变更
- `cron/jobs.json` 格式是否变更
- `.env` 文件是否新增必要变量
- `sessions/` 目录文件命名格式是否变更
- 日志文件中的标记文本是否变更
- `auth.json` 是否新增必要 OAuth 字段
- `MEMORY.md` / `USER.md` 格式约定是否变更
- `skills/` 目录结构是否变更（如 `.hub/` 格式）

---

## 4. config.yaml 字段依赖

Corey 写入的具体 YAML 字段。**字段改名/删除 = 配置静默丢失。**

### 4.1 Corey 当前写入的字段

| YAML 路径 | Corey 写入位置 | 用途 |
|----------|---------------|------|
| `model.default` | `hermes_config/mod.rs` | 模型名称（注意：Hermes 官方字段名是 `default`，不是 `name`） |
| `model.provider` | `hermes_config/mod.rs` | 模型提供商 |
| `model.base_url` | `hermes_config/mod.rs` | API Base URL |
| `compression.enabled` | `hermes_config/mod.rs` | 上下文压缩开关 |
| `compression.threshold` | `hermes_config/mod.rs` | 压缩阈值 |
| `compression.target_ratio` | `hermes_config/mod.rs` | 压缩保留比例 |
| `compression.protect_last_n` | `hermes_config/mod.rs` | 保留最近 N 条消息 |
| `approvals.mode` | `hermes_config/mod.rs` | 审批模式 (manual/auto/yolo) |
| `approvals.timeout` | `hermes_config/mod.rs` | 审批超时（秒） |
| `approvals.cron_mode` | `hermes_config/mod.rs` | Cron 审批模式 (deny/ask/allow) |
| `command_allowlist` | `hermes_config/mod.rs` | 命令白名单（文档顶层，非 approvals 子字段） |
| `mcp_servers.<id>` | `ipc/mcp.rs`, `mcp_server/mod.rs` | MCP Server 配置 |
| `mcp_servers.<id>.url` | `mcp_server/mod.rs` | MCP HTTP URL |
| `mcp_servers.<id>.command` | `ipc/mcp.rs` | MCP stdio 命令 |
| `mcp_servers.<id>.args` | `ipc/mcp.rs` | MCP stdio 参数 |
| `mcp_servers.<id>.env` | `ipc/mcp.rs` | MCP 环境变量 |
| `channels.<channel>.<field>` | `hermes_config/yaml.rs` via `write_channel_yaml_fields` | IM 频道配置 |
| `channels.telegram.mention_required` | `channels/mod.rs` YAML spec | Telegram @提及要求 |
| `channels.discord.mention_required` | `channels/mod.rs` YAML spec | Discord @提及要求 |
| `channels.discord.free_chats` | `channels/mod.rs` YAML spec | Discord 自由回复频道 |
| `channels.matrix.auto_thread` | `channels/mod.rs` YAML spec | Matrix 自动开线程 |

### 4.2 Corey 读取但未写入的字段

| YAML 路径 | Corey 读取位置 | 用途 |
|----------|---------------|------|
| `memory.provider` | `ipc/hermes_memory.rs` | 活跃记忆提供者名称 |
| `plugins.hermes-memory-store.auto_extract` | `ipc/hermes_memory.rs` | 自动提取开关 |
| `plugins.hermes-memory-store.temporal_decay_half_life` | `ipc/hermes_memory.rs` | 时间衰减半衰期 |
| `plugins.disabled` | Hermes 管理 | 插件禁用列表 |

### 4.3 Hermes 官方支持但 Corey 未使用的字段

以下字段 Hermes 官方支持，Corey 当前未使用。**Hermes 将这些字段改为必填 = Gateway 启动失败。**

| YAML 路径 | 用途 | 未来 Corey 可能用途 |
|----------|------|-------------------|
| `compression.target_ratio` | 压缩保留比例 | ✅ Corey 已写入 |
| `compression.protect_last_n` | 保留最近 N 条消息 | ✅ Corey 已写入 |
| `auxiliary.compression.model` | 压缩摘要模型 | 压缩高级设置 |
| `auxiliary.compression.provider` | 压缩摘要提供者 | 压缩高级设置 |
| `auxiliary.compression.base_url` | 压缩摘要自定义端点 | 压缩高级设置 |
| `auxiliary.vision.*` | 视觉模型配置 | 多模态设置 |
| `fallback_model.provider/model` | 备用模型 | 高可用设置 |
| `tool_output.max_bytes/max_lines/max_line_length` | 工具输出截断 | 工具设置 |
| `agent.disabled_toolsets` | 全局工具集禁用 | 工具管理 |
| `worktree` | Git Worktree 隔离 | 开发者设置 |
| `checkpoints.enabled/max_snapshots` | 文件系统快照 | 安全设置 |
| `security.redact_secrets` | 密钥脱敏 | 安全设置 |
| `security.tirith_*` | Tirith 安全扫描 | 安全设置 |
| `security.website_blocklist.*` | 网站黑名单 | 安全设置 |
| `skills.external_dirs` | 外部 Skill 目录 | 企业 Skill 管理 |
| `skills.config.*` | Skill 自定义配置 | Skill 设置页面 |
| `context.engine` | 上下文引擎选择 | 高级设置 |
| `cron.script_timeout_seconds` | Cron 脚本超时 | 定时任务设置 |
| `delegation.*` | 委派配置 | 多 Agent 设置 |
| `display.tool_progress` | 工具进度显示级别 (off/new/all/verbose) | UI 设置 |
| `display.background_process_notifications` | 后台任务通知级别 (all/result/error/off) | UI 设置 |
| `streaming.*` | 流式设置 | 性能设置 |
| `voice.*` | 语音模式配置（record_key, max_recording_seconds 等） | 语音设置 |
| `stt.provider` | STT 提供者 (local/groq/openai) | 语音设置 |
| `tts.provider` | TTS 提供者 (edge/elevenlabs/openai/neutts/minimax) | 语音设置 |
| `browser.*` | 浏览器配置 | 浏览器自动化 |
| `memory.memory_enabled` | 记忆开关 | 记忆设置 |
| `memory.user_profile_enabled` | 用户画像开关 | 记忆设置 |
| `memory.memory_char_limit` | 记忆字符限制 | 记忆设置 |
| `memory.user_char_limit` | 用户画像字符限制 | 记忆设置 |
| `terminal.backend` | 终端后端 (local/docker/ssh/modal/daytona/singularity) | 终端设置 |
| `terminal.cwd` / `terminal.timeout` | 工作目录/超时 | 终端设置 |
| `terminal.persistent_shell` | 持久 Shell | 终端设置 |
| `terminal.env_passthrough` | 环境变量透传 | 终端设置 |
| `terminal.container_*` | 容器资源限制 (cpu/memory/disk/persistent) | 终端设置 |
| `file_read_max_chars` | 文件读取上限 | 工具设置 |
| `unauthorized_dm_behavior` | 未授权 DM 行为 (pair/ignore) | 安全设置 |
| `custom_providers` | 自定义 Provider 列表 | 模型设置 |
| `prompt_caching.cache_ttl` | Prompt 缓存 TTL | 性能设置 |
| `redaction.enabled` | 密钥脱敏开关 | 安全设置 |
| `mcp_servers.<id>.enabled` | MCP Server 启用/禁用 | MCP 设置 |
| `mcp_servers.<id>.tools.include/exclude` | MCP 工具过滤 | MCP 设置 |
| `mcp_servers.<id>.sampling.*` | MCP 采样配置 | MCP 高级设置 |
| `mcp_servers.<id>.timeout` / `connect_timeout` | MCP 超时 | MCP 设置 |

**⚠️ Hermes 更新时重点检查：**
- 以上字段是否有改名/删除/类型变更
- 是否新增必填字段（Corey 不写 → Gateway 报错）
- `mcp_servers` 条目是否新增必要子字段
- `compression.summary_model/provider/base_url` → `auxiliary.compression.*` 迁移是否完成
- Hermes config version 是否递增（当前 config version 17）
- **config.yaml 环境变量替换**：Hermes 支持 `${VAR_NAME}` 语法在 YAML 中引用环境变量，Corey 的 `yaml.rs` 读写时不能破坏此语法
- `model.default` 字段名（不是 `model.name`，Corey 代码使用 `default`）
- `approvals.mode` 的有效值（官方：manual/smart/off，Corey 代码使用 manual/auto/yolo — ⚠️ 需确认 auto 和 yolo 是否与 smart 和 off 等价）

---

## 5. .env 变量依赖

Corey 写入的环境变量。Hermes Gateway 启动时读取。

### 5.1 LLM Provider API Key（Corey 写入）

| 变量名 | Corey 写入位置 | 用途 |
|--------|---------------|------|
| `OPENAI_API_KEY` | `hermes_config/env.rs` | OpenAI |
| `OPENAI_BASE_URL` | `hermes_config/env.rs` | OpenAI 自定义端点 |
| `ANTHROPIC_API_KEY` | `hermes_config/env.rs` | Anthropic |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | `hermes_config/env.rs` | Google/Gemini |
| `DEEPSEEK_API_KEY` | `hermes_config/env.rs` | DeepSeek |
| `OPENROUTER_API_KEY` | `hermes_config/env.rs` | OpenRouter |
| `HF_TOKEN` | `hermes_config/env.rs` | HuggingFace |

### 5.2 Messaging 频道 Token（Corey 写入）

| 变量名 | Corey 写入位置 | 用途 |
|--------|---------------|------|
| `TELEGRAM_BOT_TOKEN` | `ipc/channels/mod.rs` | Telegram |
| `TELEGRAM_ALLOWED_USERS` | `ipc/channels/mod.rs` | Telegram 用户白名单 |
| `TELEGRAM_HOME_CHANNEL` | `ipc/channels/mod.rs` | Telegram 主频道 |
| `DISCORD_BOT_TOKEN` | `ipc/channels/mod.rs` | Discord |
| `DISCORD_ALLOWED_USERS` | `ipc/channels/mod.rs` | Discord 用户白名单 |
| `SLACK_BOT_TOKEN` | `ipc/channels/mod.rs` | Slack |
| `SLACK_APP_TOKEN` | `ipc/channels/mod.rs` | Slack Socket Mode |
| `MATRIX_ACCESS_TOKEN` | `ipc/channels/mod.rs` | Matrix |
| `MATRIX_HOMESERVER` | `ipc/channels/mod.rs` | Matrix 服务器 |
| `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` | `ipc/channels/mod.rs` | 钉钉 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | `ipc/channels/mod.rs` | 飞书 |
| `WECOM_BOT_ID` / `WECOM_SECRET` | `ipc/channels/mod.rs` | 企业微信 |
| `WEIXIN_ACCOUNT_ID` / `WEIXIN_TOKEN` | `ipc/channels/mod.rs` | 微信 |
| `WEBHOOK_ENABLED` / `WEBHOOK_SECRET` | `ipc/channels/mod.rs` | Webhook |
| `API_SERVER_KEY` | `ipc/channels/mod.rs` | API Server 认证 |

### 5.3 Hermes 官方支持但 Corey 未写入的变量

Hermes 官方支持以下变量，Corey 当前未写入但未来可能需要：

**LLM Provider：**
`NOUS_BASE_URL`, `NOUS_INFERENCE_BASE_URL`, `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL`,
`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GLM_API_KEY`/`ZAI_API_KEY`, `KIMI_API_KEY`,
`ARCEEAI_API_KEY`, `GMI_API_KEY`, `MINIMAX_API_KEY`, `KILOCODE_API_KEY`,
`XIAOMI_API_KEY`, `TOKENHUB_API_KEY`, `AZURE_FOUNDRY_API_KEY`, `AZURE_ANTHROPIC_KEY`,
`DASHSCOPE_API_KEY`, `NVIDIA_API_KEY`, `OLLAMA_API_KEY`, `XAI_API_KEY`,
`MISTRAL_API_KEY`, `AWS_REGION`/`AWS_PROFILE`, `OPENCODE_ZEN_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`, `VOICE_TOOLS_OPENAI_KEY`

**Messaging（未列出频道）：**
`SIGNAL_*`, `TWILIO_*`/`SMS_*`, `EMAIL_*`, `BLUEBUBBLES_*`, `QQ_*`,
`MATTERMOST_*`, `HASS_*`, `WECOM_CALLBACK_*`

**Agent Behavior：**
`HERMES_MAX_ITERATIONS`, `HERMES_TOOL_PROGRESS`, `HERMES_HUMAN_DELAY_*`,
`HERMES_QUIET`, `HERMES_API_TIMEOUT`, `HERMES_EXEC_ASK`,
`HERMES_ENABLE_PROJECT_PLUGINS`, `HERMES_BACKGROUND_NOTIFICATIONS`,
`DELEGATION_MAX_CONCURRENT_CHILDREN`,
`HERMES_YOLO_MODE`, `HERMES_STREAM_READ_TIMEOUT`

**Cron/Session：**
`HERMES_CRON_TIMEOUT`, `HERMES_CRON_SCRIPT_TIMEOUT`, `SESSION_IDLE_MINUTES`, `SESSION_RESET_HOUR`

**Auxiliary：**
`AUXILIARY_VISION_*`, `AUXILIARY_WEB_EXTRACT_*`

**Gateway：**
`GATEWAY_PROXY_URL`, `GATEWAY_PROXY_KEY`, `MESSAGING_CWD`,
`GATEWAY_ALLOWED_USERS`, `GATEWAY_ALLOW_ALL_USERS`

**Terminal Backend：**
`TERMINAL_SSH_HOST/USER/PORT/KEY/PERSISTENT`,
`TERMINAL_LOCAL_PERSISTENT`, `TERMINAL_DOCKER_VOLUMES`,
`MODAL_TOKEN_ID/SECRET`, `DAYTONA_API_KEY`

**STT/TTS：**
`GROQ_API_KEY`, `VOICE_TOOLS_OPENAI_KEY`, `ELEVENLABS_API_KEY`,
`STT_GROQ_MODEL`, `STT_OPENAI_MODEL`, `GROQ_BASE_URL`, `STT_OPENAI_BASE_URL`

**Tools：**
`FIRECRAWL_API_KEY`, `FAL_KEY`, `SUDO_PASSWORD`

**⚠️ Hermes 更新时重点检查：**
- 是否新增必要的 API Key 变量
- 变量名是否变更（如 `OPENAI_API_KEY` → `OPENAI_KEY`）
- 是否支持新的环境变量格式

---

## 6. Gateway 行为依赖

Corey 依赖的 Hermes Gateway 运行时行为。**行为变更 = 功能逻辑失效。**

| 行为 | Corey 依赖方式 | 风险 |
|------|---------------|------|
| Gateway 不热加载 config.yaml | Corey 写完配置后必须重启 Gateway | 如果 Hermes 支持热加载 → 重启逻辑可优化，但不影响兼容性 |
| Gateway 支持 `/reload-mcp` 聊天命令 | MCP 变更后需重启 Gateway（Corey 未使用此聊天命令） | 如果 Hermes 提供 HTTP 端点 → 可跳过重启 |
| Gateway 支持 MCP Dynamic Tool Discovery | `notifications/tools/list_changed` 自动刷新工具列表 | Corey 不直接依赖，但 Hermes 侧行为变化可能影响 MCP 功能 |
| Gateway 不提供 `/health/channels` 端点 | Corey 从日志文件推断频道状态 | 如果 Hermes 新增此端点 → 可替代日志解析 |
| Gateway 默认端口 8642 | Corey 固定 MCP Server 端口 8649 | 端口冲突风险 |
| Gateway 使用 `HERMES_HOME` 环境变量 | Corey 注入 `HERMES_HOME` | 如果变量名变更 → 数据目录对不上 |
| Gateway 启动时自动清理 `sessions/*.jsonl` + VACUUM `state.db` | Corey 的会话清理面板仍工作但残留更少 | 纯兼容，无风险 |
| Gateway 审批流通过 SSE `approval` 事件推送 | Corey 前端渲染审批卡片 | 审批协议变更 → 审批流中断 |
| Gateway Cron 60s tick 调度 | Corey 只编辑 `jobs.json`，执行由 Gateway 负责 | 调度间隔变更 → 任务执行时机偏移 |
| Gateway 可安装为系统服务 | macOS: launchd, Linux: systemd | Corey 当前未使用，未来可能用于开机自启 |
| Gateway 支持 Background Sessions | 长任务在后台运行，完成后通知 | Corey 当前未使用，未来可利用 |
| Gateway 支持 DM Pairing | 替代 allowlist 的频道认证方式 | Corey 当前未使用 |

---

## 7. MCP 集成细节

Corey 与 Hermes MCP 系统的交互。**MCP 协议变更 = MCP 功能中断。**

| 依赖项 | Corey 行为 | 风险 |
|--------|-----------|------|
| `mcp_servers:` YAML 配置 | Corey 写入 `config.yaml` 的 `mcp_servers` 节 | 格式变更 → MCP 不可见 |
| MCP stdio 服务器 | Corey 配置 `command`/`args`/`env` | Hermes 变更启动方式 → 服务器不启动 |
| MCP HTTP 服务器 | Corey 配置 `url` | 格式变更 → 连接失败 |
| MCP 工具过滤 | Hermes 支持 per-server whitelist/blacklist | Corey 当前未使用，未来可利用 |
| MCP toolset 命名 `mcp-<server>` | Hermes 自动创建 | 命名规则变更 → 工具集管理异常 |
| `/reload-mcp` 聊天命令 | Hermes 支持，Corey 当前未使用 | 如果提供 HTTP 端点 → 可替代重启 |
| `hermes mcp serve` | Hermes 可作为 MCP Server 运行 | Corey 当前未使用，未来可利用 |
| MCP Sampling Support | Hermes 支持 MCP sampling | Corey 当前未使用 |

---

## 8. 记忆系统集成细节

Corey 与 Hermes 记忆系统的交互。**记忆格式/schema 变更 = Memory 页面异常。**

| 依赖项 | Corey 行为 | 风险 |
|--------|-----------|------|
| `MEMORY.md` (Agent 笔记) | Corey 通过 `ipc/learning/mod.rs` 写入 `## [auto]` 段落 | 格式约定变更 → 记忆不注入 |
| `USER.md` (用户画像) | Corey 通过 `ipc/hermes_memory.rs` 读写 | 格式约定变更 → 画像不注入 |
| `LEARNINGS.md` | Corey 自用备份 | — |
| `memory_store.db` (holographic) | Corey 读取 `facts` 表统计 | schema 变更 → 统计失败 |
| `memory.provider` | Corey 读取配置显示 | 字段改名 → 页面显示空 |
| `plugins.hermes-memory-store.*` | Corey 读取配置显示 | 字段改名 → 页面显示空 |
| `hermes memory setup/status/off` | Hermes CLI 命令，Corey 未调用 | 未来可用于 Provider 设置 |
| 8 个外部记忆 Provider | Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory | Provider 列表变更 → 设置页面需更新 |
| `session_search` 工具 | Hermes 内置，搜索 `state.db` | Corey 只读 DB，不依赖此工具 |

---

## 9. 频道系统集成细节

Corey 与 Hermes 频道系统的交互。**频道配置变更 = IM 推送中断。**

Hermes 官方支持的平台（toolset 名称）：

| 平台 | Toolset | Corey 支持 | 环境变量前缀 |
|------|---------|-----------|-------------|
| Telegram | `hermes-telegram` | ✅ | `TELEGRAM_*` |
| Discord | `hermes-discord` | ✅ | `DISCORD_*` |
| Slack | `hermes-slack` | ✅ | `SLACK_*` |
| WhatsApp | `hermes-whatsapp` | ✅ (QR) | `WHATSAPP_*` |
| Signal | `hermes-signal` | ⬜ | `SIGNAL_*` |
| SMS (Twilio) | `hermes-sms` | ⬜ | `TWILIO_*`/`SMS_*` |
| Email | `hermes-email` | ⬜ | `EMAIL_*` |
| 钉钉 | `hermes-dingtalk` | ✅ (QR) | `DINGTALK_*` |
| 飞书 | `hermes-feishu` | ✅ | `FEISHU_*` |
| 企业微信 | `hermes-wecom` | ✅ | `WECOM_*` |
| 企业微信 Callback | `hermes-wecom-callback` | ⬜ | `WECOM_CALLBACK_*` |
| 微信 | `hermes-weixin` | ✅ (QR) | `WEIXIN_*` |
| Mattermost | `hermes-mattermost` | ⬜ | `MATTERMOST_*` |
| Matrix | `hermes-matrix` | ✅ | `MATRIX_*` |
| Home Assistant | `hermes-homeassistant` | ⬜ | `HASS_*` |
| BlueBubbles (iMessage) | `hermes-bluebubbles` | ⬜ | `BLUEBUBBLES_*` |
| QQ Bot | `hermes-qqbot` | ✅ (QR) | `QQ_*` |
| Microsoft Teams | `hermes-teams` | ✅ | `TEAMS_*` |
| 元宝 | `hermes-yuanbao` | ✅ | `YUANBAO_*` |
| Webhook | `hermes-webhook` | ✅ | `WEBHOOK_*` |

Corey 频道 Token 探测（`ipc/channels/probe.rs`）：仅支持单 GET 探测的平台（Telegram/Discord/Slack），多凭证平台（WeCom/Feishu/WeiXin）和安装器驱动平台（Matrix/WhatsApp）暂不支持在线探测。

---

## 10. Hermes 版本兼容性

| Hermes 版本 | Corey 兼容性 | 说明 |
|------------|-------------|------|
| < 0.10 | ❌ 不支持 | `HERMES_MIN_SUPPORTED = (0, 10)` |
| 0.10 | ✅ 完全兼容 | 历史基准 |
| 0.11 | ✅ 兼容 | 新增 provider/transport，已有字段不变；新增 sessions 自动清理 |
| 0.12 | ✅ 已完成适配 | 1096 commits；核心 API/配置兼容；8 项增强落地（Teams/元宝频道、Cron workdir/context_from、`hermes update --check`、`hermes -z`、trigram 搜索、Skill reload hint、Chat hard stop、MAX_TESTED 提升）|
| **0.13** | **✅ 已升级 + 关键迁移完成** | **1296 commits（"The Tenacity Release"，2026-05-07）；2026-05-11 弃 patch 路线 + 升级；2026-05-12 完成 `/v1/runs` 迁移 → 审批 UI 恢复**。Corey 当前在 0.13 上跑。 |

**版本检测代码位置：** `hermes_config/gateway.rs` → `HERMES_MIN_SUPPORTED` / `HERMES_MAX_TESTED`

**Hermes config version 历史：**
- v17: `compression.summary_*` → `auxiliary.compression.*` 自动迁移
- v18-v20: 仅版本号递增，无 schema 变更
- v21: `plugins.enabled` 引入 opt-in 白名单（已安装的插件自动 grandfather；新插件需手工 enable）
- **v22-v23（0.13 引入）**：增加 `curator.*`（top-level）+ `auxiliary.curator.*`（aux 任务槽），自动迁移；创建 `~/.hermes/logs/curator/`。**纯 additive，对 Corey 无破坏性影响**。
- Hermes 用户首次启动 0.13 自动从 v21 升到 v23。Corey 不要写 `_config_version` 字段（Hermes 自管）。

### v0.12.0 影响分析（2026-04-30 发布）

**⚠️ 对 Corey 有影响的变更：**

| 变更 | 影响 | Corey 需要做 |
|------|------|-------------|
| `secret redaction` 默认关闭 | Corey 未写 `redaction.enabled`，无影响 | 无 |
| `state.db` 新增 trigram FTS5 索引 | Corey 读 `messages_fts` → 需确认兼容 | 验证 `session_search.rs` 查询 |
| `state.db` FTS5 索引含 `tool_name` + `tool_calls` | Corey 只读 content → 无影响 | 无 |
| API Server 新增 `POST /v1/runs/{run_id}/stop` | 新端点，可用于停止聊天 | 可选：添加停止按钮 |
| API Server 新增 `run status` 端点 | 新端点，可用于进度监控 | 可选：添加运行状态 |
| Gateway 变为插件宿主（pluggable platforms） | 平台适配器外置为插件 | 验证 QQ/WeChat/DingTalk 仍为内置 |
| `hermes curator` 新命令 | 新功能，不影响现有 | 可选：白名单加入 `curator` |
| `hermes -z` one-shot 模式 | 新 CLI flag | 可选：workflow 可调用 |
| `hermes update --check` | 新子命令 | 可选：Hermes 更新检测 |
| `hermes fallback` 命令 | 新子命令 | 可选：备用模型管理 |
| `/reload-skills` slash command | 新聊天命令 | 可选：Skill 安装后免重启 |
| `prompt_caching.cache_ttl` 新 config 字段 | 可选字段，不写不影响 | 无 |
| `tts.providers.<name>` 新 config 结构 | 可选字段 | 可选：Voice 页面适配 |
| Cron 新增 `workdir` / `context_from` 字段 | `jobs.json` 新增可选字段 | 验证 Scheduler 写入兼容 |
| `[SYSTEM:` → `[IMPORTANT:` 标记重命名 | Corey 不注入此标记 → 无影响 | 无 |
| Gateway busts cached agent on config edits | 行为改善，可能不需要完整重启 | 验证 config 写入后是否仍需重启 |
| 新 Provider: LM Studio / GMI / Azure Foundry / MiniMax / Tokenhub | 新 provider 选项 | 可选：Models 页面增加 |
| 新平台: Microsoft Teams / 元宝 | 新频道 | 可选：Channels 页面增加 |
| `pre_gateway_dispatch` / `pre_approval_request` hooks | 新 Gateway hook | 可选：审批流优化 |

**✅ 确认兼容（不需要改动）：**
- `/v1/chat/completions` SSE 格式未变
- `/health` 端点未变
- `config.yaml` 已有字段未改名/删除
- `.env` 变量名未变
- `hermes gateway start/restart/run` 命令未变
- `hermes skills` 子命令未变
- `HERMES_HOME` 环境变量仍支持

**❌ 已移除/回退（检查 Corey 是否依赖）：**
- `flush_memories` 已移除 → Corey 未使用，无影响
- `/provider` + `/plan` slash 命令已删 → Corey 未使用，无影响
- `BOOT.md` 内置 hook 已移除 → Corey 未使用，无影响

### v0.12.0 升级验证结果（2026-05-01）

- [x] `chat_stream_cancel` 已接入后端任务中止（Stop 从 soft stop 升级为 hard stop）
- [x] `/health`、`/v1/chat/completions` SSE、`/v1/models` 兼容
- [x] `config.yaml` 既有字段写入路径兼容（additive-only）
- [x] `jobs.json` 通过 `#[serde(flatten)]` 保留 Hermes 新增字段（如 `workdir`、`context_from`）
- [x] `HERMES_MAX_TESTED` 已从 `(0, 11)` 提升至 `(0, 12)`
- [x] Teams + 元宝已新增到 `CHANNEL_SPECS`（19 个平台）
- [x] `hermes_update_check` IPC + Settings UI 已实现
- [x] `hermes_oneshot` IPC（`hermes -z`）已实现
- [x] Session search trigram 检测 + 查询适配已实现
- [x] Skill Hub reload hint 已实现
- [x] Cron `workdir` / `context_from` 显式建模 + IPC 透传
- [x] `state.db` `messages_fts` 列顺序确认：v0.12 有两张 FTS5 表 — `messages_fts`(原始) + `messages_fts_trigram`(trigram)，均以 `content` 为第 0 列，`snippet(..., 0, ...)` 安全。Corey 现优先使用 trigram 表
- [x] QQ sandbox 补丁路径确认：`~/.hermes/hermes-agent/gateway/platforms/qqbot/constants.py` 仍在原位
- [x] 本地 CI 复测通过：`npx tsc --noEmit` + `npx eslint src/` + `pnpm build` + `cargo check` + `cargo test --lib`（391/0）+ `cargo fmt --check`
- [ ] Windows 最终实机验收（需 `v0.1.13` 包）：安装后自动 recheck、Gateway 启动不弹空白 cmd、`gateway-stdout.log/gateway-stderr.log` 诊断链路、聊天/搜索/定时任务回归

### v0.13.0 影响分析（2026-05-07 发布 · "The Tenacity Release"）

**核心变化：**1296 commits since 0.12，295 contributors in one week。Hermes 从"OpenAI-compat 套壳"演进到一个有完整 run 状态机 + 多 agent 编排（Kanban）+ checkpoints v2 + sessions auto-resume 的运行时。Corey 与之集成的几个面都受影响。

**🔴 对 Corey 有影响的 breaking change（必须处理）：**

| 变更 | 影响 | Corey 已做 / 待办 |
|------|------|-------------------|
| **`secret redaction` 默认从 OFF 翻为 ON**（PR #21193） | Hermes 启动后会主动脱敏 stdout / log / SSE delta 中的密钥模式（OpenAI key、AWS key 等）。Corey 读取 `~/.hermes/logs/agent.log` 做压缩统计 / 频道状态推断时，可能遇到 `[REDACTED]` 占位 | ⬜ 验证 `ipc/learning/`、`ipc/channels/probe.rs` 对 `[REDACTED]` 字符串容错（不应被当作错误特征） |
| **`/v1/chat/completions` 不再发 `approval.request` 事件**（实际从 0.12 末就如此，0.13 明确） | Corey 0.12 时审批卡片实际已断（patch_approval_sse 是补丁手段），0.13 弃 patch 后必须迁 `/v1/runs` | ✅ 2026-05-12 完成迁移；详见 §2.1 |
| **`run.completed.usage` 字段名为 `input_tokens` / `output_tokens` / `total_tokens`**（非 OpenAI 的 `prompt_tokens` / `completion_tokens`） | Corey 在 `chat_stream` 终止处需做名字翻译（`input → prompt`） | ✅ `gateway/mod.rs` 中已映射 |
| **`config_version` 21 → 23**（v22/v23 自动加 `curator.*` 段） | Hermes 启动时自动 migrate；新增字段全 additive | ✅ Corey 未写 `_config_version`（Hermes 自管），无影响 |

**🟡 对 Corey 有潜在影响（建议验证或加测试）：**

| 变更 | 影响 | Corey 建议 |
|------|------|-----------|
| **Sessions auto-resume after restart**（PR #21192） | Gateway bounce / `/update` 后会话自动恢复 | 验证 Corey UI 在 gateway 重启时不会重复创建新 session |
| **Atomic restart markers + Windows runtime-lock offset**（PR #18179） | Windows 上 Hermes 启动锁机制改了 | 验证 `gateway run` 在 Windows 上仍正常拉起；尤其 `gateway-stdout.log` 行为 |
| **Provider 插件化**（`ProviderProfile` ABC + `plugins/model-providers/`） | 自定义 provider 走插件目录 | Corey 的 `model_list` 调用 `/v1/models` 不受影响（Hermes 内部聚合）；可 future-proof Models 页面识别 plugin provider |
| **Platform allowlists 新字段**（`allowed_channels` / `allowed_chats` / `allowed_rooms`，覆盖 Slack/Telegram/Mattermost/Matrix/钉钉） | `config.yaml` 频道段新增可选字段 | Corey 当前不写这些字段，Hermes 缺省允许所有 → 行为不变。可选：UI 暴露这 3 个允许列表 |
| **`transform_llm_output` 插件 hook**（PR #21235） | 插件可在 LLM 输出落到对话之前改写 | Corey 不直接受影响，但若用户装了内容过滤插件，输出可能被改写 → 不可信任 raw output 校验 |
| **MCP SSE transport + OAuth forwarding**（PR #21227） | MCP 服务器现支持 SSE 传输 + 代理 OAuth | Corey 写 `mcp_servers.<id>.transport` 时可设 `sse`；对现有 stdio/http 配置无影响 |
| **`X-Hermes-Session-Key` 头**（PR #20199） | 长期记忆作用域绑定 | ⬜ 当 Corey 接入记忆 Provider（Honcho / Mem0 等）时，传 `X-Hermes-Session-Key=<channel|session>` 启用 scoped 记忆 |
| **QQBot 原生审批键盘**（PR #21342） | QQ 渠道审批 UI 与 Telegram/Discord 一致 | 撤销原 `patch_qqbot_sandbox` 后，QQ 审批应自动走原生键盘 |
| **7 个新 locale**（中/日/德/西/法/乌/土） | Hermes 静态 gateway/CLI 文案多语言 | 部分文案（如 `gateway/run.py:15066` plain-text approval prompt fallback）仍是英文硬编码 — upstream gap，已记录 |

**🟢 v0.13 新增、Corey 当前未利用但值得追的能力：**

| 能力 | 价值 | 优先级 |
|------|------|--------|
| **Multi-Agent Kanban (durable)** + worker lifecycle | 多 agent 任务编排板（heartbeat / reclaim / zombie 检测 / per-task max_retries） | 中（Pack 级编排可借力） |
| **`/goal` Ralph loop**（持久目标，跨 turn 锁定） | 长任务跑偏检测 + Recovery | 中（影响 workflow 设计） |
| **Checkpoints v2** | 状态持久化重写，真 pruning + disk guardrails | 低（Corey 不依赖） |
| **`no_agent` cron 模式** | Cron 任务跳过 agent，纯脚本 watchdog | 中（Corey scheduler 可暴露这个开关） |
| **Curator subcommands**（`hermes curator archive/prune/list-archived`） | 后台 skill 维护 | 低（Skill Hub 页可加入口） |
| **Google Chat（第 20 个平台）** | 新 IM 渠道 | 低 |
| **SearXNG search backend** + per-capability backend selection | 自托管搜索 | 低（Corey 不直接控制 web 工具） |
| **`hermes -z` one-shot + `[[as_document]]` 媒体路由** | One-shot 已被 Corey workflow 使用；`as_document` 是新指令 | 低（Skill 作者关心，Corey 不写 skill） |
| **API server `X-Hermes-Session-Key`** | 见上 | 中（接入长期记忆时再做） |
| **TUI `/model` 选择器对齐 `hermes model`** | TUI 端体验改善，Corey 桌面端不依赖 | 低 |

**❌ v0.13 移除/重命名（确认 Corey 不依赖）：**

- `flush_memories`（0.12 已移除，0.13 持续）— Corey 未使用 ✅
- `/provider` + `/plan` slash 命令（0.12 删，0.13 持续）— Corey 未使用 ✅
- `BOOT.md` 内置 hook（0.12 删，0.13 持续）— Corey 未使用 ✅
- 4 个 Hermes patch 函数（Corey 主动 retire）— `gateway.rs` 标 `#[allow(dead_code)]` 保留备查，已不在调用链 ✅

### v0.13.0 升级验证结果（2026-05-12）

- [x] Hermes 升级到 0.13.0，`pip install -e .` 完成，依赖 `ruamel.yaml` / `psutil` / `tzdata` 装好
- [x] Hermes source 3 个被 patch 文件 `git checkout` 还原，working tree clean
- [x] 4 个 `patch_*` 函数全部从启动路径移除（`gateway.rs`），doctest 编译失败已修
- [x] `/v1/runs` + `/v1/runs/{run_id}/events` + `/v1/runs/{run_id}/approval` 三端点接入 (`adapters/hermes/gateway/{mod,types,tests}.rs`)
- [x] `RunEvent` 9 变体全部覆盖单元测试（`run_event_parses_each_variant` + `run_event_tolerates_unknown_extra_fields`）
- [x] `hermes_approval_pending` IPC 删除；`hermes_approval_respond` 改走 `/v1/runs/{run_id}/approval`
- [x] 前端：`ChatApprovalRequest.run_id` + `choices`；`ApprovalCard.tsx` + `useTalkMode.ts` 透传 `run_id`
- [x] CI gate 全绿：`cargo fmt --check` + `cargo test`（546/546）+ `clippy unwrap baseline`（546=546）+ `tsc --noEmit` + `eslint` + `vitest`（112/112）
- [x] SOUL.md L0 元铁律 + corey-guards 物理拦截层落地（`src-tauri/src/{soul_md,hermes_hooks}.rs` + `src-tauri/assets/corey-guards/file-ops-guard.py`）
- [x] Settings → 安全防护 卡片接入 (`SecuritySection.tsx`)
- [ ] **UI 端到端实机验证**（用户手动）：boot 日志 / Settings 卡片 / guard 拦 rm + Python / 普通聊天走 `/v1/runs` 通 / 触发 dangerous command 看到审批卡片
- [ ] Windows 实机验收：Hermes 0.13 在 Windows 上 `gateway run` + `CREATE_NO_WINDOW` 行为是否仍稳定（Atomic restart markers PR #18179 改了 Windows runtime-lock offset）
- [ ] **`HERMES_MAX_TESTED` 升到 `(0, 13)`**（升级完毕后再 bump，避免预提升导致虚假"已测试"标记）

---

## 11. 跨平台注意事项

Corey 同时支持 Windows 和 macOS，Hermes 集成的平台差异：

| 差异点 | macOS | Windows | Corey 代码位置 |
|--------|-------|---------|---------------|
| Gateway 前台运行 | `hermes gateway run` | `hermes gateway run` + `CREATE_NO_WINDOW` | `hermes_config/gateway.rs` |
| Gateway 系统服务 | launchd (`hermes gateway install`) | 不支持（Windows 无 systemd） | 未来可能支持 |
| CLI 二进制查找 | PATH + `/usr/local/bin/hermes` | PATH + `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe` | `hermes_config/gateway.rs` |
| Hermes Home 默认 | `~/.hermes` | `%LOCALAPPDATA%\hermes` | `paths.rs` → `hermes_data_dir()` |
| 环境变量 | `$HOME` | `%USERPROFILE%` | 使用 `dirs` crate |
| 进程窗口抑制 | 不需要 | `.creation_flags(CREATE_NO_WINDOW)` | `hermes_config/gateway.rs` |
| Bootstrap 脚本 | bash | PowerShell (`bootstrap-windows.ps1`) | `src-tauri/assets/scripts/` |
| Windows Bootstrap 日志 | `~/.hermes/logs/bootstrap-macos.log` | `%LOCALAPPDATA%/Corey/logs/bootstrap-windows.log`（记录 exit_code；实时输出通过 `Stdio::inherit()` 到 PowerShell 窗口） | `hermes_config/gateway.rs` |
| Windows Bootstrap 环境注入 | `HERMES_HOME` | `HERMES_HOME` + `COREY_INSTALL_DIR`（Corey exe 所在目录） | `hermes_config/gateway.rs` |

**⚠️ Hermes 更新时重点检查：**
- Windows 上 `hermes.exe` 安装路径是否变更
- `CREATE_NO_WINDOW` flag 是否仍需要
- `HERMES_HOME` / `COREY_HERMES_DIR` 是否仍被支持
- Bootstrap 脚本是否需要更新

---

## 12. Hermes 更新检查清单

当 Hermes 发布新版本时，按以下清单逐项检查：

### Step 1：CLI 兼容性
- [ ] `hermes skills` 子命令名是否变更
- [ ] `hermes gateway start/restart/run` 命令是否变更
- [ ] `hermes --version` 输出格式是否变更
- [ ] `python3 -m hermes_cli` 模块路径是否变更
- [ ] CLI stdout 输出格式是否变更（Corey 直接渲染）
- [ ] Corey 白名单中的子命令是否被 Hermes 删除或重命名
- [ ] 新增的子命令是否需要加入白名单

### Step 2：Gateway API 兼容性
- [ ] `/health` 响应格式是否变更
- [ ] `/v1/chat/completions` SSE 事件格式是否变更（`hermes.tool.progress` 结构、[DONE] 哨兵、reasoning_content / delta 字段）
- [ ] `/v1/models` 响应格式是否变更
- [ ] `/v1/runs` + `/v1/runs/{run_id}/events` SSE 事件格式是否变更（`message.delta` / `tool.started` / `tool.completed` / `reasoning.available` / `approval.request` / `approval.responded` / `run.completed` / `run.failed` / `run.cancelled`）
- [ ] `/v1/runs/{run_id}/approval` POST payload 是否变更（`choice` 取值集 / 别名 / `all` 标志）
- [ ] 是否新增 Corey 可利用的新端点
- [ ] `API_SERVER_*` 环境变量是否变更
- [ ] `~~/api/approval/respond~~` / `~~/api/approval/pending~~` 2026-05-11 已 retire，不再检查

### Step 3：文件系统兼容性
- [ ] `config.yaml` 是否新增必填字段
- [ ] `config.yaml` 已有字段是否改名/删除
- [ ] `config.yaml` config version 是否递增
- [ ] `state.db` 的 messages/messages_fts schema 是否变更
- [ ] `memory_store.db` 的 facts 表 schema 是否变更
- [ ] `cron/jobs.json` 格式是否变更
- [ ] `sessions/` 文件命名格式是否变更
- [ ] 日志文件标记文本是否变更
- [ ] `.env` 变量名是否变更
- [ ] `auth.json` 是否新增必要 OAuth 字段
- [ ] `MEMORY.md` / `USER.md` 格式约定是否变更
- [ ] `skills/` 目录结构是否变更

### Step 4：行为兼容性
- [ ] Gateway 是否支持 config.yaml 热加载
- [ ] Gateway 是否新增 `/reload-mcp` HTTP 端点（已有聊天命令）
- [ ] Gateway 是否新增 `/health/channels` 端点
- [ ] `HERMES_HOME` 环境变量是否仍被支持
- [ ] 审批流 SSE 事件格式是否变更
- [ ] 默认端口是否变更
- [ ] Cron 60s tick 间隔是否变更
- [ ] MCP Dynamic Tool Discovery 行为是否变更

### Step 5：跨平台验证
- [ ] macOS: 启动 Gateway → 聊天 → Skill Hub → MCP → 频道 → 定时任务 → 记忆
- [ ] Windows: 同上
- [ ] Windows: `hermes.exe` 路径是否仍有效
- [ ] Windows: `CREATE_NO_WINDOW` 是否仍需要
- [ ] Windows: bootstrap 日志路径/exit_code 记录是否仍有效
- [ ] Windows: `COREY_INSTALL_DIR` 注入是否仍被脚本使用

### Step 6：文档更新
- [ ] 更新 `HERMES_MIN_SUPPORTED` 如果最低版本变更
- [ ] 更新本文档
- [ ] 更新 `project_rules.md` 中的 Hermes 依赖规则

---

## 13. Corey 自有功能（不依赖 Hermes）

以下功能完全由 Corey 自己实现，Hermes 更新不影响：

| 功能 | 实现位置 | 说明 |
|------|---------|------|
| 工作流引擎 | `ipc/workflow/`, `workflow_engine/` | Corey 自研，不调用 Hermes |
| MCP Native Bridge | `mcp_server/` | Corey 自己跑的 HTTP MCP Server |
| 学习提取 | `ipc/learning/mod.rs` | 写入 `MEMORY.md`/`LEARNINGS.md`，但格式遵循 Hermes 约定 |
| 截图审计 | `ipc/screenshot_audit.rs` | Corey 专用 |
| 语音 | `ipc/voice/` | Corey 专用 |
| 会话搜索 | `ipc/session_search.rs` | 读 state.db 但不依赖 Hermes 逻辑 |
| 变更日志/回滚 | `ipc/changelog.rs` | Corey 专用 |
| LLM Profile 管理 | `ipc/llm_profiles.rs` | Corey 专用 |
| 预算控制 | `ipc/budgets.rs` | Corey 专用 |
| 数据目录管理 | `ipc/paths.rs` | Corey 专用 |
| Tauri Updater | 内置插件 | 不依赖 Hermes |
| Instance 管理 | `ipc/hermes_instances.rs` | Corey 管理 API 端点配置 |
| COS CDN 更新 | `.github/workflows/sync-cos.yml` | 腾讯云 COS 自动同步 release 产物 |
| 统一下载中心 | `ipc/download.rs`（v0.1.11） | 应用更新 + 模型下载进度管理 |
| BGE-M3 Embedding | `ipc/embedding.rs`（v0.1.11） | 本地 ONNX 推理，不依赖 Hermes |

**注意：** `ipc/learning/mod.rs` 虽然是 Corey 自有逻辑，但它写入 `MEMORY.md` 的格式遵循 Hermes 的 `## [auto]` 约定，如果 Hermes 变更 MEMORY.md 的注入格式，学习功能也需要适配。

---

## 14. 更新日志

| 日期 | 版本 | Hermes 版本 | 变更内容 | Corey 适配 |
|------|------|-----------|---------|-----------|
| 2026-04-29 | v1.0 | 0.10-0.11 | 初始文档创建 | — |
| 2026-04-29 | v2.0 | 0.10-0.11 | 基于 Hermes 官方文档全面更新：补充 28 个未调用 CLI 命令、完整目录结构、auth.json/SOUL.md/memory_store.db、config.yaml 4.2/4.3 分类、.env 完整变量列表、MCP/记忆/频道集成细节、跨平台注意事项、config version 17 迁移信息 | — |
| 2026-04-29 | v2.1 | 0.10-0.11 | 同步代码现状：补充 `/api/approval/pending` 依赖；更新 Windows bootstrap 日志与环境注入说明（`COREY_DATA_DIR`、exit_code 日志） | — |
| 2026-04-29 | v2.2 | 0.10-0.11 | 补充 COS CDN 更新流程、统一下载中心、BGE-M3 Embedding（v0.1.9 计划） | — |
| 2026-04-29 | v2.2 | 0.11 | Windows bootstrap 重写：`COREY_INSTALL_DIR` 替代 `COREY_DATA_DIR`，安装到 Corey exe 同级目录；`resolve_hermes_binary()` 新增 Corey 安装目录搜索路径；`Stdio::inherit()` 替代 `Stdio::piped()` 显示实时进度；PowerShell 5.1 兼容性修复；`gateway run` 替代 `gateway start`（Windows 不支持 start） | `gateway.rs` `resolve_hermes_binary()`, `bootstrap-windows.ps1` |
| 2026-05-01 | v2.3 | 0.12 | Hermes v0.12.0 影响分析：新增 pluggable gateway platforms、curator 系统、5 个新 Provider、2 个新平台（Teams/元宝）、API Server run status/stop 端点、Cron workdir/context_from 字段、TTS provider registry、state.db trigram FTS5。`secret redaction` 默认改为关闭。`flush_memories` / `/provider` / `/plan` 已移除。核心 API（chat completions / health / config.yaml / .env）无 breaking change。 | 需验证 QQ/WeChat 适配器仍内置；可选适配新 Provider 和新端点 |
| 2026-05-01 | v2.4 | 0.12 | 完成 v0.12 升级落地：`HERMES_MAX_TESTED` 提升到 `(0, 12)`；Chat Stop 升级为后端 hard stop（新增 `chat_stream_cancel`）。补充 v0.12 验证清单状态。 | `ipc/chat.rs`, `src/lib/ipc/chat.ts`, `hermes_config/gateway.rs` |
| 2026-05-01 | v2.5 | 0.12 | 完成全部 v0.12 适配：Teams + 元宝频道（19 个）、Cron workdir/context_from 显式建模、`hermes_update_check` IPC + Settings UI、`hermes_oneshot` IPC（`hermes -z`）、Session search trigram 检测 + 查询适配、Skill Hub reload hint。CI 模拟通过（tsc + eslint + build + cargo check + cargo test 391/0 + cargo fmt）。 | `channels/mod.rs`, `hermes_cron.rs`, `ipc/scheduler.rs`, `ipc/hermes_config.rs`, `ipc/workflow/mod.rs`, `ipc/session_search.rs`, `features/settings/`, `locales/` |
| 2026-05-01 | v2.6 | 0.12 | Windows 启动链路修复：`hermes_data_dir()` 新增 `HERMES_HOME` 兼容读取；`windows_gateway_spawn` 改为 stdout/stderr 文件日志（`gateway-stdout.log` / `gateway-stderr.log`）、移除 `DETACHED_PROCESS`，增强 `gateway-start.log` 诊断；安装完成后 Home 安装卡自动 `recheck`。本地 CI 复测全绿；Windows 最终实机验收待 `v0.1.13` 包。 | `paths.rs`, `hermes_config/gateway.rs`, `features/home/HermesInstallCard.tsx` |
| 2026-05-07 | v3.0 | 0.12 | 基于 Hermes 官方文档全面核对（逐模块对比代码 vs 文档）：§1 修正 `gateway run` 描述（不限于 Windows，是前台运行模式）；补充 `hermes model/tools/setup/pairing` 等未列出命令；补充 Hermes 不支持原生 Windows 说明。§2 补充审批端点是 Corey patch 注入而非 Hermes 原生。§3 目录结构扩充（pairing/hooks/gateway.json/whatsapp/session/sandboxes/modal_snapshots.json 等）；修正 `error.log` → `errors.log`。§4 修正 config.yaml 字段名为代码实际值（`model.default` 非 `model.name`、`approvals.timeout`/`cron_mode` 等）；§4.3 新增 30+ 个 Hermes 官方支持的字段（terminal.*/stt.*/tts.*/voice.*/display.*/mcp_servers 子字段等）；标注 `config.yaml ${VAR}` 替换语法和 `approvals.mode` 值差异。§5.3 新增 Terminal Backend/STT/TTS/Tools 相关环境变量。§9 频道表拆分 WeCom Callback 为独立行、标注 DingTalk QR。 | 全文档 |
| 2026-05-11 | v4.0 | **0.13** | 升级 Hermes 0.12.0 → 0.13.0 (2026.5.7)，+1296 commits。重大架构决策：**永不 patch Hermes 源码**。§2 retire 4 个 `patch_*` 函数（`patch_approval_sse` / `patch_dangerous_patterns` / `patch_qqbot_sandbox` / `patch_approval_prompt_template`），`/api/approval/*` 端点标为 retired。Hermes 0.13.0 原生在 `/v1/runs` / `/v1/runs/{run_id}/events` / `/v1/runs/{run_id}/approval` 提供审批 SSE，待下次 session 迁移。新增 `corey-guards` 物理拦截层 + `SOUL.md` marker-delimited 铁律注入替代一部分原 patch 行为。详见 `docs/session-handoff-2026-05-11-pm.md` + `docs/migrations/hermes-v0.13-runs-endpoint.md`。 | Hermes source 3 个文件 `git checkout` 还原；`gateway.rs` patch 调用点注释；Python venv `pip install -e .`（新依赖 ruamel.yaml/psutil/tzdata）；新增 `src-tauri/src/{soul_md,hermes_hooks}.rs` + `src/features/settings/sections/SecuritySection.tsx` |
| 2026-05-12 | v5.0 | **0.13** | **完成 `/v1/runs` 迁移 + 全文档基于 0.13.0 源码核对**。§2 完整重写：拆分 Corey 在用 / 未用 / 已 retire 三类端点；列出 9 个 `RunEvent` SSE 变体的精确字段；记录 `X-Hermes-Session-Id` / `X-Hermes-Session-Key` 双头；`run.completed.usage` 字段名 `input_tokens`/`output_tokens` 与 OpenAI 不同。§10 新增 v0.13.0 影响分析（4 个 breaking + 9 个潜在影响 + 10 个未利用能力）+ v0.13.0 升级验证清单。Config version 从 17 → 23 变更说明（v22/v23 加 `curator.*`，纯 additive）。`secret redaction` 默认 ON（0.12 是 OFF）— Corey 读 log 需容错 `[REDACTED]`。 | `adapters/hermes/gateway/{mod,types,tests}.rs`、`ipc/chat.rs`、`lib.rs`、`hermes_config/gateway.rs`（doctest fix）、`src/lib/ipc/chat.ts`、`src/features/chat/ApprovalCard.tsx`、`src/features/talk/useTalkMode.ts` |
| 2026-05-12 | v5.1 | **0.13** | **4 项 v0.13 落地修复 + SOUL.md 反虚构铁律 + UI 端到端验证通过**。（1）`HERMES_MAX_TESTED` `(0, 12)` → `(0, 13)`，加 anchor 测试 `supported_at_max_tested_v0_13`，UI 不再显示"untested"黄条。（2）**errors.log 文件名 bug fix**：Hermes 0.13 写 `errors.log`（带 s），Corey 之前死读 `error.log` → Logs UI 错误页空白。改为 canonical-优先-legacy-fallback，加 3 个测试。（3）**Windows runtime-lock offset (PR #18179) 适配**：Hermes 0.13 `gateway.pid` → `gateway.lock` (JSON `{pid, kind, argv, start_time}`)。新增 `read_gateway_pid()` 跨平台帮助函数，6 个单元测试。（4）**SOUL.md 第二组 C「禁止虚构工具结果」铁律**：补昨晚发现的 LLM 在微信渠道编造"备份已完成"幻觉漏洞（agent.log 实证：5 分 18 秒 / 0 工具调用 / 227 字符虚构）。01:08 真人 UI 重测「删了它」→ agent 真调 search_files + terminal，guard 真 BLOCK，agent 回复内容 100% 与 guard log 对齐 ✅。`HERMES_MAX_TESTED` 真人横幅验证待后续 session。 | `hermes_config/gateway.rs` (`MAX_TESTED` + `read_gateway_pid` + `windows_gateway_stop` + 2 新 test mod)、`hermes_logs.rs` (`legacy_filename` + 路径解析 + 3 测试)、`assets/soul/corey_iron_rules.md` (第二组 C 段 + 反模式表 + 自检从 6→7 题) |
