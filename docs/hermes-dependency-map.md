# Hermes Agent 依赖地图

> 版本：v1.0 · 2026-04-29
> 当前 Hermes 最低支持版本：0.10
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

**⚠️ Hermes 更新时重点检查：**
- CLI 子命令名是否变更（如 `gateway start` → `gateway launch`）
- 输出格式是否变更（Corey 直接渲染 CLI stdout）
- `--json` flag 是否稳定（目前未使用，但未来可能依赖）
- Windows 上 `gateway run` vs `gateway start` 行为是否变化

---

## 2. Gateway HTTP API

CoreyOS 通过 HTTP 调用的 Hermes Gateway 端点。**API 路径/响应格式变更 = 聊天功能中断。**

| 端点 | 方法 | 调用位置 | 用途 | 风险 |
|------|------|---------|------|------|
| `/health` | GET | `adapters/hermes/gateway/mod.rs` | Gateway 存活检测 | 响应格式变更 → 状态判断错误 |
| `/v1/chat/completions` | POST (stream) | `adapters/hermes/gateway/mod.rs` | 流式聊天 | SSE 格式变更 → 聊天中断 |
| `/v1/chat/completions` | POST (non-stream) | `adapters/hermes/gateway/mod.rs` | 单轮聊天 | 响应 JSON 变更 → 解析失败 |
| `/v1/models` | GET | `adapters/hermes/probe.rs` | 模型列表探测 | 响应格式变更 → 模型列表为空 |
| `/api/approval/respond` | POST | `ipc/chat.rs` | 审批响应 | 路径/格式变更 → 审批流中断 |

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

---

## 3. 文件系统依赖

CoreyOS 读写 Hermes 管理的文件。**文件路径/格式变更 = 功能静默失败。**

### 3.1 读取（Corey 只读，Hermes 拥有）

| 文件/目录 | 路径 | Corey 用途 | 风险 |
|----------|------|-----------|------|
| Hermes 日志 | `~/.hermes/logs/agent.log` | 压缩统计、频道状态探测 | 日志格式变更 → 统计错误 |
| Hermes 日志 | `~/.hermes/logs/gateway.log` | 频道在线状态探测 | 同上 |
| Hermes 日志 | `~/.hermes/logs/error.log` | 错误日志查看页 | 同上 |
| 会话数据库 | `~/.hermes/state.db` | 全文搜索（FTS5）| schema 变更 → 搜索失败 |
| 会话文件 | `~/.hermes/sessions/session_*.json` | 会话磁盘占用统计 | 文件名格式变更 → 统计不准 |
| 会话文件 | `~/.hermes/sessions/session_*_*.jsonl` | 同上 | 同上 |
| 定时任务输出 | `~/.hermes/cron/output/{job_id}/` | Scheduler 页面展示运行结果 | 目录结构变更 → 结果不可见 |
| Skill 文件 | `~/.hermes/skills/*.md` | Skill 列表展示 | 目录结构变更 → 列表为空 |
| 压缩日志标记 | `"Context compression triggered"` | 压缩统计 | 日志文本变更 → 统计归零 |
| 压缩日志标记 | `"Compressed: ... tokens saved"` | 同上 | 同上 |

### 3.2 读写（Corey 和 Hermes 共享）

| 文件 | 路径 | Corey 写入内容 | Hermes 读取时机 | 风险 |
|------|------|---------------|---------------|------|
| 主配置 | `~/.hermes/config.yaml` | model/compression/approvals/mcp_servers/channels | Gateway 启动/重启 | YAML schema 变更 → 写入的字段被忽略或报错 |
| 环境变量 | `~/.hermes/.env` | API Key（OPENAI_API_KEY 等）| Gateway 启动 | 格式变更 → Key 不被识别 |
| Profile 配置 | `~/.hermes/profiles/<name>/config.yaml` | 创建/克隆/重命名 Profile | Gateway 切换 profile | 目录结构变更 → Profile 切换失败 |
| 定时任务 | `~/.hermes/cron/jobs.json` | CRUD 定时任务 | Gateway 运行时 | JSON schema 变更 → 任务不执行 |

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
- `cron/jobs.json` 格式是否变更
- `.env` 文件是否新增必要变量
- `sessions/` 目录文件命名格式是否变更
- 日志文件中的标记文本是否变更

---

## 4. config.yaml 字段依赖

Corey 写入的具体 YAML 字段。**字段改名/删除 = 配置静默丢失。**

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
| `approvals.mode` | `hermes_config/yaml.rs` | 审批模式 |
| `approvals.allowed_commands` | `hermes_config/yaml.rs` | 允许的命令 |
| `command_allowlist` | `hermes_config/yaml.rs` | 命令白名单 |
| `mcp_servers.<id>` | `ipc/mcp.rs`, `mcp_server/mod.rs` | MCP Server 配置 |
| `mcp_servers.<id>.url` | `mcp_server/mod.rs` | MCP HTTP URL |
| `mcp_servers.<id>.command` | `ipc/mcp.rs` | MCP stdio 命令 |
| `mcp_servers.<id>.args` | `ipc/mcp.rs` | MCP stdio 参数 |
| `mcp_servers.<id>.env` | `ipc/mcp.rs` | MCP 环境变量 |
| `channels.<channel>.<field>` | `ipc/channels/mod.rs` | IM 频道配置 |

**⚠️ Hermes 更新时重点检查：**
- 以上字段是否有改名/删除/类型变更
- 是否新增必填字段（Corey 不写 → Gateway 报错）
- `mcp_servers` 条目是否新增必要子字段

---

## 5. .env 变量依赖

Corey 写入的环境变量。Hermes Gateway 启动时读取。

| 变量名 | Corey 写入位置 | 用途 |
|--------|---------------|------|
| `OPENAI_API_KEY` | `hermes_config/env.rs` | OpenAI API Key |
| `ANTHROPIC_API_KEY` | `hermes_config/env.rs` | Anthropic API Key |
| `GOOGLE_API_KEY` | `hermes_config/env.rs` | Google API Key |
| `DEEPSEEK_API_KEY` | `hermes_config/env.rs` | DeepSeek API Key |
| `TELEGRAM_BOT_TOKEN` | `ipc/channels/mod.rs` | Telegram Bot Token |
| `MATRIX_ACCESS_TOKEN` | `ipc/channels/mod.rs` | Matrix Token |
| `DISCORD_BOT_TOKEN` | `ipc/channels/mod.rs` | Discord Bot Token |
| 其他 IM 频道 Token | `ipc/channels/mod.rs` | 频道认证 |

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
| Gateway 不提供 `/reload-mcp` 端点 | MCP 变更后需重启 Gateway | 如果 Hermes 新增此端点 → 可跳过重启 |
| Gateway 不提供 `/health/channels` 端点 | Corey 从日志文件推断频道状态 | 如果 Hermes 新增此端点 → 可替代日志解析 |
| Gateway 默认端口 8642 | Corey 固定 MCP Server 端口 8649 | 端口冲突风险 |
| Gateway 使用 `HERMES_HOME` 环境变量 | Corey 注入 `HERMES_HOME` | 如果变量名变更 → 数据目录对不上 |
| Gateway 启动时自动清理 `sessions/*.jsonl` + VACUUM `state.db` | Corey 的会话清理面板仍工作但残留更少 | 纯兼容，无风险 |
| Gateway 审批流通过 SSE `approval` 事件推送 | Corey 前端渲染审批卡片 | 审批协议变更 → 审批流中断 |

---

## 7. Hermes 版本兼容性

| Hermes 版本 | Corey 兼容性 | 说明 |
|------------|-------------|------|
| < 0.10 | ❌ 不支持 | `HERMES_MIN_SUPPORTED = (0, 10)` |
| 0.10 | ✅ 完全兼容 | 当前基准版本 |
| 0.11 | ✅ 兼容 | 新增 provider/transport，已有字段不变；新增 sessions 自动清理 |

**版本检测代码位置：** `hermes_config/gateway.rs` → `HERMES_MIN_SUPPORTED`

---

## 8. Hermes 更新检查清单

当 Hermes 发布新版本时，按以下清单逐项检查：

### Step 1：CLI 兼容性
- [ ] `hermes skills` 子命令名是否变更
- [ ] `hermes gateway start/restart/run` 命令是否变更
- [ ] `hermes --version` 输出格式是否变更
- [ ] `python3 -m hermes_cli` 模块路径是否变更
- [ ] CLI stdout 输出格式是否变更（Corey 直接渲染）

### Step 2：Gateway API 兼容性
- [ ] `/health` 响应格式是否变更
- [ ] `/v1/chat/completions` SSE 事件格式是否变更
- [ ] `/v1/models` 响应格式是否变更
- [ ] `/api/approval/respond` 路径/格式是否变更
- [ ] 是否新增 Corey 可利用的新端点

### Step 3：文件系统兼容性
- [ ] `config.yaml` 是否新增必填字段
- [ ] `config.yaml` 已有字段是否改名/删除
- [ ] `state.db` 的 messages/messages_fts schema 是否变更
- [ ] `cron/jobs.json` 格式是否变更
- [ ] `sessions/` 文件命名格式是否变更
- [ ] 日志文件标记文本是否变更
- [ ] `.env` 变量名是否变更

### Step 4：行为兼容性
- [ ] Gateway 是否支持 config.yaml 热加载
- [ ] Gateway 是否新增 `/reload-mcp` 端点
- [ ] Gateway 是否新增 `/health/channels` 端点
- [ ] `HERMES_HOME` 环境变量是否仍被支持
- [ ] 审批流 SSE 事件格式是否变更
- [ ] 默认端口是否变更

### Step 5：测试验证
- [ ] macOS: 启动 Gateway → 聊天 → Skill Hub → MCP → 频道 → 定时任务
- [ ] Windows: 同上
- [ ] 更新 `HERMES_MIN_SUPPORTED` 如果最低版本变更
- [ ] 更新本文档

---

## 9. Corey 自有功能（不依赖 Hermes）

以下功能完全由 Corey 自己实现，Hermes 更新不影响：

| 功能 | 实现位置 | 说明 |
|------|---------|------|
| 工作流引擎 | `ipc/workflow/`, `workflow_engine/` | Corey 自研，不调用 Hermes |
| MCP Native Bridge | `mcp_server/` | Corey 自己跑的 HTTP MCP Server |
| 截图审计 | `ipc/screenshot_audit.rs` | Corey 专用 |
| 语音 | `ipc/voice/` | Corey 专用 |
| 会话搜索 | `ipc/session_search.rs` | 读 state.db 但不依赖 Hermes 逻辑 |
| 变更日志/回滚 | `ipc/changelog.rs` | Corey 专用 |
| LLM Profile 管理 | `ipc/llm_profiles.rs` | Corey 专用 |
| 预算控制 | `ipc/budgets.rs` | Corey 专用 |
| 数据目录管理 | `ipc/paths.rs` | Corey 专用 |
| Tauri Updater | 内置插件 | 不依赖 Hermes |

---

## 10. 更新日志

| 日期 | Hermes 版本 | 变更内容 | Corey 适配 |
|------|-----------|---------|-----------|
| 2026-04-29 | 0.10-0.11 | 初始文档创建 | — |
