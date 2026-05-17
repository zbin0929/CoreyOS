# CoreyOS 全局 TODO

<!-- type: status -->
<!-- last-verified: 2026-05-17 -->
<!-- 校验规则：每 30 天一次；超过 500 行需立刻拆分或归档 -->

> ⛔ **2026-05-10 起本文件暂被 [`FOCUS.md`](./FOCUS.md) 覆盖。**
> 在拿到第 1 个真实付费客户之前，不参考下文 30 条，只看 FOCUS.md 的 3 件事。
> 拿到客户、跑完一轮反馈之后，回头基于真实数据重写本文件。
>
> **当下状态**：v0.2.14 · 基座 12 项（B-1~B-12）全部 ✅ · 美正 Pack 6 个需求中 4 个已交付（#1 USD 汇率 ✅ · #2 UPS 分区 ✅ · USPS 分区 ✅ · FedEx 分区 ✅ · #6 燃油费率 ✅）；剩余 #3 财务发票 / #4 领星费用 / #5 一件代发待客户对齐启动
> **铁律**：0 修改 Hermes Agent 代码 / trait 表面。Hermes 升级只换 binary。
> **当前阻塞**：P-1 的 Amazon SP-API 开发者账号（审核 1-2 周）。不阻塞 demo 交付（先用报表上传方案）。
> **关联文档**：[`CURRENT-STATE.md`](./CURRENT-STATE.md) · [`roadmap.md`](./roadmap.md) · [`known-issues.md`](./known-issues.md) · [`../spec/architecture.md`](../spec/architecture.md) § Pack Architecture

---

## 一、下一步（未来 7 天 · 阻塞商业化）

| # | 动作 | 工期 | 交付物 |
|---|---|---|---|
| 1 | ~~**打通 Soul 注入**~~ | ~~1d~~ | ✅ 2026-05-09 完成：`pack_active_souls` IPC + `enrichHistoryWithContext` 已可用；Pack `cross_border_ecom` v0.1.0 骨架（manifest + soul.md）落地；Rust guard + e2e 锁死 |
| 2 | ~~**走通端到端行业链路**~~ | ~~2-3d~~ | ✅ 2026-05-10 完成：`cross_border_ecom` v0.2.0 落地 3 Skill（ad_analyst / inventory_sentinel / review_monitor）+ 3 Workflow（ad_daily_check / inventory_alert / review_alert）+ 3 手造 demo CSV；CompositeDashboard `ad-overview` 修复 `layout` 数组格式；pack:: 84 passed |
| 3 | ~~**交付工具链脚本化**~~ | ~~0.5d~~ | ✅ 2026-05-10 完成：`scripts/new-customer.sh` — 一键生成 customer.yaml + license.txt + INSTALL.md + README.md；Rust smoke test `new_customer_sh_emits_parseable_yaml` 锁死 yaml 契约；[`../spec/licensing.md`](../spec/licensing.md) 「整包交付」章节覆盖全流程 + 踩坑指南 |

**验收标准**：启用 `cross_border_ecom` Pack → 用户问"帮我看看昨天的广告数据" → AI 自称亚马逊运营顾问 + 召回 SP 广告结构 KB + 返回结构化 ACoS/CTR/CVR + 底部浮出"一键调整"Workflow 入口。

---

## 二、第二批（未来 30 天 · 质量红线）

| # | 动作 | 工期 | 目的 |
|---|---|---|---|
| 4 | **Chat 状态机重构** | 3-4d | `chat/index.tsx` 反复震荡 1000 行；引入显式 reducer（idle/composing/streaming/tooling/error）彻底止血 |
| 5 | **Workflow 前端 4 态解耦** | 2-3d | `workflow/index.tsx` 拆 List/Editor/Runner/Approval |
| 6 | **Workflow IPC 分离** | 2d | `ipc/workflow.rs` 拆 service + executors + browser_config |
| 7 | **首次运行压缩** | 2d | `FirstRunOrchestrator` 自动跑 preflight / install / 配 LLM / 启 Pack，失败给可复制 debug |
| 8 | **Pack 升级 UX + 数据保护合同** | 2-3d | 当前 `pack/seed.rs` "存在即跳过" 保护客户改动但永不升级 Pack。需要：(a) 启动时比对 bundled vs installed manifest version，新版可用就弹 "Pack 有更新（v1.0 → v1.1），合并/跳过/查看差异" UX；(b) Pack-level migration（manifest schema 改字段时按版本顺序跑 migrator）；(c) 合并前自动备份 `~/.hermes/skill-packs/<id>/` → `.bak-<timestamp>/`，保留最近 7 天；(d) 写 `docs/spec/data-protection-contract.md` 钉死"哪些用户数据永远不动"的清单；(e) 给 `cross_border_ecom` 写一次 v1→v2 真实 migration 演练 |
| 8b | **客户机器迁移（备份/恢复）** | 2d | Settings → Advanced 加 "导出 / 导入 数据" 按钮：打包 `~/.hermes/` 关键子集 + `caduceus.db` + `customer.yaml` 成单个 `.corey-backup` 文件；恢复时反向解包 + 一键校验完整性。客户换电脑 / 重装系统时不丢任何东西。 |
| 8c | **把美正 Pack 从基座源码摘出** | 1.5-2h | 现状：`src-tauri/assets/skill-packs/meizheng/` 完整 bundle 在基座 binary 里，每个客户启动都会自动装上美正 Pack。这违反架构铁律"Pack ≠ 基座代码"。摘出后：(a) `meizheng/` 移到独立 repo 或 zip；(b) `seed.rs` 改成只 bundle `cross_border_ecom` 通用骨架（或全空）；(c) 美正客户走 `pack_import_zip` IPC 或 `customer.yaml` 远程源声明安装；(d) 删除 `pack/manifest.rs::tests` 里写死的 `id: meizheng` fixture；(e) 加 CI smoke：基座干净启动后 `packs=0`，导入美正 zip 后 `packs=1 enabled=1 healthy`。低风险、可独立 PR。 |

---

## 三、第三批（未来 90 天 · 长期健康）

| # | 动作 | 工期 | 目的 |
|---|---|---|---|
| 9 | 文档三分法 + 定期校验 | ✅ 2026-05-09 完成 | 详见 [`../README.md`](../README.md) 整理历史 |
| 10 | 本地 opt-in 使用埋点 | 1.5d | `~/.hermes/usage.jsonl` 用户主动导出，产品决策有数据 |
| 11 | Hermes 版本兼容矩阵 | 1d（首次） | `src-tauri/tests/hermes-compat/` fixture，每个 Hermes 版本存 `config.yaml` 样本 |
| 12 | 白标客户模式（可选） | 1d | `customer.yaml mode: customer` 隐藏 Terminal/Compare/Logs/MCP/Memory 入口 |

---

## 四、P-1 跨境电商 Pack（v0.3.0 · 当前活跃 Pack）

- **状态**：v0.2.0 · 3 Skill（ad_analyst / inventory_sentinel / review_monitor）+ 3 Workflow（ad_daily_check / inventory_alert / review_alert）+ 3 demo CSV + `ad-overview` CompositeDashboard view（layout 数组格式正确，3 按钮浮出）· 剩余 6 能力待 SP-API + 真实客户迭代
- **目标版本**：v0.3.0
- **交付方式**：一次性全做完 9 能力（不分批）
- **外部前置**：Amazon SP-API 开发者账号（申请中）
- **差异化打法**：本地部署 / 不绑 ERP / 用户可自定义新场景

### 9 能力矩阵（对标麦多 AI）

| # | 能力 | 实现 | 用到的视图 | 状态 |
|---|---|---|---|---|
| 1 | 战场地图 | CompositeDashboard 组合 | Composite + Metrics + Table + Alert + Radar | ✅ UI |
| 2 | AI 智能体总管 | Hermes 多 Agent | 对话 + ActionPanel | ✅ 已具备 |
| 3 | 广告守卫 | Workflow + Browser MCP + Skill | Table + Alert | ✅ skill+workflow+demo CSV（真实数据待 SP-API） |
| 4 | 库存哨兵 | Scheduler + MCP | Table + Alert | ✅ skill+workflow+demo CSV（🔴🟡🟢⚫ 四档） |
| 5 | 差评监控 | Workflow + MCP | Alert | ✅ skill+workflow+demo CSV（Q/L/D/F/S/X 六桶 + P0/P1/P2） |
| 6 | 数据分析 | Skill + RAG | 对话 + ActionPanel | ✅ |
| 7 | 市场分析 | Skill + 报告生成 | 对话 + ActionPanel | ✅ |
| 8 | 战场雷达 | Workflow + Browser | Timeline | 🟡 数据源待接 |
| 9 | 六维诊断 | Skill + 多维评分 | Radar | ✅ |

### 已完成项（仅列仓库中实际存在的文件）

- `manifest.yaml` v0.2.0（schema_version:1，挂载 soul/3 skills/3 workflows/1 view）
- `prompts/soul.md` 亚马逊运营顾问人设 + Soul 注入链路 ✅ 2026-05-09
- **Skills**（均为 YAML frontmatter + Markdown body）：
  - `skills/ad_analyst.md` SP 广告数据分析师
  - `skills/inventory_sentinel.md` 库存哨兵（🔴🟡🟢⚫ 四档分级）
  - `skills/review_monitor.md` 差评监控（Q/L/D/F/S/X 六桶 + P0/P1/P2 + listing_alert 阈值）
- **Workflows**（均为 2-step agent，id 精确对齐 CompositeDashboard 硬编码按钮）：
  - `workflows/ad_daily_check.yaml` 广告日巡检
  - `workflows/inventory_alert.yaml` 库存巡检
  - `workflows/review_alert.yaml` 差评巡检
- **Samples**（手造真实格式 + 可触发阈值的故事数据）：
  - `samples/sp_ad_report_2026-05-08.csv`（7 campaigns）
  - `samples/fba_inventory_2026-05-08.csv`（10 ASIN · 3 断货 + 3 冗余）
  - `samples/reviews_2026-05-08.csv`（15 条差评 · B08N 触发 q_ratio_7d 阈值）
- views: `ad-overview`（CompositeDashboard，nav_section: home，layout 数组格式：顶行 MetricsCard × 1 + 下行 AlertList × 1；3 按钮）
- 基础设施层（非 Pack 目录内，但支撑上层）：
  - `resolve_mcp_source` stdio 支持（subprocess + JSON-RPC）
  - CompositeDashboard DateRange + ActionTrigger + `LayoutCell[]` 渲染
  - MetricsCard `_delta` 同比 / TrendBadge
  - Rust guard `bundled_skill_packs_are_wellformed`（soul + skills + workflows）
  - `COREY_FORCE_RESEED=1` 开发时强刷破坏 `~/.hermes/skill-packs/<id>/` 保护（pack::seed 4 passed）
  - e2e `pack-soul-inject.spec.ts` 锁死 Soul 注入契约

### 剩余未做（按优先级）

#### P0 — 不做无法交付
- [x] Soul 注入闭环 ✅ 2026-05-09（见 § 一 · 第 1 项）
- [ ] 真实卖家账号端到端实测

#### P1 — 粗糙程度的底线 · ⏸️ **阻塞：Amazon SP-API 开发者账号**
- [ ] `mcp-amazon-sp` SP-API MCP Server（接口对齐 amazon-browser，未来无缝切换）
- [ ] 广告规则引擎：Target ACOS 自动调 bid / 预算再分配 / 自动否词（20 次点击无转化）
- [ ] 分时投放 Dayparting：按小时级 metrics
- [ ] 库存补货建议卡片：安全库存 + 建议补货量 + 交期
- [ ] 断货自动停广告 + 在途跟踪 Inbound
- [ ] 关键词排名追踪 + Buy Box 份额监控
- [ ] 退货率 + NCX Rate + 账户健康（ODR / IPI / IP 投诉率）

#### P2 — 锦上添花
- [ ] 新品推广 / Listing 优化 / FBA 索赔 / 竞品防御 / 促销节奏 5 条 Workflow
- [ ] IM 推送（微信 / 钉钉 / QQ）+ CSV/Excel 导出 + 多店铺切换
- [ ] 恢复 `license_feature: cross_border_ecom`（给客户签 license）

#### P3 — UI 打磨
- [ ] DataTable 列筛选 / 搜索栏 + KPI 下钻 ASIN 明细
- [ ] 自定义看板布局（拖拉拽）+ 移动端 / 微信小程序适配
- [ ] 广告 4 级下钻（Campaign → AdGroup → Keyword → SearchTerm）+ 多仓库视图
- [ ] 评价星级饼图 + FIFO COGS + 异常检测智能提示
- [ ] AI CFO 报告 / 多渠道归因 / 发票管理

---

## 五、企业 RPA Pack — 美正（v0.3.x · 燃油费率已上线）

- **状态**：燃油费率（#6）+ 汇率（#1）+ UPS/USPS/FedEx 月度分区（#2 + 衍生 USPS/FedEx）共 4 条已交付；剩余 #3 财务发票 / #4 领星费用 / #5 一件代发待客户对齐启动
- **架构设计**：详见 [`../plans/enterprise-rpa-pack.md`](../plans/enterprise-rpa-pack.md)
- **目标版本**：v0.3.x（与 v0.3.0 跨境电商并行，不互相阻塞）
- **客户**：美正（首例）— 实际是企业 RPA 通用架构的第一个落地实例
- **关键约束**：美正OS 有 REST API（燃油费率模块已验证）· Win+Mac 混部 · 多角色权限 · 不上专用服务器（复用员工现有 PC）

### 需求清单（6 条已知 + 后续追加）

| # | 需求 | 模式 | 触发 | 跑在哪 | 状态 |
|---|---|---|---|---|---|
| 1 | 中行美金现汇卖出价 → 美正OS | Pattern A: Scrape→Push | 工作日 09:30 + 10:30 兜底 | runner | ✅ 已交付（独立 `exchange-rate-config.yaml` + `pack_exchange_rate_config_*` IPC + ExchangeRateConfigEditor + 2 schedules） |
| 2 | UPS 月度分区 → 美正OS | Pattern B: 批量下载→转换→逐个上传 | 每月 1 号 02:00 | runner | ✅ 已交付（`download_ups_zones.py` + `download_ups_zones_browser.py` 兜底 + ZoneConfigEditor + workflow） |
| 2b | USPS Priority Mail 分区 | Pattern B + 5位邮编展开/拆分 | 每月 1 号 03:00 | runner | ✅ 已交付（`download_usps_zones.py` + carrier-parametric `upload_zones_meizheng.py` + ZIP3→5位 expand + override 拆分去重 + workflow） |
| 2c | FedEx Ground 分区 | Pattern B | 每月 1 号 04:00 | runner | ✅ 已交付（`download_fedex_zones.py` + workflow） |
| 3 | 财务发票自动化 | Pattern D: 文档→结构化→Push | 邮件/上传事件 | runner | 🟡 待客户对齐 |
| 4 | 领星费用导出 → 美正OS | Pattern B 浏览器版 | 每月 1-3 号 | runner | 🟡 待客户对齐 |
| 5 | 一件代发订单取消 | Pattern C: 事件→操作 | UI 按钮 | end_user | 🟡 待客户对齐 |
| 6 | UPS/Fedex/DHL 燃油费率 | **API 直写**（非浏览器）| 每周日 23:30 + 每月 1 号 02:00 | runner | ✅ 已交付 |

### 需求 #6 已交付内容

- **抓取**：`crawl4ai_extract_{ups,fedex,dhl}.py` 抓取承运商官网 → Agent 解析 → JSON
- **写入**：`update_fuel_rates_via_api.py` 直接调美正OS REST API（login → CREATE → audit），零浏览器、零 LLM 推理
- **调度**：两个 Cron Workflow（`update-fuel-rates-weekly` / `update-fuel-rates-monthly`），通过 `~/.hermes/cron/jobs.json` 注册到 Hermes scheduler
- **配置 UI**：`CarrierConfigEditor` 中文 cron picker（每周/每月/每天/自定义 + 时间选择器），保存后立即更新 jobs.json
- **自动审核**：CREATE 成功后自动调 `PUT /quote/feetype/fuelRate/admin/audit`
- **效率**：单次更新从 8 分钟 / 6.3M tokens → **1.5 秒 / 5K tokens**

### 需求 #1 已交付内容

- **抓取**：`scrape_boc_usd_rate.py` — 纯 HTTP 抓取 BOC 汇率页面（JWT 验证码绕过），取 earliestTime 后第一条匹配记录
- **写入**：`update_exchange_rate_via_api.py` — login（Basic Auth `/login/token`）→ find_currency → update_currency，JWT 解码获取操作人，token 缓存 + TTL
- **调度**：manifest 中两个 schedule（`daily-usd-rate-930` 09:30 + `daily-usd-rate-1030` 10:30 兜底），触发 `update-usd-exchange-rate` workflow
- **配置 UI**：`ExchangeRateConfigEditor` — 独立 `exchange-rate-config.yaml`，含 source（URL/queryKeyword/rateType/earliestTime）、conversion（divideBy）、target（currencyCode）、remarkTemplate
- **IPC**：新增 `pack_exchange_rate_config_get/set` 读写独立配置文件
- **配置读取**：脚本从 `exchange-rate-config.yaml` 读抓取参数，从 `fuel-rate-config.yaml` 读美正OS API 凭证
- **注意**：`fuel-rate-config.yaml` 中 `meizheng_os.credentials.username` 曾被误覆盖为 `admin@admin`，需确认用户最新配置已正确保存

### 需求 #2 UPS 月度分区 — 架构设计

#### 已验证的数据源

- **索引 API**：`GET https://www.ups.com/us/en/zone-chart.json` → 返回 902 个 ZIP3 的 XLS 下载 URL
- **XLS CDN**：`https://assets.ups.com/adobe/assets/urn:aaid:aem:{uuid}/original/as/{zip3}.xls`
  - 域名是 `assets.ups.com`（不是 `www.ups.com`）
  - 无需 cookies / Bot 防护绕过，纯公开 CDN
  - 每个 XLS 约 44KB，包含完整的 Ground/3Day/2Day/NextDay 分区 + Hawaii/Alaska 脚注
- **分页**：索引 API 支持 `?offset=N&limit=M` 参数

#### XLS 结构（以 910 为例）

```
Row 0-7: 标题/说明（ZONE CHART / UPS Ground... / ZONES）
Row 8:    表头 Dest. ZIP | Ground | 3 Day Select | 2nd Day Air | ...
Row 9-945: 主数据（每行一个 ZIP3，Ground 列值如 008=Zone8, 045=Zone45）
Row 946+:  脚注
  [3] For Alaska ... Zone 44 for Ground → 5位邮编列表
  For Alaska ... Zone 46 for Ground → 5位邮编列表
  [2] For Hawaii ... Zone 44 for Ground → 5位邮编列表
  For Hawaii ... Zone 46 for Ground → 5位邮编列表
```

#### 美正OS 上传模板格式

```
Row 1: 说明文字（"1、分区代码、开始邮编、截止邮编均为必填..."）
Row 2: 分区代码 | 开始邮编 | 截止邮编
Row 3+: Zone2 | 00500 | 00599  （ZIP3=005 → 00500-00599）
        Zone44 | 96703 | 96703 （Hawaii 5位邮编，一对一）
```

- 邮编列必须设为 `@`（文本格式），防止前导零丢失
- Zone 代码：Zone2/Zone3/Zone4/Zone5/Zone6/Zone7/Zone8/Zone44/Zone45/Zone46
- Zone44/45/46 是独立分区（Hawaii/Alaska），不是 4 区

#### 脚本拆分方案（不做一体化）

| 脚本 | 职责 | 输入 | 输出 |
|---|---|---|---|
| `download_ups_zone_xls.py` | 下载单个 ZIP3 的 XLS + 解析 + 转换为模板 Excel | `--zip3 910` | `UPS-GROUND-910.xlsx` |
| `batch_download_ups_zones.py` | 批量调度：读索引 → 逐个调用下载脚本 → checkpoint/resume | `--all` 或 `--zip3-list file.txt` | 目录下 902 个 xlsx + `checkpoint.json` |
| `upload_zone_to_meizheng.py` | 上传单个 ZIP3 的 Excel 到美正OS（复用 login/token/cache 模式） | `--xlsx UPS-GROUND-910.xlsx` | API 响应 |
| `batch_upload_zones.py` | 批量上传：读目录 → 逐个调用上传脚本 → checkpoint/resume | `--dir ./zones/` | `upload_report.json` |

#### 批处理策略

- **下载**：902 个 × ~3s/个 ≈ 45 分钟。串行下载（UPS CDN 不限流但不宜并发）
- **上传**：902 个 × ~2s/个 ≈ 30 分钟。串行上传（美正OS API 可能有频率限制）
- **checkpoint**：每完成一个记录到 JSON，断了重跑自动跳过
- **重试**：单个失败指数退避（2s/4s/8s），最多 3 次
- **日志**：每个操作记录到 `zone-update-{date}.log`，失败的手动补

#### Workflow 设计

```yaml
id: update-ups-zones
trigger:
  type: cron
  expression: "0 0 2 1 * *"  # 每月1号凌晨2点
steps:
  - id: batch_download
    prompt: |
      运行批量下载脚本，902个ZIP3全部下载并转换为模板Excel
  - id: batch_upload
    prompt: |
      运行批量上传脚本，逐个上传到美正OS
```

#### 已完成

- ✅ XLS 下载+解析+转换端到端验证（ZIP3=910，1324行，10个Zone）
- ✅ 模板格式验证（与用户提供的 `邮编分区模板.xlsx` 一致）
- ✅ Hawaii/Alaska 脚注解析（Zone44/46 的 5 位邮编）
- ✅ 数据源验证（`assets.ups.com` CDN 无需认证）

#### 待完成

- [ ] `download_ups_zone_xls.py` — 整理当前 `download_ups_zones_browser.py` 为正式脚本
- [ ] `batch_download_ups_zones.py` — 批量下载 + checkpoint
- [ ] `upload_zone_to_meizheng.py` — 美正OS 分区上传 API（需确认接口）
- [ ] `batch_upload_zones.py` — 批量上传 + checkpoint
- [ ] `zone-config.yaml` — 独立配置文件
- [ ] `update-ups-zones.yaml` — workflow
- [ ] 端到端测试：下载 → 转换 → 上传

### 关键设计决策（不再讨论）

| 决策 | 理由 |
|---|---|
| 不上专用服务器，混合 runner/end_user 部署 | 复用客户现有员工 PC，零额外硬件成本 |
| 目标系统有 API 则优先 API（如燃油费率），无 API 走 Playwright RPA | 确定性 > 灵活性；API 路径零 LLM 推理 |
| 分布式锁存目标系统自己一张表 | 零外部依赖，审计直观 |
| 时间窗调度而非准点（`first_after HH:MM`）| 员工 PC 开机时间不固定，配 Owner + Failover 兜底 |
| 锁屏可跑、睡眠不可跑 | 安装向导自动配电源管理 + 开机自启 + 防 App Nap |
| Workflow 模式库 A/B/C/D | 新需求按模板填空，1-3 天/条 |
| 复用 Hermes `vue-element-ui-automation` skill | HD-1：上游已有，不重写 |

### 待客户 Kickoff 对齐（阻塞其余 5 条需求）

详见 [`../plans/enterprise-rpa-pack.md`](../plans/enterprise-rpa-pack.md) § 十四：

- [ ] 美正OS 其他模块是否也有 API（汇率/分区/订单）
- [ ] 能否开放一张表给 Corey 存 corey_locks / corey_heartbeats
- [ ] user_role 完整列表 + runner 候选机器清单
- [ ] 5 条剩余需求各自的时间敏感度
- [ ] 失败通知首选渠道（企业微信/钉钉/飞书/邮件）
- [ ] UI 改版提前通知 N 天（合同条款）

### 执行计划（阶段化）

| 阶段 | 周次 | 交付物 |
|---|---|---|
| 阶段 0 | Week 0 | 客户对齐开放问题 |
| 阶段 1 | Week 1-2 | Workflow Engine 节点扩展 + 分布式锁库 + 凭证库 + Adapter 框架 |
| 阶段 2 | Week 3-4 | 美正 Pack v0.1（需求 #1）端到端 |
| 阶段 3 | Week 5-7 | 美正 Pack v0.2（需求 #2 + #4 + #5）端到端 |
| 阶段 4 | Week 8-11 | 美正 Pack v0.3（需求 #3 财务发票）|

### 通用化（v0.4.x 之后）

设计上已为后续企业客户做好抽象 —— `templates/patterns/` 跨 Pack 复用，水平 skill（中行汇率、UPS 分区等）抽到 `corey-horizontal-skills/`。第 N 个企业客户工期预期 4-8 周（取决于目标系统复杂度）。

---

## 六、其他行业 Pack（P-2 ~ P-8 · 触发式）

不主动开发。真实付费客户合同到位时启动对应 Pack，沿用 P-1 模板（manifest + 视图 + Skill + Workflow + MCP）。

| Pack | 触发条件 |
|---|---|
| P-2 财务 / P-3 尾程 / P-4 头程 / P-5 海外仓 / P-6 卡派 / P-7 客服 / P-8 报价 | 真实客户合同 |

---

## 七、永远不做（商业模式 / 架构决策）

| 砍掉项 | 原因 |
|---|---|
| ❌ Skill Pack 商店 UI / 推荐列表 / 分类搜索 | 不让客户自己挑 Pack |
| ❌ 在线激活 / JWT / 心跳 / 联网校验 | ed25519 离线方案够用 |
| ❌ 客户管理后台 | Notion / 表格记账即可 |
| ❌ 通用拖拽式可视化引擎 | 12 视图模板 + manifest 声明替代 |
| ❌ 远程更新服务后端 | GitHub Releases + COS 够用 |
| ❌ 单独的 Persona 系统 | 并入 Pack `soul_inject` |
| ❌ Pack 写 React 代码 | 违反唯一基座原则 |
| ❌ AI 数字人 / avatar | 与开发者工具定位冲突 |
| ❌ 自改写 prompt / meta-optimisation | 研究前沿而非产品 |
| ❌ 自建任务 DAG 框架 | LangGraph / CrewAI / AutoGen 已成熟 |
| ❌ 桌面侧视频处理 | Tauri 打包膨胀 |
| ❌ 常开语音唤醒词 | 信任 / 电量成本高 |
| ❌ Hermes Browser Harness 集成 | Alpha 5 个结构性 bug，只借概念 |

---

## 八、基座能力速查（B-1 ~ B-12 全部 ✅）

| # | 能力 | 版本 | 交付核心 |
|---|---|---|---|
| B-1 | BGE-M3 RAG | v0.1.11 | 本地 ONNX 语义检索，详见 [`../plans/v0.1.11-bge-m3-rag.md`](../plans/v0.1.11-bge-m3-rag.md) |
| B-2 | customer.yaml 白标 | v0.2.0 | schema_version=1 + 品牌 / 导航 / pin / preinstall / config |
| B-3 | Pack 加载器 + 12 视图 | v0.2.0 | manifest + scanner + 模板变量 + MCP 翻译 + 5 阶段数据 wiring + ActionPanel + 升级备份 |
| B-4 | License features 联动 | v0.2.0 | ed25519 + manifest.license_feature + UI 授权占位 |
| B-5 | BGE-M3 离线 zip 导入 | v0.2.7 | `scripts/pack-bge-m3-offline.sh` + `release-bge-m3.yml` + Knowledge 导入 UI |
| B-6 | 用量 / 费用分析仪表盘 | v0.2.0 | Token / 费用 / 30d 趋势 / 延迟 P95 / 错误率 / 预算 / 雷达，详见 [`../plans/v0.2.0-b4-analytics.md`](../plans/v0.2.0-b4-analytics.md) |
| B-7 | 卸载 / 重置 | v0.2.0 | `hermes_data_reset` + `corey_config_reset` + [`../user/uninstall.md`](../user/uninstall.md) |
| B-8 | Talk Mode v1.3 | v0.2.10 | zipformer STT + silero-vad v5 + Piper/VITS/MeloTTS + 镜像 fallback + cpal 常听 |
| B-9 | 任务执行体验 | v0.2.6 | `/tasks` + `/approvals` + tray 计数 + 桌面通知 + artifact 原生 save |
| B-10 | 工作流硬化 | v0.2.5 ~ v0.2.7 | timeout + retry + on_error + tool step + real browser + sub-workflow + webhook |
| B-11 | （归入 B-3/B-9） | - | - |
| B-12 | 多 Agent 并行 | 🗒️ Backlog | 触发式（客户明确要求时再启动） |

### Pack 12 视图模板速查

DataTable / MetricsCard / TimeSeriesChart / PivotTable / TrendsMatrix / Timeline / AlertList / WorkflowLauncher / SkillPalette / FormRunner / RadarChart / CompositeDashboard。每个均支持 `actions:` 段嵌入 Skill / Workflow 触发按钮（"决策归还"模式）。详见 [`../spec/architecture.md`](../spec/architecture.md) § Pack Architecture。

---

## 九、关键决策记录（不再讨论）

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-04-30 | 只做定制，不做 SaaS | 用户基数大了不好管控 |
| 2026-04-30 | 唯一基座二进制 + 数据驱动定制 | 避免维护多版本地狱 |
| 2026-04-30 | Pack 不写 React 代码 | 违反唯一基座原则 |
| 2026-04-30 | 视图模板 12 个（Tier 1）封顶 | 行业研究 + 麦多 AI 对标 |
| 2026-04-30 | License 用 ed25519 离线方案 | 内网客户必备 |
| 2026-04-30 | Pack MCP 自带预编译二进制 | 客户机器零依赖 |
| 2026-04-30 | `pack-data/<id>/` 永不被覆盖 | 用户资产神圣 |
| 2026-04-30 | 跨境电商一次性做 9 能力 | 第一版上线即完整 |
| 2026-04-30 | Persona 并入 `soul_inject` | 不做单独系统 |
| 2026-05-09 | Skill 为主 Agent 为辅 | Hermes Skill 系统天然适合行业知识 |
| 2026-05-09 | Browser Harness 不集成 | Alpha 5 bug，只借 domain-skills 概念 |
| 2026-05-09 | 不依赖 SP-API 也能交付 | 报表上传 → RAG → Skill 先验证价值 |

---

## 十、提交前必跑的本地检查（CI 第一关）

CI 在 Rust 任何 push 上跑这两个 gate；**本地不通过就别 push**：

```bash
# 1. rustfmt 必须一致
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

# 2. clippy::unwrap_used 不允许回归（baseline 见 scripts/clippy-unwrap-baseline.txt）
node scripts/check-clippy-unwrap.mjs
```

前端等价：

```bash
pnpm tsc --noEmit && pnpm lint && pnpm vitest run
```

**教训**（2026-04-30）：`cargo test` 通过 ≠ CI 通过。连续两个 commit（license / customer.yaml）因未跑 gate 导致 CI 红灯。

## 十一、当下阻塞 & 下次会话起手

1. **Amazon SP-API 开发者账号**：审核中。SP-API 到位后启动 P-1 P1（预估 1-2 周）。
2. **端到端行业链路 demo**：见 § 一 · 第 2 项。Soul 注入已打通，可立即用跨境电商 Pack 跑完整 demo。
3. **首个真实客户**：签到就立刻拉通完整链路（§ 一 · 第 2 项），验证 demo。

历史 Bug 详见 [`known-issues.md`](./known-issues.md)。历代版本变更见 [`CHANGELOG.md`](../../CHANGELOG.md)。历史 Phase 见 [`../archive/phases/`](../archive/phases/)。
