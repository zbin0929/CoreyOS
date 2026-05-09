# Hermes v0.12.0 完整影响分析

> 日期：2026-05-01
> Hermes 版本：v0.12.0（2026-04-30 发布，1096 commits，550 PRs，213 contributors）
> CoreyOS 当前 MAX_TESTED：(0, 12)
> 分析范围：逐模块对比 Corey 代码 vs Hermes 变更

## 变更补充（2026-05-01）

- Chat 停止能力已从前端 soft stop 升级为后端 hard stop：
  - 前端 `ChatStreamHandle.cancel()` 现在调用 `chat_stream_cancel`
  - Rust 侧新增流任务注册表，按 `handle` 中止 `chat_stream_start` 启动的任务
  - 停止后仍保留已收到的内容，UI 行为与原来一致

---

## 一、版本检测系统

### Corey 当前状态
- `src-tauri/src/hermes_config/gateway.rs` L29-30:
  ```rust
  const HERMES_MIN_SUPPORTED: (u32, u32) = (0, 10);
  const HERMES_MAX_TESTED: (u32, u32) = (0, 11);
  ```
- 解析逻辑：扫描 `hermes --version` 输出中 `vX.Y.Z` 格式
- Hermes banner 格式：`Hermes Agent v0.12.0 (2026.4.30)` — 解析可正常工作
- 当用户升级到 0.12 后 → `HermesCompatibility::Untested` → 黄色 banner

### 需要做的
- [x] **已 bump** `HERMES_MAX_TESTED` 到 `(0, 12)`
- [x] 版本 banner 格式未变 → 解析逻辑无需修改

---

## 二、Chat 流式连接（核心路径）

### Corey 当前状态
- `src-tauri/src/adapters/hermes/gateway/mod.rs`（671 行）
- 使用 `/v1/chat/completions` (stream=true) SSE
- 识别的 SSE event 类型：
  - `""` / `"message"` → OpenAI-compatible chat.completion.chunk
  - `"hermes.tool.progress"` → 工具进度
  - `"hermes.approval"` → 审批请求
  - `[DONE]` → 流结束
- 解析字段：`delta.content`、`delta.reasoning_content`、`usage`、`finish_reason`、`model`

### Hermes v0.12.0 变更
- `/v1/chat/completions` SSE **格式未变**
- `reasoning_content` 处理改进但字段名不变
- 新增 `runtime-metadata footer`（opt-in）→ 不影响 SSE 事件流
- 新增 `post_tool_call` hook（仅影响 CLI/TUI 显示）

### 兼容性结论
✅ **完全兼容，无需改动**

---

## 三、API Server HTTP 端点

### Corey 当前调用的端点
| 端点 | Corey 代码位置 | 用途 |
|------|---------------|------|
| `GET /health` | `gateway/mod.rs` L87 | 健康检查 |
| `GET /v1/models` | `gateway/mod.rs` L115 | 模型列表 |
| `POST /v1/chat/completions` | `gateway/mod.rs` L148, L312 | 聊天（流/非流） |
| `POST /api/approval/respond` | `ipc/chat.rs` L206 | 审批响应 |
| `GET /api/approval/pending` | gateway.rs 补丁逻辑 | 待审批列表 |

### Hermes v0.12.0 新增端点
| 新端点 | 用途 | Corey 可利用？ |
|--------|------|---------------|
| `POST /v1/runs/{run_id}/stop` | 停止正在进行的 run | ⭐ 聊天停止按钮 |
| `GET /v1/runs/{run_id}/status` | 查询 run 状态 | ⭐ 进度展示 |
| `pre_approval_request` hook | 审批前拦截 | 中期考虑 |
| `post_approval_response` hook | 审批后回调 | 中期考虑 |

### 已有端点变更
- `/health` → 无变化
- `/v1/models` → 无变化
- `/v1/chat/completions` → 无变化
- `/api/approval/respond` → 无变化
- `pre_gateway_dispatch` hook → 新增，但不影响现有调用

### 兼容性结论
✅ **完全兼容**
🆕 **可选机会**：`/v1/runs/{run_id}/stop` 可实现聊天中止功能

---

## 四、Session Search（state.db 查询）

### Corey 当前状态
- `src-tauri/src/ipc/session_search.rs`
- 只读打开 `~/.hermes/state.db`
- 使用 FTS5 查询：`messages_fts MATCH ?1`
- 使用 `snippet(messages_fts, 0, ...)` — 列索引 0 = `content`
- JOIN `messages` + `sessions` 表

### Hermes v0.12.0 变更
- **Trigram FTS5 索引** 替代原始 FTS5（改善 CJK 搜索）
- FTS5 表新增 `tool_name` + `tool_calls` 列
- 索引名 `messages_fts` **保持不变**
- `content` 仍然是第一列（索引 0）

### 潜在风险
⚠️ Trigram tokenizer 改变了 FTS5 的匹配行为：
- 之前：基于空格分词 → CJK 搜索效果差
- 现在：基于 trigram → CJK 效果好，但查询语法可能有细微差异
- **我们的 `sanitize_fts5_query` 逻辑仍然适用**（引号、连字符处理不受 tokenizer 影响）

### SQL 兼容性验证

当前 SQL：
```sql
SELECT m.session_id, s.title, COALESCE(s.source, '') AS source,
       m.role, snippet(messages_fts, 0, '>>>', '<<<', '…', 32) AS snip,
       m.timestamp
FROM messages_fts
JOIN messages m ON m.id = messages_fts.rowid
JOIN sessions s ON s.id = m.session_id
WHERE messages_fts MATCH ?1
ORDER BY m.timestamp DESC LIMIT ?2
```

- `messages_fts` 表名 → ✅ 未变
- `rowid` 关联 → ✅ FTS5 标准行为
- `snippet(..., 0, ...)` 对列 0 (content) → ⚠️ 需确认新增 `tool_name`/`tool_calls` 是否改变了列顺序

### 兼容性结论
✅ **已实现 trigram 检测**：`is_trigram_tokenizer()` 运行时检测 FTS5 schema 是否包含 `trigram`，`sanitize_fts5_query()` 在 trigram 模式下自动将每个 token 包裹双引号以启用子串匹配。`state_db_path()` 已改用 `hermes_data_dir()` 跨平台解析。

---

## 五、Channels（消息平台）

### Corey 当前支持的平台目录（19 个）
telegram, discord, slack, whatsapp, matrix, feishu, weixin, wecom, dingtalk, qq, signal, email, sms, mattermost, bluebubbles, homeassistant, webhook, **teams**, **yuanbao**

### Hermes v0.12.0 新增平台（已实现）
| 平台 | 类型 | 环境变量 |
|------|------|----------|
| **Microsoft Teams** | 外置插件 | `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`, `TEAMS_TENANT_ID`, `TEAMS_ALLOWED_USERS` |
| **腾讯元宝 (Yuanbao)** | 内置适配器 | `YUANBAO_APP_ID`, `YUANBAO_APP_SECRET`, `YUANBAO_WS_URL`, `YUANBAO_API_DOMAIN`, `YUANBAO_ALLOWED_USERS` |

### 架构变更：Pluggable Gateway Platforms
- Gateway 现在是"插件宿主" — 平台适配器可以作为插件加载
- **核心内置平台（Telegram/Discord/Slack/QQ/WeChat 等）未变** — 仍然内置
- **Teams 是第一个外置插件** — 新架构的示范
- 后续新平台可能都走插件路径

### QQ Bot 补丁兼容性
- `patch_qqbot_sandbox()` 依赖 `~/.hermes/hermes-agent/gateway/platforms/qqbot/constants.py` 的文件路径
- 如果 pluggable 架构改变了平台文件布局 → ⚠️ QQ Bot sandbox 补丁可能失效
- **但 QQ Bot 仍是内置平台，不是插件** → 路径大概率不变

### 兼容性结论
✅ **已实现**：
1. QQ/WeChat/DingTalk 仍为内置 → 文件路径不变 → `patch_qqbot_sandbox` 安全
2. 元宝和 Teams 已新增到 Corey 的 `CHANNEL_SPECS` 目录（共 19 个）

---

## 六、Scheduler / Cron

### Corey 当前状态
- `src-tauri/src/hermes_cron.rs`（507 行）
- 读写 `~/.hermes/cron/jobs.json`
- `HermesJob` struct 使用 `#[serde(flatten)] extra: Map<String, Value>` 保留未知字段
- 已知字段：`id`, `name`, `schedule`, `prompt`, `skills`, `provider`, `model`, `paused`, `repeat`

### Hermes v0.12.0 新增 jobs.json 字段
| 新字段 | 用途 | 影响 |
|--------|------|------|
| `workdir` | 每个 job 的工作目录 | `extra` flatten 保留 ✅ |
| `context_from` | 链式 job 输出 | `extra` flatten 保留 ✅ |

### Corey 写入兼容性
- Corey 使用 `upsert_job()` 写入时，会保留 `extra` 中的所有未知字段
- 新增字段通过 flatten catch-all 自动 round-trip
- **不会丢失 Hermes 新增的 `workdir` / `context_from` 字段**

### Curator Cron Ticker
- Hermes 新增 `hermes curator` 作为 gateway cron ticker 的后台任务（7 天周期）
- Curator 不需要 `jobs.json` 中的显式条目 — 它是 gateway 内置的
- 对 Corey Scheduler 页面无影响

### 已实现增强
- `HermesJob` 新增 `workdir: Option<String>` 和 `context_from: Option<String>` 显式字段
- `SchedulerJobView` / `SchedulerJobUpsert` 同步新增，upsert 映射已接线
- TypeScript 接口 `SchedulerJob` / `SchedulerJobUpsert` 同步更新
- `#[serde(flatten)] extra` 仍保留作为兜底

### 兼容性结论
✅ **完全兼容 + 显式建模**（flatten 保留 + 新字段可编辑）

---

## 七、Memory 系统

### Corey 当前状态
- `src-tauri/src/ipc/hermes_memory.rs`（560 行）
- 读取 `~/.hermes/memory_store.db` → `SELECT count(*) FROM facts`
- 读取 `plugins.hermes-memory-store.*` 配置
- 读/写 `~/.hermes/memories/USER.md`

### Hermes v0.12.0 变更
- `flush_memories` 已完全移除 → Corey 未调用，无影响
- Memory providers 现在在 shutdown 时传递 session transcript
- Memory providers 支持 mid-process `session_id` rotation 通知
- `write-origin metadata` seam 修复
- `preserve symlinks during atomic file writes` → 影响 Hermes 自己的写入

### 兼容性结论
✅ **完全兼容** — Corey 只是读取数据，不调用 memory provider API

---

## 八、MCP Server 管理

### Corey 当前状态
- `src-tauri/src/ipc/mcp.rs`（396 行）
- 读/写 `~/.hermes/config.yaml` 的 `mcp_servers:` section
- 格式：每个 server 有 `command`, `args`, `env`, `tools.include/exclude`, `url`, `headers`

### Hermes v0.12.0 变更
- Gateway **现在是插件宿主** — MCP 相关无变化
- `/reload-mcp` slash command 仍然有效
- MCP 配置格式无变化

### 兼容性结论
✅ **完全兼容**

---

## 九、Voice / TTS

### Corey 当前状态
- `src-tauri/src/ipc/voice/tts.rs`（162 行）
- Corey **自己做 TTS**：直接调用 OpenAI/Zhipu/Edge TTS API
- 不依赖 Hermes 的 TTS 功能

### Hermes v0.12.0 变更
- 新增 `tts.providers.<name>` 注册表（pluggable TTS）
- 新增 Piper 本地 TTS provider
- Voice mode CLI 对等支持在 TUI

### 与 Corey 的关系
- Corey 的 Voice 功能是**独立于 Hermes 的**
- Hermes 新 TTS 注册表是给 CLI/TUI 用的，不影响 Corey

### 未来机会
🆕 可以考虑**复用 Hermes 的 TTS registry** 而非自己做，减少重复代码

### 兼容性结论
✅ **无影响**（两套独立实现）

---

## 十、Skills Hub CLI

### Corey 当前状态
- `src-tauri/src/ipc/skill_hub.rs`（173 行）
- 白名单子命令：`browse`, `search`, `inspect`, `install`, `uninstall`, `list`, `check`, `update`, `audit`

### Hermes v0.12.0 新增 Skills 相关
| 新命令/功能 | 类型 | 需要加入白名单？ |
|------------|------|-----------------|
| `hermes curator` | 新顶级命令 | 否（不是 `skills` 子命令） |
| `hermes curator status` | 新顶级命令 | 否 |
| `/reload-skills` | 网关 slash 命令 | 否（通过聊天发送） |
| `skill_manage` 支持 `external_dirs` | 功能增强 | 否（已有命令） |
| Direct-URL skill install | `install` 增强 | 否（已在白名单） |

### 兼容性结论
✅ **完全兼容** — 白名单无需扩展

---

## 十一、config.yaml 读写

### Corey 当前读写的 YAML 路径
| 路径 | 模块 | 操作 |
|------|------|------|
| `model:` | `hermes_config/mod.rs` | 读写 |
| `auxiliary.compression.*` | `hermes_config/mod.rs` | 读写 |
| `approvals:` | `hermes_config/mod.rs` | 读写 |
| `command_allowlist:` | `hermes_config/mod.rs` | 读写 |
| `channels.*` | `hermes_config/yaml.rs` | 读写 |
| `mcp_servers:` | `ipc/mcp.rs` | 读写 |
| `plugins.hermes-memory-store.*` | `ipc/hermes_memory.rs` | 只读 |

### Hermes v0.12.0 新增 config 字段
| 新字段 | 默认值 | Corey 影响 |
|--------|--------|-----------|
| `prompt_caching.cache_ttl` | 5m | 不写 → 无影响 |
| `tts.providers.<name>` | 空 | 不写 → 无影响 |
| `redaction.enabled` | `false`（新默认） | 不写 → 无影响 |
| `auxiliary.curator.*` | 内部使用 | 不写 → 无影响 |
| `auxiliary.extra_body.reasoning` | 内部使用 | 不写 → 无影响 |

### config version
- 之前：version 17（`compression.summary_*` → `auxiliary.compression.*` 迁移）
- v0.12.0：**未提及新的 config version bump** → 推测仍为 17 或增量至 18（additive only）

### 兼容性结论
✅ **完全兼容** — 所有新字段都是 additive，Corey 不触碰的字段不受影响

---

## 十二、Gateway 启动/重启

### Corey 当前状态
- 使用 `hermes gateway run` (Windows) / `hermes gateway start` (macOS)
- 使用 `hermes gateway restart`

### Hermes v0.12.0 变更
- Gateway 命令 **未变**
- 新行为：**Gateway 在 config 编辑后自动 bust cached agent**（#17008）
  - 之前：改 config 必须完整重启 gateway
  - 现在：部分 config 改动（compression/context_length）会自动重载
- `/reload-mcp` 现在也会 rebuild cached agents + prompt-cache cost confirmation

### 对 HD-9 规则的影响
- HD-9 说"Gateway restart required after config changes (no hot-reload)"
- **v0.12.0 部分改变了这个限制** — 某些 config 改动现在会自动生效
- 但 **并非所有改动** — model/provider 改动仍可能需要重启

### 兼容性结论
✅ **兼容**，行为改善
📝 **规则更新**：HD-9 可弱化为"大部分 config 改动仍建议重启，但 compression/context_length 现已自动生效"

---

## 十三、.env 环境变量

### Corey 当前读写的 .env 变量
- 各 channel 的 API key（`TELEGRAM_BOT_TOKEN`, `DISCORD_TOKEN`, `QQ_APP_ID` 等）
- `API_SERVER_KEY`
- `QQ_SANDBOX`

### Hermes v0.12.0 新增环境变量
| 变量 | 用途 |
|------|------|
| `HERMES_INFERENCE_MODEL` | `hermes -z` 的默认模型 |
| 各新 Provider 的 key | GMI/Azure Foundry/MiniMax/Tokenhub |
| Teams 相关 | Microsoft Teams plugin |
| 元宝相关 | Yuanbao adapter |

### 兼容性结论
✅ **无冲突** — 新变量名不与 Corey 已写变量重叠

---

## 十四、Approval 系统

### Corey 当前状态
- 监听 SSE `"hermes.approval"` 事件
- 调用 `POST /api/approval/respond` 发送用户决定
- 补丁 `api_server.py` 添加 SSE 支持

### Hermes v0.12.0 变更
- `hardline blocklist` for unrecoverable commands — 某些命令会被 Hermes 直接拒绝，不走审批
- `pre_approval_request` / `post_approval_response` hooks — 插件可拦截审批流
- `DANGEROUS_PATTERNS` 和 `HARDLINE_PATTERNS` 预编译

### 对 Corey 的影响
- Hermes 侧的 hardline blocklist 意味着：某些命令 **根本不会发审批请求到 Corey**
- 这是行为改善（安全性提升），不是 breaking change
- 如果 Corey 之前展示过这些命令的审批 UI → 现在不会再收到 → 无 UI 破坏

### 兼容性结论
✅ **兼容**，行为改善

---

## 十五、Provider / Model 支持

### Corey 当前状态
- `ipc/model.rs` — 从 `config.yaml` 读取当前 model/provider 设置
- Models 页面显示 gateway 返回的 `/v1/models` 列表
- 不硬编码 provider 列表

### Hermes v0.12.0 新增 Provider
| Provider | 类型 |
|----------|------|
| LM Studio | 本地，首次提升为 first-class |
| GMI Cloud | API key |
| Azure AI Foundry | 自动检测 |
| MiniMax | OAuth PKCE |
| Tencent Tokenhub | API key |

### 新模型
- `openai/gpt-5.5`, `gpt-5.5-pro`
- `deepseek-v4-pro`, `deepseek-v4-flash`
- `qwen3.6-plus`

### Remote model catalog
- OpenRouter / Nous Portal 现在从远程 manifest 拉取模型列表
- 新模型自动出现，不需要 Hermes 发版

### 对 Corey 的影响
- `/v1/models` 端点返回的列表会自动包含新 Provider 的模型
- Corey Models 页面 **无需改动即可显示新 Provider 的模型**
- `hermes fallback` 命令可让用户配置备用 provider（UI 暂无对应操作）

### 兼容性结论
✅ **自动兼容** — Corey 不硬编码 Provider 列表

---

## 十六、Dashboard / Web UI 竞争

### Hermes v0.12.0 自带 Dashboard 增强
- Models tab + 在线配置 main/auxiliary 模型
- Dashboard Chat tab (xterm.js)
- Layout refresh
- `--stop` / `--status` flags

### 与 Corey 的关系
- Hermes Dashboard 运行在 `localhost:8081`（默认）
- Corey 是独立的桌面应用，**不使用 Hermes Dashboard**
- 两者**功能有重叠**（模型配置、聊天）

### 差异化评估
| 功能 | Hermes Dashboard | Corey |
|------|-----------------|-------|
| 聊天 | Web terminal | 原生桌面 + 流式 + 审批 |
| 模型切换 | 有 | 有 |
| 频道管理 | 无 | ✅ 17 平台 GUI |
| Scheduler GUI | 无 | ✅ |
| Memory 可视化 | 无 | ✅ |
| MCP 管理 | 无 | ✅ |
| Workflow 引擎 | 无 | ✅ |
| Pack 系统 | 无 | ✅ (v0.2.0) |
| Analytics | 无 | ✅ |
| 白标定制 | 无 | ✅ |

**结论**：Corey 的差异化能力完好。Hermes Dashboard 是轻量 Web 工具，Corey 是重型控制平面。

---

## 十七、Browser Automation

### Hermes v0.12.0 变更
- CDP supervisor — dialog detection + response + cross-origin iframe eval
- Auto-spawn local Chromium for LAN/localhost URLs when cloud provider is configured

### 与 Corey 的关系
- Corey 有 `browser_config` IPC — 配置 Hermes 的浏览器行为
- CDP 改进对 Corey 透明（Hermes 内部处理）

### 兼容性结论
✅ **无影响**

---

## 十八、Performance 影响

### Hermes v0.12.0 性能改进
- TUI cold start -57%（lazy agent init）
- `load_config()` + `read_raw_config()` mtime-cache
- `get_tool_definitions()` memoize + TTL-cache

### 对 Corey 的好处
- **Gateway 冷启动更快** → Corey 启动时 gateway 就绪更快
- **Config 读取 mtime-cache** → gateway 对 config 变更响应更快
- **无负面影响**

---

## 十九、Breaking Changes 总结

### 已移除功能
| 移除项 | Corey 是否使用 | 影响 |
|--------|---------------|------|
| `flush_memories` | 否 | 无 |
| `/provider` slash 命令 | 否 | 无 |
| `/plan` slash 命令 | 否 | 无 |
| `BOOT.md` 内置 hook | 否 | 无 |
| Kanban multi-profile board | 否 | 无 |
| `computer-use cua-driver` | 否 | 无 |

### 行为变更（非破坏性）
| 变更 | 影响 |
|------|------|
| `secret redaction` 默认关闭 | 正面：不再损坏工具输出 |
| `[SYSTEM:` → `[IMPORTANT:` | 无影响（Corey 不注入此标记） |
| Gateway bust cached agent on config edits | 正面：部分配置免重启 |
| `child_timeout_seconds` 默认 600s | 正面：子代理超时更宽裕 |

---

## 二十、行动建议

### 已完成（2026-05-01）
1. ✅ **Bump `HERMES_MAX_TESTED`** 到 `(0, 12)`
2. ✅ **Chat 停止** — 后端 hard stop via `chat_stream_cancel` IPC
3. ✅ **新增 Teams + 元宝到 `CHANNEL_SPECS`** — 19 个平台
4. ✅ **Skill Hub reload hint** — 安装成功后提示 `/reload-skills`
5. ✅ **Cron workdir/context_from** — 显式建模 + IPC 透传
6. ✅ **`hermes update --check`** — Rust IPC + Settings UI
7. ✅ **`hermes -z` one-shot** — Rust IPC + TypeScript 接口
8. ✅ **Session search trigram** — 运行时检测 + 查询语法适配

### 已验证（实机确认 2026-05-01）
9. ✅ **`state.db` FTS5 schema** — v0.12 有两张 FTS5 表：`messages_fts`(原始) + `messages_fts_trigram`(trigram)，均以 `content` 为第 0 列。Corey 优先使用 trigram 表
10. ✅ **QQ Bot 文件路径** — `~/.hermes/hermes-agent/gateway/platforms/qqbot/constants.py` 仍在原位

### 可选（长期）
11. 白名单增加 `curator` — 如果要暴露 Skill 自动维护状态
12. 复用 Hermes TTS registry 替代自建 TTS
13. 利用 `hermes fallback` 管理备用模型
14. 新增 5 个 Provider 的 Models 页面 onboarding 指引

---

## 二十一、代码影响矩阵

| Corey 文件 | 影响等级 | 变更说明 |
|------------|----------|------|
| `hermes_config/gateway.rs` | ✅ 已完成 | bump MAX_TESTED + `hermes_update_check()` + `HermesUpdateCheck` |
| `adapters/hermes/gateway/mod.rs` | ✅ 无 | SSE 格式未变 |
| `ipc/chat.rs` | ✅ 已完成 | `chat_stream_cancel` 后端 hard stop |
| `ipc/session_search.rs` | ✅ 已完成 | trigram 检测 + 查询适配 + `hermes_data_dir()` 跨平台 |
| `channels/mod.rs` | ✅ 已完成 | 新增 Teams + Yuanbao（19 个） |
| `hermes_cron.rs` | ✅ 已完成 | `workdir` / `context_from` 显式字段 |
| `ipc/hermes_memory.rs` | ✅ 无 | 读取路径不变 |
| `ipc/mcp.rs` | ✅ 无 | 格式不变 |
| `ipc/voice/tts.rs` | ✅ 无 | 独立实现 |
| `ipc/skill_hub.rs` | ✅ 无 | 白名单够用 |
| `hermes_config/yaml.rs` | ✅ 无 | additive 字段 |
| `ipc/scheduler.rs` | ✅ 已完成 | `workdir` / `context_from` 透传 |
| `ipc/hermes_config.rs` | ✅ 已完成 | `hermes_update_check` IPC |
| `ipc/workflow/mod.rs` | ✅ 已完成 | `hermes_oneshot` IPC |
| `lib.rs` | ✅ 已完成 | 注册 `chat_stream_cancel` + `hermes_update_check` + `hermes_oneshot` |
| `lib/ipc/runtime.ts` | ✅ 已完成 | `SchedulerJob` + `HermesOneshotResult` 接口 |
| `lib/ipc/hermes-config.ts` | ✅ 已完成 | `HermesUpdateCheck` 接口 |
| `features/settings/` | ✅ 已完成 | `useHermesUpdateCheck` hook + `HermesUpdateSection` 组件 |
| `locales/en.json` + `zh.json` | ✅ 已完成 | `skill_hub.reload_hint` + `settings.hermes_update.*` |

---

## 二十二、结论

**Hermes v0.12.0 对 CoreyOS 的整体兼容性：良好。**

- 核心 Chat/SSE 通路 → **零变化**
- API 端点 → **只增不删**
- config.yaml → **additive only**
- .env → **无冲突**
- state.db → **已验证 FTS5 列兼容**（`messages_fts` + `messages_fts_trigram` 均以 `content` 为第 0 列）
- 已移除功能 → **Corey 都没用**

最大的架构变化（pluggable gateway platforms）目前只影响新平台（Teams），现有内置平台（QQ/WeChat/DingTalk）不受影响。

**升级路径**：已完成所有 Corey 侧代码变更，并完成本地 CI 复测（`tsc` + `eslint` + `build` + `cargo check` + `cargo test` + `cargo fmt --check` 全通过）。

Windows 端最终实机验收（安装后一键启动、Gateway 启动稳定性、聊天/搜索/定时任务）需在包含本次修复的 `v0.1.13` Windows 包上执行；当前 `v0.1.12` 包不具备完整验证条件。
