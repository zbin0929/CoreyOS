# CoreyOS Bug 修复历史

> 创建：2026-05-01（从 `docs/global-todo.md` v1 拆分而来，保留为修复参考）
> 用途：已修复 Bug 的根因 + 解决方案存档

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
