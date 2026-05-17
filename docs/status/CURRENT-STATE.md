# CURRENT-STATE · 当下事实

<!-- type: status -->
<!-- last-verified: 2026-05-17 -->
<!-- 校验规则：每 30 天至少一次。过期后由下一个接触者重新校验或标记为 stale。 -->

> 本文件描述 CoreyOS **当下**是什么样子，不描述计划。
> 计划看 [`TODO.md`](./TODO.md) 和 [`roadmap.md`](./roadmap.md)。

## 一句话

本地部署的 B2B 定制 AI 控制平面。Tauri 2 桌面应用，面向直签 B2B 客户做白标交付（Pack 架构），不做 SaaS 订阅。

## 当前版本

- 产品版本：**v0.2.14**（以 `package.json` / `Cargo.toml` / `tauri.conf.json` 为准；最新 tag `8fdde13` 后已累积 **62** 个 post-release commit，包含 P0/P1 重构 sprint + Pack Schema DSL Phase 3a+3b + 美正 5 个 `.tsx` 全删；下一版未定号）
- 上游 Hermes 版本：**v0.13.0 (2026.5.7)**；参见 [`hermes-deps.md`](./hermes-deps.md)
- 代码规模：Rust **169** 文件 / TS+TSX **346** 文件（合计 ~111K 行）
- 测试：Rust **568** · Vitest **112** · Playwright **38 specs / 77 tests**（2026-05-17 sprint 全绿）
- 路由：25 个页面
- IPC 模块：48 个 `.rs` + 5 个子目录（合计 53），约 200+ commands
- E2E 覆盖：38 个 spec 文件
- clippy unwrap baseline：**546**（`scripts/clippy-unwrap-baseline.txt`）
- 文件长度告警阈：≥ 800 行 warn，≥ 1500 行 fail；当前 **12 个文件越警戒线，1 个越 fail 线**（仅 `mcp_server/tools.rs` 1724 行，属 AC-1b 稳定 catalog 豁免，参见下"健康提示"）

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
| Pack 架构 | 白标基座 + skill-packs + pack-data + 12 视图模板 + license features | ✅ 已落地 | `cross_border_ecom` v0.2.0：3 Skill + 3 Workflow + CompositeDashboard；`meizheng` v0.5.0：1 Skill + 6 Workflow + 12 Python 脚本 + 7 cron schedules |
| 企业 RPA Pack | 美正 Pack —— 汇率 + 燃油费率 + UPS/USPS/FedEx 分区自动化 | ✅ 已落地 | API 直写（无浏览器）/ 中文 cron picker UI / `pack_exchange_rate_config_*` + `pack_zone_config_*` IPC |
| Browser 工具 | Playwright 子进程 + CDP 直连 | ⚠️ 脆弱 | 见 `known-issues.md` |
| MCP 管理 | stdio + URL 传输 + 桌面原生工具（通知/文件选择器/深链接） | ✅ 可用 | |
| Memory | MEMORY.md + USER.md 编辑 + holographic 后端 + FTS5 搜索 + Chat 自动 fact 召回 + entity 列表 UI + typed relations 图查询 | ✅ 可用 | 见 `../spec/memory-strategy.md` / `../spec/memory-knowledge-graph.md` |
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

## 健康提示（2026-05-17 校验 · 重构 sprint 后）

- **超长文件 fail 线（≥1500）**：仅 `src-tauri/src/mcp_server/tools.rs` (1724) 一个。属 **AC-1b 稳定 catalog 豁免**（MCP 工具目录，加新工具是 ~30 LOC + 1 branch 的低频操作）。`browser_cdp.rs` 在 2026-05-17 sprint 由 2149 → 1090；`gateway.rs` 由 1850 → 1399（patch_* 退役）已脱离 fail 线。
- **超长文件 warn 线（800-1500）**：13 个，全部属 AC-1b 稳定 catalog（`workflow/engine/tests.rs` 1236 测试目录、`hermes_memory.rs` 1014 Hermes contract、`db/analytics.rs` 933 schema 锁定、`lib.rs` 922 IPC 注册、`engine/mod.rs` 863、`channels/mod.rs` 801），或 sprint 拆出的 cohesive 子模块（`workflow/execution.rs` 956 — 含 HermesExecutor + run path）。剩 `features/talk/useTalkMode.ts` 1130 高频但 Talk Mode v0.4.0+ 还没上线，无紧迫性。
- **clippy unwrap baseline 546**：基本来自 tests + db 模块；新代码用 `.expect()` 不要 `.unwrap()`，否则越基线 CI 红。
- **release 不打包 Pack** 已在 v0.2.13 起落地：`tauri.conf.json :: bundle.resources` 不含 `assets/skill-packs/**`。dev 模式 + bundled seed 仍走 `assets/skill-packs/`。
- **客户 Pack 出基座**（2026-05-17 8c · commit `40e63c0` + `8c0d7d3`）：美正 Pack 从 `src-tauri/assets/skill-packs/meizheng/` 搬到顶层 `packs/meizheng/` 并 gitignored。`src-tauri/assets/skill-packs/` 现在**只有** `cross_border_ecom`（通用骨架）。客户 Pack 分发走私有 zip + Settings → Packs → 导入 zip（`pack_import_zip` IPC）。详见 `packs/README.md`。

## 最近改动要点（近 30 天）

> 截止 2026-05-17。只记**结构性改动**，不记单 bug 修复。细节参见 [`../../CHANGELOG.md`](../../CHANGELOG.md)（CHANGELOG 在 v0.2.14 之后未补条目，post-tag 19 个 commit 全部围绕美正 Pack）。

- **2026-05-17 · P0/P1 重构 sprint（14 commit，未发版）**：把 3 个高频文件按 cohesive 拆子模块：
  - `ipc/browser_cdp.rs` **2149 → 1090（−49%）**，拆 5 子模块（`chromium_bundle` / `cdp_protocol` / `disabled_sentinel` / `lifecycle` / `profile_ops`）
  - `ipc/workflow/mod.rs` **1421 → 506（−64%）**，拆 `execution` 子模块（HermesExecutor + run path）
  - `ipc/pack/mod.rs` **1214 → 524（−57%）**，拆 `install` + `config` 子模块
  - 新增 AC-1b 规则区分"稳定 catalog 文件"vs"高频更新文件"（写入 `.windsurfrules` + `.trae/rules/project_rules.md`）
  - Bug fix：BrowserCdpSection.tsx 乐观更新 + finally refresh（解决"启停按钮要切 tab 才更新"问题）
  - 顺手退役 4 个 `gateway.rs::patch_*` 函数（功能已被 Hermes plugin hooks / corey-guards / i18n / config toggle 替代）
  - 顺手 de-flake `seed_chrome_download_prefs_is_idempotent_and_skips_existing`（PR 4-pack 重构暴露了未获 HOME_LOCK 的潜伏 bug）
  - CI 5 项 gate 全绿 / Rust 568 tests / Vitest 112 tests / `cargo build --bin Corey` 通过

- **2026-05-13 ~ 17 · 美正 Pack 多承运商分区自动化（post-v0.2.14，未发版）**：
  - **USPS Priority Mail 分区** 端到端落地（`download_usps_zones.py` + `upload_zones_meizheng.py` carrier-parametric + `update-usps-zones.yaml`）：3 位 ZIP3 → 5 位完整邮编展开（005→00500-00599）+ 5 位 override 拆分去重；命名按美正OS 约定 `USPS-GROUND` 前缀；workflow 用 `--all` + venv python + 独立 output 目录
  - **UPS 月度分区** 落地：`download_ups_zones.py` + `download_ups_zones_browser.py`（CDP 触发原生下载兜底）+ `update-ups-zones.yaml` + ZoneConfigEditor UI
  - **FedEx 月度分区** 落地：`download_fedex_zones.py` + `update-fedex-zones.yaml`
  - **USD 汇率工作流分离**：从 fuel-rate 配置剥离独立 `exchange-rate-config.yaml` + `pack_exchange_rate_config_get/set` IPC + ExchangeRateConfigEditor
  - **CarrierConfigEditor 中文 cron picker**：每周/每月/每天/自定义 + 时间选择器，保存即写 `~/.hermes/cron/jobs.json`
  - manifest schedules 从 1 → 7（USD daily 09:30/10:30 + UPS/USPS/FedEx monthly + 周日 23:30 fuel + 月底 DHL fuel）
- **2026-05-15 · 美正 Pack 需求 #2 UPS 分区数据**：
  - 发现 UPS 公开 CDN 索引 API：`zone-chart.json`（902 个 ZIP3 的 XLS URL）
  - 正确域名 `assets.ups.com`（不是 `www.ups.com`），无需 cookies
  - XLS 解析完成：自动定位表头行 + Ground 列 + Hawaii/Alaska 脚注（Zone44/46）
  - 模板输出格式与用户提供的 `邮编分区模板.xlsx` 完全一致
  - 端到端验证通过：ZIP3=910 → 下载 44KB XLS → 解析 905 主行 + 419 脚注 → 输出 1324 行模板 Excel
  - 架构设计完成：4 个独立脚本（下载/批量下载/上传/批量上传）+ checkpoint/resume + workflow
  - 详见 `TODO.md` 需求 #2 章节
- **2026-05-15 · 美正 Pack 需求 #1 汇率自动更新**：
  - BOC 中行美金现汇卖出价抓取 + 美正OS API 写入端到端跑通
  - 纯 HTTP 抓取（JWT 验证码绕过），零浏览器
  - 独立 `exchange-rate-config.yaml` 配置 + 独立 IPC 命令 `pack_exchange_rate_config_get/set`
  - manifest 中两个 schedule（09:30 + 10:30 兜底）触发同一 workflow
  - 已知问题：`fuel-rate-config.yaml` 中凭证 username 曾被误覆盖，需确认用户最新配置
- **2026-05-12 · v0.2.13**：
  - Windows file-ops-guard 路径匹配修复 + PowerShell WPF 确认对话框（GUARD_VERSION 2→3）
  - `skill_curator` / `skill_hub` / `workflow oneshot` 三个 IPC 改用 `resolve_hermes_binary()` 替代裸 `Command::new("hermes")`，修复 macOS GUI 应用找不到 `~/.local/bin/hermes` 的问题
  - README.md 全面更新：重新组织功能列表、新增 Pages 表格、更新测试计数
  - Release workflow 改为自动发布（`releaseDraft: false`）
- **2026-05-12 · v0.2.13 Guard IPC 桥接 + IM 通道审批 + UI 修复**：
  - Guard 审批从 macOS 原生弹窗改为 Corey UI 内嵌审批卡片（`GuardConfirmModal`，样式与 Hermes `ApprovalCard` 一致）
  - 新增 Rust `guard.rs` IPC 桥接：axum `/guard/prompt` + oneshot channel + Tauri event
  - IM 通道（微信/Slack/WhatsApp）文件审批协议：pending approval 文件 + "回复「确认执行」"流程，5 分钟 TTL
  - Talk Mode 审批与 Chat 对齐：不再自动批准，渲染 `ApprovalCard` 等待用户选择
  - 发送按钮状态修复：`UiMessage.streaming` 与 `pending` 分离，AI 回复期间保持停止按钮
  - 双重发送防护：`sendingRef` 同步锁防止 Enter + form submit 同时触发
  - Guard 脚本升级 v3→v4：新增 `_ask_user_ipc` + `_discover_corey_port` + pending approval 文件协议
- **2026-05-12 · v0.2.13 Memory 知识图谱增强**：
  - Chat 自动 fact 召回：每条用户消息发送前 FTS5 检索 Hermes `memory_store.db`，命中 facts 注入 context
  - Chat bubble 召回标签：assistant 消息下方显示"已召回 N 条记忆"金色标签
  - Memory 页 entity 列表 UI：展示 Hermes holographic 实体 + 关联 facts（category + trust score）
  - `corey_entity_relations` 表 + BFS 图查询 service（`corey_graph_query` IPC）
  - `corey_entity_mentions` 表自动建表（为后续 Tier 递进做准备）
  - 详见 `docs/spec/memory-knowledge-graph.md` v1.2
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
