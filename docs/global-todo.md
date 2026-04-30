# CoreyOS 全局 TODO

> 版本：v1.0 · 2026-04-29
> 说明：所有待办事项，区分基座（Core 必做）和扩展（行业 Pack 按需做）
> 完整的产品规划见 `docs/customization-plan.md`

---

## 一、基座 vs 扩展

**基座（Core）**：所有行业客户都需要的通用能力。同一个二进制，所有部署自带。

**扩展（Pack）**：按行业/客户按需安装的能力。通过 Skill Pack 机制交付：
- 行业 Prompt + Skill 文件
- 行业专属 MCP Server
- 行业工作流
- 可选 UI 扩展（侧边栏入口、设置面板、数据看板）

**Pack 导入机制**：
- 扩展通过导入形式集成（商店一键安装 / customer.yaml 预装 / 本地文件导入）
- 导入后自动完成：安装 Skills → 注册 MCP → 注入 Prompt → 创建工作流 → 渲染 UI 入口
- 基座升级 / Hermes 升级不影响已安装的 Pack（Pack 存储在 `~/.hermes/skill-packs/`，与基座二进制隔离）
- Pack 升级独立于基座（每个 Pack 有自己的版本号）

**Pack 防盗版机制**：
- 客户 A 安装了跨境电商 Pack，不能把文件拷给客户 B 使用
- 机器绑定：Pack 安装时绑定当前机器指纹（主板序列号 + 磁盘序列号 + MAC 地址的哈希），写入加密的 `.state/pack-license.bin`
- 在线激活：首次安装时向 update.coreyos.com 发送 license_key + machine_id → 服务端返回签名的授权令牌（JWT，含 pack_id + machine_id + 过期时间）
- 离线校验：基座每次启动时校验本地授权令牌（签名验证 + 机器指纹匹配 + 过期检查），不通过则 Pack 功能不可用
- MCP Server 网关校验：自研 MCP Server（mcp-amazon-sp 等）启动时验证授权令牌，未授权拒绝启动
- 文件加密：Pack 内核心文件（prompts/、skills/）可选加密存储，运行时由基座解密注入，直接拷贝文件无法使用
- 定期心跳：每 7 天联网校验一次授权状态（离线超过 30 天则暂停功能，联网后自动恢复）
- 卸载清除：Pack 卸载时删除所有文件 + 授权令牌，客户 A 无法通过拷贝 `.hermes/` 目录转移给客户 B

```
┌─────────────────────────────────────────────┐
│              Corey 基座（统一二进制）           │
│  Chat · Agents · MCP · Workflow · Scheduler  │
│  Channels · Skills · Memory · Knowledge      │
│  BGE-M3 RAG · Skill Pack 商店 · 数据可视化    │
├─────────────────────────────────────────────┤
│  扩展层（Skill Pack，按行业按需安装）            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ 跨境电商  │ │ 尾程物流  │ │  财务    │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ 海外仓   │ │  头程    │ │  客服    │     │
│  └──────────┘ └──────────┘ └──────────┘     │
└─────────────────────────────────────────────┘
```

---

## 二、基座 TODO（按优先级排序）

### B-1. BGE-M3 知识库 RAG
- **状态**：✅ 已完成（v0.1.11）
- **目标版本**：v0.1.11
- **前置**：无
- **内容**：
  - [x] 统一下载中心 UI（下载进度、暂停/重试、错误展示）
  - [x] BGE-M3 ONNX 模型下载（百度 PaddleNLP CDN，~2.1GB）
  - [x] `ort` crate 本地 embedding 推理（1024 维，`rag` feature gate）
  - [x] SQLite 向量存储 + cosine similarity
  - [x] 混合检索（向量 + 关键词 RRF 融合，k=60）
  - [x] Knowledge 页面"语义增强"状态卡片 + 一键下载
  - [x] `rag_status` / `rag_download_model` IPC 命令
  - [x] Windows NSIS 安装模式配置（installMode=both）
  - [x] 应用更新修复（下载完手动重启，不再闪退）
- **价值**：本地 RAG，数据不出机器。所有行业客户都需要（跨境电商查政策、财务查法规、物流查关税）
- **参考**：`docs/plans/v0.1.9-bge-m3-rag.md`

### B-2. Skill Pack 商店
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **前置**：无
- **内容**：
  - [ ] Skill Pack manifest.yaml 规范定义
  - [ ] Rust 端 Pack 安装/卸载/列表/更新 IPC
  - [ ] 前端商店页面（推荐 Pack 列表、分类、搜索）
  - [ ] Pack 详情页（功能介绍、包含 Skills/工作流/MCP 列表）
  - [ ] 一键安装（下载 → 解压 → 注册 MCP → 重启网关）
  - [ ] Pack 更新检查 + 增量更新
  - [ ] Pack UI 扩展引擎
    - 声明式 UI 渲染器（manifest.yaml → 侧边栏入口 + 设置面板 + 数据看板）
    - Dashboard 渲染器（schemas/ + MCP 数据源 → 自动生成图表页面）
    - Form 渲染器（ui.settings.fields → 自动生成配置表单）
    - 自定义 UI 组件支持（Pack 内 ui/ 目录 → 动态路由注册）
  - [ ] Pack 隔离机制
    - Pack 文件存储在 `~/.hermes/skill-packs/<id>/`，与基座二进制隔离
    - 基座 / Hermes 升级不触碰 skill-packs 目录
    - Pack 卸载时清理所有痕迹（Skills、MCP 注册、UI 入口、工作流）
  - [ ] Pack 授权机制
    - 机器指纹采集（主板序列号 + 磁盘序列号 + MAC → SHA256）
    - License 在线激活（license_key + machine_id → JWT 授权令牌）
    - 启动时离线校验（签名验证 + 指纹匹配 + 过期检查）
    - 定期心跳（7 天联网校验，30 天离线宽限期）
    - Pack 核心文件可选加密（prompts/skills 运行时解密）
- **价值**：行业扩展的交付载体。没有商店，每个客户要手动配置。这是商业化的基础设施
- **参考**：`docs/customization-plan.md` § 4.1-4.2

### B-3. 数据可视化引擎
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **前置**：无
- **内容**：
  - [ ] 通用图表组件库（折线图、柱状图、饼图、表格、指标卡）
  - [ ] 图表数据源抽象层（支持 IPC 返回的任意 JSON 数据）
  - [ ] Dashboard 页面框架（可拖拽布局、多卡片、时间范围选择器）
  - [ ] 数据刷新机制（手动 / 定时 / 事件触发）
- **价值**：所有行业都需要数据展示。跨境电商看广告/库存报表、财务看应收应付、物流看轨迹异常率。这是扩展 Pack UI 层的基础

### B-4. 用量分析仪表盘
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **前置**：B-3
- **内容**：
  - [ ] Token 消耗统计（按 Agent / 模型 / 天分组）
  - [ ] 费用估算（按模型价格表计算）
  - [ ] 30 天趋势图
  - [ ] 预算使用进度条（关联 Budgets 模块）
- **价值**：企业管理者控制 AI 成本

### B-5. Persona 角色管理
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **前置**：无
- **内容**：
  - [ ] 预设角色模板（通用助手、代码专家、数据分析师...）
  - [ ] 自定义角色（SOUL.md 编辑器）
  - [ ] Agent 绑定角色（每个 Agent 可设不同 Persona）
  - [ ] 角色与 Skill Pack 联动（安装电商 Pack 自动出现"亚马逊运营专家"角色）
- **价值**：不同角色看同一数据得出不同结论。Skill Pack 通过 Persona 注入行业知识

### B-6. 远程更新服务
- **状态**：🔴 未开始
- **目标版本**：v0.3.0
- **前置**：B-2
- **内容**：
  - [ ] update.coreyos.com 后端（基座版本检查 + Pack 更新检查）
  - [ ] 客户身份验证（license key + 机器指纹）
  - [ ] 管理后台（客户列表、版本状态、按客户推送更新）
  - [ ] COS CDN 同步（已有 sync-cos.yml，需加 Pack 产物同步）
  - [ ] Pack 授权管理后台
    - 客户授权列表（客户 → 已授权 Pack 列表 + 过期时间）
    - 按客户启用/禁用/续期 Pack 授权
    - 机器指纹变更处理（客户换电脑时重新绑定）
    - 授权异常监控（批量激活、异常 IP 等）
- **价值**：持续收费的基础。企业客户需要远程推送 Pack 更新

### B-7. customer.yaml 白标交付
- **状态**：🔴 未开始
- **目标版本**：v0.3.0
- **前置**：B-2
- **内容**：
  - [ ] customer.yaml 解析器（读取 → 应用 → 删除）
  - [ ] 功能隐藏（feature flag 二进制持久化）
  - [ ] 品牌定制（App 名称、Logo、配色运行时替换）
  - [ ] 侧边栏定制（隐藏/显示特定入口）
  - [ ] 预装 Skill Pack（customer.yaml 指定要装的 Pack）
- **价值**：一个二进制 + 一个 YAML = 客户专属产品。商业化关键
- **参考**：`docs/customization-plan.md` § 3

---

## 三、扩展 TODO（按行业 Pack 排序）

### P-1. 跨境电商 Skill Pack（首个落地包）

**前置**：B-1（RAG）+ B-2（商店）+ B-3（图表）
**详细设计**：`docs/customization-plan.md` § 5.1（完整场景设计 + 目录结构 + Skill 文件清单）

#### P-1.1 基础设施
- **状态**：🔴 未开始
- **内容**：
  - [ ] 注册 Amazon SP-API 开发者账号（前置条件，审核 1-2 周）
  - [ ] 自研 `mcp-amazon-sp` MCP Server（Python，~5 天）
    - 广告 API：campaigns / keywords / search terms
    - 库存 API：FBA inventory / inbound shipments
    - 结算 API：settlement reports
    - Listing API：catalog items / listings
  - [ ] 跨境电商 manifest.yaml
  - [ ] 行业 Prompt（system.md + knowledge/ + templates/）
  - [ ] 基础 Skills：listing-optimizer / compliance-checker
  - [ ] UI 扩展（manifest.yaml ui.sidebar）：
    - "Listing 优化"入口（icon: Package）
    - "库存看板"入口（icon: BarChart3）
  - [ ] UI 扩展（manifest.yaml ui.settings）：
    - 平台配置面板（Amazon 站点选择、ERP 地址、Shopify 店铺名）

#### P-1.2 广告守卫机器人
- **状态**：🔴 未开始
- **前置**：P-1.1
- **内容**：
  - [ ] ad-optimizer.md Skill（废词识别 prompt）
  - [ ] 每日巡检工作流（inventory_alert.yaml 改造）
  - [ ] 否词建议 → IM 推送（钉钉/飞书/企业微信）
  - [ ] 运营回复"确认" → 自动执行否词
  - [ ] 广告数据看板（花费 / ACoS / 转化率 趋势图）

#### P-1.3 库存哨兵机器人
- **状态**：🔴 未开始
- **前置**：P-1.1
- **内容**：
  - [ ] inventory-advisor.md Skill（断货/滞销预警 prompt）
  - [ ] 连接客户 ERP（DBHub MCP，零代码）
  - [ ] 库存水位监控工作流（每日检查）
  - [ ] 补货建议 → IM 推送
  - [ ] 库存看板（FBA 库存 / 在途 / 日均销量 / 预计断货日）

#### P-1.4 利润分析机器人
- **状态**：🔴 未开始
- **前置**：P-1.1
- **内容**：
  - [ ] 利润计算 Skill（结算数据 + 采购成本 + 头程运费）
  - [ ] 利润看板（按 SKU / 按时间 / 按市场）
  - [ ] 周报自动生成工作流
  - [ ] 周报 → IM 推送 + 邮件

#### P-1.5 差评监控 + 竞品雷达（二期）
- **状态**：🔴 未开始
- **前置**：P-1.2 + P-1.3 + P-1.4
- **内容**：
  - [ ] 差评监控 Skill（Reviews API 或爬虫）
  - [ ] 竞品雷达 Skill（SP-API Catalog + 价格监控）
  - [ ] ASIN 六维诊断（销售/库存/流量/广告/评分/退货）
  - [ ] 竞品对比看板

### P-2. 财务 Skill Pack

**前置**：B-1 + B-2 + B-3

#### P-2.1 基础设施
- [ ] 连接客户财务系统（DBHub → 金蝶/用友/SAP）
- [ ] 财务 manifest.yaml
- [ ] 行业 Prompt（会计准则 + 税务知识）
- [ ] UI 扩展：侧边栏"财务看板"入口 + 设置面板（财务系统连接配置）

#### P-2.2 核心功能
- [ ] 开票 Skill（invoice.create → 发票自动生成）
- [ ] 对账 Skill（recon.match_payment → 每日自动对账）
- [ ] 汇兑 Skill（fx.get_rate → 汇率预警）
- [ ] 应收应付 Skill（invoice.list_ar/ap → 账龄分析）

#### P-2.3 数据可视化
- [ ] 应收应付看板（账龄分布饼图、逾期预警指标卡、现金流预测趋势线）
- [ ] 收入支出趋势图
- [ ] 利润率趋势图
- [ ] 对账差异报告表格

### P-3. 尾程物流 Skill Pack

**前置**：B-1 + B-2 + B-3

#### P-3.1 基础设施
- [ ] 自研 `mcp-carrier` MCP Server（对接 UPS/FedEx/USPS/DPD API）
- [ ] 尾程物流 manifest.yaml
- [ ] 行业 Prompt（物流术语 + 时效标准 + 异常处理 SOP）
- [ ] UI 扩展：侧边栏"物流追踪"入口 + 设置面板（承运商 API Key 配置）

#### P-3.2 核心功能
- [ ] 比价打单 Skill（carrier.get_rates → 多渠道比价 → 一键打单）
- [ ] 轨迹追踪 Skill（carrier.get_tracking → 实时物流状态）
- [ ] 异常处理 Skill（carrier.report_exception → 自动建工单）
- [ ] POD 确认 Skill（carrier.get_pod → 自动对账）

#### P-3.3 数据可视化
- [ ] 物流时效看板（平均送达时间趋势线、各渠道对比柱状图）
- [ ] 异常率趋势图
- [ ] 运费成本分析（按渠道/按重量段/按目的地柱状图）
- [ ] 客户满意度指标卡（按时交付率、损坏率）

### P-4. 头程物流 Skill Pack

**前置**：B-1 + B-2 + B-3

- [ ] 自研 `mcp-shipping` MCP Server（对接船司/货代 API）
- [ ] 订舱 Skill（shipping.create_booking）
- [ ] 提单草拟 Skill（shipping.generate_bl）
- [ ] 报关申报 Skill（customs.create_declaration + HS 编码查询）
- [ ] 到港通知工作流（自动推送 ETA + 清关状态）
- [ ] 头程时效看板 + 成本分析
- [ ] UI 扩展：侧边栏"头程追踪"入口 + 设置面板（船司/货代 API 配置）

### P-5. 海外仓 Skill Pack

**前置**：B-1 + B-2 + B-3

- [ ] 自研 `mcp-wms` MCP Server（对接客户 WMS API）
- [ ] 入库预约 Skill（wms.create_inbound）
- [ ] 库存查询 Skill（wms.query_inventory）
- [ ] 出库打单 Skill（wms.create_outbound + carrier.generate_label）
- [ ] 盘点 Skill（wms.initiate_stocktake）
- [ ] 仓库利用率看板 + 库存周转率
- [ ] UI 扩展：侧边栏"仓库管理"入口 + 设置面板（WMS 连接配置）

### P-6. 卡派 Skill Pack

**前置**：B-1 + B-2 + B-3

- [ ] LTL 报价 Skill（ltl.get_rates + ltl.compare_carriers）
- [ ] 预约送仓 Skill（warehouse.schedule_delivery）
- [ ] 交货证明 Skill（ltl.confirm_delivery）
- [ ] 卡派成本看板 + 送仓时效分析
- [ ] UI 扩展：侧边栏"卡派管理"入口 + 设置面板（LTL 承运商配置）

### P-7. 客服 Skill Pack

**前置**：B-1 + B-2 + B-3

- [ ] 自研 `mcp-ticket` MCP Server（对接 Zendesk/Freshdesk/自研工单）
- [ ] 工单处理 Skill（ticket.create + ticket.update）
- [ ] SLA 监控 Skill（ticket.check_sla → 超时预警）
- [ ] 自动回复 Skill（ticket.draft_reply → 常见问题自动草拟）
- [ ] 升级流转 Skill（ticket.escalate → 超时自动升级）
- [ ] 客服质量看板（响应时间、解决率、满意度）
- [ ] UI 扩展：侧边栏"客服中心"入口 + 设置面板（工单系统连接配置）

### P-8. 报价 Skill Pack

**前置**：B-1 + B-2 + B-3

- [ ] 运费计算 Skill（rate.calculate + surcharges）
- [ ] 利润校验 Skill（rate.calc_margin → 建议售价）
- [ ] 报价单生成 Skill（quote.generate_pdf → 一键发送）
- [ ] 历史报价 Skill（quote.search_history → 趋势分析）
- [ ] 报价效率看板（报价 → 成交转化率）
- [ ] UI 扩展：侧边栏"报价中心"入口 + 设置面板（费率表配置）

---

## 四、执行路线图

```
2026 Q2（v0.1.11 - v0.2.0）
├── B-1  BGE-M3 RAG + 统一下载中心           ← v0.1.11 ✅
├── B-2  Skill Pack 商店                     ← v0.2.0
├── B-3  数据可视化引擎                       ← v0.2.0
├── B-4  用量分析仪表盘                       ← v0.2.0
└── B-5  Persona 角色管理                     ← v0.2.0

2026 Q3（v0.3.0）
├── B-6  远程更新服务
├── B-7  customer.yaml 白标交付
├── P-1.1  跨境电商基础设施（mcp-amazon-sp）
└── P-1.2-P-1.4  跨境电商第一期（广告/库存/利润）

2026 Q3-Q4（v0.4.0+）
├── P-1.5  跨境电商第二期（差评/竞品/诊断）
├── P-2   财务 Pack
├── P-3   尾程物流 Pack
└── P-4-P-8  头程/海外仓/卡派/客服/报价 Pack
```

---

## 五、依赖关系

```
B-1 (RAG) ────────────────────────────── 所有 Pack 都需要知识检索
B-2 (商店) ────────────────────────────── 所有 Pack 的交付载体
B-3 (可视化) ──────────────────────────── 所有 Pack 都需要数据看板
    │
    ├── P-1 (跨境电商) ← 首个落地 Pack
    │   ├── P-1.1 (mcp-amazon-sp) ← 前置：SP-API 开发者账号
    │   ├── P-1.2 (广告守卫)
    │   ├── P-1.3 (库存哨兵) ← 依赖 DBHub（基座预装）
    │   ├── P-1.4 (利润分析) ← 依赖 DBHub + SP-API
    │   └── P-1.5 (差评/竞品) ← 依赖 P-1.2~1.4 数据
    │
    ├── P-2 (财务) ← 依赖 DBHub（基座预装）
    ├── P-3 (尾程物流) ← 依赖 mcp-carrier（自研）
    ├── P-4 (头程) ← 依赖 mcp-shipping（自研）
    ├── P-5 (海外仓) ← 依赖 mcp-wms（自研）
    ├── P-6 (卡派) ← 依赖 mcp-ltl（自研）
    ├── P-7 (客服) ← 依赖 mcp-ticket（自研）
    └── P-8 (报价) ← 依赖多个 MCP

B-6 (远程更新) ← 依赖 B-2（Pack 更新推送）
B-7 (白标交付) ← 依赖 B-2（Pack 预装）
```

---

## 六、Pack UI 扩展机制

每个行业 Pack 安装后自动拥有专属 UI。两种实现方式：

### 声明式 UI（YAML 驱动，零前端代码）

Pack 的 `manifest.yaml` 中声明 UI 入口，基座自动渲染：

```yaml
ui:
  sidebar:
    - id: inventory-dashboard
      label: 库存看板
      icon: BarChart3          # Lucide icon
      route: /skill-pack/cross-border-ecom/inventory
  settings:
    - id: marketplace-config
      label: 平台配置
      fields:
        - key: amazon_region
          type: select
          options: [US, EU, JP, UK, DE, FR]
```

基座渲染器：
- **Sidebar 渲染器**：读 `ui.sidebar` → 在侧边栏"More"区域动态添加入口
- **Form 渲染器**：读 `ui.settings.fields` → 在 Settings 页自动生成配置面板
- **Dashboard 渲染器**：读 `schemas/` + MCP 数据源 → 自动生成图表页面（B-3 提供）
- **Table 渲染器**：读 `schemas/` + MCP 返回数据 → 自动生成数据表格

### 自定义 UI 组件（按需，复杂交互才用）

Pack 目录中放 `ui/` 子目录，包含 React 组件：

```
skill-packs/cross-border-ecom/
└── ui/
    ├── listing-optimizer.tsx    # Listing 对比编辑器（复杂交互）
    ├── ad-dashboard.tsx         # 广告数据看板（自定义图表）
    └── styles.css
```

基座安装 Pack 时自动注册动态路由（React lazy import）。

### 隔离性保障

| 维度 | 机制 |
|------|------|
| 文件隔离 | Pack 存储在 `~/.hermes/skill-packs/<id>/`，与基座二进制完全分离 |
| 基座升级安全 | Corey 更新只替换 App 二进制，不触碰 `~/.hermes/` 任何内容 |
| Hermes 升级安全 | Hermes 升级不影响 `skill-packs/` 目录 |
| Pack 升级独立 | 每个 Pack 有独立版本号，单独更新 |
| 卸载干净 | Pack 卸载时清理：Skills 文件、MCP 注册、config.yaml 条目、UI 入口、工作流文件 |
| 路由隔离 | Pack 路由统一前缀 `/skill-pack/<id>/...`，不与基座路由冲突 |

---

## 七、行业 Pack 数据可视化需求汇总

| Pack | 核心图表 | 数据源 |
|------|---------|--------|
| 跨境电商 | 趋势线（销量/广告费）、柱状图（库存水位）、指标卡（ACoS/转化率） | SP-API + ERP |
| 财务 | 饼图（账龄分布）、趋势线（现金流）、表格（应收应付明细） | 金蝶/用友/SAP |
| 尾程物流 | 趋势线（时效）、柱状图（各渠道成本）、指标卡（异常率/按时交付率） | Carrier API |
| 头程 | 甘特图（船期）、趋势线（运费成本） | 船司/货代 API |
| 海外仓 | 柱状图（仓库利用率）、趋势线（周转率） | WMS API |
| 卡派 | 趋势线（送仓时效）、饼图（渠道占比） | LTL API |
| 客服 | 趋势线（响应时间）、指标卡（解决率/满意度） | 工单系统 |
| 报价 | 漏斗图（报价→成交）、趋势线（报价量） | CRM/自研 |

**基座 B-3（数据可视化引擎）** 需要支持的图表类型：
- 折线图（趋势）
- 柱状图（对比）
- 饼图（占比）
- 指标卡（KPI）
- 数据表格（明细）
- 漏斗图（转化）

这些足够覆盖 8 个行业 Pack 的需求。

---

## 八、当前版本状态

| 版本 | 状态 | 主要内容 |
|------|------|---------|
| v0.1.8 | ✅ 已发布 | 网关会话自动导入 + Windows 修复 + COS CDN + 进度条 |
| v0.1.9 | 🔄 开发中 | BGE-M3 RAG + 统一下载中心 |
| v0.1.11 | 🔄 开发中 | 网关修复 + 通道状态 + 多项 Bug 修复 |
| v0.2.0 | 📋 规划中 | Skill Pack 商店 + 可视化 + Persona + 用量分析 |
| v0.3.0 | 📋 规划中 | 远程更新 + 白标交付 + 跨境电商第一期 |

---

## 九、当前 Bug 跟踪（v0.1.11）

> 更新时间：2026-04-30（第二轮修复完成）

### 9.1 已修复（代码已改，CI 全绿）

#### BUG-001: Hermes 网关不启动 HTTP API Server
- **优先级**：P0
- **影响平台**：Windows + macOS
- **现象**：Corey 显示"网关未启动"，但 `hermes gateway run` 进程在运行
- **根因**：Hermes 要求 `.env` 中设置 `API_SERVER_ENABLED=true` 才会启动 8642 端口的 HTTP API。未设置时 gateway 只运行消息平台 + cron，不启动 API server
- **修复**：
  - `gateway.rs` — 新增 `ensure_api_server_env()`，在 `gateway_start()` 和 `gateway_restart()` 前自动写入 `API_SERVER_ENABLED=true`
  - `bootstrap-windows.ps1` — Step 5.6 自动写入

#### BUG-002: config.yaml 不存在时不自动创建
- **优先级**：P0
- **影响平台**：Windows + macOS
- **现象**：首次安装后配置 LLM Profile，但 `~/.hermes/config.yaml` 不存在
- **根因**：`seed_hermes_model_if_empty` 在 `read_view()` 失败时直接 return，不创建文件
- **修复**：`llm_profiles.rs` — 构造空 `HermesConfigView` 继续执行写入

#### BUG-003: Windows 网关进程随 Corey 退出
- **优先级**：P0
- **影响平台**：Windows
- **现象**：关闭 Corey 后 Hermes gateway 进程也消失
- **根因**：`CREATE_NO_WINDOW` 标志不够，子进程仍绑定在父进程组
- **修复**：`gateway.rs` — 改用 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`，stdout/stderr 设为 null

#### BUG-004: Windows 无法停止网关
- **优先级**：P1
- **影响平台**：Windows
- **现象**：macOS 有 `hermes gateway stop`，Windows 无对应实现
- **修复**：`gateway.rs` — 新增 `gateway_stop()`：读 `gateway.pid` → `taskkill /F /PID`，fallback 到 PowerShell 端口查找杀进程。新增 IPC `hermes_gateway_stop`

#### BUG-005: QQ/钉钉扫码后无连接状态标识
- **优先级**：P1
- **影响平台**：Windows + macOS
- **现象**：QQ/钉钉扫码登录成功后，平台通道卡片没有"在线"标识，用户无法确认是否连接
- **根因**：`computeStatus()` 对 `has_qr_login=true` 的通道永远返回 `'qr'`，而 `ChannelCard` 在 `qr` 状态下隐藏 `LiveStatusPill`
- **修复**：`computeStatus.ts` — QR 通道在 env 已配置时返回 `'configured'`，让 `LiveStatusPill`（在线 ✅ / 离线 ❌ / 未知）正常显示
- **效果**：扫码前显示 `QR`（黄色）→ 扫码成功后显示 `已配置`（绿色）+ `在线`（绿色 ✅）

#### BUG-006: macOS Node.js/Browser Runner 检测失败
- **优先级**：P1
- **影响平台**：macOS
- **现象**：已安装 Node.js 但浏览器自动化页面显示"未找到"
- **根因**：Tauri GUI 应用不加载 `.zshrc`/`.bashrc`，Homebrew/nvm 安装的 `node` 不在 PATH
- **修复**：`browser_config.rs` — `detect_node()` 增加 macOS 常见路径（`/opt/homebrew/bin/node`、`~/.nvm/versions/node/current/bin/node`、`~/.volta/bin/node`、`~/.fnm/node/current/bin/node`）；`find_browser_runner` 增加 `CARGO_MANIFEST_DIR` 开发模式搜索

### 9.2 待修复

#### BUG-007: Windows 数据目录不一致（根因问题）
- **优先级**：P0
- **影响平台**：Windows
- **现象**：`E:\Corey\data\` 和 `C:\Users\ADMI\.hermes\` 两个数据目录并存，skills/config/sessions 重复
- **根因**：`paths.rs` 的 `platform_default()` 在 Windows 上检测到 `Corey.exe` 所在目录就返回 `<exe_dir>/data/`，而 Bootstrap 脚本设置 `HERMES_HOME=C:\Users\ADMI\.hermes`。两边指向不同目录
- **修复**：`paths.rs` — 去掉 `Corey.exe` 检测逻辑，所有平台统一用 `~/.hermes/`；`bootstrap-windows.ps1` 清理死代码
- **文件**：`src-tauri/src/paths.rs`、`src-tauri/assets/scripts/bootstrap-windows.ps1`

#### BUG-008: Windows 对话白圈无回复
- **优先级**：P0
- **影响平台**：Windows
- **现象**：发送消息后一直白圈转圈，无回复
- **根因**：数据目录不一致（BUG-007），gateway 读不到 Corey 写的 `.env`/`config.yaml`
- **修复**：随 BUG-007 解决

#### BUG-009: Skills 和数据目录重复
- **优先级**：P0
- **影响平台**：Windows
- **现象**：`E:\Corey\data\skills` 和 `E:\Corey\hermes-agent\skills` 都有相同的 skills 文件
- **根因**：BUG-007 的直接后果
- **修复**：随 BUG-007 解决

#### BUG-010: BGE-M3 假装安装完成
- **优先级**：P1
- **影响平台**：Windows + macOS
- **现象**：知识库点"安装"立刻提示 BGE-M3 安装完成，但文件不存在或为空
- **根因**：`model_exists()` 只检查文件是否存在，不检查文件大小。空文件被当成已下载
- **修复**：`embedding.rs` — `model_exists()` 增加文件大小校验（onnx≥1MB, onnx_data≥100MB, tokenizer≥100KB）；`knowledge.rs` — `rag_download_model` 空文件重新下载
- **文件**：`src-tauri/src/ipc/embedding.rs`、`src-tauri/src/ipc/knowledge.rs`

#### BUG-011: 会话列表混乱
- **优先级**：P1
- **影响平台**：Windows + macOS
- **现象**：
  1. 微信对话按话题分裂成多个会话
  2. 存在空会话
  3. Corey session 和 Gateway session 重复
- **根因**：`gatewaySync` 按 Hermes session ID 逐个导入，不按来源分组
- **修复**：
  - 新增 `gateway_source_messages` IPC 按 source 聚合消息
  - `gatewaySync` 改为按 source 分组创建 session
  - `GatewaySection` 改为按 source 分组显示（如"微信对话"、"钉钉对话"）
  - 每个 source 一个会话，消息按时间排序
- **文件**：`gateway_sessions.rs`、`lib.rs`、`runtime.ts`、`chat.ts`、`chatTypes.ts`、`GatewaySection.tsx`

#### BUG-012: 安装后 Skill/MCP 引导消失
- **优先级**：P1
- **影响平台**：Windows + macOS
- **现象**：一键安装启动网关后，配置引导消失了
- **根因**：`HermesInstallCard` 在 gateway online 后返回 `null`
- **修复**：新增 `NextStepsCard` 组件，gateway online 后显示"配置 Skills → 配置 MCP → 连接通道"引导
- **文件**：`src/features/home/HermesInstallCard.tsx`

#### BUG-013: 语言设置显示不一致
- **优先级**：P2
- **影响平台**：Windows + macOS
- **现象**：中文界面但设置页语言显示 English
- **根因**：fallback 语言为 `'en'`，`zh-CN` 无法匹配
- **修复**：`AppearanceSection.tsx` — 用 `split('-')[0]` 提取主语言代码，fallback 改为 `'zh'`
- **文件**：`src/features/settings/AppearanceSection.tsx`

#### BUG-014: 默认主题浅色
- **优先级**：P2
- **影响平台**：Windows + macOS
- **现象**：首次启动应用主题为浅色
- **修复**：`ui.ts` — 默认值从 `'dark'` 改为 `'system'` 跟随系统偏好
- **文件**：`src/stores/ui.ts`

#### BUG-015: QQ/钉钉扫码登录等待时间过长
- **优先级**：P2
- **影响平台**：Windows + macOS
- **现象**：扫码后等了很久才提示登录成功
- **修复**：`ChannelQrPanel.tsx` — 轮询间隔从 3 秒改为 2 秒
- **文件**：`src/features/channels/ChannelQrPanel.tsx`

### 9.2 待验证（需用户在 Windows 实测）

- BUG-007~009：数据目录统一后，Windows 上旧的 `E:\Corey\data\` 目录需要手动删除
- BUG-008：对话白圈需在 Windows 上实测确认已解决
- BUG-010：BGE-M3 需实测下载流程（文件大小校验后应触发重新下载）

### 9.3 功能缺失（非 Bug）

#### FEAT-001: 卸载/重置功能
- **优先级**：P2
- **说明**：设置中需要"清除 Hermes 数据"和"重置 Corey 配置"按钮。帮助手册需完整卸载步骤
- **卸载清单**：
  - **Windows**：删安装目录 → 删 `~/.hermes/` → 删 `%APPDATA%/com.caduceus.app/` → 清环境变量
  - **macOS**：删 `.app` → 删 `~/.hermes/` → 删 `~/Library/Application Support/com.caduceus.app/`

### 9.4 CI 验证结果

| 检查 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 0 错误 |
| `cargo check` | ✅ 编译通过 |
| `cargo test --lib` | ✅ 314 passed, 0 failed |
| `pnpm build` | ✅ 7.26s 构建成功 |

### 9.5 修改文件汇总

| 文件 | 改动 |
|------|------|
| `src-tauri/src/hermes_config/gateway.rs` | `ensure_api_server_env`、`windows_gateway_spawn` 重写、`gateway_stop`/`windows_gateway_stop`、`check_port_8642` |
| `src-tauri/src/ipc/llm_profiles.rs` | `seed_hermes_model_if_empty` 空容错 |
| `src-tauri/src/ipc/hermes_config.rs` | 新增 `hermes_gateway_stop` IPC |
| `src-tauri/src/hermes_config/mod.rs` | re-export `gateway_stop` |
| `src-tauri/src/lib.rs` | 注册 `hermes_gateway_stop`、`gateway_source_messages` |
| `src-tauri/assets/scripts/bootstrap-windows.ps1` | Step 5.6 `API_SERVER_ENABLED`、清理死代码 |
| `src-tauri/src/ipc/browser_config.rs` | `detect_node` macOS 多路径、`find_browser_runner` 开发模式 |
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
| `src/stores/chatTypes.ts` | 新增 `importGatewaySource` 类型 |
| `src/stores/ui.ts` | 默认主题 `system` |
| `src/lib/ipc/runtime.ts` | 新增 `gatewaySourceMessages` |
