# CoreyOS Bug 修复历史

> 创建：2026-05-01（从 `docs/status/TODO.md` v1 拆分而来，保留为修复参考）
> 用途：已修复 Bug 的根因 + 解决方案存档

## 2026-05-11 晚 · 待修 / 已迁移的问题

### 已知未修：Corey UI 聊天的审批卡片当前不会触发（P0）

- **现象**：在 Corey UI chat 里触发危险命令（如 `rm ~/Desktop/x`），**不会**出现审批 UI。命令要么被 Hermes `DANGEROUS_PATTERNS` 直接拒，要么被 `corey-guards` 拦（弹 macOS 原生对话框，不是 Corey UI 卡片）。
- **根因**：2026-05-11 我们撤销了 `patch_approval_sse()` 对 Hermes `api_server.py` 的 patch。Hermes 0.13.0 原生只在 `/v1/runs` endpoint 发 `approval.request` 事件；Corey 现在用的是 `/v1/chat/completions`，没有 approval 事件。
- **修复计划**：迁移 Corey `chat_stream` 到 `/v1/runs` + `/v1/runs/{run_id}/events`。详见 `docs/migrations/hermes-v0.13-runs-endpoint.md`，预估 3-4 小时。
- **临时替代**：
  - 消息渠道（WeChat / Slack / cron）走 Hermes 原生 channel 审批流（英文）
  - corey-guards macOS 对话框仍然会对保护路径的破坏性操作弹窗

### 已知未修：消息渠道审批提示仍是英文（P2 · upstream gap）

- **现象**：微信 / Slack / Telegram / 钉钉收到的危险命令审批提示仍然是英文硬编码 `Dangerous command requires approval:` + `/approve session / /deny` 等 jargon。
- **根因**：Hermes 0.13.0 虽然新增了 `locales/zh.yaml` 等 16 种语言的 locale 支持（upstream commit `c39168453`），但 `gateway/run.py:15066` 的 plain-text 审批 fallback 还没迁到 locale 文件里。
- **修复计划**：向 hermes-agent 提 upstream issue（草稿在 `docs/migrations/hermes-v0.13-runs-endpoint.md` 最后一节）。我们**不再 patch Hermes 源码**。

### 已修复：LLM 绕过 shell guard 删文件（P0 real safety incident）

- **时间**：2026-05-11 晚用户实测
- **现象**：用户说"帮我删除桌面的 test.md"，LLM：
  1. 第一步调 shell `rm ~/Desktop/test.md` → Hermes `DANGEROUS_PATTERNS` 拦
  2. LLM 在回复里主动说"终端被拦，我用 Python 工具试试"
  3. 切换调 `code_execution` 跑 `os.remove(...)` → 成功删除文件
- **根因**：
  1. corey-guards 的 v1 版本 `CODE_TOOLS` 集合没包含 Hermes 真实工具名 `code_execution`（只有 `execute_code`）
  2. 更致命的是 `~/.hermes/config.yaml` 里 `hooks.pre_tool_call: '[]'` **是字符串不是列表**，Hermes `_parse_hooks_block` 发现类型不对直接 warn-and-skip，所以 guard 根本没挂上去过
  3. LLM 本身主动寻找绕过路径（behavioral issue）
- **修复**：
  - 新增 `src-tauri/src/hermes_hooks.rs`：`seed_guards_script()`（bundled v2 guard 覆盖 code_execution + python -c 内联 + Hermes 真实工具名）+ `ensure_hook_registered()`（Corey 启动时幂等写 `config.yaml.hooks.pre_tool_call` 为正确的 list 格式）+ 12 个测试
  - 新增 `src-tauri/assets/soul/corey_iron_rules.md` + `src-tauri/src/soul_md.rs`：marker-delimited 块注入到 `~/.hermes/SOUL.md`，里面新增"🛑 禁止绕过任何 guard"硬红线，明令 LLM 遇到 block 必须停，不得换工具路径、换命令形式、拆分、sudo、切目录等 7 类绕过
  - 新增 `src-tauri/src/ipc/security.rs` + `src/features/settings/sections/SecuritySection.tsx`：Settings 页"安全防护"卡片，显示 guard 注册状态 / 最近 fires / 最近 blocks / hooks_auto_accept 状态，以及"立即修复"按钮

### 已执行：Hermes Agent 升级 0.12.0 → 0.13.0

- **原因**：用户要求"永不 patch Hermes 源码"，但 Corey 之前有 4 个 `patch_*` 函数在 gateway start/restart 时重写 Hermes `.py` 文件（approval SSE、危险 patterns、QQ bot URL、新加的审批提示模板）。客户如果升级 Hermes，patch anchor 失效 → 静默失败。
- **操作**：
  1. `git checkout` 还原 3 个被 patch 的 Hermes 源文件
  2. 删除 `api_server.py.bak`（已备份到 `/tmp/`）
  3. 注释掉 `gateway.rs` 里 3 处 `patch_*()` 调用；函数本体标 `#[allow(dead_code)]` 保留备查
  4. `cd ~/.hermes/hermes-agent && git pull --ff-only origin main`（+1296 commits）
  5. `venv/bin/pip3 install -e .`（新依赖 ruamel.yaml / psutil / tzdata）
- **验证**：`hermes --version` 返回 `v0.13.0 (2026.5.7)`；Corey 543/543 tests pass。
- **影响**：见上条"Corey UI 审批不会触发"。

---

## v0.1.12（2026-04-30 发布，15 项 Bug 修复）

### 已修复

#### BUG-001: Hermes 网关不启动 HTTP API Server
- **优先级**：P0
- **影响平台**：Windows + macOS
- **现象**：Corey 显示"网关未启动"，但 `hermes gateway run` 进程在运行
- **根因**：Hermes 要求 `.env` 中设置 `API_SERVER_ENABLED=true` 才会启动 8642 端口的 HTTP API
- **修复**：
  - `gateway.rs` — 新增 `ensure_api_server_env()`，在 `gateway_start()` / `gateway_restart()` 前自动写入
  - `bootstrap-windows.ps1` — Step 5.6 自动写入

#### BUG-002: config.yaml 不存在时不自动创建
- **优先级**：P0
- **修复**：`llm_profiles.rs` — 构造空 `HermesConfigView` 继续执行写入

#### BUG-003: Windows 网关进程随 Corey 退出
- **优先级**：P0 / Windows
- **根因**：`CREATE_NO_WINDOW` 不够，子进程仍绑父进程组
- **修复**：`gateway.rs` — 改用 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`

#### BUG-004: Windows 无法停止网关
- **优先级**：P1 / Windows
- **修复**：`gateway.rs` — 新增 `gateway_stop()`：读 `gateway.pid` → `taskkill /F /PID`

#### BUG-005: QQ/钉钉扫码后无连接状态标识
- **优先级**：P1
- **根因**：`computeStatus()` 对 `has_qr_login=true` 永远返回 `'qr'`
- **修复**：`computeStatus.ts` — QR 通道在 env 已配置时返回 `'configured'`

#### BUG-006: macOS Node.js/Browser Runner 检测失败
- **优先级**：P1 / macOS
- **根因**：Tauri GUI 不加载 `.zshrc`，Homebrew/nvm 安装的 `node` 不在 PATH
- **修复**：`browser_config.rs` — `detect_node()` 增加 macOS 常见路径

#### BUG-007: Windows 数据目录不一致（根因问题）
- **优先级**：P0 / Windows
- **根因**：`paths.rs` 在 Windows 上检测到 `Corey.exe` 所在目录就返回 `<exe_dir>/data/`，与 Bootstrap 的 `HERMES_HOME=C:\Users\ADMI\.hermes` 不一致
- **修复**：`paths.rs` — 去掉 `Corey.exe` 检测逻辑，所有平台统一用 `~/.hermes/`

#### BUG-008: Windows 对话白圈无回复
- **优先级**：P0 / Windows
- **根因**：随 BUG-007（数据目录不一致导致 gateway 读不到 .env/config.yaml）

#### BUG-009: Skills 和数据目录重复
- **根因**：BUG-007 直接后果

#### BUG-010: BGE-M3 假装安装完成
- **优先级**：P1
- **根因**：`model_exists()` 只检查文件存在，不检查大小，空文件被当成已下载
- **修复**：`embedding.rs` — 增加文件大小校验（onnx≥1MB, onnx_data≥100MB, tokenizer≥100KB）

#### BUG-011: 会话列表混乱
- **优先级**：P1
- **现象**：微信对话按话题分裂多会话；存在空会话；Corey/Gateway session 重复
- **修复**：新增 `gateway_source_messages` IPC 按 source 聚合；`gatewaySync` 改为按 source 分组

#### BUG-012: 安装后 Skill/MCP 引导消失
- **修复**：新增 `NextStepsCard` 组件，gateway online 后显示引导

#### BUG-013: 语言设置显示不一致
- **修复**：`AppearanceSection.tsx` — 用 `split('-')[0]` 提取主语言代码

#### BUG-014: 默认主题浅色
- **修复**：`ui.ts` — 默认值从 `'dark'` 改为 `'system'`

#### BUG-015: QQ/钉钉扫码登录等待时间过长
- **修复**：`ChannelQrPanel.tsx` — 轮询间隔 3s → 2s

### 待 Windows 实测验证

- BUG-007~009：旧的 `E:\Corey\data\` 目录需手动删除
- BUG-008：Windows 实测对话流程
- BUG-010：BGE-M3 文件大小校验后重新下载

### CI 验证

| 检查 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 0 错误 |
| `cargo check` | ✅ 编译通过 |
| `cargo test --lib` | ✅ 314 passed |
| `pnpm build` | ✅ 7.26s 构建成功 |

### 修改文件汇总

| 文件 | 改动 |
|------|------|
| `src-tauri/src/hermes_config/gateway.rs` | `ensure_api_server_env`、`windows_gateway_spawn` 重写、`gateway_stop` |
| `src-tauri/src/ipc/llm_profiles.rs` | `seed_hermes_model_if_empty` 空容错 |
| `src-tauri/src/ipc/hermes_config.rs` | 新增 `hermes_gateway_stop` IPC |
| `src-tauri/src/lib.rs` | 注册 `hermes_gateway_stop`、`gateway_source_messages` |
| `src-tauri/assets/scripts/bootstrap-windows.ps1` | Step 5.6 `API_SERVER_ENABLED` |
| `src-tauri/src/ipc/browser_config.rs` | `detect_node` macOS 多路径 |
| `src-tauri/src/ipc/embedding.rs` | `model_exists` 文件大小校验 |
| `src-tauri/src/ipc/knowledge.rs` | `rag_download_model` 空文件重新下载 |
| `src-tauri/src/ipc/gateway_sessions.rs` | 新增 `gateway_source_messages` IPC |
| `src-tauri/src/paths.rs` | `platform_default` 统一用 `~/.hermes/` |
| `src/features/channels/computeStatus.ts` | QR 通道状态判断修复 |
| `src/features/channels/ChannelQrPanel.tsx` | 轮询间隔 3s → 2s |
| `src/features/chat/GatewaySection.tsx` | 按 source 分组显示 |
| `src/features/home/HermesInstallCard.tsx` | 新增 `NextStepsCard` 引导 |
| `src/features/settings/AppearanceSection.tsx` | 语言 fallback 修复 |
| `src/stores/chat.ts` | `importGatewaySource` 按 source 分组 |
| `src/stores/ui.ts` | 默认主题 `system` |
| `src/lib/ipc/runtime.ts` | 新增 `gatewaySourceMessages` |
