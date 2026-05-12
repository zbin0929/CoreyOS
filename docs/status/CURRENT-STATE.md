# CURRENT-STATE · 当下事实

<!-- type: status -->
<!-- last-verified: 2026-05-12 -->
<!-- 校验规则：每 30 天至少一次。过期后由下一个接触者重新校验或标记为 stale。 -->

> 本文件描述 CoreyOS **当下**是什么样子，不描述计划。
> 计划看 [`TODO.md`](./TODO.md) 和 [`roadmap.md`](./roadmap.md)。

## 一句话

本地部署的 B2B 定制 AI 控制平面。Tauri 2 桌面应用，面向直签 B2B 客户做白标交付（Pack 架构），不做 SaaS 订阅。

## 当前版本

- 产品版本：**v0.2.13**（以 `package.json` / `CHANGELOG.md` 为准）
- 上游 Hermes 版本：**v0.13.0 (2026.5.7)**；参见 [`hermes-deps.md`](./hermes-deps.md)
- 代码规模：Rust 168 文件 / TS 338 文件
- 测试：Rust **555** · Vitest **112** · Playwright **38 specs / 77 tests**（全绿）
- 路由：25 个页面
- IPC 模块：53 个（193+ commands）
- E2E 覆盖：38 个 spec 文件

> 🔁 校验提醒：数字随代码变动，至少每月核对一次。

## 功能矩阵

| 领域 | 核心能力 | 状态 | 备注 |
|---|---|---|---|
| 聊天 | 多轮对话 / 流式 SSE / 附件 / 模型切换 / 审批卡片 | ✅ 可用 | 已迁移到 `/v1/runs` endpoint |
| 多 Agent | Hermes（主）/ Claude Code mock / Aider mock | ✅ 可用 | 真实多 agent 能力仅 Hermes |
| 多 LLM | OpenAI / Anthropic / 任意兼容端点 | ✅ 可用 | 通过 LlmProfile 管理，11 个预置模板含 6 个国产 LLM |
| Workflow | React Flow DAG + 7 步类型 + 审批 / webhook / AI 生成 | ✅ 可用 | 浏览器自动化步骤待加固 |
| Talk Mode | zipformer STT + silero-vad + VITS/MeloTTS 进程内合成 | ✅ 可用 | 支持即时打断、语速调节 |
| RAG | Jaccard 关键词 + BGE-M3 ONNX 本地语义检索 + RRF 融合 | ✅ 可用 | 2.3 GB，支持离线 zip 导入 |
| Pack 架构 | 白标基座 + skill-packs + pack-data + 12 视图模板 + license features | ✅ 已落地 | `cross_border_ecom` v0.2.0：3 Skill + 3 Workflow + CompositeDashboard |
| Browser 工具 | Playwright 子进程 + CDP 直连 | ⚠️ 脆弱 | 见 `known-issues.md` |
| MCP 管理 | stdio + URL 传输 + 桌面原生工具（通知/文件选择器/深链接） | ✅ 可用 | |
| Memory | MEMORY.md + USER.md 编辑 + holographic 后端 + FTS5 搜索 | ✅ 可用 | 见 `../spec/memory-strategy.md` |
| 消息渠道 | Telegram / Discord / Slack / WeCom / WeChat / Feishu / WhatsApp / Signal / DingTalk / Email / SMS / iMessage / Matrix / Mattermost / Webhooks / Home Assistant（16 种） | ✅ 可用 | |
| License | ed25519 离线签名 + machine ID 绑定 + features 联动 | ✅ 已落地 | `scripts/new-customer.sh` 一键交付 |
| 安全防护（L0-L3） | SOUL.md 铁律 + corey-guards 物理拦截 + Hermes DANGEROUS_PATTERNS + 路径沙箱 | ✅ 已落地 | 审批卡片已修复（`/v1/runs` 迁移） |
| Knowledge | 文档上传 → 分块 → Jaccard/BGE-M3 搜索 → 注入对话 | ✅ 可用 | |
| 语音 | push-to-talk ASR + TTS（OpenAI / Zhipu / Groq / Edge TTS） | ✅ 可用 | |
| Trajectory | 会话时间线 + 工具调用树 + 子 agent 委托树 + Token/延迟 | ✅ 可用 | |
| Analytics | Token 用量 + 成本估算 + 延迟 + 错误率 + 健康雷达 + CSV 导出 | ✅ 可用 | |
| Budgets | 按 model / profile 消费上限 + 80% 预警 | ✅ 可用 | |

## 已知关键缺陷（简表）

详见 [`known-issues.md`](./known-issues.md)；以下是截至 2026-05-12 的 P0：

1. **0 真实客户** —— 产品从未在真实 B2B 客户手里跑过完整工作日
2. **跨境电商 Pack 5/9 能力落地** —— `cross_border_ecom` v0.2.0 已落地 3 Skill + 3 Workflow + demo CSV；剩余 P1/P2 能力阻塞在 SP-API 账号 + 真实客户数据
3. **Amazon SP-API 开发者账号**申请阻塞 v0.3.0 跨境电商 Pack 的真实数据接入
4. **Browser 工具脆弱** —— Playwright 子进程在 CI 和 Windows 上不稳定

## 当前商业模式

- ❌ 不做：SaaS 订阅 / 多租户 / 线上激活 / 简化模式
- ✅ 做：直签 B2B 项目制交付 / 本地部署 / Pack 白标 / ed25519 license

## 性能预算（架构层承诺）

- 冷启动 < 3s
- IPC 平均往返 < 30 ms
- RAM 常驻 < 400 MB（空闲）
- 安装包 < 80 MB（基座，不含 Talk Mode 模型）

> 🔁 校验提醒：每次发布前抽测一次。

## 最近改动要点（近 30 天）

> 截止 2026-05-12。只记**结构性改动**，不记单 bug 修复。细节参见 [`../../CHANGELOG.md`](../../CHANGELOG.md)。

- **2026-05-12 · v0.2.13**：
  - Windows file-ops-guard 路径匹配修复 + PowerShell WPF 确认对话框（GUARD_VERSION 2→3）
  - `skill_curator` / `skill_hub` / `workflow oneshot` 三个 IPC 改用 `resolve_hermes_binary()` 替代裸 `Command::new("hermes")`，修复 macOS GUI 应用找不到 `~/.local/bin/hermes` 的问题
  - README.md 全面更新：重新组织功能列表、新增 Pages 表格、更新测试计数
  - Release workflow 改为自动发布（`releaseDraft: false`）
- **2026-05-12 · v0.2.12 安全防护体系**：
  - 迁移 `chat_stream` 到 `POST /v1/runs` + `GET /v1/runs/{run_id}/events` SSE，修复 Corey UI 审批卡片不触发的问题
  - 新增 SOUL.md 铁律"禁止虚构工具结果 / 禁止假冒拦截"
  - 修复 LLM 绕过 shell guard 删文件（新增 `hermes_hooks.rs` + `soul_md.rs` + `ipc/security.rs` + `SecuritySection.tsx`）
  - Hermes 0.12.0 → 0.13.0 升级，删除 4 个 `patch_*` 函数
  - 修复 `errors.log` vs `error.log` 文件名、`gateway.lock` JSON 格式适配
- **2026-05-10 · v0.2.11 交付工具链**：
  - `cross_border_ecom` v0.2.0：3 Skill + 3 Workflow + CompositeDashboard layout 修复
  - `scripts/new-customer.sh` 一键生成客户包 + Rust smoke test 锁死 yaml 契约
  - Starter 去 Pack 化（`daily-news-digest` / `pdf-summary` 迁至 `assets/default-workflows/`）
- **2026-05-09 · 文档体系重构**：docs 从 33 个根文件 → 1 个，建立 spec/status/log/plans/user/archive 四分法
- **2026-05-07 · v0.2.10 进程内 TTS**：sherpa-onnx + VITS MeloTTS 直接进程内合成
- **2026-05-06 · v0.2.7-9 可见性闭环 + Hermes 不变量**：AgentSwitcher、Vision 代理、MCP 工具扩展、Memory 去重、sub-workflow、webhook 触发器

---

## 如何校验本文件

1. 对照 `package.json` / `CHANGELOG.md` / `Cargo.toml` 核对版本号
2. `cd src-tauri && cargo test --lib 2>&1 | grep "test result"` → Rust 测试数
3. `npx vitest run 2>&1 | tail -5` → Vitest 测试数
4. `ls e2e/*.spec.ts | wc -l` → E2E spec 数
5. `grep -c "path:" src/app/routes.tsx` → 路由数
6. `ls src-tauri/src/ipc/ | grep -v mod.rs | wc -l` → IPC 模块数
7. 对照 `status/known-issues.md` 核对 P0 清单
8. 更新顶部 `last-verified` 日期
