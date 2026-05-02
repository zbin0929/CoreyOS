# CoreyOS 全局 TODO

> 版本：v2.0 · 2026-05-02
> 商业模式：**只做定制**（B2B 直签 + 本地部署，不做 SaaS）
> 架构原则：**唯一基座 + 数据驱动定制**（详见 `docs/01-architecture.md` § Pack Architecture）
> 配套文档：`docs/competitor-maiduo-ai.md`、`docs/customization-plan.md`、`docs/licensing.zh.md`
> Bug 历史：`docs/bug-history.md`

---

## 一、产品定位

| 维度 | 决策 |
|------|------|
| 商业模式 | 只做定制（B2B 直签项目制，不做 SaaS / 不做订阅） |
| 部署形态 | 本地部署（含内网无网场景） |
| 客户来源 | 直签合同，按项目收费 |
| 目标客户 | 不用易仓 ERP 的卖家（70%+ 跨境市场）+ 想本地部署的中大型卖家 |
| 差异化 | 本地部署 / 不绑 ERP / 用户可自定义新场景 |
| 主要对标 | 易仓的麦多AI（详见 `docs/competitor-maiduo-ai.md`）|

**核心交付物**：唯一一个 Corey 二进制 + 客户专属的 `customer.yaml` + 预装 Skill Pack + license token。

---

## 二、基座 TODO（v3 清单）

### 第 1 层 — 必做（卡商业化交付）

#### B-1. BGE-M3 知识库 RAG ✅ 已完成
- **版本**：v0.1.11
- **价值**：本地 RAG，所有行业 Pack 共用的知识检索基础
- **参考**：`docs/plans/v0.1.11-bge-m3-rag.md`

#### B-2. customer.yaml 白标机制 ✅ 已完成（v0.2.0）
- **状态**：✅ 已完成（v0.2.0）
- **目标版本**：v0.2.0
- **第一阶段（已完成）**：
  - [x] customer.yaml schema 设计 + 解析器（schema_version=1，前向兼容）
  - [x] runtime 加载 + AppState 集成 + `customer_config_get` IPC
  - [x] 品牌定制（app_name 运行时替换；logo 通过 convertFileSrc 加载；primary_color hex→HSL 注入到 `--gold-500`）
  - [x] 导航定制（hidden_routes 在 sidebar 过滤）
  - [x] 测试：10 cargo + 13 vitest 单元测试
  - 提交：`229ab57` + `17595af`（CI 修复）
- **延后项（随 B-3 一起做）**：
  - [x] `pin_to_primary` 实现（需 Pack 路由先就绪）
  - [x] `packs.preinstall` 实现（需 Pack 加载器先就绪）
  - [x] `packs.config` 预填（需 Pack 配置系统先就绪）
  - [x] 隐藏路由的 URL 级守卫（rootRoute beforeLoad redirect）
  - [x] Settings → Help 面板显示 customer.yaml 的 parse error（已有 CustomerSection）
- **价值**：定制交付的核心载体——同一个二进制，靠 yaml 让客户看到不同产品
- **依赖**：无

#### B-3. Pack 加载器 + 12 视图模板
- **状态**：✅ 已完成（v0.2.0-dev）
- **目标版本**：v0.2.0
- **分阶段交付**：
  - [x] **Stage 1**：manifest.yaml schema_version=1 解析器（`7963f93`）
  - [x] **Stage 2**：Pack 扫描器 + enable-state 持久化（`ea49667`）
    - `scan_skill_packs_dir()`、`Registry::scan()`、`pack-state.json`
    - IPC：`pack_list` / `pack_set_enabled`
    - 副作用层为空：开关只持久化，不启 MCP / 不挂路由
  - [x] **Stage 3a**：模板变量解析器（`3bf14d6`）
    - `${platform}` / `${pack_data_dir}` / `${pack_config.X}`
    - 未知变量保留原样、不递归扩展
  - [x] **Stage 3b**：Pack MCP → Hermes config 翻译器（`9855db3`）
    - 键命名规范 `pack__<pack_id>__<server_id>`（基于前缀识别 Pack 拥有的条目）
    - argv `["./bin", "arg"]` → Hermes `{ command, args }` 翻译 + env 模板替换
    - `enable_updates` / `disable_updates` 纯函数 + 12 单测
  - [x] **Stage 3c**：Pack 开关 → 写 config.yaml + gateway 重启（`5d7b2bd`）
    - `pack_set_enabled` IPC：先写 config.yaml，再持久化 enable bit
    - 自动 `mkdir -p ~/.hermes/pack-data/<id>/` 首次启用
    - 启用无 manifest 的 broken pack 直接拒绝
    - 仅在 config 实际变化时异步触发 gateway restart
    - Hermes 0.10 没 `/reload-mcp`，gateway restart 是唯一重载路径
  - [x] **Stage 4**：Skill 注册管道（按 pack_id 子目录）— Pack `manifest.skills` 拷到 `~/.hermes/skills/pack__<id>/`，启用时 install + 禁用时 rm -rf
  - [x] **Stage 4b**：Workflow + Schedule 注册管道（按 pack_id 前缀）— Pack 启用时拷贝 workflows 到 `~/.hermes/workflows/pack__<id>__*.yaml` + 写 schedules 进 `jobs.json`，禁用时整批清理
  - [x] **Stage 5a**：视图渲染管道 + 第一个模板（`1e2136a`）— `pack_views_list` IPC + `/pack/$packId/$viewId` 动态路由 + 模板注册表 + MetricsCard
  - [x] **Stage 5b**：DataTable + AlertList 模板（`c25f336`）
  - [x] **Stage 5c**：TimeSeriesChart + TrendsMatrix + PivotTable 模板（`e057d57`）
  - [x] **Stage 5d**：剩余 6 个模板（Timeline / RadarChart / CompositeDashboard / WorkflowLauncher / SkillPalette / FormRunner）— **12 个模板全部 layout 完成，等 stage 5e 接数据**
  - [x] **Stage 5e**：数据 wiring（`pack_view_data` IPC + `usePackViewData` hook）— 9 个数据驱动模板已接通：
    - **5e1**：MetricsCard + DataTable（`c33d59b`）— 引入 IPC + hook + 第一对模板
    - **5e2**：AlertList + Timeline + RadarChart（`24e5651`）
    - **5e3**：TimeSeriesChart + TrendsMatrix + PivotTable（本提交）— TrendsMatrix 含 Sparkline + 同比着色
    - 当前仅支持 `data_source: { static: ... }`；`mcp:` / `http:` / `sql:` kinds 推到 stage 5f
  - [x] **Stage 5f**：MCP / HTTP 数据源 kinds（`resolve_http_source` + `resolve_mcp_source`）
  - [x] ActionPanel 嵌入（视图旁的"决策归还"按钮，绑 actions[].workflow / actions[].skill）
  - [x] 数据目录设计：`skill-packs/<id>/` 只读 + `pack-data/<id>/` 永不被覆盖（架构文档已锁定，代码已执行）
  - [x] Pack 升级前自动备份（zip 到 `~/.hermes/backups/`，保留 7 天）
  - [x] manifest migrations 机制（跨版本字段迁移）
  - [x] Pack 配置 UI（动态表单）+ 导入 zip 按钮 + 卸载 UI
- **价值**：所有行业 Pack 的运行时基础
- **依赖**：无（可与 B-2 并行）
- **架构**：详见 `docs/01-architecture.md` § Pack Architecture

#### B-4. License Features 联动 Pack 加载
- **状态**：✅ 已完成（v0.2.0-dev）
- **目标版本**：v0.2.0
- **内容**：
  - [x] `mint-license.sh` 已有的 `--features` 字段在 license 验证时启用
  - [x] Pack 加载器读 `manifest.license_feature`，校验客户 license 包含此 feature
  - [x] 缺 feature 时 UI 显示"需要授权"占位（不加载 MCP / 不挂路由）
  - [x] 续费 / 加 Pack 流程文档化（`docs/licensing.zh.md` § Pack 授权限联动）
- **价值**：Pack 防盗版（客户 A 拷给 B 用不了）+ 按 Pack 收费
- **依赖**：B-3
- **不做**：在线激活 / JWT / 心跳 / 客户后台（已有 ed25519 离线方案够用）

#### B-5. BGE-M3 离线 zip 包导入
- **状态**：🟡 代码完成，CI 打包脚本待做
- **目标版本**：v0.2.0
- **内容**：
  - [ ] 交付一份 `bge-m3-offline.zip`（约 2.3GB，CI 自动打包）— 需独立打包脚本
  - [x] Knowledge / 设置页加"导入离线模型包"按钮
  - [x] 解压到 `~/.hermes/models/bge-m3/` + 大小校验 + 校验通过后启用 RAG
- **价值**：内网无网客户可直接拿到模型，不依赖联网下载
- **依赖**：无（B-1 基础上的扩展）
- **工时**：约 1-2 天

### 第 2 层 — 应做（影响交付质量）

#### B-6. 用量 / 费用分析仪表盘
- **状态**：🟢 Sprint 1-4 全部完成
- **目标版本**：v0.2.0
- **内容**：见 `docs/plans/v0.2.0-b4-analytics.md`
  - [x] Token 消耗统计（按 Agent / 模型 / 天）
  - [x] 费用估算（按模型价格表 MODEL_PRICES + CNY 汇率）
  - [x] 30 天趋势图 + 时间筛选器（7d/30d/90d/All）
  - [x] 延迟追踪（DB v14 + P50/P95/P99 + 按模型延迟）
  - [x] 错误率统计（ErrorStats + Top Errors + >5% 红色警告）
  - [x] CSV 导出（Blob download，含 Summary/Daily/Cost/Errors）
  - [x] 预算使用进度（关联 Budgets + 进度条 + 超额警告）
  - [x] 健康雷达图（六维：延迟/成本效率/可靠性/工具使用/反馈/活跃度）
- **价值**：客户付费后必问"花了多少钱"
- **依赖**：B-3（用 MetricsCard + TimeSeriesChart 模板渲染）

#### B-7. 卸载 / 重置功能（FEAT-001）
- **状态**：� 已完成
- **目标版本**：v0.2.0
- **内容**：
  - [x] 设置页"清除 Hermes 数据"按钮
  - [x] 设置页"重置 Corey 配置"按钮（保留 license 与 Pack）
  - [x] Rust IPC: hermes_data_reset + corey_config_reset
  - [x] 完整卸载手册（Windows + macOS）
- **价值**：出问题时的逃生通道，客户支持成本下降

#### B-8. Talk Mode 语音持续对话
- **状态**：📋 计划中
- **目标版本**：v0.4.0+
- **参考**：OpenClaw Talk Mode（https://docs.openclaw.ai/nodes/talk）
- **核心循环**：Listen（STT）→ Send（LLM）→ Wait → Speak（TTS）→ 循环
- **技术选型（零费用方案）**：
  - STT: macOS `SFSpeechRecognizer` / Windows `System.Speech` / 系统原生（免费）
  - TTS: 系统原生兜底 + MLX 本地（Apple Silicon，免费）+ ElevenLabs 可选（客户自费）
  - 静音检测窗口: 700ms（停顿超过此时间自动发送）
  - 音频流格式: macOS `pcm_44100`, Windows `pcm_24000`
- **关键特性**：
  - [ ] **interruptOnSpeech**: 用户说话时打断 AI 播放，记录中断时间戳注入下一条 prompt
  - [ ] **Voice Directives**: LLM 回复首行可带 JSON 指令切换声音/语速
  - [ ] **三态 UI 覆盖层**: Listening（脉冲）→ Thinking（下沉动画）→ Speaking（辐射环）
  - [ ] **MLX 本地 TTS**: `mlx-community/Soprano-80M-bf16`，Apple Silicon 离线场景
- **需要补的组件**：
  - [ ] STT 静音检测 + 持续监听循环（现有 voice 模块基础上扩展）
  - [ ] TTS 流式 PCM 播放 + 中断机制（现有 ProviderCard 基础上扩展）
  - [ ] 停止播放 + 时间戳注入
  - [ ] 三态 UI 覆盖层
  - [ ] MLX 本地 TTS helper（可选）
- **预估工期**：2-3 周
- **价值**：运营人员语音操作比打字快，"帮我查昨天广告花费"一句话搞定
- **依赖**：无（voice 模块已有基础）
- **跨平台**：macOS + Windows 必须同时支持

### 第 3 层 — 已砍（与"只做定制"冲突，永久不做）

| 已砍项 | 原因 |
|--------|------|
| ❌ Skill Pack 商店 UI / 推荐列表 / 分类搜索 | 你不让客户自己挑 Pack |
| ❌ 在线激活 / JWT / 心跳 / 联网校验 | license 离线签名已够用 |
| ❌ 客户管理后台 | 直签客户用 Notion / 表格记账即可 |
| ❌ 通用拖拽式可视化引擎 | 12 视图模板 + manifest 声明替代 |
| ❌ 远程更新服务后端 | 手动交付 / GitHub Releases / COS |
| ❌ 单独的 Persona 角色管理系统 | 并入 Pack `soul_inject` 段 |
| ❌ Pack UI 写 React 代码 | 违反"唯一基座"原则 |

---

## 三、扩展 Pack TODO

### P-1. 跨境电商助手（首发，对标麦多AI 9 能力）

- **状态**：� 骨架完成，数据层待接
- **目标版本**：v0.3.0
- **交付方式**：**一次性全做完**（不分 P-1.1 / P-1.2，第一版上线即完整）
- **前置**：B-2 + B-3 + B-4（基座 v0.2.0 ✅ 已就绪）
- **前置外部**：申请 Amazon SP-API 开发者账号（审核 1-2 周，建议 v0.2.0 启动时同步申请）
- **9 能力清单**（对标 `docs/competitor-maiduo-ai.md`）：

| # | 能力 | CoreyOS 实现 | 用到的视图 | 状态 |
|---|------|------------|-----------|------|
| 1 | 战场地图 | CompositeDashboard 多视图组合 | CompositeDashboard + MetricsCard + DataTable + AlertList + RadarChart | ✅ UI 完成 |
| 2 | AI 智能体（总管） | Hermes 多 Agent 编排（已具备） | 对话 + ActionPanel | ✅ 已具备 |
| 3 | 广告守卫机器人 | Workflow + Browser MCP + Skill | DataTable + AlertList | 🟡 Skill ✅ Workflow ✅ MCP 骨架 ✅ 数据提取待写 |
| 4 | 库存哨兵机器人 | Scheduler + MCP | DataTable + AlertList | 🟡 Skill ✅ Workflow ✅ MCP 骨架 ✅ 数据提取待写 |
| 5 | 差评监控机器人 | Workflow + MCP | AlertList | 🟡 Skill ✅ Workflow ✅ MCP 骨架 ✅ 数据提取待写 |
| 6 | 数据分析机器人 | Skill + RAG（销量历史） | 对话 + ActionPanel | ✅ Skill ✅ |
| 7 | 市场分析机器人 | Skill + 报告生成 | 对话 + ActionPanel | ✅ Skill ✅ |
| 8 | 战场雷达机器人 | Workflow + Browser Automation 抓竞品 | Timeline | 🟡 Skill ✅ 数据源待接 |
| 9 | 六维诊断机器人 | Skill + 多维评分 | RadarChart | ✅ Skill ✅ 视图 ✅ |

- **已完成项**：
  - [x] manifest.yaml + 6 个 view 配置（dashboard/kpi/orders/alerts/radar + ad_monitor/inventory/reviews/diagnostic）
  - [x] 7 个 Skill（analyst/ad_guard/inventory_sentinel/review_monitor/market_analyst/radar_bot/diagnostic_six）
  - [x] 3 个 Workflow（ad_daily_check/inventory_alert/review_alert）— 格式已修复
  - [x] 3 个 Schedule（daily-ad-check/inventory-check/review-check）
  - [x] 行业 Persona（prompts/soul.md）
  - [x] Browser Automation MCP Server 骨架（6 tools：login_status/get_kpi_metrics/get_ad_campaigns/get_fba_inventory/get_recent_reviews/get_orders）
  - [x] 侧边栏 Pack 分组折叠
  - [x] CompositeDashboard 子模板渲染 + 运营摘要条 + 风险等级条 + 建议动作按钮
  - [x] 模板视觉美化 v1（中文标签/状态色胶囊/告警排序/雷达进度条/KPI 业务语义着色）
  - [x] 模板视觉美化 v2（MetricsCard icon+趋势+sparkline / DataTable 可排序+hover+空状态 / AlertList severity icon+折叠+汇总 / RadarChart 轴标签+色条+顶点 / CompositeDashboard 分区布局+卡片阴影）
  - [x] CompositeDashboard 支持 `ref` 引用（子视图不再内联重复数据，manifest 去重）
  - [x] manifest.yaml 清理：移除不存在的 DocViewer 模板引用
  - [x] `resolve_mcp_source` 支持 stdio MCP server（spawn 进程 + JSON-RPC initialize + tools/call + 超时保护 + Windows CREATE_NO_WINDOW）
  - [x] MCP Server 新增 `login_interactive` tool（headless=False 可见浏览器 + cookie 持久化 + 超时控制）
  - [x] CompositeDashboard 日期筛选器骨架（7d/14d/30d/90d 切换按钮）

- **剩余未做（按优先级分层）**：

  #### P0 — 不做就无法交付（数据维度 + 交互基础）

  - [x] 费用拆解看板：PivotTable + 可折叠分组 + 同比色标 + 中文列名 — 已完成（13 行示例数据）
  - [x] ASIN 级利润下钻：DataTable expandable rows（children 展开/收起 + 缩进子行 + chevron 图标）— 已完成
  - [x] 日期筛选器 dateRange → MCP params 全链路：usePackViewData 接收 params → IPC 传 runtime_params → resolve_mcp_source 合并到 tool arguments — 已完成
  - [x] KPI 同比计算：MCP server 返回 `_delta` 字段 → MetricsCard TrendBadge 自动渲染绿红箭头 — 已完成
  - [x] DateRange Context：CompositeDashboard 选择日期范围 → 子视图自动注入 date_range 参数到 MCP 调用 — 已完成
  - [x] 流量结构视图：MetricsCard（sessions / page_views / organic_traffic_pct / paid_traffic_pct）— 已完成
  - [x] 转化漏斗视图：DataTable + 自动标红（high_ctr_low_cvr/low_cvr/drop 状态色标）+ 5 步漏斗示例数据 — 已完成
  - [x] MCP Server 数据提取函数：返回模板兼容的结构化 mock 数据（KPI+广告+库存+评价+订单）— 已完成，真实 CSS 选择器待登录后补充
  - [x] 浏览器登录流程：`login_interactive` MCP tool（headless=False 弹可见窗口 → 用户手动登录 → cookie 持久化）— 已完成
  - [x] Dashboard KPI 视图切到 `data_source: mcp`（server + tool + ${config.marketplace} 模板变量解析）— 已完成
  - [x] 其余视图从 static 切 mcp：ad_monitor/inventory/reviews/orders 全部切到 MCP data_source — 已完成
  - [x] `resolve_mcp_source` stdio 支持：spawn subprocess + JSON-RPC initialize/tools_call + 超时 + Windows 兼容 — 已完成
  - [x] Browser MCP 打包方案已决策：Phase 1 = Python venv + setup.sh（当前）; Phase 2 = PyInstaller per-platform binary（发布前）— setup.sh 已创建

  #### P1 — 不做会显得粗糙（自动化深度 + 关键监控）

  - [ ] 广告规则引擎：Target ACOS 自动调 bid / 预算再分配（低 ACOS campaign 加预算）/ 自动否词（20 次点击无转化自动加否）
  - [ ] 分时投放 Dayparting：按小时级 metrics 展示，高转化时段加 bid / 低转化时段降 bid
  - [ ] 库存补货建议卡片：安全库存量 + 建议补货量 + 供应商交期，MetricsCard 或新模板
  - [ ] 断货自动停广告：库存不足时自动降广告预算 / 暂停 campaign（SellerApp 标配）
  - [ ] 在途跟踪：Inbound shipment 物流状态 + 预计到仓时间（Jungle Scout 标配）
  - [ ] 关键词排名追踪：核心词自然排名位置 / 收录词数量 / 排名变动趋势，新增视图或 Timeline
  - [ ] Buy Box 份额监控：购物车赢得率 + 跟卖告警（Keepa/SellerApp 标配）
  - [ ] 退货率 + NCX Rate：退货率趋势 / 退货原因分析 / NCX Rate 预警（Amazon Voice of Customer）
  - [ ] 账户健康监控：ODR（订单缺陷率）/ IPI（库存绩效指标）/ IP 投诉率，超阈值自动告警
  - [ ] `mcp-amazon-sp` SP-API MCP Server（接口对齐 amazon-browser，未来无缝切换）

  #### P2 — 锦上添花但竞品都有（工作流 + 通道 + 导出）

  - [ ] 新品推广期 Workflow：关键词排名追踪 → 自动调 bid → 自然占比达标后降预算
  - [ ] Listing 优化 Workflow：收录检测 → 文案重写建议 → 重新提交
  - [ ] FBA 索赔 Workflow：自动检测丢失/损坏 → 生成索赔 → 跟进进度（Carbon6/Sellerise 标配）
  - [ ] 竞品防御 Workflow：Buy Box 丢失 → 价格调整建议 → 跟卖投诉
  - [ ] 促销节奏 Workflow：秒杀报名 → 库存预留 → 广告配合
  - [ ] IM 推送集成：告警推到微信/钉钉/QQ（必盈/数跨境标配）
  - [ ] 数据导出：DataTable 加 CSV/Excel 导出按钮
  - [ ] 多店铺切换：顶部店铺选择器，跨店铺数据聚合
  - [ ] 出厂数据：关键词词典 / 品类映射 / 合规术语
  - [ ] 恢复 `license_feature: cross_border_ecom`（给客户签 license）
  - [ ] 真实卖家账号端到端实测

  #### P3 — UI 美化与交互打磨

  - [x] DataTable 列排序（点击表头排序 asc/desc/无）— 已完成
  - [ ] DataTable 列筛选（顶部筛选栏 / 搜索框）
  - [ ] KPI 卡片下钻交互（点击 KPI → 展开 ASIN 明细表）
  - [ ] 自定义看板布局（拖拉拽组合图表，数跨境标配）
  - [ ] 移动端适配 / 微信小程序（必盈标配）
  - [ ] 广告表格加 Campaign → Ad Group → Keyword → Search Term 四级下钻
  - [ ] 库存表格加多仓库视图（FBA vs 自发货 vs 海外仓）
  - [ ] 评价视图加星级分布饼图 + 趋势折线
  - [ ] 利润视图加 FIFO COGS 计算模式切换
  - [ ] 异常检测智能提示：CPC 飙升/转化骤降 → 自动推原因 + 修复建议（Perpetua 标配）
  - [ ] AI CFO 报告：AI 自动分析利润数据并给优化建议（Jungle Scout 已上线）
  - [ ] 多渠道归因视图：Amazon + Walmart + Shopify 跨平台利润对比
  - [ ] 发票管理：供应商发票上传 + FBA 索赔按实际成本赔（2025 新规）
- **差异化打法**：
  1. **本地部署**：客户数据不出公司
  2. **不绑 ERP**：客户用任意 ERP / Excel，通过 MCP 接入
  3. **用户可自定义**：开放 Skill / Workflow 编辑

### P-2 ~ P-8. 其他行业 Pack（按客户需求拉，不主动做）

| Pack | 触发条件 |
|------|---------|
| P-2 财务 | 真实客户合同 |
| P-3 尾程物流 | 真实客户合同 |
| P-4 头程物流 | 真实客户合同 |
| P-5 海外仓 | 真实客户合同 |
| P-6 卡派 | 真实客户合同 |
| P-7 客服 | 真实客户合同 |
| P-8 报价 | 真实客户合同 |

> ⚠️ **不主动开发**。等到有真实付费客户签合同时再启动对应 Pack。每个 Pack 的设计沿用跨境电商助手 模板（manifest + 视图 + Skill + Workflow + MCP）。

---

## 四、执行路线图

```
v0.1.13（约 3-5 天）— Windows 端到端实测 + 收尾   ← 强烈建议先做
└── 用户在真实 Windows 环境验证 BUG-007~010 已解决

v0.2.0（约 4-5 周）— 基座定制能力（"卖货前的最后一公里"）
├── B-2  customer.yaml 白标机制
├── B-3  Pack 加载器 + 12 视图模板（大头）
├── B-4  License Features 联动
├── B-5  BGE-M3 离线 zip 包导入
├── B-6  用量分析仪表盘
└── B-7  卸载 / 重置
[同步] 申请 Amazon SP-API 开发者账号

v0.3.0（约 3-4 周）— 跨境电商助手 完整版
├── P-1  跨境电商助手（9 能力一次性全做）
└── 第一个真实客户上线

v0.4.0+ — 按客户需求拉新 Pack + Talk Mode
├── 真实客户合同 → 启动对应 Pack（不主动）
└── B-8  Talk Mode 语音持续对话
```

---

## 五、依赖关系图

```
B-1 (RAG ✅) ───────────────────┐
                                ├─► P-1 (跨境电商助手)
B-2 (白标 customer.yaml) ──────┤      │
B-3 (Pack 加载器+12 视图模板) ─┤      │
B-4 (License Features 联动) ───┤      └─► 第一个真实客户
B-5 (BGE-M3 离线包) ───────────┤
                                │
B-6 (用量分析) ─────────────────┘ （依赖 B-3 视图模板）
B-7 (卸载/重置)  独立
B-8 (Talk Mode)  独立（v0.4.0+，voice 模块已有基础）

[外部前置] Amazon SP-API 开发者账号（v0.2.0 启动同步申请）
```

---

## 六、当前版本状态

| 版本 | 状态 | 主要内容 |
|------|------|---------|
| v0.1.8 | ✅ | 网关会话自动导入 + Windows 修复 + COS CDN |
| v0.1.9 | ✅ | Windows env var 修复 + COS upload 工作流 |
| v0.1.10 | ✅ | bootstrap COREY_INSTALL_DIR 传递修复 |
| v0.1.11 | ✅ | BGE-M3 RAG + 统一下载中心 + updater 修复 + NSIS |
| v0.1.12 | ✅ | 15 项 Bug 修复（详见 `docs/bug-history.md`）|
| v0.1.13 | ✅ | Skills 树修复 + macOS 图标修复 + E2E 修复 + 文档同步 |
| v0.1.14 | ✅ | Windows CMD 弹窗修复 + 图标灰边二次修复 |
| v0.1.15 | ✅ | Windows 实测通过 + suppress_window 全覆盖 + 图标边缘纯黑 |
| v0.2.0 | ✅ | 白标 + Pack 加载器 + 12 视图模板 + license features + preinstall + pin_to_primary + BGE-M3 离线导入 |
| v0.2.1 | ✅ | MCP 数据流 + dashboard 视图 + stdio 修复 |
| v0.2.2 | ✅ | CI 修复（Windows clippy + embedding stamp test）|
| v0.2.3 | ✅ | UI overhaul — gradient + glow + animation + light theme parity |
| v0.3.0 | 🔧 | 跨境电商助手 骨架完成 + 数据层待接 + 第一个真实客户 |
| v0.4.0 | 📋 | Talk Mode 语音持续对话 + 按客户需求拉新 Pack |

---

## 七、Pack 视图模板速查表（基座 v0.2.0 必交付）

| # | 模板 | 主要应用场景 |
|---|------|-------------|
| 1 | DataTable | 通用表格、广告/订单/库存明细 |
| 2 | MetricsCard | KPI 卡片、利润总览 |
| 3 | TimeSeriesChart | 销量/成本趋势 |
| 4 | PivotTable | 损益表、库存层级 |
| 5 | TrendsMatrix | 产品 × 时间矩阵（Sellerboard 同款） |
| 6 | Timeline | 货物追踪、竞品雷达 |
| 7 | AlertList | 预警条目（红黄绿） |
| 8 | WorkflowLauncher | 一键周报 / 一键巡检 |
| 9 | SkillPalette | Skill 入口按钮组 |
| 10 | FormRunner | 表单 → MCP → 结果 |
| 11 | RadarChart | 六维诊断、健康度 |
| 12 | CompositeDashboard | 战场地图（栅格容器） |

每个视图均支持 `actions:` 段（嵌入 Skill / Workflow 触发按钮，"决策归还"模式）。

---

## 七点五、提交前必跑的本地检查（CI 第一关）

CI 在 Rust 任何 push 上跑这两个 gate；**本地不通过就别 push**，否则一定红灯：

```bash
# 1. rustfmt 必须一致（CI step 33 会 fail）
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

# 2. clippy::unwrap_used 不允许回归（baseline=548，见 scripts/clippy-unwrap-baseline.txt）
node scripts/check-clippy-unwrap.mjs
# 如果 baseline 因为新代码上升了，需要写 expect("...") 替代 unwrap()
# 如果 baseline 因为重构下降了，跑 `pnpm check:clippy-unwrap -- --update` 锁定改善
```

**前端等价：**
```bash
pnpm tsc --noEmit       # 0 错误
pnpm lint               # 0 警告
pnpm vitest run         # 全绿
```

历史教训（2026-04-30）：连续两个 commit（license 修复、customer.yaml）都因为没本地跑这两个 gate 而 CI 红灯。`cargo test` 通过 ≠ CI 通过。

---

## 八、关键决策记录（不再讨论的事）

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-30 | 只做定制，不做 SaaS | 用户基数大了不好管控 |
| 2026-04-30 | 唯一基座二进制 + 数据驱动定制 | 避免维护多版本地狱 |
| 2026-04-30 | Pack 不写 React 代码 | 违反唯一基座原则 |
| 2026-04-30 | 视图模板 12 个（Tier 1） | 行业研究 + 麦多AI 对标补 RadarChart + CompositeDashboard |
| 2026-04-30 | License 用现有 ed25519 离线方案 | 内网客户必备 |
| 2026-04-30 | Pack MCP 自带预编译二进制（方案 B） | 客户机器零依赖 |
| 2026-04-30 | `pack-data/<id>/` 永不被覆盖 | 用户资产神圣 |
| 2026-04-30 | 跨境电商助手 一次性全做 9 能力 | 第一版上线即完整 |
| 2026-04-30 | Persona 系统并入 Pack `soul_inject` | 不做单独系统 |
| 2026-04-30 | 不做商店 / 后台 / 远程心跳 | 与定制模式冲突 |

---

## 九、当前 Bug 跟踪

> 历史 Bug 修复见 `docs/bug-history.md`。

### v0.1.13-dev 已修复（2026-05-01）

- **QQ Bot "灵魂不在线"**：Corey 侧 `patch_qqbot_sandbox()` 在 gateway 启动时按 `QQ_SANDBOX` 环境变量自动切换沙箱/正式 API，不改 Hermes 源码
- **平台通道用量为零**：`gateway_source` 未持久化到 DB，导致 app 重启后 session 丢失、消息无法累积。DB migration v13 修复
- **Token 用量缺失**：Hermes state.db 不记录 token_count，Corey 侧增加估算回退
- **Updater 不提示新版本**：CI workflow 只上传构建产物但未同步 `latest.json` 到 COS，已修复
- **分析面板不自动刷新**：加 30s 定时轮询
- **通道卡片无在线标识**：在线通道左上角绿色对勾 + 绿色边框
- **BGE-M3 模型误判未安装**：`model_exists()` 用文件大小阈值检测，`model.onnx` 实际 724KB 低于 1MB 阈值导致误判。改用 `.verified` 戳文件机制：下载成功写戳、ONNX 加载失败删戳、无戳时回退文件存在性检查
- **首页缺少底部状态栏**：新增全局 `StatusBar` 组件，左=会话标题+消息数/页面名，中=技能数+MCP数+定时任务数，右=Corey 版本
- **首页右侧栏太空**：加回「系统概览」卡片（Gateway/Hermes/MCP/Cron 四行状态）
- **E2E smoke 测试失败**：首页标题从 "Welcome to Corey" 改为 "CoreyOS"，`HermesInstallCard` 移除 `!hermes.installed` 门控条件

### v0.1.13-dev Bug fix batch 2（2026-05-01）

- **#1 设默认模型后顶部/会话模型未刷新**：`LlmProfilesSection.setAsDefault` 写了 Hermes config 但未更新 `useAppStatusStore.currentModel`，加 `setCurrentModel()` 调用
- **#4 语义模型点安装后立刻显示已安装**：加最小文件大小校验 + ONNX session 加载验证（`validate_model_load`），验证通过才写 `.verified` 戳
- **#5 首页"配置MCP"跳转到设置页**：路由从 `/settings` 改为 `/mcp`
- **#6 日志页路径不对（Windows）**：`log_path()` 从 `$HOME` 改为 `hermes_data_dir()`
- **#7 简单问候消耗 11K token**：移除 `enrichHistoryWithContext` 中重复的 `memoryRead('user')` 注入（Hermes Layer 6 已注入 USER.md）
- **#9 Win重开卡死（lock file PermissionError）**：清理 lock 文件失败时先杀残留 gateway 进程再重试
- **设置页移除网关表单**：Base URL / API Key / 默认模型表单移除，改由 Models 页管理
- **Skills 树显示 402 项**：`walk()` 列出所有 `.md`（含 references/templates/DESCRIPTION.md），改为只索引 `SKILL.md`（92 项），`name` 取父目录名，`group` 取祖父目录名
- **macOS 生产包 Dock 图标灰框**：替换 `icon.icns` 消除灰边

### E2E 已知问题

- **budget-gate × 3 test.skip**：`chat-budget-warning` 在 CI headless 不可见，预存问题待查

### 已知低优先问题

- **#8 Windows 中文乱码**：部分 Windows 机器终端输出编码问题，低优先
- **Token 固定开销 ~11K**：Hermes 架构固有（31 工具定义 ~8.7K + Skills Index ~3K + 系统提示词 ~3-8K），建议选支持 prompt caching 的模型（DeepSeek cache hit 90% 折扣）

### 当前已知功能缺失

- FEAT-001：卸载 / 重置功能 → 已纳入 B-7（v0.2.0）

---

## 附：参考文档清单

| 文档 | 用途 |
|------|------|
| `docs/01-architecture.md` § Pack Architecture | 架构铁律 + 目录布局 + manifest schema |
| `docs/competitor-maiduo-ai.md` | 麦多AI 详细调研，对标参考 |
| `docs/customization-plan.md` | 白标交付的完整产品规划 |
| `docs/licensing.zh.md` | License 系统使用手册 |
| `docs/hermes-dependency-map.md` | 上下游分工：Hermes vs Corey 各做什么 |
| `docs/bug-history.md` | 已修复 Bug 历史档案 |
| `docs/plans/v0.2.0-b4-analytics.md` | 用量分析仪表盘详细计划 |
