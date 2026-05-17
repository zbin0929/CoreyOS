# Roadmap · 路线图

<!-- type: status -->
<!-- last-verified: 2026-05-17 -->
<!-- 校验规则：每月校验；发布新版本时同步 Upcoming 和 In progress 节。 -->

> 本文件描述 CoreyOS **未来计划 + 当下在做**。
> **已发布版本清单**看 [`CHANGELOG.md`](../../CHANGELOG.md)（单一事实源）。
> **当下状态快照**看 [`CURRENT-STATE.md`](./CURRENT-STATE.md)。
> **详细 TODO**看 [`TODO.md`](./TODO.md)。

---

## In progress · 当下在做

| 条目 | 目标版本 | 状态 | 备注 |
|---|---|---|---|
| Soul 注入链路打通 | v0.2.10 | ✅ 2026-05-09 | `pack_active_souls` IPC + `enrichHistoryWithContext` + cross_border_ecom v0.1.0 骨架 + Rust guard + e2e |
| 跨境电商 Pack 端到端链路 | v0.2.11 | ✅ 2026-05-10 | v0.2.0：3 Skill + 3 Workflow + 3 demo CSV + CompositeDashboard layout 修复；9 能力矩阵 5/9 落地 |
| 交付工具 `scripts/new-customer.sh` | v0.2.11 | ✅ 2026-05-10 | 一键生成客户包 + Rust smoke test 锁死 yaml 契约 + licensing.md 整包交付章节 |
| 美正 Pack 燃油费率自动化 | v0.2.14 | ✅ 2026-05-15 | 需求 #6：API 直写（非浏览器）· crawl4ai 抓取 UPS/FedEx/DHL · 中文 cron picker UI · 自动审核 · 1.5s/5K tokens |
| 美正 Pack 多承运商月度分区自动化 | post-v0.2.14 (未发版) | ✅ 2026-05-17 | 需求 #2 + 衍生：UPS/USPS/FedEx 三家 download → transform → upload 全链路；ZoneConfigEditor + carrier-parametric upload + ZIP3→5位邮编 expand/override 拆分；3 条月度 schedule |
| 美正 Pack USD 汇率自动化 | post-v0.2.14 (未发版) | ✅ 2026-05-17 | 需求 #1：剥离 fuel-rate 配置 → 独立 `exchange-rate-config.yaml` + 独立 IPC + ExchangeRateConfigEditor + 09:30/10:30 双 schedule |
| Amazon SP-API 开发者账号申请 | v0.3.0 | ⛔ 阻塞中 | 外部审批时效；解阻后推进 9 能力矩阵 P1 批次 |
| AI Browser 焦点抢夺根治（自带 Chromium + LSUIElement + ad-hoc 重签） | v0.3.x | 🟡 spike 中 | progress.txt 记录；当前卡在"先验证 LSUIElement 能否隔绝焦点"，验证通过再进入正式集成 |

> 🔁 当下在做应当永远 ≤ 5 条，超出代表注意力分散。

---

## Upcoming · 未来版本

| 版本 | 计划 | 核心能力 |
|---|---|---|
| **v0.3.0** | [`TODO.md`](./TODO.md) § P-1 | 跨境电商 Pack（SP-API 真实数据接入 · MCP 浏览器自动化 · 9 能力矩阵 P1 批次）|
| **v0.3.1** | 客户反馈驱动 | 9 能力矩阵 P2 + 第一个真实客户运行数据验证 |
| **v0.3.x** | [`../plans/enterprise-rpa-pack.md`](../plans/enterprise-rpa-pack.md) | 企业 RPA Pack 通用架构（首例：美正）— 混合 runner/end_user 部署 · 无 API 走浏览器自动化 · 分布式锁 · 时间窗 + Owner + Failover 调度 · Pattern A/B/C/D 模板库 |
| v0.3.2+ | 客户反馈驱动 | 视第一个真实客户的使用数据决定 |

---

## 战略边界 · 永不做（除非产品方向转向）

引用 2026-04-23 评审的决策，不可再翻案：

| 砍掉项 | 原因 |
|---|---|
| AI 数字人 / avatar | 与开发者工具定位冲突；HeyGen / D-ID / Character.ai 都是 10× 团队的消费产品 |
| 自改写 prompt / meta-optimisation | 研究前沿（DSPy / TextGrad），不是产品特性 |
| 自建任务 DAG 框架 | LangGraph / CrewAI / AutoGen 已成熟并获融资，Phase 7 用 adapter 接入即可 |
| 桌面侧视频处理 | ffmpeg 会让 Tauri 打包膨胀；视频能力走 Hermes 后端 |
| 常开语音唤醒词 | 信任 / 电量成本高；仅做 push-to-talk |

详细原因见 [`archive/06-backlog.md`](../archive/06-backlog.md) § Will not do。

---

## Cross-cutting 横向轨道（持续执行）

- **Design** — 每个 PR 触碰 ≥ 1 Storybook story；评审必带截图
- **Performance** — 夜跑基准；> 10% 退化阻塞发布
- **Accessibility** — `axe` + 键盘手测，每个功能完成前过一遍
- **i18n** — 所有字符串第一天就进 locale 文件，零硬编码
- **Docs** — 每个新功能同步 `docs/user/用户手册.md`

---

## Risk Register · 风险登记

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| Hermes SSE 字段变形 | 中 | 高 | 隔离在 `adapters/hermes/gateway.rs` + 固定 fixture |
| CLI `--json` 输出跨版本变化 | 中 | 中 | 钉最低版本 + 版本化 parser |
| Tauri 2 updater 签名在 Win/mac 上复杂 | 高 | 中 | 详见 [`../spec/release.md`](../spec/release.md) |
| Amazon SP-API 开发者资格卡审批 | 高 | 高 | 预留备选 Pack（电商工具替代品 / 新行业） |
| Bundle 体积蠕增 | 高 | 低 | CI size budget + Rollup visualizer |
| 企业 RPA 目标系统 UI 改版（如美正OS） | 高 | 高 | Adapter 启动探测 + 合同要求改版前通知 N 天，详见 [`../plans/enterprise-rpa-pack.md`](../plans/enterprise-rpa-pack.md) § 风险登记 |

---

## 历史里程碑（存档）

| 里程碑 | 达成 |
|---|---|
| **M0** Phase 0 → 可跑空壳 + ⌘K + CI 绿 | ✅ 2026-04-21 |
| **M1** Phase 1 → 可替代 Hermes TUI 做日常聊天 | ✅ 2026-04-22 |
| **M2** Phase 3 → 对标 hermes-web-ui 功能齐 | ✅ 2026-04-22 |
| **M3** Phase 4 → 至少一项同生态最强 | ✅ 2026-04-22 |
| **M4** Phase 5 → "universal agent console" 站得住 | ✅ 2026-04-23 |

所有历代 Phase 实施文档：[`archive/phases/`](../archive/phases/)。
所有历代版本变更：[`CHANGELOG.md`](../../CHANGELOG.md)。
