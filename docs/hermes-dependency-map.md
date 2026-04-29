# Hermes Agent 依赖地图

> 版本：v2.1 · 2026-04-29
> 当前 Hermes 最低支持版本：0.10
> Hermes 官方文档：https://hermes-agent.nousresearch.com/docs/
> Hermes GitHub：https://github.com/NousResearch/hermes-agent
> 用途：Hermes 每次更新时，对照此文档快速定位影响范围

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
| `hermes gateway run` | `hermes_config/gateway.rs` (Windows) | Windows 前台运行 Gateway | 同上 |
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
| `hermes gateway stop` | 停止 Gateway 服务 | 停止按钮 |
| `hermes gateway status` | 查看 Gateway 状态 | 状态页面 |
| `hermes gateway uninstall` | 卸载系统服务 | 卸载流程 |
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
- Windows 上 `gateway run` vs `gateway start` 行为是否变化
- Corey 白名单中的子命令是否被 Hermes 删除或重命名
- 新增的子命令是否需要加入白名单

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

| 端点 | 方法 | 调用位置 | 用途 | 风险 |
|------|------|---------|------|------|
| `/health` | GET | `adapters/hermes/gateway/mod.rs` | Gateway 存活检测 | 响应格式变更 → 状态判断错误 |
| `/v1/chat/completions` | POST (stream) | `adapters/hermes/gateway/mod.rs` | 流式聊天 | SSE 格式变更 → 聊天中断 |
| `/v1/chat/completions` | POST (non-stream) | `adapters/hermes/gateway/mod.rs` | 单轮聊天 | 响应 JSON 变更 → 解析失败 |
| `/v1/models` | GET | `adapters/hermes/probe.rs`, `ipc/hermes_instances.rs` | 模型列表探测 | 响应格式变更 → 模型列表为空 |
| `/api/approval/respond` | POST | `ipc/chat.rs` | 审批响应 | 路径/格式变更 → 审批流中断 |
| `/api/approval/pending` | POST | `hermes_config/gateway.rs` (patch 注入) | 查询待审批项 | 路径/格式变更 → 审批恢复/轮询失败 |

**SSE 事件类型依赖（`/v1/chat/completions` stream）：**

| 事件类型 | 用途 | Corey 处理位置 |
|---------|------|---------------|
| `ChatStreamEvent::Delta` | 增量文本 | `ipc/chat.rs` → 前端渲染 |
| `ChatStreamEvent::Tool` | 工具调用进度 | `ipc/chat.rs` → 前端工具卡片 |
| `ChatStreamEvent::Approval` | 审批请求 | `ipc/chat.rs` → 前端审批卡片 |
| `ChatStreamEvent::Reasoning` | 思考过程 | `ipc/chat.rs` → 前端推理展示 |

**⚠️ Hermes 更新时重点检查：**
- SSE 事件格式是否新增/删除字段
- `tool` 事件的 progress 结构是否变化
- `approval` 事件的交互协议是否变化
- `/health` 响应是否新增必要字段
- `/api/approval/respond` 路径是否变更
- `/api/approval/pending` 路径是否变更
- `API_SERVER_*` 环境变量是否变更默认值

---

## 3. 文件系统依赖

CoreyOS 读写 Hermes 管理的文件。**文件路径/格式变更 = 功能静默失败。**

Hermes 官方目录结构：
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
│   └── error.log
├── profiles/          # Profile 配置
│   └── <name>/
│       └── config.yaml
└── memory_store.db    # Holographic 记忆 SQLite (facts 表)
```

### 3.1 读取（Corey 只读，Hermes 拥有）

| 文件/目录 | 路径 | Corey 用途 | 风险 |
|----------|------|-----------|------|
| Agent 日志 | `~/.hermes/logs/agent.log` | 压缩统计、频道状态探测 | 日志格式变更 → 统计错误 |
| Gateway 日志 | `~/.hermes/logs/gateway.log` | 频道在线状态探测 | 同上 |
| 错误日志 | `~/.hermes/logs/error.log` | 错误日志查看页 | 同上 |
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
| `model.provider` | `hermes_config/yaml.rs` | 模型提供商 |
| `model.name` | `hermes_config/yaml.rs` | 模型名称 |
| `model.base_url` | `hermes_config/yaml.rs` | API Base URL |
| `model.api_key_env` | `hermes_config/yaml.rs` | API Key 环境变量名 |
| `model.profile` | `hermes_config/yaml.rs` | 当前活跃 Profile |
| `compression.enabled` | `hermes_config/yaml.rs` | 上下文压缩开关 |
| `compression.method` | `hermes_config/yaml.rs` | 压缩方法 |
| `compression.threshold` | `hermes_config/yaml.rs` | 压缩阈值 |
| `approvals.mode` | `hermes_config/yaml.rs` | 审批模式 (manual/smart/off) |
| `approvals.allowed_commands` | `hermes_config/yaml.rs` | 允许的命令 |
| `command_allowlist` | `hermes_config/yaml.rs` | 命令白名单 |
| `mcp_servers.<id>` | `ipc/mcp.rs`, `mcp_server/mod.rs` | MCP Server 配置 |
| `mcp_servers.<id>.url` | `mcp_server/mod.rs` | MCP HTTP URL |
| `mcp_servers.<id>.command` | `ipc/mcp.rs` | MCP stdio 命令 |
| `mcp_servers.<id>.args` | `ipc/mcp.rs` | MCP stdio 参数 |
| `mcp_servers.<id>.env` | `ipc/mcp.rs` | MCP 环境变量 |
| `channels.<channel>.<field>` | `ipc/channels/mod.rs` | IM 频道配置 |
| `discord.require_mention` | `ipc/channels/mod.rs` | Discord @提及要求 |
| `discord.free_response_channels` | `ipc/channels/mod.rs` | Discord 自由回复频道 |
| `discord.auto_thread` | `ipc/channels/mod.rs` | Discord 自动开线程 |

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
| `compression.target_ratio` | 压缩保留比例 | 压缩设置页面 |
| `compression.protect_last_n` | 保留最近 N 条消息 | 压缩设置页面 |
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
| `context.engine` | 上下文引擎选择 | 高级设置 |
| `cron.script_timeout_seconds` | Cron 脚本超时 | 定时任务设置 |
| `delegation.*` | 委派配置 | 多 Agent 设置 |
| `display.*` | 显示设置 | UI 设置 |
| `streaming.*` | 流式设置 | 性能设置 |
| `voice.*` / `tts.*` | 语音/TTS 配置 | 语音设置 |
| `browser.*` | 浏览器配置 | 浏览器自动化 |
| `memory.memory_enabled` | 记忆开关 | 记忆设置 |
| `memory.user_profile_enabled` | 用户画像开关 | 记忆设置 |
| `memory.memory_char_limit` | 记忆字符限制 | 记忆设置 |
| `memory.user_char_limit` | 用户画像字符限制 | 记忆设置 |

**⚠️ Hermes 更新时重点检查：**
- 以上字段是否有改名/删除/类型变更
- 是否新增必填字段（Corey 不写 → Gateway 报错）
- `mcp_servers` 条目是否新增必要子字段
- `compression.summary_model/provider/base_url` → `auxiliary.compression.*` 迁移是否完成
- Hermes config version 是否递增（当前 config version 17）

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
`DELEGATION_MAX_CONCURRENT_CHILDREN`

**Cron/Session：**
`HERMES_CRON_TIMEOUT`, `HERMES_CRON_SCRIPT_TIMEOUT`, `SESSION_IDLE_MINUTES`, `SESSION_RESET_HOUR`

**Auxiliary：**
`AUXILIARY_VISION_*`, `AUXILIARY_WEB_EXTRACT_*`

**Gateway：**
`GATEWAY_PROXY_URL`, `GATEWAY_PROXY_KEY`, `MESSAGING_CWD`,
`GATEWAY_ALLOWED_USERS`, `GATEWAY_ALLOW_ALL_USERS`

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
| 钉钉 | `hermes-dingtalk` | ✅ | `DINGTALK_*` |
| 飞书 | `hermes-feishu` | ✅ | `FEISHU_*` |
| 企业微信 | `hermes-wecom` / `hermes-wecom-callback` | ✅ | `WECOM_*` |
| 微信 | `hermes-weixin` | ✅ (QR) | `WEIXIN_*` |
| Mattermost | `hermes-mattermost` | ⬜ | `MATTERMOST_*` |
| Matrix | `hermes-matrix` | ✅ | `MATRIX_*` |
| Home Assistant | `hermes-homeassistant` | ⬜ | `HASS_*` |
| BlueBubbles (iMessage) | `hermes-bluebubbles` | ⬜ | `BLUEBUBBLES_*` |
| QQ Bot | `hermes-qqbot` | ✅ (QR) | `QQ_*` |
| 元宝 | `hermes-yuanbao` | ⬜ | — |
| Webhook | `hermes-webhook` | ✅ | `WEBHOOK_*` |

Corey 频道 Token 探测（`ipc/channels/probe.rs`）：仅支持单 GET 探测的平台（Telegram/Discord/Slack），多凭证平台（WeCom/Feishu/WeiXin）和安装器驱动平台（Matrix/WhatsApp）暂不支持在线探测。

---

## 10. Hermes 版本兼容性

| Hermes 版本 | Corey 兼容性 | 说明 |
|------------|-------------|------|
| < 0.10 | ❌ 不支持 | `HERMES_MIN_SUPPORTED = (0, 10)` |
| 0.10 | ✅ 完全兼容 | 当前基准版本 |
| 0.11 | ✅ 兼容 | 新增 provider/transport，已有字段不变；新增 sessions 自动清理 |

**版本检测代码位置：** `hermes_config/gateway.rs` → `HERMES_MIN_SUPPORTED`

**Hermes config version 历史：**
- config version 17: `compression.summary_*` → `auxiliary.compression.*` 自动迁移

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
| Windows Bootstrap 日志 | `~/.hermes/logs/bootstrap-macos.log` | `%LOCALAPPDATA%/Corey/logs/bootstrap-windows.log`（记录 exit_code） | `hermes_config/gateway.rs` |
| Windows Bootstrap 环境注入 | `HERMES_HOME` | `HERMES_HOME` + `COREY_DATA_DIR` | `hermes_config/gateway.rs` |

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
- [ ] `/v1/chat/completions` SSE 事件格式是否变更
- [ ] `/v1/models` 响应格式是否变更
- [ ] `/api/approval/respond` 路径/格式是否变更
- [ ] 是否新增 Corey 可利用的新端点
- [ ] `API_SERVER_*` 环境变量是否变更

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
- [ ] Windows: `COREY_DATA_DIR` 注入是否仍被脚本使用

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

**注意：** `ipc/learning/mod.rs` 虽然是 Corey 自有逻辑，但它写入 `MEMORY.md` 的格式遵循 Hermes 的 `## [auto]` 约定，如果 Hermes 变更 MEMORY.md 的注入格式，学习功能也需要适配。

---

## 14. 更新日志

| 日期 | 版本 | Hermes 版本 | 变更内容 | Corey 适配 |
|------|------|-----------|---------|-----------|
| 2026-04-29 | v1.0 | 0.10-0.11 | 初始文档创建 | — |
| 2026-04-29 | v2.0 | 0.10-0.11 | 基于 Hermes 官方文档全面更新：补充 28 个未调用 CLI 命令、完整目录结构、auth.json/SOUL.md/memory_store.db、config.yaml 4.2/4.3 分类、.env 完整变量列表、MCP/记忆/频道集成细节、跨平台注意事项、config version 17 迁移信息 | — |
| 2026-04-29 | v2.1 | 0.10-0.11 | 同步代码现状：补充 `/api/approval/pending` 依赖；更新 Windows bootstrap 日志与环境注入说明（`COREY_DATA_DIR`、exit_code 日志） | — |
