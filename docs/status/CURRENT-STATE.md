# CURRENT-STATE · 当下事实

<!-- type: status -->
<!-- last-verified: 2026-05-11 -->
<!-- 校验规则：每 30 天至少一次。过期后由下一个接触者重新校验或标记为 stale。 -->

> 本文件描述 CoreyOS **当下**是什么样子，不描述计划。
> 计划看 [`TODO.md`](./TODO.md) 和 [`roadmap.md`](./roadmap.md)。
> 骨架由 2026-05-09 文档整理建立，尚待首次完整填充。

## 一句话

本地部署的 B2B 定制 AI 控制平面。Tauri 2 桌面应用，面向直签 B2B 客户做白标交付（Pack 架构），不做 SaaS 订阅。

## 当前版本

- 产品版本：**v0.2.10**（以 `package.json` / `CHANGELOG.md` 为准）
- 上游 Hermes 版本：**v0.13.0 (2026.5.7)** — 2026-05-11 从 0.12.0 升级；参见 [`hermes-deps.md`](./hermes-deps.md)
- 代码规模：Rust ~140 文件 ~42K 行 / TS ~297 文件 ~44K 行（2026-05-11 晚新增 `soul_md.rs` / `hermes_hooks.rs` / `ipc/security.rs` / `SecuritySection.tsx` 等）
- 测试：Rust 543 + Vitest 112 + Playwright 77（全绿）

> 🔁 校验提醒：数字随代码变动，至少每月核对一次。

## 功能矩阵

| 领域 | 核心能力 | 状态 | 备注 |
|---|---|---|---|
| 聊天 | 多轮对话 / 流式 / 附件 / 模型切换 | ✅ 可用 | Chat 页超大文件待重构 |
| 多 Agent | Hermes（主）/ Claude Code mock / Aider mock | ✅ 可用 | 真实多 agent 能力仅 Hermes |
| 多 LLM | OpenAI / Anthropic / 任意兼容端点 | ✅ 可用 | 通过 LlmProfile 管理 |
| Workflow | React Flow DAG + 7 步类型 + 审批 / webhook | ✅ 可用 | 前端 4-态解耦待做 |
| Talk Mode | zipformer STT + silero-vad + Piper/VITS/MeloTTS | ✅ 可用 | 实机充分验证待做 |
| RAG | BGE-M3 ONNX 本地语义检索 | ✅ 可用 | 2.3 GB，支持离线 zip 导入 |
| Pack 架构 | 白标基座 + skill-packs + pack-data + license features | ✅ 已落地 | `cross_border_ecom` v0.2.0 已装载 3 Skill + 3 Workflow + CompositeDashboard view（layout 数组修复后可正常渲染）；Soul 注入链路已打通，有 Rust guard + e2e 锁死 |
| Browser 工具 | Playwright 子进程 | ⚠️ 脆弱 | 见 `known-issues.md` |
| MCP 管理 | 子进程生命周期 + 工具列表 | ✅ 可用 |  |
| Memory | holographic 后端 | ✅ 可用 | 见 `../spec/memory-strategy.md` |
| License | ed25519 离线签名 + features 联动 | ✅ 已落地 | 签发脚手架待完善 |
| 安全防护（L0-L3）| SOUL.md 铁律 + corey-guards 物理拦截 + Hermes DANGEROUS_PATTERNS | ✅ 已落地 2026-05-11 | Corey UI 审批卡片暂失效，待 `/v1/runs` 迁移；详见 `known-issues.md` |

## 已知关键缺陷（简表）

详见 [`known-issues.md`](./known-issues.md)；以下是截至 2026-05-09 的 P0：

1. **0 真实客户** —— 产品从未在真实 B2B 客户手里跑过完整工作日
2. **Pack 内容 2/9 能力落地** —— `cross_border_ecom` v0.2.0 已结构化落地 3 Skill（ad_analyst / inventory_sentinel / review_monitor）+ 3 Workflow + 3 demo CSV；剩余 P1/P2 能力（规则引擎 / Dayparting / Buy Box / 5 条运营 workflow）阻塞在 SP-API 账号 + 真实客户数据
3. **Amazon SP-API 开发者账号**申请阻塞 v0.3.0 跨境电商 Pack 的真实数据接入

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

> 截止 2026-05-10。只记**结构性改动**，不记单 bug 修复。细节参见 [`../../CHANGELOG.md`](../../CHANGELOG.md)。

- **2026-05-10 · Pack 架构优化**：
  - **Starter 去 Pack 化**：`corey_starter` 从可管理 Pack 降级为内置默认 workflow（`daily-news-digest` / `pdf-summary` 迁至 `assets/default-workflows/`，用 `include_str!` 编进二进制 + `ensure_templates` 写入 `~/.hermes/workflows/`）。
  - **`cross_border_ecom` v0.2.0**：新增 2 Skill（`inventory_sentinel` 库存哨兵 🔴🟡🟢⚫ 四档 / `review_monitor` 差评监控 Q/L/D/F/S/X 六桶 + P0/P1/P2）+ 2 Workflow + 2 手造 CSV；`CompositeDashboard` view 的 `layout` 从非法对象改为合法 `LayoutCell[]` 数组（修复空态占位文案）。
  - **开发体验**：`COREY_FORCE_RESEED=1` 环境变量打破 `seed.rs` 对已存在 `~/.hermes/skill-packs/<id>/` 不覆盖的保护（仅开发）；`pack::seed` 4 passed、`pack::` 84 passed。
  - **安全**：`customers/` 加入 `.gitignore`（license.txt 含 ed25519 签名 token 禁止入库）。
  - **文档**：[`../spec/licensing.md`](../spec/licensing.md) 新增「整包交付（推荐路径）」章节，收录 `scripts/new-customer.sh` 全流程 + 4 场景 + 踩坑指南。
- **2026-05-10 · 交付工具链脚本化**：新增 `scripts/new-customer.sh` — 一键生成客户包（customer.yaml + license.txt + INSTALL.md + README.md），支持 `--dry-run` / `--no-license` / `--hide` / `--primary-color`；Rust smoke test `new_customer_sh_emits_parseable_yaml` 锁死脚本输出的 yaml 与 `CustomerConfig::parse` 的契约，customer 模块 11 passed。
- **2026-05-09 · 跨境电商 Pack 最小可演示版**：`cross_border_ecom` 落地 `skills/ad_analyst.md` SP 广告分析师 + `workflows/ad_daily_check.yaml` 2-step workflow + `samples/sp_ad_report_2026-05-08.csv` 手造数据 + CompositeDashboard `ad-overview` view；Rust guard 扩展校验 skills/workflows 文件存在性（pack:: 83 passed）。
- **2026-05-09 · 文档体系重构**：docs 从 33 个根文件 → 1 个（`README.md`），建立 `spec / status / log / plans / user / archive` 四分法；TODO.md 728→206 行、roadmap.md 201→82 行、新增 `archive/README.md` 防误引。
- **2026-05-07 · v0.2.10 进程内 TTS**（B-8 Talk Mode v1.3）：sherpa-onnx Rust crate + VITS MeloTTS 直接在进程内合成，Web Audio API 播放；去掉 CLI 子进程、临时 WAV、afplay 依赖；即时打断、语速调节、RMS 音量归一化。
- **2026-05-06 · v0.2.9 可见性闭环**：AgentSwitcher 恢复（过滤 Hermes-family）、全局待审批 chip、`/tasks` Long chats tab、工作流 artifacts 目录（`~/.hermes/artifacts/<run_id>/`）+ `save_artifact` MCP 工具。
- **2026-05-06 · v0.2.8 Hermes 不变量**：可编辑 Hermes 标签、Vision 代理（SHA-256 缓存）、MCP 工具扩展 6 项（list_skills / list_chat_sessions / read_memory / append_memory / list_active_runs / cancel_run）、Memory 去重（CJK bigram + 0.45 jaccard）。所有改动仅在 Corey 侧，Hermes Agent 零修改。
- **2026-05-06 · v0.2.7 B-9/B-10 收口**：sub-workflow step_type、webhook 触发器（Bearer token + 127.0.0.1 only）、长表格 → Download CSV、通知分级 all/failure/off。

---

## 如何校验本文件

1. 对照 `package.json` / `CHANGELOG.md` / `Cargo.toml` 核对版本号
2. 对照 `src/features/*` 核对功能矩阵是否有新增
3. 对照 `status/known-issues.md` 核对 P0 清单
4. 更新顶部 `last-verified` 日期
