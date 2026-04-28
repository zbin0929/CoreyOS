# CoreyOS 定制化方案

> 版本：v3.0 · 2026-04-29
> 状态：详细设计阶段（含竞争分析 + 数据可行性验证）
> 基于现有代码架构分析 + 麦多AI竞品调研编写

---

## 0. 竞品分析与市场定位

### 0.1 麦多AI 调研

**基本信息：**

| 维度 | 内容 |
|------|------|
| 公司 | 易仓科技旗下（eccang.com），国内跨境 ERP 龙头 |
| 产品 | 麦多AI — 亚马逊 AI 全能运营助手 |
| 口号 | "用麦多，越卖越多" / "8小时的活，1小时搞定" |
| 用户 | 800+ 企业客户，5000+ 用户 |
| 部署 | SaaS 云端，注册即用 |
| 核心卖点 | 8 个 AI 机器人 7×24 小时代替人工运营 |

**八大 AI 机器人：**

| # | 机器人 | 角色 | 核心能力 |
|---|--------|------|----------|
| 1 | 否词机器人 | 预算守卫者 | 7×24 巡检广告，精准拦截高点击零转化废词，一键执行 |
| 2 | 库存机器人 | 供应链先知 | 断货预警 + 调价建议；冗余库存清仓策略 |
| 3 | 差评机器人 | 品牌声誉哨兵 | 全 ASIN 差评实时追踪，AI 翻译 + 提炼诉求 |
| 4 | 数据分析机器人 | 全店诊断专家 | 打通全盘数据，归因销量波动，生成行动建议 |
| 5 | 市场分析机器人 | 蓝海勘探队 | ASIN 健康度评估，机会词挖掘，运营策略生成 |
| 6 | 战场雷达机器人 | 实时情报中心 | 竞品价格/排名/促销/上新监控 |
| 7 | 竞品分析机器人 | 战术复刻引擎 | 交叉分析竞品轨迹，揭示排名驱动力 |
| 8 | 新老诊断机器人 | 增长归因分析师 | 六维诊断（销售/库存/流量/广告/评分/退货） |

**麦多的核心优势（我们无法复制的）：**

1. **易仓 ERP 数据护城河** — 数千家卖家每天的数据流，10 年行业沉淀
2. **聚合分析能力** — 跨店铺、跨市场的数据聚合
3. **精准成本计算** — 采购成本、头程运费、FBA 费用的精确算法
4. **开箱即用** — 注册 → 授权 SP-API → 立即使用，零部署

**麦多的局限（我们的机会）：**

1. **仅限亚马逊** — 不支持其他平台（Shopify/Temu/TikTok Shop）
2. **SaaS 数据上云** — 中大型企业不愿数据出企业
3. **无法定制** — 标准化产品，不能对接客户内部系统
4. **仅推钉钉** — IM 推送只支持钉钉
5. **单行业** — 只做跨境电商，不做海外仓/物流/客服

### 0.2 CoreyOS vs 麦多AI 定位对比

```
麦多AI 模式（SaaS 数据聚合）：
  卖家 → 授权店铺 → 麦多云端 → 麦多分析 → 推送结果
  卖家用的是麦多的数据和算法

CoreyOS 模式（本地 AI 中枢）：
  企业 → CoreyOS 连接客户已有系统 → LLM 分析 → IM 推送
  企业用的是自己的数据 + CoreyOS 的 AI 能力
```

| 维度 | 麦多AI | CoreyOS |
|------|--------|---------|
| 部署模式 | SaaS 云端 | **本地桌面应用** |
| 数据安全 | 数据上云 | **数据本地，不出企业** |
| 目标客户 | 中小卖家（运营个人决策） | **中大型企业（年销 1 亿+，IT/管理层决策）** |
| 行业覆盖 | 仅亚马逊跨境电商 | **8 大行业可定制** |
| IM 推送 | 仅钉钉 | **微信/QQ/钉钉/飞书全通道** |
| 定制能力 | 无（标准化 SaaS） | **Skill Pack 按行业/客户定制** |
| MCP 工具 | 内置固定工具链 | **可插拔 MCP Server 生态** |
| 数据来源 | 自有 ERP + SP-API | **连接客户已有 ERP/WMS/OMS** |
| 价格模型 | 按用量计费 | **按行业包 + 定制开发收费** |

### 0.3 CoreyOS 的差异化战略

**不正面硬刚麦多。** 麦多在中小卖家市场已有 5000+ 用户，且有易仓 ERP 数据护城河。

**CoreyOS 的核心定位：企业 AI 运营中枢**

- 面向**中大型企业**（年销 1 亿+），他们已有 ERP、已有团队、数据不能上云
- **不聚合数据**，而是连接客户已有的系统（ERP/WMS/OMS/CRM），用 AI 在本地分析
- 客户的 Amazon 数据、ERP 数据、WMS 数据都在客户自己那里，CoreyOS 只是"读"然后分析
- **可定制** — 不同行业、不同客户看到不同的功能
- **白标交付** — 可以换上客户自己的品牌

---

## 0.4 数据来源可行性验证

### 跨境电商数据来源分析

| 机器人 | 数据需求 | 可用数据源 | 可行性 | 风险 |
|--------|---------|-----------|--------|------|
| 广告守卫 | 广告关键词表现、搜索词报告 | **Amazon SP-API Advertising API**（官方） | ✅ 100% | 需注册 Amazon 开发者（审核 1-2 周） |
| 库存哨兵 | FBA 库存、在途、日均销量 | **SP-API FBA Inventory** + 客户 ERP（DBHub） | ✅ 100% | 客户需授权 SP-API + 提供 ERP 连接串 |
| 利润分析 | 结算报告、采购成本、头程运费 | **SP-API Settlement Report** + ERP 成本数据（DBHub） | ✅ 90% | 成本数据需客户提供 |
| ASIN 诊断 | 销量/库存/流量/广告/评分/退货 | 综合以上所有数据 | ✅ 80% | 依赖其他机器人数据准确度 |
| 差评监控 | 实时评论数据 | ⚠️ **Amazon 无官方 Reviews API** | ⚠️ 需第三方 | 用 Jungle Scout API / Helium10 API（$50-200/月）或自建爬虫 |
| 竞品雷达 | 竞品价格/Coupon/主图/排名 | **SP-API Catalog**（公共数据）+ ⚠️ 爬虫 | ⚠️ 部分有 API | 实时价格/Buy Box 有 API，Coupon/主图变更需爬虫 |

### 第一期能交付的（有可靠数据源）

| 机器人 | 数据源 | 把握 | 说明 |
|--------|--------|------|------|
| 广告守卫 | SP-API Advertising | **100%** | 官方 API，数据完整 |
| 库存哨兵 | SP-API Inventory + 客户 ERP | **100%** | 官方 API + DBHub 连 ERP |
| 利润分析 | SP-API Settlement + 客户 ERP | **90%** | 结算报告 + 客户提供成本数据 |

### 第二期再做的（需要额外方案）

| 机器人 | 数据源 | 方案 |
|--------|--------|------|
| 差评监控 | 第三方 API 或爬虫 | 接入 Jungle Scout API / Helium10 API，按调用量付费 |
| 竞品雷达 | SP-API + 爬虫 | 价格/Buy Box 用 SP-API，Coupon/主图用 Puppeteer MCP |

### SP-API 注册前置条件

SP-API 是获取 Amazon 第一方数据的唯一官方途径，**必须先完成注册**：

1. 注册 Amazon Developer Central 账号
2. 创建 SP-API 应用（需填写用例说明）
3. 通过 Amazon 审核（1-2 周）
4. 获取 `LWA_CLIENT_ID` + `CLIENT_SECRET`
5. 卖家通过 OAuth 授权我们的应用
6. 获得 `REFRESH_TOKEN` → 可调用 SP-API

**这个前置条件不影响 Skill Pack 基础设施的开发，可以并行推进。**

---

## 0.5 跨境电商 Skill Pack 机器人设计（第一期）

### 设计原则

1. **每个机器人有名字、角色、图标** — 不只是功能，而是一个有身份的 AI 员工
2. **行动建议 > 数据展示** — 不只是给数据，而是给"一键否词""一键调价"的操作建议
3. **IM 推送是核心** — 所有巡检结果推送到微信/钉钉/飞书，用户不用打开 CoreyOS
4. **数据来自客户自己的系统** — CoreyOS 只读不存，分析在本地完成

### 机器人 1：广告守卫 🛡️

**角色：** 7×24 小时盯广告，帮你省预算

**数据来源：** Amazon SP-API → Advertising API

**核心功能：**

| 功能 | 描述 | API 调用 |
|------|------|----------|
| 废词巡检 | 每小时扫描广告活动，找高点击零转化搜索词 | `get_search_term_report` |
| 语义否词 | 结合产品属性判断搜索词相关性（卖"指甲油"≠"美甲灯"） | LLM 分析 |
| ACOS 预警 | ACOS 超阈值自动推送 IM 告警 | `get_campaign_metrics` |
| 一键否词 | IM 推送建议，用户回复"确认"自动执行 | `add_negative_keywords` |

**IM 推送模板：**

```
🛡️ 广告守卫 - 发现 3 个废词

❌ "handheld shower head holder"
   点击 28 次 / 订单 0 / 花费 ¥41.9 / ACOS ∞
   → 回复"否词"一键执行

❌ "rain shower head combo"
   点击 15 次 / 订单 0 / 花费 ¥23.5 / ACOS ∞
   → 与你的产品(手持花洒)不匹配

✅ 建议否词模式：精准否词
```

### 机器人 2：库存哨兵 📦

**角色：** 断货预警 + 滞销清理

**数据来源：** SP-API FBA Inventory + 客户 ERP 数据库（DBHub）

**核心功能：**

| 功能 | 描述 | 数据源 |
|------|------|--------|
| 断货预警 | 可售天数 <14 黄灯，<7 红灯 | SP-API `get_inventory_summaries` + ERP 日均销量 |
| 补货建议 | 结合在途/日均/时效给优先级 | SP-API `get_inventory_items` + ERP 采购数据 |
| 滞销预警 | 90 天+ 库龄自动标记 | SP-API `get_inventory_aging` |
| 每日简报 | 推送库存健康度到 IM | 综合数据 |

**IM 推送模板：**

```
📦 库存哨兵 - 每日简报

🔴 断货风险（3 个 SKU）
  SKU-A: 可售 6 天 | 日均 40 件 | 在途可支撑 3 天
  → 建议：立即涨价 10% 抑制单量 + 紧急空运补位

🟡 滞销预警（2 个 SKU）
  SKU-B: 库龄 120 天 | 日均 2 件 | 库存 360 件
  → 建议：开启 Outlet Deal 或 BOGO 促销

✅ 健康：85 个 SKU 正常运转
```

### 机器人 3：利润分析 💰

**角色：** 帮你看清每笔钱去了哪里

**数据来源：** SP-API Settlement Report + 客户 ERP 成本数据（DBHub）

**核心功能：**

| 功能 | 描述 | 数据源 |
|------|------|--------|
| 利润看板 | 按 SKU/天/月的利润明细 | SP-API Settlement + ERP 成本 |
| 成本拆解 | FBA 费用/广告费/采购/头程/退货 | 综合数据 |
| 利润预警 | 利润率低于阈值自动告警 | 实时计算 |
| 周报/月报 | 自动生成利润分析报告 | 定时汇总 |

### 定时巡检（Workflow）

```
06:00  库存哨兵 - 扫描断货/滞销
07:00  广告守卫 - 扫描废词 + ACOS 异常
08:00  广告守卫 - 早间巡检
12:00  广告守卫 - 午间巡检
18:00  利润分析 - 日终利润快报
22:00  库存哨兵 - 晚间库存快报
全天   广告守卫 - ACOS 突破阈值实时告警
```

### mcp-amazon-sp MCP Server 工具清单

这是唯一需要自研的 MCP Server，其余复用基座已有的 DBHub + Filesystem：

```
Tools:
  ├── 广告相关
  │   ├── list_ad_campaigns          # 列出广告活动
  │   ├── get_ad_keywords            # 获取关键词表现
  │   ├── get_search_term_report     # 搜索词报告（找废词）
  │   ├── add_negative_keywords      # 添加否定关键词（一键否词）
  │   └── update_bid                 # 调整竞价
  │
  ├── 库存相关
  │   ├── get_inventory              # 获取库存快照
  │   ├── get_inventory_health       # 库存健康度
  │   └── estimate_days_of_supply    # 可售天数估算
  │
  ├── 订单相关
  │   ├── get_orders                 # 获取订单
  │   └── get_order_metrics          # 订单统计
  │
  ├── 报告相关
  │   ├── request_report             # 请求报告
  │   └── get_report                 # 获取报告数据
  │
  └── 产品相关
      ├── get_catalog_item           # 获取 Listing 信息
      ├── get_item_offers            # 获取报价（含竞品 Buy Box）
      └── update_price               # 改价
```

### Skill Pack 目录结构

```
cross-border-ecom/
├── manifest.yaml
├── prompts/
│   ├── system.md
│   ├── robots/
│   │   ├── ad-guardian.md
│   │   ├── inventory-sentinel.md
│   │   └── profit-analyst.md
│   ├── knowledge/
│   │   ├── amazon_policy.md
│   │   ├── fba_rules.md
│   │   ├── advertising_guide.md
│   │   └── glossary.md
│   └── templates/
│       ├── daily-report.md
│       ├── alert-format.md
│       └── weekly-report.md
├── skills/
│   ├── listing-optimizer.md
│   ├── keyword-research.md
│   └── compliance-checker.md
├── workflows/
│   ├── hourly-ad-scan.yaml
│   ├── daily-inventory.yaml
│   └── weekly-report.yaml
└── mcp-servers/
    └── mcp-amazon-sp/
        ├── pyproject.toml
        └── src/
            └── mcp_amazon_sp/
                ├── __init__.py
                ├── server.py
                ├── advertising.py
                ├── inventory.py
                ├── orders.py
                ├── catalog.py
                └── reports.py
```

---

## 0.6 客户定位与交付策略

### 目标客户画像

| 维度 | 麦多客户 | CoreyOS 客户 |
|------|---------|-------------|
| 规模 | 中小卖家 | **中大型企业（年销 1 亿+）** |
| ERP | 可能没用，或用易仓 | **已有 ERP（SAP/Oracle/自研/领星/积加）** |
| 数据安全 | 不敏感 | **敏感（不愿数据上云）** |
| 定制需求 | 标准化够用 | **需要深度定制（对接内部系统）** |
| 采购决策 | 运营个人决定 | **IT/管理层决策** |
| 付费意愿 | 按月订阅 | **项目制 + 年费** |

### 交付方式

```
交付流程：
1. 客户下载标准 Corey 安装包（同一个 dmg/exe）
2. 我们远程或本地导入 customer.yaml
3. Corey 启动 → 检测到 customer.yaml → 自动执行：
   - 安装指定 Skill Pack
   - 注册 MCP Server（连接客户 ERP/WMS）
   - 应用品牌定制
   - 隐藏内部功能
   - 删除 customer.yaml（不留痕迹）
4. 客户看到的是完整行业产品，找不到任何定制化痕迹
```

### 更新维护策略

不同行业客户看到不同功能，但**基座代码完全相同**：

- **Skill Pack 隔离** — 每个 Pack 独立安装在 `~/.hermes/skill-packs/<id>/`
- **基座更新** — 所有客户用同一个自动更新通道（GitHub Releases）
- **Pack 更新** — 按客户安装的 Pack 推送对应更新
- **配置隔离** — 每个 Pack 的 MCP Server、工作流、prompt 完全独立

---

## 1. 核心理念

**Corey = 通用 AI 基座 + 行业 Skill Pack**

- 基座提供：AI 对话、工具调用（MCP）、工作流引擎、权限沙箱、数据持久化
- 定制 = 行业专属的 **Prompt 包 + MCP Tool 包 + 可选 UI 组件**
- **核心代码零分支**，所有行业差异通过配置和插件解决
- 客户拿到的是完整行业产品，看不到内部插件机制

```
┌─────────────────────────────────────────────────┐
│                   Corey 基座                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ AI 对话   │ │ 工作流引擎│ │ 权限沙箱 + 审计   │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ MCP 网关  │ │ 数据持久化│ │ 通知 / 定时任务   │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├─────────────────────────────────────────────────┤
│              Skill Pack 加载层                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │ 跨境电商 │ │ 海外仓   │ │ 尾程物流 │  ...      │
│  └─────────┘ └─────────┘ └─────────┘            │
└─────────────────────────────────────────────────┘
```

---

## 2. 现有架构盘点（已具备的能力）

在开始设计之前，先梳理 Corey 已有的基础设施，避免重复造轮子：

### 2.1 Skills 系统（已实现 ✅）

**代码位置：**
- Rust 后端：`src-tauri/src/skills.rs` — 读写 `~/.hermes/skills/**/*.md`
- Rust IPC：`src-tauri/src/ipc/skills.rs` — `skill_list`, `skill_get`, `skill_save`, `skill_delete`, `skill_version_list`
- 前端 IPC：`src/lib/ipc/skills.ts` — TypeScript 类型 + invoke 封装
- 前端页面：`src/features/skills/index.tsx` — Skill 编辑器（树 + textarea）
- 版本历史：SQLite 存储，支持快照回滚

**已有能力：**
- Markdown 文件的 CRUD + 版本历史
- 按 group（目录）分组展示
- 文件级读写，前端编辑保存

**缺失能力：**
- ❌ 无 manifest.yaml 概念，每个 skill 是独立 .md 文件
- ❌ 无 Skill Pack 概念（一组 skill 的打包/安装/卸载）
- ❌ 无 prompt 注入机制（skill 文件存在但不会自动注入 system prompt）
- ❌ 无 MCP tool 声明和自动注册
- ❌ 无工作流注册
- ❌ 无 UI 扩展注册

### 2.2 Skill Hub（已实现 ✅）

**代码位置：**
- Rust IPC：`src-tauri/src/ipc/skill_hub.rs` — `skill_hub_exec` 命令
- 前端页面：`src/features/skills/HubPanel.tsx` — Hub 浏览器
- CLI 封装：调用 `hermes skills <subcmd>`，支持 9 个子命令

**已有能力：**
- `hermes skills browse/search/inspect/install/uninstall/list/check/update/audit`
- 7+ hub 源（official, skills-sh, well-known, github, clawhub, lobehub, claude-marketplace）
- 子命令白名单安全机制

**缺失能力：**
- ❌ Hub 安装的是单个 skill（.md），不是 Skill Pack（一组文件 + MCP 配置）
- ❌ 无行业分类/筛选
- ❌ 无私有 Hub 源（我们的行业包需要自己的分发渠道）

### 2.3 MCP Server 管理（已实现 ✅）

**代码位置：**
- Rust IPC：`src-tauri/src/ipc/mcp.rs` — `mcp_server_list`, `mcp_server_upsert`, `mcp_server_delete`, `mcp_server_probe`
- 前端页面：`src/features/mcp/index.tsx` — MCP 管理页面
- 前端表单：`src/features/mcp/ServerForm.tsx` — MCP 编辑表单
- 配置读写：`src-tauri/src/hermes_config.rs` — 读写 `~/.hermes/config.yaml` 的 `mcp_servers:` 段

**已有能力：**
- MCP Server 的 CRUD（upsert/delete/list）
- 支持 stdio（command/args/env）和 http（url/headers）两种传输
- 可达性探测（probe）
- 推荐模板快速添加（`RECOMMENDED_MCPS`）
- YAML patch 写入，不影响其他配置段

**缺失能力：**
- ❌ 无批量注册（Skill Pack 安装时需要一次性注册多个 MCP Server）
- ❌ 无环境变量模板替换（`${vault.xxx}` / `${skill.xxx}`）
- ❌ 无 MCP Server 依赖检查

### 2.4 Hermes 配置管理（已实现 ✅）

**代码位置：**
- `src-tauri/src/hermes_config.rs` — config.yaml 读写
- `src-tauri/src/hermes_config/gateway.rs` — gateway start/restart
- `src/lib/ipc/hermes-config.ts` — 前端 IPC

**已有能力：**
- YAML 字段级 patch（`write_channel_yaml_fields`）
- Gateway 状态管理
- `HERMES_HOME` 环境变量注入

### 2.6 基座层预装 MCP 清单（开源免费，可本地部署）

Corey 基座预装以下开源 MCP Server，覆盖通用数据访问需求，行业 Skill Pack 可直接引用，无需自研：

| MCP Server | 分类 | 核心能力 | 部署方式 | 外部依赖 | 行业适用性 |
|-----------|------|---------|---------|---------|----------|
| **DBHub** | 💾 数据 | MySQL / PostgreSQL / SQLite 轻量网关，零依赖，Token 高效 | `npx -y @anthropic/dbhub-mcp` / Docker | ❌ 无 | **全行业** — 替代大部分 ERP/WMS 数据直连 MCP |
| **Filesystem MCP** | 🖥️ 系统 | 安全可控的本地文件读写管理 | `npx -y @anthropic/fs-mcp` / Python | ❌ 无 | **全行业** — 报价单 PDF 输出、批量导入导出、对账文件读写 |
| **freeweb-mcp** | 🌐 网络 | 多层级网页抓取（7 种备用机制），无需 API Key | `npx -y freeweb-mcp` / Docker | ❌ 无 | **全行业** — 竞品分析、市场调研、无 API 系统的 fallback 抓取 |
| **Puppeteer MCP** | 🖥️ 系统 | 无头浏览器自动化，截图 + 网页操作 | `npx -y @anthropic/puppeteer-mcp` | ❌ 无 | **客服** — 操作无 API 的后台 Web 界面 |
| **SQLite MCP** | 💾 数据 | SQLite 自然语言查询 | `uvx mcp-server-sqlite` | ❌ 无 | **内部开发** — 原型验证、本地数据分析 |
| **GitHub MCP** | 🔧 开发 | 仓库 / Issue / PR 操作 | Go / Docker | ⚠️ GitHub Token | **开发者** — 代码仓库集成 |
| **MongoDB MCP** | 💾 数据 | MongoDB Atlas M0 免费层或本地部署 | Node / Docker | ❌ 无 | **海外仓** — 若客户 WMS 使用 MongoDB |
| **Supabase MCP** | 🔧 开发 | 本地 PostgreSQL 连接，可作开发替代 | `npx -y supabase-mcp` / Docker | ❌ 无 | **内部开发** — 快速搭建客户数据层原型 |

**基座必装（所有部署预装）：**

| # | MCP Server | 理由 |
|---|-----------|------|
| 1 | **DBHub** | 通用数据库访问，行业包只需配置连接串即可直连客户 ERP/WMS |
| 2 | **Filesystem** | 所有行业都需要文件读写能力 |
| 3 | **freeweb-mcp** | 通用网页抓取，作为无 API 系统的 fallback |

**行业按需装（Skill Pack 声明依赖时自动安装）：**

| 行业 | 额外 MCP | 用途 |
|------|---------|------|
| 跨境电商 | Puppeteer | 操作 Amazon Seller Central Web 界面（部分功能无 API） |
| 海外仓 | MongoDB MCP | 若客户 WMS 使用 MongoDB |
| 客服 | Puppeteer | 操作 Zendesk/Freshdesk Web 界面 |
| 开发者 | GitHub MCP | 代码仓库集成 |

**对自研 MCP Server 的影响：**

引入现成 MCP 后，行业包的自研 MCP 开发量大幅降低：

```
原方案：跨境电商 = mcp_amazon_sp_api(5天) + mcp_erp_sync(3天) = 8天
优化后：跨境电商 = mcp_amazon_sp_api(5天) + DBHub 连 ERP(0.5天) = 5.5天
        ↑ DBHub 已支持 MySQL/PostgreSQL，只需配置连接串

原方案：海外仓 = mcp_wms_inventory(5天) + mcp_putaway(3天) = 8天
优化后：海外仓 = DBHub 连 WMS(0.5天) + mcp_putaway(3天) = 3.5天
        ↑ 若 WMS 有数据库直连权限，DBHub 替代 50% 自研 MCP

原方案：财务 = mcp_invoice(5天) + mcp_recon(3天) = 8天
优化后：财务 = DBHub 连财务系统(0.5天) + Filesystem 读写对账文件(0天) = 0.5天
        ↑ 纯数据库读写场景，DBHub + Filesystem 完全覆盖
```

### 2.7 沙箱 / 权限系统（已实现 ✅）

**代码位置：**
- `src-tauri/src/sandbox.rs` — PathAuthority + 权限校验

**已有能力：**
- 文件访问权限控制
- MCP tool 调用权限控制

---

## 3. 需要新建的能力（Gap 分析）

基于 2.x 的盘点，以下是需要从零构建的部分：

| # | 能力 | 优先级 | 复杂度 | 说明 |
|---|------|--------|--------|------|
| G1 | Skill Pack manifest.yaml 规范 | P0 | 低 | 纯设计，无代码 |
| G2 | Skill Pack 安装/卸载/更新命令 | P0 | 中 | 扩展 skill_hub IPC |
| G3 | Prompt 自动注入 system prompt | P0 | 中 | 新增 Rust 模块 |
| G4 | MCP Server 批量注册 + 环境变量模板 | P0 | 中 | 扩展 mcp IPC |
| G5 | 工作流引擎 | P1 | 高 | 新建子系统 |
| G6 | Vault 密钥管理 | P1 | 中 | 新建子系统 |
| G7 | UI 扩展注册 + 动态路由 | P2 | 高 | 前端架构变更 |
| G8 | 白标构建系统 | P2 | 中 | CI/CD + 配置 |
| G9 | Feature flag 机制 | P2 | 低 | 配置驱动 |
| G10 | 远程更新通道 | P3 | 高 | 需要后端服务 |

---

## 4. 详细技术设计

### 4.1 Skill Pack manifest.yaml 规范（G1）

**设计原则：**
- 向后兼容 Hermes 已有的 skills 目录结构（`~/.hermes/skills/**/*.md`）
- manifest.yaml 放在 Skill Pack 根目录，描述整个包的元信息
- 安装后 manifest.yaml 复制到 `~/.hermes/skill-packs/<id>/manifest.yaml` 做记录

**完整 schema：**

```yaml
# ── 必填 ──────────────────────────────────────
id: cross-border-ecom              # 全局唯一标识，[a-z0-9-]+
name: 跨境电商助手                   # 显示名称（中文/英文均可）
version: 1.0.0                      # 语义化版本
description: 跨境电商全链路 AI 助手    # 一句话描述
author: CoreyOS Team                # 作者/组织
corey_version: ">=0.1.0"            # 兼容的 Corey 最低版本

# ── 依赖 ──────────────────────────────────────
depends_on: []                      # 依赖的其他 Skill Pack ID
conflicts_with: []                  # 互斥的 Skill Pack ID（不可同时安装）

# ── Prompt 注入 ───────────────────────────────
prompts:
  # 主 system prompt 片段，追加到 Corey 基础 prompt 之后
  system: prompts/system.md

  # 知识库片段，按顺序追加到 system prompt 末尾
  knowledge:
    - prompts/knowledge/compliance.md
    - prompts/knowledge/glossary.md
    - prompts/knowledge/amazon_policy.md

  # 输出模板，作为 few-shot 示例注入
  templates:
    - prompts/templates/listing.md
    - prompts/templates/quote.md

# ── MCP Server 声明 ───────────────────────────
mcp_servers:
  # 必需的 MCP Server（安装时检查，缺失则报错）
  required:
    # type: builtin — 使用 Corey 基座预装的开源 MCP，零开发成本
    - id: erp-database
      type: builtin                # 基座预装，安装时自动检查可用性
      builtin_provider: dbhub      # 对应基座预装的 DBHub
      config:
        command: npx
        args: ["-y", "@anthropic/dbhub-mcp"]
        env:
          DB_CONNECTION: "${vault.erp_db_connection}"
          # 支持 MySQL / PostgreSQL / SQLite 连接串
          # 例: mysql://user:pass@host:3306/erp
          #     postgresql://user:pass@host:5432/erp

    # type: custom — 需要自研的行业专属 MCP Server
    - id: amazon-sp-api
      type: custom                # 自研，需随 Skill Pack 分发
      config:
        command: python
        args: ["-m", "mcp_amazon_sp_api"]
        env:
          AMAZON_REGION: "${skill.amazon_region}"
          AMAZON_ACCESS_KEY: "${vault.amazon_access_key}"
          AMAZON_SECRET_KEY: "${vault.amazon_secret_key}"

  # 可选的 MCP Server（安装时提示，不阻塞）
  optional:
    - id: web-scraper
      type: builtin
      builtin_provider: freeweb   # 基座预装的 freeweb-mcp
      config:
        command: npx
        args: ["-y", "freeweb-mcp"]

    - id: shopify-admin
      type: custom
      config:
        command: python
        args: ["-m", "mcp_shopify"]
        env:
          SHOPIFY_SHOP: "${skill.shopify_shop}"
          SHOPIFY_TOKEN: "${vault.shopify_token}"

# ── Skill 文件 ─────────────────────────────────
# 这些 .md 文件会被复制到 ~/.hermes/skills/<id>/ 下
# 用户可在 Skill 编辑器中查看和修改
skills:
  - skills/listing-optimizer.md
  - skills/competitor-analysis.md
  - skills/compliance-checker.md
  - skills/inventory-advisor.md
  - skills/ad-optimizer.md

# ── 工作流 ─────────────────────────────────────
workflows:
  - workflows/order_sync.yaml
  - workflows/inventory_alert.yaml
  - workflows/weekly_report.yaml

# ── 数据 Schema ────────────────────────────────
schemas:
  product: schemas/product.schema.json
  shipment: schemas/shipment.schema.json
  order: schemas/order.schema.json

# ── UI 扩展（可选）─────────────────────────────
ui:
  # 侧边栏新增入口
  sidebar:
    - id: listing-optimizer
      label: Listing 优化
      icon: Package                    # Lucide icon name
      route: /skill-pack/cross-border-ecom/listing
      description: AI 驱动的 Listing 优化工具

    - id: inventory-dashboard
      label: 库存看板
      icon: BarChart3
      route: /skill-pack/cross-border-ecom/inventory

  # 设置页新增面板
  settings:
    - id: marketplace-config
      label: 平台配置
      fields:
        - key: amazon_region
          type: select
          label: Amazon 站点
          options: [US, EU, JP, UK, DE, FR]
          default: US
        - key: erp_url
          type: url
          label: ERP 地址
          placeholder: https://erp.example.com/api
        - key: shopify_shop
          type: text
          label: Shopify 店铺名
          required: false

# ── 安装后钩子（可选）─────────────────────────
hooks:
  post_install:
    # 安装完成后执行的命令列表
    - command: pip install mcp_amazon_sp_api
      description: 安装自研 MCP Server Python 包
      # 注：DBHub / Filesystem / freeweb-mcp 为基座预装，无需 pip install
    - command: hermes gateway restart
      description: 重载 MCP 配置
```

### 4.2 Skill Pack 安装机制（G2）

**核心思路：** 不发明新命令，复用 Hermes 已有的 `hermes skills install` 命令，扩展其能力。

**当前 `skill_hub_exec` 的子命令白名单：**

```rust
// src-tauri/src/ipc/skill_hub.rs:45
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    "browse", "search", "inspect", "install",
    "uninstall", "list", "check", "update", "audit",
];
```

**扩展方案：** 新增 `pack` 子命令族，加入白名单：

```rust
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    // 原有单 skill 操作
    "browse", "search", "inspect", "install",
    "uninstall", "list", "check", "update", "audit",
    // 新增 Skill Pack 操作
    "pack-install", "pack-uninstall", "pack-list",
    "pack-update", "pack-info",
];
```

**但更好的方案：** 不走 `hermes skills` CLI，而是在 Corey Rust 端直接实现 pack 管理。原因：
1. `hermes skills install` 是安装单个 .md 文件，pack 是一组文件 + 配置变更，语义不同
2. pack 安装需要写 `config.yaml`（MCP 注册），这需要 Corey 的 `write_channel_yaml_fields` 能力
3. pack 安装需要写 Vault，这需要 Corey 的加密存储能力
4. 这些能力在 Hermes CLI 中不存在，在 Corey Rust 端已有

**新增 IPC 命令：**

```rust
// src-tauri/src/ipc/skill_pack.rs（新文件）

/// 安装 Skill Pack
/// - source: 本地路径 / Git URL / 内置包 ID
/// - 返回安装结果（成功/失败/警告列表）
#[tauri::command]
pub async fn skill_pack_install(
    state: State<'_, AppState>,
    source: String,           // 路径、URL 或内置 ID
    options: PackInstallOptions,
) -> IpcResult<PackInstallResult>

/// 卸载 Skill Pack
#[tauri::command]
pub async fn skill_pack_uninstall(
    state: State<'_, AppState>,
    pack_id: String,
) -> IpcResult<()>

/// 列出已安装的 Skill Pack
#[tauri::command]
pub async fn skill_pack_list(
    state: State<'_, AppState>,
) -> IpcResult<Vec<PackSummary>>

/// 获取单个 Skill Pack 详情
#[tauri::command]
pub async fn skill_pack_info(
    state: State<'_, AppState>,
    pack_id: String,
) -> IpcResult<PackDetail>

/// 更新 Skill Pack
#[tauri::command]
pub async fn skill_pack_update(
    state: State<'_, AppState>,
    pack_id: String,
) -> IpcResult<PackInstallResult>
```

**安装流程详细步骤：**

```
skill_pack_install("cross-border-ecom")
│
├─ 1. 解析 source
│   ├─ 内置 ID → 从 Corey resources/skill-packs/ 读取
│   ├─ 本地路径 → 直接读取
│   └─ Git URL → clone 到临时目录
│
├─ 2. 解析 manifest.yaml
│   ├─ 校验必填字段
│   ├─ 校验 id 格式 [a-z0-9-]+
│   ├─ 校验 corey_version 兼容性
│   └─ 校验 depends_on / conflicts_with
│
├─ 3. 检查依赖
│   ├─ depends_on 中的 pack 是否已安装
│   ├─ conflicts_with 中的 pack 是否未安装
│   └─ 不满足 → 返回错误 + 缺失列表
│
├─ 4. 检查基座 MCP 预装状态
│   ├─ 检查 DBHub / Filesystem / freeweb-mcp 是否已注册
│   ├─ 未注册 → 自动安装（npx -y ...），写入 config.yaml
│   └─ 安装失败 → 记录警告，不阻塞
│
├─ 5. 检查 Skill Pack MCP Server 可用性
│   ├─ type: builtin → 检查基座 MCP 是否已注册
│   ├─ type: custom → 检查是否已在 config.yaml
│   ├─ 不在 → 自动注册（写入 config.yaml）
│   └─ 可选的 → 记录到安装结果中提示用户
│
├─ 6. 复制文件
│   ├─ prompts/ → ~/.hermes/skill-packs/<id>/prompts/
│   ├─ skills/  → ~/.hermes/skills/<id>/           ← 已有目录结构
│   ├─ workflows/ → ~/.hermes/skill-packs/<id>/workflows/
│   ├─ schemas/ → ~/.hermes/skill-packs/<id>/schemas/
│   └─ manifest.yaml → ~/.hermes/skill-packs/<id>/manifest.yaml
│
├─ 7. 注册 MCP Server
│   ├─ 遍历 mcp_servers.required
│   ├─ 对每个 config 模板：
│   │   ├─ type: builtin → 跳过（已在步骤 4 预装）
│   │   ├─ type: custom → 替换 ${vault.xxx}/${skill.xxx}，写入 config.yaml
│   │   └─ 调用 mcp_server_upsert 写入 config.yaml
│   └─ 记录哪些 MCP Server 需要用户补充密钥
│
├─ 8. 注册工作流
│   └─ 写入 ~/.hermes/skill-packs/<id>/workflows/
│       （工作流引擎后续扫描此目录）
│
├─ 9. 注册 UI 扩展
│   ├─ 写入 ~/.hermes/skill-packs/<id>/ui.json
│   └─ 前端下次加载时读取并动态渲染
│
├─ 10. 写入安装记录
│   └─ ~/.hermes/skill-packs/installed.json
│       { "cross-border-ecom": { "version": "1.0.0", "installed_at": ... } }
│
└─ 11. 返回 PackInstallResult
    ├─ success: bool
    ├─ warnings: ["需要设置 amazon_access_key", ...]
    ├─ installed_skills: ["listing-optimizer.md", ...]
    ├─ registered_mcp_servers: ["erp-database(dbhub)", "amazon-sp-api(custom)", ...]
    └─ needs_gateway_restart: bool
```

**卸载流程：**

```
skill_pack_uninstall("cross-border-ecom")
│
├─ 1. 读取 manifest.yaml
├─ 2. 检查是否有其他 pack depends_on 本 pack
├─ 3. 删除 ~/.hermes/skills/<id>/ 下的 skill 文件
├─ 4. 删除 ~/.hermes/skill-packs/<id>/ 整个目录
├─ 5. 删除 config.yaml 中本 pack 注册的 MCP Server
│   └─ 只删除标记为 pack 管理的 MCP（不删用户手动添加的）
├─ 6. 从 installed.json 移除记录
└─ 7. 返回 needs_gateway_restart: true
```

### 4.3 Prompt 自动注入机制（G3）

**设计目标：** 安装 Skill Pack 后，AI 对话自动获得行业知识和能力，无需用户手动操作。

**注入位置：** Hermes 的 system prompt 构建过程。

**实现方案：**

Hermes 的 system prompt 由 Hermes CLI 自己构建，Corey 无法直接修改。但 Hermes 支持 `~/.hermes/skills/` 下的 skill 文件被自动加载。我们利用这个机制：

**方案 A（推荐）：利用 Hermes 已有的 skill 加载**

Hermes 启动时会扫描 `~/.hermes/skills/` 下的 `.md` 文件，将其作为可用 skill 注入。我们只需要把行业 prompt 文件放到正确位置：

```
~/.hermes/skills/
├── cross-border-ecom/           ← Skill Pack 安装时创建
│   ├── listing-optimizer.md     ← 自动被 Hermes 加载
│   ├── competitor-analysis.md
│   ├── compliance-checker.md
│   └── ...
├── warehouse/                   ← 另一个 Skill Pack
│   ├── inbound-booking.md
│   └── ...
└── user-custom-skill.md         ← 用户自己创建的 skill
```

**每个 skill .md 文件格式：**

```markdown
---
name: Listing 优化专家
description: 优化 Amazon/Shopify 产品 Listing，提升搜索排名和转化率
tools:
  - amazon-sp-api.get_listings
  - amazon-sp-api.update_listing
  - erp-product-sync.get_sku_info
model: deepseek
---

你是一位跨境电商 Listing 优化专家，拥有 10 年 Amazon 运营经验。

## 核心能力
1. 标题优化：关键词研究 + 可读性平衡
2. 五点描述：卖点提炼 + 痛点覆盖
3. A+ 内容：视觉叙事 + 转化文案
4. Search Terms：长尾词填充策略

## 行业知识
- Amazon A9 算法权重：Title > Bullets > Backend Keywords > Description
- 标题公式：Brand + Core Keyword + Feature + Benefit + Size/Color
- 五点描述：Feature → Benefit → Proof 结构

## 输出规范
- 标题：≤200 字符，首字母大写
- 五点：每点 ≤500 字符，以动词开头
- Search Terms：≤250 字节，不重复标题词
```

**方案 B（备选）：Corey 侧注入 system prompt 片段**

如果 Hermes 不自动加载 skills 目录下的文件作为 system prompt，我们在 Corey 的 MCP 交互层注入：

```rust
// src-tauri/src/skill_pack/prompt_injector.rs（新文件）

/// 构建行业 prompt 注入片段
/// 在每次 AI 对话时，将已安装 Skill Pack 的 system.md 内容
/// 作为附加 system message 注入
pub fn build_pack_system_injection() -> String {
    let packs = list_installed_packs().unwrap_or_default();
    let mut injection = String::new();

    for pack in &packs {
        if let Ok(system_md) = fs::read_to_string(
            pack_dir(&pack.id).join("prompts/system.md")
        ) {
            injection.push_str(&format!(
                "\n\n---\n# 行业知识：{}\n\n{}",
                pack.name, system_md
            ));
        }

        // 追加知识库
        for knowledge in &pack.manifest.prompts.knowledge {
            if let Ok(content) = fs::read_to_string(
                pack_dir(&pack.id).join(knowledge)
            ) {
                injection.push_str(&format!("\n\n{}", content));
            }
        }
    }

    injection
}
```

**注入优先级：**

1. Hermes/Corey 基础 system prompt（不可覆盖）
2. Skill Pack 的 `prompts/system.md`（追加）
3. Skill Pack 的 `prompts/knowledge/*.md`（追加）
4. Skill Pack 的 `prompts/templates/*.md`（作为 few-shot 追加）
5. 用户在对话中的指令（最高优先级）

### 4.4 MCP Server 批量注册 + 环境变量模板（G4）

**当前 `mcp_server_upsert` 的工作方式：**

```rust
// src-tauri/src/ipc/mcp.rs:95
pub async fn mcp_server_upsert(state: State<'_, AppState>, server: McpServer) -> IpcResult<()> {
    // 直接将 server.config 写入 config.yaml 的 mcp_servers.<id> 下
    hermes_config::write_channel_yaml_fields("mcp_servers", &updates, Some(&journal))
}
```

**扩展方案：** 新增模板替换层，在写入前替换占位符：

```rust
// src-tauri/src/skill_pack/mcp_template.rs（新文件）

/// 替换 MCP config 中的模板变量
/// ${vault.xxx} → 从 Vault 读取
/// ${skill.xxx} → 从 Skill Pack settings 读取
/// ${env.xxx}   → 从系统环境变量读取
pub fn resolve_mcp_config(
    config: &serde_json::Value,
    pack_id: &str,
    vault: &dyn VaultStore,
) -> serde_json::Value {
    let mut resolved = config.clone();
    walk_and_replace(&mut resolved, |key, value| {
        if let Some(s) = value.as_str() {
            if s.starts_with("${vault.") && s.ends_with("}") {
                let key = &s[8..s.len()-1];
                if let Ok(v) = vault.get(key) {
                    *value = serde_json::Value::String(v);
                }
                // 缺失的 vault key 保留占位符，安装结果中标记警告
            } else if s.starts_with("${skill.") && s.ends_with("}") {
                let key = &s[8..s.len()-1];
                if let Ok(v) = get_skill_setting(pack_id, key) {
                    *value = serde_json::Value::String(v);
                }
            } else if s.starts_with("${env.") && s.ends_with("}") {
                let key = &s[6..s.len()-1];
                if let Ok(v) = std::env::var(key) {
                    *value = serde_json::Value::String(v);
                }
            }
        }
    });
    resolved
}

/// 批量注册 MCP Server（Skill Pack 安装时调用）
pub fn batch_register_mcp_servers(
    servers: &[McpServerTemplate],
    pack_id: &str,
    vault: &dyn VaultStore,
    journal: &Path,
) -> Result<Vec<String>> {
    let mut warnings = Vec::new();
    let mut updates = HashMap::new();

    for tmpl in servers {
        let resolved = resolve_mcp_config(&tmpl.config, pack_id, vault);

        // 检查是否有未解析的 vault 引用
        check_unresolved_vaults(&resolved, &mut warnings);

        // 标记此 MCP 属于哪个 pack（用于卸载时清理）
        let mut marked = resolved;
        if let Some(obj) = marked.as_object_mut() {
            obj.insert("_managed_by_pack".into(),
                serde_json::Value::String(pack_id.into()));
        }

        updates.insert(tmpl.id.clone(), marked);
    }

    hermes_config::write_channel_yaml_fields("mcp_servers", &updates, Some(journal))?;
    Ok(warnings)
}
```

**卸载时清理：** 只删除 `_managed_by_pack == pack_id` 的 MCP 条目，不删用户手动添加的。

### 4.5 工作流引擎（G5）

**设计目标：** 自动化定时/事件触发的 AI + Tool 工作流。

**工作流定义格式：**

```yaml
# workflows/order_sync.yaml
id: order-sync
name: 订单同步
description: 每2小时从 Amazon 拉取新订单并同步到 ERP
pack_id: cross-border-ecom       # 所属 Skill Pack

trigger:
  type: schedule
  cron: "0 */2 * * *"            # 每2小时
  timezone: Asia/Shanghai
  # 或事件触发：
  # type: event
  # event: mcp:amazon-sp-api:new_order

enabled: true

steps:
  - id: fetch_orders
    type: tool_call               # 调用 MCP tool
    tool: amazon-sp-api.get_orders
    params:
      marketplace: "${skill.amazon_region}"
      since: "{{context.last_run_time}}"
    retry:
      max_attempts: 3
      delay_seconds: 30

  - id: transform
    type: ai_transform            # AI 数据转换
    prompt: |
      将以下 Amazon 订单数据转换为 ERP 标准格式。
      字段映射规则：
      - Amazon Order ID → ERP order_no
      - Buyer Name → customer_name
      - Items → order_lines (需拆分 SKU + qty)
      输出 JSON 格式。
    input: "{{steps.fetch_orders.result}}"
    model: deepseek               # 可指定模型

  - id: sync_to_erp
    type: tool_call
    tool: erp-product-sync.sync_orders
    params:
      orders: "{{steps.transform.result}}"

  - id: notify
    type: notify
    channel: chat                  # 在 Corey 聊天中通知
    message: "✅ 订单同步完成：{{steps.sync_to_erp.result.count}} 笔"
    # channel: email              # 或邮件通知
    # to: ops@example.com

error_handling:
  on_step_failure: notify_and_stop
  notify:
    channel: chat
    message: "❌ 工作流 [{{workflow.name}}] 第 {{failed_step.id}} 步失败：{{error}}"
```

**Rust 实现架构：**

```
src-tauri/src/workflow/
├── mod.rs              # 模块入口
├── engine.rs           # 工作流执行引擎
├── scheduler.rs        # 定时调度器（基于 tokio::time）
├── steps/
│   ├── mod.rs          # Step trait 定义
│   ├── tool_call.rs    # MCP tool 调用 step
│   ├── ai_transform.rs # AI 数据转换 step
│   ├── notify.rs       # 通知 step
│   └── condition.rs    # 条件分支 step
├── template.rs         # {{}} 模板变量替换
└── persistence.rs      # 工作流状态持久化（SQLite）
```

**核心 trait：**

```rust
// src-tauri/src/workflow/steps/mod.rs

#[async_trait]
pub trait StepExecutor: Send + Sync {
    /// 执行一步工作流
    async fn execute(&self, ctx: &StepContext) -> Result<StepOutput>;

    /// 步骤类型名
    fn step_type(&self) -> &str;
}

pub struct StepContext {
    pub workflow_id: String,
    pub step_id: String,
    pub params: serde_json::Value,
    pub previous_outputs: HashMap<String, StepOutput>,
    pub vault: Arc<dyn VaultStore>,
}

pub struct StepOutput {
    pub success: bool,
    pub data: serde_json::Value,
    pub error: Option<String>,
}
```

**调度器：**

```rust
// src-tauri/src/workflow/scheduler.rs

pub struct WorkflowScheduler {
    workflows: Arc<RwLock<HashMap<String, WorkflowDef>>>,
    handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    db: Arc<Db>,
}

impl WorkflowScheduler {
    /// 启动所有 enabled 的工作流
    pub async fn start_all(&self) { ... }

    /// 注册一个工作流（Skill Pack 安装时调用）
    pub async fn register(&self, def: WorkflowDef) { ... }

    /// 注销一个工作流（Skill Pack 卸载时调用）
    pub async fn unregister(&self, workflow_id: &str) { ... }

    /// 手动触发一次执行
    pub async fn trigger(&self, workflow_id: &str) -> Result<RunResult> { ... }
}
```

### 4.6 Vault 密钥管理（G6）

**设计目标：** 安全存储 API Key 等敏感信息，Skill Pack 的 MCP config 通过 `${vault.xxx}` 引用。

**存储方案：** 使用操作系统的密钥链（macOS Keychain / Windows Credential Manager / Linux Secret Service），通过 `keyring` crate 访问。

```rust
// src-tauri/src/vault/mod.rs（新文件）

use keyring::Entry;

pub struct VaultStore {
    /// keyring 服务名，区分不同客户部署
    service_name: String,
}

impl VaultStore {
    pub fn new(service_name: &str) -> Self {
        Self { service_name: service_name.to_string() }
    }

    /// 存储密钥
    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        let entry = Entry::new(&self.service_name, key)?;
        entry.set_password(value)?;
        Ok(())
    }

    /// 读取密钥
    pub fn get(&self, key: &str) -> Result<String> {
        let entry = Entry::new(&self.service_name, key)?;
        Ok(entry.get_password()?)
    }

    /// 删除密钥
    pub fn delete(&self, key: &str) -> Result<()> {
        let entry = Entry::new(&self.service_name, key)?;
        entry.delete_password()?;
        Ok(())
    }

    /// 列出所有密钥名（不返回值）
    pub fn list_keys(&self) -> Result<Vec<String>> {
        // keyring 不支持 list，我们用一个索引文件记录 key 名
        let index_path = self.index_path();
        let content = fs::read_to_string(index_path).unwrap_or_default();
        Ok(content.lines().map(String::from).collect())
    }
}
```

**IPC 命令：**

```rust
#[tauri::command]
pub async fn vault_set(key: String, value: String) -> IpcResult<()>

#[tauri::command]
pub async fn vault_get(key: String) -> IpcResult<String>

#[tauri::command]
pub async fn vault_delete(key: String) -> IpcResult<()>

#[tauri::command]
pub async fn vault_list() -> IpcResult<Vec<String>>
```

**前端 UI：** 在 Settings 页面新增 "密钥管理" 面板，列出所有 vault key，支持增删改，值用密码框显示。

### 4.7 UI 扩展注册 + 动态路由（G7）

**设计目标：** Skill Pack 可以声明侧边栏入口和自定义页面，Corey 前端动态加载。

**实现方案：**

```
src/features/skill-pack/
├── SkillPackRoute.tsx       # 动态路由容器
├── SkillPackSidebar.tsx     # 侧边栏动态入口
├── GenericToolPage.tsx      # 通用工具页面（prompt + 输入 + 输出）
└── PackSettingsPanel.tsx    # Skill Pack 设置面板
```

**侧边栏注入：**

```tsx
// src/features/skill-pack/SkillPackSidebar.tsx

export function SkillPackSidebarItems() {
  const [packs, setPacks] = useState<PackSummary[]>([]);

  useEffect(() => {
    skillPackList().then(setPacks);
  }, []);

  // 从每个 pack 的 manifest.ui.sidebar 读取入口
  const items = packs.flatMap(pack =>
    (pack.ui?.sidebar ?? []).map(item => ({
      packId: pack.id,
      ...item,
    }))
  );

  return (
    <>
      {items.map(item => (
        <SidebarItem
          key={item.id}
          icon={item.icon}
          label={item.label}
          to={item.route}
        />
      ))}
    </>
  );
}
```

**通用工具页面：** 大部分行业功能不需要自定义 React 组件，一个通用的 "prompt + 输入 + AI 输出" 页面即可：

```tsx
// src/features/skill-pack/GenericToolPage.tsx

// 路由：/skill-pack/:packId/:toolId
// 读取 manifest.ui.sidebar 中匹配的 entry
// 加载对应的 skill .md 文件作为 prompt
// 提供输入框 → 调用 AI → 展示输出
```

**自定义页面（高级）：** 如果通用页面不够，Skill Pack 可以提供 React 组件：

```
~/.hermes/skill-packs/cross-border-ecom/ui/
├── listing-optimizer.js     # UMD 格式的 React 组件
└── inventory-dashboard.js
```

Corey 前端通过动态 `import()` 或 `script` 标签加载。这是 Phase 3+ 的高级功能。

### 4.8 定制化交付模型（G8）

**核心思路：一个基座 + 一个配置文件 = 定制产品**

不需要按客户构建不同二进制。所有客户下载同一个 Corey 安装包，我们只需导入一个 `customer.yaml` 配置文件，Corey 启动时自动完成定制化。

```
交付流程：
1. 客户下载标准 Corey 安装包（同一个 dmg/exe）
2. 我们远程或本地导入 customer.yaml
3. Corey 启动 → 检测到 customer.yaml → 自动执行：
   - 安装指定 Skill Pack
   - 注册 MCP Server
   - 应用品牌定制
   - 隐藏内部功能
   - 删除 customer.yaml（不留痕迹）
4. 客户看到的是完整行业产品，找不到任何定制化痕迹
```

**customer.yaml 完整 schema：**

```yaml
# ── 客户信息 ──────────────────────────────────
customer:
  id: acme-logistics              # 客户唯一标识
  name: ACME 智能物流              # 客户名称
  company: ACME 国际物流有限公司    # 公司名

# ── 品牌定制 ──────────────────────────────────
branding:
  app_name: ACME 智能助手          # 显示在标题栏
  logo_url: https://cdn.coreyos.com/branding/acme/logo.png
  primary_color: "#1E40AF"        # 主色调
  accent_color: "#3B82F6"         # 强调色
  # logo 下载后存入 ~/.hermes/branding/logo.png
  # 前端从 customer config 读取路径

# ── Skill Pack 安装 ──────────────────────────
skill_packs:
  - id: tail-logistics            # 尾程物流
    source: builtin               # builtin = Corey 内置 / url = 远程下载
  - id: ltl-delivery              # 卡派
    source: builtin
  - id: quotation                 # 报价
    source: builtin
  # - id: custom-pack
  #   source: https://cdn.coreyos.com/packs/custom-pack-1.0.zip

# ── MCP Server 预配置 ────────────────────────
mcp_servers:
  - id: erp-database
    type: builtin                 # 基座预装的 DBHub
    builtin_provider: dbhub
    config:
      command: npx
      args: ["-y", "@anthropic/dbhub-mcp"]
      env:
        DB_CONNECTION: "${vault.erp_db_connection}"

  - id: carrier-rate-shop
    type: custom
    config:
      command: python
      args: ["-m", "mcp_carrier_rate"]
      env:
        CARRIER_API_KEY: "${vault.carrier_api_key}"

# ── 功能隐藏 ──────────────────────────────────
# 导入后这些功能在 UI 和 CLI 中完全消失
hide:
  - skill_hub                    # Skill Hub 浏览器
  - skill_editor                 # Skill 编辑器
  - mcp_manager                  # MCP 管理页面
  - developer_settings           # 开发者设置
  - pack_management              # Skill Pack 安装/卸载
  - hermes_skill_commands        # hermes skills CLI 子命令

# ── 功能启用 ──────────────────────────────────
show:
  - workflow_dashboard           # 工作流看板
  - vault_ui                     # 密钥管理
  - industry_dashboard           # 行业看板

# ── 密钥预填（可选）──────────────────────────
# 导入时自动写入 Vault，客户无需手动配置
vault:
  erp_db_connection: "postgresql://user:pass@10.0.1.50:5432/erp"
  carrier_api_key: "sk-carrier-xxxx"
  # 敏感值建议通过加密通道传输，不直接写在 yaml 中
  # 也可以只声明 key 列表，让客户在 Vault UI 中填写

# ── 导入后行为 ─────────────────────────────────
import_behavior:
  delete_after_import: true      # 导入完成后删除 customer.yaml
  hide_import_log: true          # 不在日志中记录导入操作
  delete_hermes_skill_history: true  # 清除 hermes skills 命令历史
```

**导入方式：**

```bash
# 方式 1：命令行导入（我们远程执行，客户不知道）
corey import-customer customer.yaml

# 方式 2：文件放置（我们远程拷贝，Corey 下次启动自动检测）
cp customer.yaml ~/.hermes/customer.yaml
# Corey 启动时检测到 → 自动导入 → 导入后删除

# 方式 3：拖拽导入（开发阶段调试用）
# 将 customer.yaml 拖入 Corey 窗口 → 弹窗确认 → 导入
```

**Corey 启动时的自动导入流程：**

```rust
// src-tauri/src/customer_import.rs（新文件）

pub fn check_and_import_customer_config() -> Result<()> {
    let config_path = hermes_data_dir()?.join("customer.yaml");

    if !config_path.exists() {
        return Ok(());  // 无配置，正常启动
    }

    // 1. 解析 customer.yaml
    let config: CustomerConfig = serde_yaml::from_str(&fs::read_to_string(&config_path)?)?;

    // 2. 安装 Skill Pack
    for pack in &config.skill_packs {
        skill_pack::install_from_source(&pack.id, &pack.source)?;
    }

    // 3. 注册 MCP Server
    for server in &config.mcp_servers {
        mcp::batch_register(server)?;
    }

    // 4. 应用品牌定制
    branding::apply(&config.branding)?;

    // 5. 应用功能隐藏
    feature_flags::apply_hide_list(&config.hide, &config.show)?;

    // 6. 预填 Vault
    for (key, value) in &config.vault {
        vault::set(key, value)?;
    }

    // 7. 清除痕迹
    if config.import_behavior.delete_after_import {
        fs::remove_file(&config_path)?;
    }
    if config.import_behavior.delete_hermes_skill_history {
        clear_hermes_skill_history()?;
    }

    // 8. 重启 Gateway 使 MCP 生效
    gateway::restart()?;

    Ok(())
}
```

**"找不到痕迹"策略：**

客户即使翻找 `~/.hermes/` 目录，也找不到任何定制化证据：

| 痕迹 | 处理方式 |
|------|---------|
| `customer.yaml` | 导入后删除 |
| `skill-packs/` 目录 | 正常存在，但看起来就是数据文件，无"插件"标识 |
| `config.yaml` 中的 MCP 条目 | 看起来是正常配置，无 `_managed_by_pack` 标记（客户版本不标记） |
| `hermes skills` 命令 | 从 ALLOWED_SUBCOMMANDS 白名单中移除，命令不存在 |
| Skill Hub UI | 路由不注册，页面不存在 |
| MCP 管理页面 | 路由不注册，页面不存在 |
| 导入日志 | 不写入任何日志文件 |
| `installed.json` | 不生成（客户版本不需要卸载功能） |

**Hermes Agent 也找不到：**

```rust
// 客户版本中，hermes skills 子命令从白名单移除
// src-tauri/src/ipc/skill_hub.rs
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    // 客户版本：清空，或只保留 "list"（只读）
    // 开发者版本：保留全部
];
```

```rust
// 功能隐藏通过 customer.yaml 的 hide 列表驱动
// 不是编译时决定，而是运行时读取
// 但 customer.yaml 导入后删除，所以运行时也无法逆向
pub fn is_feature_hidden(feature: &str) -> bool {
    // 从内部状态读取，而非文件
    // 内部状态在导入时写入内存，持久化为二进制格式
    HIDDEN_FEATURES.contains(feature)
}
```

### 4.9 Feature flag 机制（G9）

**设计原则：**
- **运行时决定**，由 `customer.yaml` 导入后写入内部状态
- 导入后 `customer.yaml` 删除，feature flag 状态持久化为不可读的二进制格式
- 客户无法逆向修改（找不到配置文件，二进制格式不可编辑）
- 默认值面向开发者版本（所有功能可见）

**后端实现：**

```rust
// src-tauri/src/feature_flags.rs

use once_cell::sync::Lazy;
use std::sync::RwLock;

/// 隐藏功能列表（运行时由 customer.yaml 导入写入）
static HIDDEN_FEATURES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::new()));

/// 显示功能列表（运行时由 customer.yaml 导入写入）
static SHOWN_FEATURES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::new()));

/// 导入 customer.yaml 时调用
pub fn apply_hide_list(hide: &[String], show: &[String]) {
    let mut hidden = HIDDEN_FEATURES.write().unwrap();
    let mut shown = SHOWN_FEATURES.write().unwrap();
    *hidden = hide.iter().cloned().collect();
    *shown = show.iter().cloned().collect();

    // 持久化为二进制格式（不可人工编辑）
    persist_feature_state(hide, show);
}

/// 检查功能是否隐藏
pub fn is_hidden(feature: &str) -> bool {
    HIDDEN_FEATURES.read().unwrap().contains(feature)
}

/// 检查功能是否显式启用
pub fn is_shown(feature: &str) -> bool {
    SHOWN_FEATURES.read().unwrap().contains(feature)
}

/// 持久化：写入 ~/.hermes/.state/features.bin
/// 格式：自定义二进制（非 JSON/YAML），不可人工阅读和编辑
fn persist_feature_state(hide: &[String], show: &[String]) {
    let state_path = hermes_data_dir().join(".state").join("features.bin");
    // 写入二进制格式...
}

/// 启动时加载
pub fn load_persisted_state() {
    let state_path = hermes_data_dir().join(".state").join("features.bin");
    if state_path.exists() {
        // 从二进制文件恢复 HIDDEN_FEATURES / SHOWN_FEATURES
    }
}
```

**IPC 暴露给前端：**

```rust
#[tauri::command]
pub async fn feature_flags() -> IpcResult<FeatureFlags> {
    Ok(FeatureFlags {
        hide_skill_hub: is_hidden("skill_hub"),
        hide_skill_editor: is_hidden("skill_editor"),
        hide_mcp_manager: is_hidden("mcp_manager"),
        hide_developer_settings: is_hidden("developer_settings"),
        hide_pack_management: is_hidden("pack_management"),
        enable_workflow_dashboard: is_shown("workflow_dashboard"),
        enable_vault_ui: is_shown("vault_ui"),
        enable_industry_dashboard: is_shown("industry_dashboard"),
    })
}
```

**前端使用：**

```tsx
// src/lib/feature-flags.ts

const flags: FeatureFlags = await invoke('feature_flags');

export function isFeatureEnabled(key: keyof FeatureFlags): boolean {
  return !flags[key];
}

// 在路由中使用
{!isFeatureEnabled('hide_skill_hub') && (
  <Route path="/skills/hub" element={<HubPanel />} />
)}
```

### 4.10 更新策略（G10）

**设计目标：** 客户部署后，我们能远程推送更新，客户端自动/半自动拉取，客户无感知。

#### 核心原则：更新不覆盖数据

Corey 的 App 二进制和数据目录完全分离，更新只替换二进制，**绝不动用户数据**：

```
App 安装目录（更新时替换）          数据目录（更新时不动）
─────────────────────────          ─────────────────────────
/Applications/Corey.app            ~/.hermes/
  └── Contents/MacOS/corey           ├── config.yaml        ← MCP 配置
  └── Resources/                     ├── skills/            ← Skill 文件
                                     ├── skill-packs/       ← Skill Pack
                                     ├── workflows/         ← 工作流状态
                                     ├── vault/             ← 密钥索引
                                     └── db/                ← SQLite 数据库
                                       ├── chat_history.db
                                       └── skill_versions.db
```

**数据保护规则：**

| 数据类型 | 存储位置 | 更新行为 | 说明 |
|---------|---------|---------|------|
| App 二进制 | 安装目录 | ✅ 替换 | Tauri Updater 只替换这个 |
| `config.yaml` | `~/.hermes/` | ❌ 不动 | MCP 配置、客户设置 |
| `skills/*.md` | `~/.hermes/skills/` | ❌ 不动 | 用户可能已修改 |
| `skill-packs/` | `~/.hermes/skill-packs/` | ⚠️ 按需合并 | Skill Pack 更新时走 Layer 2 |
| `vault/` | OS 密钥链 | ❌ 不动 | API Key 等敏感信息 |
| `db/*.db` | `~/.hermes/db/` | ❌ 不动 | 聊天历史、版本历史 |
| `customer.yaml` | `~/.hermes/customer.yaml` | ❌ 不动 | 客户部署配置文件 |
| `workflows/` | `~/.hermes/skill-packs/*/workflows/` | ⚠️ 按需合并 | 工作流定义 |

**config.yaml schema 变更时的迁移策略：**

当 Corey 新版本需要 config.yaml 新增字段时，**不覆盖整个文件**，而是：

```rust
// src-tauri/src/hermes_config.rs — 已有的 write_channel_yaml_fields
// 只 patch 新增字段，不重写整个文件

// 新增：启动时自动迁移
pub fn migrate_config_if_needed() -> Result<()> {
    let current_version = read_config_version()?;
    let app_version = env!("CARGO_PKG_VERSION");

    if current_version < "0.4.0" {
        // 0.3.x → 0.4.0: 新增 workflow 字段
        patch_yaml("workflow_scheduler", default_scheduler_config())?;
    }

    // 更新 config 中的版本标记
    patch_yaml("_config_version", app_version)?;
    Ok(())
}
```

**Skill Pack 更新时的合并策略（Layer 2）：**

```
更新 Skill Pack 时：
1. 备份当前版本 → backup/<version>/
2. 对比新旧 manifest.yaml
3. 新增的文件 → 直接复制
4. 修改的文件 → 用新版本覆盖（用户未修改的）
5. 用户已修改的文件 → 保留用户版本，新版本存为 .new 供参考
6. 删除的文件 → 移到 backup/，不直接删
```

**检测用户是否修改过文件：**

```rust
// 比较文件 hash 与安装时记录的原始 hash
pub fn is_user_modified(path: &Path, pack_id: &str) -> bool {
    let original_hash = get_installed_hash(pack_id, path);
    let current_hash = sha256(path);
    original_hash != current_hash
}
```

**更新分四层，热更新能力各不同：**

```
┌───────────────────────────────────────────────────────────────┐
│  Layer 0: 前端资源热更新（JS/CSS/HTML）                        │
│  → 替换 dist 文件 + webview reload，无需重启 App              │
├───────────────────────────────────────────────────────────────┤
│  Layer 1: Corey 基座更新（Rust 二进制）                        │
│  → Tauri Updater，整包替换，需重启                             │
├───────────────────────────────────────────────────────────────┤
│  Layer 2: Skill Pack 更新（prompt / workflow / schema）       │
│  → 轻量 zip，热加载，无需重启 App                             │
├───────────────────────────────────────────────────────────────┤
│  Layer 3: MCP Server 更新（Python 包 / Node 包）              │
│  → pip/npm 更新，需重启 Gateway（1-2秒）                      │
└───────────────────────────────────────────────────────────────┘
```

**什么能热更新，什么不能：**

| 组件 | 能否热更新 | 原因 | 更新频率 |
|------|-----------|------|---------|
| 前端 JS/CSS/HTML | ✅ 可以 | 替换文件 + reload webview 即可 | 高（周级） |
| Skill Pack prompt/workflow | ✅ 可以 | 替换文件，下次对话自动生效 | 高（周级） |
| MCP Server | ✅ 可以 | pip/npm 更新 + gateway restart（1-2秒） | 中（月级） |
| config.yaml | ✅ 可以 | 运行时重新读取 | 按需 |
| Rust 后端代码 | ❌ 不能 | 二进制必须替换，需重启 | 低（月级） |
| Tauri 框架升级 | ❌ 不能 | 二进制必须替换，需重启 | 低（季度） |

**关键洞察：** 绝大多数更新（UI 优化、prompt 调优、工作流调整、MCP 修复）都不需要重启 App。只有 Rust 代码变更才需要重启，而这种变更频率很低。

#### Layer 0：前端资源热更新（新增）

Tauri 的前端是本地 HTML/JS/CSS 文件，由 webview 加载。替换这些文件后 reload webview，等于热更新了整个 UI。

**实现方案：**

```
App 安装目录（不可写）              数据目录（可写）
─────────────────────              ─────────────────────
/Applications/Corey.app            ~/.hermes/
  └── Resources/                     ├── web/              ← 热更新目标
      └── dist/                        ├── index.html
          ├── index.html               ├── assets/
          └── assets/                  │   ├── index-abc123.js  ← 新版本
              ├── index-abc123.js       │   └── index-def456.css
              └── index-def456.css      └── hot-update.json
```

**热更新流程：**

```
1. 检查更新服务器 → 发现新前端版本
2. 下载新 dist 文件到 ~/.hermes/web/
3. 写入 hot-update.json 记录新版本号
4. 调用 webview.reload()（Tauri API）
5. 前端重新加载 → 从 ~/.hermes/web/ 读取新文件
6. 用户无感知，对话历史不丢失（存在 Rust 后端内存中）
```

**Rust 端实现：**

```rust
// src-tauri/src/hot_update.rs（新文件）

use tauri::Manager;

/// 检查并应用前端热更新
pub fn check_and_apply_hot_update(app: &tauri::App) -> Result<bool> {
    let hot_update_marker = hermes_data_dir()?.join("web/hot-update.json");

    if !hot_update_marker.exists() {
        return Ok(false);  // 无热更新
    }

    let meta: HotUpdateMeta = serde_json::from_str(&fs::read_to_string(&hot_update_marker)?)?;
    let current_version = env!("CARGO_PKG_VERSION");

    if meta.target_corey_version != current_version {
        // 热更新与当前 Rust 版本不兼容，忽略
        return Ok(false);
    }

    // 切换 webview 的资源目录到 ~/.hermes/web/
    // Tauri 支持自定义 asset protocol，重定向到新目录
    if let Some(webview) = app.get_webview_window("main") {
        // 通过自定义 asset protocol 提供文件
        // 优先从 ~/.hermes/web/ 读取，fallback 到内置 dist/
        webview.eval("window.location.reload()")?;
    }

    Ok(true)
}

/// Tauri 自定义 asset protocol：优先读热更新目录
pub fn resolve_asset(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Cow<[u8]>> {
    let uri = request.uri().to_string();

    // 1. 先查 ~/.hermes/web/ （热更新目录）
    let hot_path = hermes_data_dir().join("web").join(&uri);
    if hot_path.exists() {
        let content = fs::read(&hot_path).unwrap();
        return tauri::http::Response::builder()
            .body(content.into())
            .unwrap();
    }

    // 2. Fallback 到内置 dist/
    let builtin = std::include_bytes!(concat!(env!("OUT_DIR"), "/dist", uri));
    tauri::http::Response::builder()
        .body(builtin.into())
        .unwrap()
}
```

**hot-update.json 格式：**

```json
{
  "version": "0.4.1-hotfix1",
  "target_corey_version": "0.4.0",
  "applied_at": null,
  "files": [
    "assets/index-abc123.js",
    "assets/index-def456.css",
    "index.html"
  ],
  "signature": "dW50cnVzdGVkLWNvbW1lbnQ6..."
}
```

**热更新包结构（我们发布）：**

```
hot-update-0.4.1-hotfix1.zip
├── index.html
├── assets/
│   ├── index-abc123.js      # 新版 JS
│   └── index-def456.css     # 新版 CSS
└── hot-update.json          # 元信息
```

**IPC 命令：**

```rust
#[tauri::command]
pub async fn hot_update_check() -> IpcResult<Option<HotUpdateInfo>>

#[tauri::command]
pub async fn hot_update_apply() -> IpcResult<()>  // 下载 + 解压 + reload

#[tauri::command]
pub async fn hot_update_rollback() -> IpcResult<()>  // 删除 ~/.hermes/web/，reload
```

**热更新 vs 整包更新的选择策略：**

```
发布新版本时，判断用哪种更新：

┌─ 只改了前端（UI 优化、文案、样式）？
│  YES → 发布 hot-update.zip（Layer 0），用户无感知
│
├─ 只改了 Skill Pack / prompt？
│  YES → 发布 Skill Pack 更新（Layer 2），用户无感知
│
├─ 只改了 MCP Server？
│  YES → 发布 MCP 更新（Layer 3），Gateway 重启 1-2 秒
│
└─ 改了 Rust 代码（新 IPC、新功能、性能优化）？
   YES → 发布整包更新（Layer 1），需重启 App
```

**实际场景举例：**

| 变更内容 | 更新方式 | 用户感知 |
|---------|---------|---------|
| 修复工作流看板 UI bug | Layer 0 热更新 | 无感知 |
| 优化 Listing prompt 效果 | Layer 2 Skill Pack 更新 | 无感知 |
| 新增一个 MCP tool | Layer 3 MCP 更新 | Gateway 重启 1-2秒 |
| 新增 Vault 密钥管理 IPC | Layer 1 整包更新 | 需重启 App |
| Tauri 版本升级 | Layer 1 整包更新 | 需重启 App |

#### Layer 1：Corey 基座更新

**已有基础设施：** Corey 已集成 `tauri-plugin-updater`，更新流程全自动。

```rust
// src-tauri/src/lib.rs:94 — 已有
.plugin(tauri_plugin_updater::Builder::new().build())

// src-tauri/tauri.conf.json:59 — 已有
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/zbin0929/CoreyOS/releases/latest/download/latest.json"],
    "pubkey": "..."
  }
}
```

**Tauri Updater 自动处理的事（不需要我们开发）：**
- ✅ 定时检查新版本（24h 轮询）
- ✅ 下载安装包（macOS: .app.tar.gz, Windows: .exe）
- ✅ ed25519 签名验证
- ✅ 弹窗提示用户"是否更新"
- ✅ 替换 App 二进制 + 自动重启
- ✅ 跨平台差异（macOS/Windows 各自的安装逻辑）

**我们只需要做的事：**

| 待办 | 说明 | 优先级 |
|------|------|--------|
| 配置 CI 发布流程 | 打 tag → GitHub Actions 构建 → 上传 Release → 生成 latest.json | P0 |
| 购买代码签名证书 | macOS: Apple Developer ID ($99/年), Windows: EV 证书 (~$300/年) | P0 |

> **关于白标 endpoint：** 初期不需要。所有客户用同一个 Corey 基座，更新统一从 GitHub Releases 推送。差异化由 customer.yaml（Skill Pack / 功能隐藏）控制，不由基座版本控制。只有 Phase 4+ 需要灰度发布或按客户控制升级节奏时，才搭建 `update.coreyos.com` 替换 endpoint。

**没有代码签名的后果：**
- macOS：Gatekeeper 阻止打开，用户必须右键 → 打开 → 确认
- Windows：SmartScreen 弹出"未知发布者"蓝色警告

**CI 发布流程（待配置）：**

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    strategy:
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install -g pnpm && pnpm install
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: ${{ matrix.args }} }
      - run: pnpm tauri build ${{ matrix.args }}
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
      - uses: tauri-apps/tauri-action@v0
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Corey ${{ github.ref_name }}'
          releaseDraft: true
```

#### Layer 2：Skill Pack 更新（轻量，热加载）

Skill Pack 更新不需要重装 App，只需替换文件：

```
┌──────────────┐     GET /api/v1/pack-updates?customer=acme&installed=tail-logistics@1.0.0,ltl-delivery@2.1.0
│  更新服务器   │ ←───────────────────────────────────────────────────────────
│  (我们维护)    │ ──────────────────────────────────────────────────────────→
└──────────────┘     200 {
                       "updates": [
                         {
                           "pack_id": "tail-logistics",
                           "version": "1.1.0",
                           "download_url": "https://update.coreyos.com/packs/tail-logistics/1.1.0.zip",
                           "signature": "dW50cnVzdGVk...",
                           "changelog": "新增 POD 自动确认工作流"
                         }
                       ]
                     }
```

**客户端更新流程：**

```
1. 每 24 小时轮询 /api/v1/pack-updates
2. 发现新版本 → 下载 zip → ed25519 验证签名
3. 备份当前版本 → ~/.hermes/skill-packs/<id>/backup/<version>/
4. 解压覆盖 → ~/.hermes/skill-packs/<id>/
5. 同步更新 skills/ 目录下的 .md 文件
6. 如有 MCP config 变更 → 更新 config.yaml
7. 热重载（无需重启 App）：
   - Prompt 注入：下次对话自动使用新 prompt
   - 工作流：重新加载工作流定义
   - MCP：调用 hermes gateway restart
8. 更新 installed.json 中的版本号
9. 失败 → 自动回滚到 backup 版本
```

**IPC 命令：**

```rust
#[tauri::command]
pub async fn skill_pack_check_updates() -> IpcResult<Vec<PackUpdateInfo>>

#[tauri::command]
pub async fn skill_pack_apply_update(pack_id: String) -> IpcResult<()>
```

**前端 UI（开发者版本可见，客户版本隐藏）：**

Settings → 更新 页面：
- 基座版本 + 检查更新按钮（已有）
- Skill Pack 版本列表 + 更新按钮（新增）
- 自动更新开关（新增）

#### Layer 3：MCP Server 更新

MCP Server 是 Python/Node 包，更新方式：

| MCP 类型 | 更新方式 | 说明 |
|---------|---------|------|
| **builtin（基座预装）** | `npx -y <pkg>@latest` | npx 自动拉取最新版，无需管理 |
| **custom（自研 Python）** | `pip install --upgrade mcp_xxx` | Skill Pack 更新钩子中声明 |

**manifest.yaml 中声明 MCP 更新源：**

```yaml
mcp_servers:
  required:
    - id: amazon-sp-api
      type: custom
      config: { ... }
      update:
        method: pip
        package: mcp_amazon_sp_api
        # 或 method: git
        # repo: https://github.com/our-org/mcp-amazon-sp-api
        # ref: main
```

**更新流程：**
1. Skill Pack 更新时（Layer 2），检查 `mcp_servers.*.update` 声明
2. 执行 `pip install --upgrade <package>` 或 `git pull`
3. 重启 Gateway 使新 MCP 生效

#### 更新策略矩阵

| 场景 | Layer 0（前端热更新） | Layer 1（基座） | Layer 2（Skill Pack） | Layer 3（MCP Server） |
|------|---------------------|---------------|---------------------|---------------------|
| **自动更新** | ✅ 轮询 + 自动下载 | ✅ Tauri Updater | ✅ 轮询 + 自动下载 | ❌ 需重启 Gateway |
| **用户感知** | 无感知（webview reload） | 需重启 App | 无感知（热加载） | 需重启 Gateway（1-2秒） |
| **回滚** | 删除 ~/.hermes/web/ | 安装旧版安装包 | 自动回滚 backup/ | pip install <old_version> |
| **签名验证** | ed25519 | ed25519 | ed25519 | pip/npm 自有校验 |
| **频率** | 高（周级） | 低（月级） | 高（周级） | 中（月级） |
| **强制更新** | 可配置 | 可配置 | 可配置 | 可配置 |
| **包大小** | ~500KB-2MB | ~50-100MB | ~50-500KB | ~1-10MB |

#### 初期落地方案（Phase 1-3）

Phase 1-3 不搭建更新服务器，采用**手动更新**：

```
方式 1：远程 SSH
  我们 SSH 到客户机器 → 执行更新脚本
  适合：有服务器部署的客户

方式 2：更新包
  我们打包一个 update.zip（含 Skill Pack + MCP 更新）
  发给客户 → 客户运行 update.sh / update.ps1
  适合：本地部署的客户

方式 3：Tauri Updater（已有）
  基座更新走 GitHub Releases → 客户端自动检测
  适合：所有客户
```

**更新脚本模板：**

```bash
#!/bin/bash
# scripts/update-pack.sh — 手动更新 Skill Pack
set -euo pipefail

PACK_ID="$1"
VERSION="$2"
UPDATE_ZIP="$3"  # 本地路径或 URL

echo "🔄 更新 Skill Pack: $PACK_ID → $VERSION"

# 1. 备份
BACKUP_DIR="$HOME/.hermes/skill-packs/$PACK_ID/backup/$(date +%Y%m%d%H%M%S)"
cp -r "$HOME/.hermes/skill-packs/$PACK_ID" "$BACKUP_DIR"

# 2. 解压覆盖
unzip -o "$UPDATE_ZIP" -d "$HOME/.hermes/skill-packs/$PACK_ID"

# 3. 同步 skills 目录
cp -r "$HOME/.hermes/skill-packs/$PACK_ID/skills/"*.md \
      "$HOME/.hermes/skills/$PACK_ID/"

# 4. 更新 MCP（如有）
if [ -f "$HOME/.hermes/skill-packs/$PACK_ID/mcp-servers/requirements.txt" ]; then
  pip install --upgrade -r "$HOME/.hermes/skill-packs/$PACK_ID/mcp-servers/requirements.txt"
fi

# 5. 重启 Gateway
hermes gateway restart

echo "✅ 更新完成: $PACK_ID@$VERSION"
echo "   备份位置: $BACKUP_DIR"
```

#### Phase 4：自动更新服务

搭建 `update.coreyos.com` 更新服务：

```
update.coreyos.com/
├── api/v1/
│   ├── check          # 基座版本检查（兼容 Tauri Updater 协议）
│   ├── pack-updates   # Skill Pack 版本检查
│   └── artifacts/     # 下载 CDN
├── dashboard/         # 管理后台（我们用）
│   ├── customers/     # 客户列表 + 版本状态
│   ├── packs/         # Skill Pack 版本管理
│   └── releases/      # 基座版本发布
└── auth/              # 客户身份验证（license key 绑定）
```

**客户身份验证：** 更新请求携带 license 机器指纹，服务端验证后才返回下载链接：

```
GET /api/v1/pack-updates?customer=acme&machine_id=5a4b2c56-286b-4ea5-9c67-83a6e5851f41
Authorization: Bearer <license_token>
```

**管理后台功能：**
- 查看所有客户当前版本
- 按客户推送指定 Skill Pack 更新
- 按行业批量推送更新
- 查看更新成功率/失败率
- 紧急回滚指定版本

---

## 5. 行业 Skill Pack 详细规划

### 5.1 跨境电商（首个落地包）

**目标用户：** Amazon / Shopify 卖家运营团队

**目录结构：**

```
skill-packs/cross-border-ecom/
├── manifest.yaml
├── prompts/
│   ├── system.md                    # 行业角色定义
│   ├── knowledge/
│   │   ├── amazon_policy.md         # Amazon 平台政策要点
│   │   ├── compliance.md            # 跨境合规（FDA/CE/FCC）
│   │   ├── glossary.md              # 行业术语表
│   │   └── hs_code_guide.md         # HS 编码指南
│   └── templates/
│       ├── listing.md               # Listing 输出模板
│       └── appeal_letter.md         # 申诉信模板
├── skills/
│   ├── listing-optimizer.md         # Listing 优化专家
│   ├── competitor-analysis.md       # 竞品分析
│   ├── compliance-checker.md        # 合规检查
│   ├── inventory-advisor.md         # 库存补货建议
│   └── ad-optimizer.md             # 广告优化
├── workflows/
│   ├── order_sync.yaml
│   ├── inventory_alert.yaml
│   └── weekly_report.yaml
├── schemas/
│   ├── product.schema.json
│   └── order.schema.json
└── mcp-servers/
    └── mcp_amazon_sp_api/           # Python MCP Server（自研）
        ├── __init__.py
        ├── server.py
        └── requirements.txt
    # 注：erp-product-sync 已被基座预装的 DBHub 替代
    # 只需在 manifest.yaml 中声明 type: builtin + dbhub 即可
    # 无需自研，节省 3 天开发量
```

**核心场景详细设计：**

#### 场景 1：Listing 优化

```
用户输入："帮我优化这个产品的 Listing"
AI 行为：
1. 调用 amazon-sp-api.get_listings → 获取当前 Listing
2. 调用 erp-database(DBHub) 查询产品属性 → 获取 SKU 信息
3. 使用 listing-optimizer.md 的 prompt 生成优化方案
4. 展示对比（当前 vs 优化后）
5. 用户确认 → 调用 amazon-sp-api.update_listing
```

#### 场景 2：库存补货

```
触发方式：工作流 inventory_alert.yaml（每日检查）
AI 行为：
1. 调用 amazon-sp-api.get_inventory → 获取 FBA 库存
2. 调用 erp-database(DBHub) 查询销量数据 → 获取近 30 天销量
3. 使用 inventory-advisor.md 的 prompt 计算补货建议
4. 库存低于阈值 → 在聊天中推送补货建议
5. 用户确认 → 调用 amazon-sp-api.create_fba_shipment
```

#### 场景 3：合规检查

```
用户输入："这个产品能卖到欧盟吗？"
AI 行为：
1. 调用 erp-database(DBHub) 查询产品属性 → 获取 SKU 详情
2. 使用 compliance-checker.md + compliance.md 知识
3. 检查 CE/FCC/REACH 合规要求
4. 输出合规报告 + 需要的认证清单
```

### 5.2 海外仓

**核心场景 + skill 文件：**

| 场景 | Skill 文件 | MCP Tool | 工作流 |
|------|-----------|----------|--------|
| 入库预约 | `inbound-booking.md` | `wms.create_inbound`, `wms.check_capacity` | 新品到货自动预约 |
| 库存查询 | `inventory-query.md` | `wms.query_inventory`, `wms.get_stock_alerts` | 库存水位监控 |
| 拣货优化 | `pick-optimize.md` | `wms.suggest_pick_path`, `wms.confirm_pick` | — |
| 出库打单 | `outbound-label.md` | `wms.create_outbound`, `carrier.generate_label` | 订单自动打单 |
| 盘点 | `stocktake.md` | `wms.initiate_stocktake`, `wms.report_variance` | 月度盘点提醒 |

### 5.3 尾程物流

| 场景 | Skill 文件 | MCP Tool | 工作流 |
|------|-----------|----------|--------|
| 比价打单 | `rate-shop.md` | `carrier.get_rates`, `carrier.generate_label` | — |
| 轨迹追踪 | `tracking.md` | `carrier.get_tracking`, `carrier.subscribe_updates` | 异常件预警 |
| 异常处理 | `exception-handle.md` | `carrier.report_exception`, `carrier.request_refund` | 异常件自动建工单 |
| POD 确认 | `pod-confirm.md` | `carrier.get_pod`, `wms.confirm_delivery` | POD 到账自动对账 |

### 5.4 头程

| 场景 | Skill 文件 | MCP Tool | 工作流 |
|------|-----------|----------|--------|
| 订舱 | `booking.md` | `shipping.create_booking`, `shipping.get_schedules` | — |
| 提单草拟 | `bl-draft.md` | `shipping.generate_bl`, `shipping.validate_bl` | — |
| 报关申报 | `customs-decl.md` | `customs.create_declaration`, `customs.check_hs_code` | — |
| 到港通知 | `arrival-notice.md` | `shipping.get_eta`, `shipping.notify_arrival` | 到港自动通知 |

### 5.5 卡派

| 场景 | Skill 文件 | MCP Tool | 工作流 |
|------|-----------|----------|--------|
| LTL 报价 | `ltl-quote.md` | `ltl.get_rates`, `ltl.compare_carriers` | — |
| 预约送仓 | `appointment.md` | `warehouse.schedule_delivery`, `warehouse.get_slots` | — |
| 交货证明 | `delivery-proof.md` | `ltl.confirm_delivery`, `ltl.get_pod` | 交货自动通知 |

### 5.6 客服

| 场景 | Skill 文件 | MCP Tool | 工作流 |
|------|-----------|----------|--------|
| 工单处理 | `ticket-handle.md` | `ticket.create`, `ticket.update`, `ticket.escalate` | 新工单自动分类 |
| SLA 监控 | `sla-monitor.md` | `ticket.check_sla`, `ticket.get_breach_risk` | SLA 预警 |
| 自动回复 | `auto-reply.md` | `ticket.draft_reply`, `ticket.send_reply` | 常见问题自动草拟 |
| 升级流转 | `escalation.md` | `ticket.escalate`, `ticket.assign` | 超时自动升级 |

### 5.7 报价

| 场景 | Skill 文件 | MCP Tool | 工作流 |
|------|-----------|----------|--------|
| 运费计算 | `rate-calc.md` | `rate.calculate`, `rate.get_surcharges` | — |
| 利润校验 | `margin-check.md` | `rate.calc_margin`, `rate.suggest_price` | — |
| 报价单生成 | `quote-gen.md` | `quote.generate_pdf`, `quote.send_email` | — |
| 历史报价 | `quote-history.md` | `quote.search_history`, `quote.get_trends` | — |

### 5.8 财务

| 场景 | Skill 文件 | MCP Tool | 工作流 |
|------|-----------|----------|--------|
| 开票 | `invoice-gen.md` | `invoice.create`, `invoice.send` | 发票自动生成 |
| 对账 | `reconciliation.md` | `recon.match_payment`, `recon.flag_discrepancy` | 每日自动对账 |
| 汇兑 | `fx-hedge.md` | `fx.get_rate`, `fx.suggest_hedge` | 汇率预警 |
| 应收应付 | `ar-ap.md` | `invoice.list_ar`, `invoice.list_ap` | 账龄分析 |

---

## 6. 商业模式

**核心原则：一个基座 + 一个 customer.yaml = 定制产品，导入后痕迹全无。**

```
交付流程：
┌────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Corey 基座  │  +  │ customer.yaml│  →  │ 客户专属行业 AI 产品  │
│ (统一安装包) │     │ (我们导入)    │     │ (客户找不到定制痕迹)  │
└────────────┘     └──────────────┘     └─────────────────────┘
```

```
┌──────────────────────────────────────────────┐
│              Corey 基座（统一二进制）           │
│  AI 对话 + MCP 网关 + 工作流 + 沙箱           │
├──────────────────────────────────────────────┤
│    基座预装 MCP（开源免费，所有部署自带）        │
│  DBHub · Filesystem · freeweb-mcp            │
├──────────────────────────────────────────────┤
│         Skill Pack（内置，按需激活）            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 跨境电商  │  │ 海外仓    │  │ 尾程物流  │   │
│  └──────────┘  └──────────┘  └──────────┘   │
├──────────────────────────────────────────────┤
│    行业专属 MCP（自研，随 Skill Pack 激活）     │
│  amazon-sp-api  carrier-api  ticket-crud     │
└──────────────────────────────────────────────┘
```

**交付模式：**

| 层级 | 内容 | 说明 |
|------|------|------|
| 基座 | Corey 统一安装包 | 所有客户下载同一个 dmg/exe |
| customer.yaml | 定制配置文件 | 我们导入后自动删除，客户找不到 |
| 基座 MCP | DBHub + Filesystem + freeweb-mcp | 开源免费，所有部署自带 |
| Skill Pack | 行业 prompt + 工作流模板 | 内置在基座中，按 customer.yaml 激活 |
| 行业 MCP | 外部系统对接（自研） | 随 Skill Pack 激活，开发量已大幅降低 |
| 定制开发 | 专属 MCP Server + UI | 项目制收费 |

**部署策略：白标交付，痕迹全无**

- 客户下载的是标准 Corey 安装包，和开发者版本一模一样
- 我们导入 customer.yaml → 自动安装 Skill Pack + MCP + 品牌定制 + 功能隐藏
- 导入后 customer.yaml 删除，功能隐藏状态写入不可读的二进制文件
- 客户看到的：一个完整的行业 AI 产品，品牌可定制
- 客户看不到的：Skill Pack 安装机制、MCP Store、manifest.yaml、customer.yaml
- Hermes Agent 也找不到：`hermes skills` 命令被移除，Skill Hub 页面不存在
- 客户如需新功能 → 找我们做定制开发 → 我们导入新的 customer.yaml → 更新部署

---

## 7. 落地路线图

### 前置条件（与 Phase 1 并行推进）

**SP-API 开发者账号注册（1-2 周）：**

| 步骤 | 操作 | 负责人 | 说明 |
|------|------|--------|------|
| 1 | 注册 Amazon Developer Central | 产品/运营 | https://developer.amazonservices.com/ |
| 2 | 创建 SP-API 应用 | 开发 | 填写应用名称、描述、用例说明 |
| 3 | 填写用例说明 | 产品 | 参考模板："AI-powered advertising optimization tool for sellers" |
| 4 | 提交审核 | — | Amazon 审核 1-2 周 |
| 5 | 获取 LWA 凭证 | 开发 | `CLIENT_ID` + `CLIENT_SECRET` |
| 6 | 实现 OAuth 授权流程 | 开发 | 卖家点击授权链接 → 回调获取 `REFRESH_TOKEN` |
| 7 | 测试 API 调用 | 开发 | 用测试店铺验证广告/库存/订单 API |

**用例说明参考模板（提高审核通过率）：**

```
Application Name: CoreyOS AI Operations Assistant
Description: AI-powered operations assistant for Amazon sellers.
Use Case: Our application helps sellers optimize advertising campaigns,
monitor inventory levels, and analyze profitability. We use SP-API to:
1. Advertising: Read campaign/keyword/search term reports to identify
   wasteful keywords and suggest negative keyword additions.
2. Inventory: Read FBA inventory levels and sales velocity to predict
   stockout risks and recommend replenishment timing.
3. Settlement: Read settlement reports to calculate per-SKU profitability
   including FBA fees, advertising costs, and referral fees.

We do NOT modify listings, prices, or inventory without explicit seller
confirmation. All data is processed locally on the seller's machine.
Data is never shared with third parties.
```

### Phase 1：Skill Pack 基础设施（1-2 周）

**目标：** 让 Corey 能安装、管理、加载 Skill Pack

| 任务 | 涉及文件 | 工作量 |
|------|---------|--------|
| 定义 manifest.yaml schema | `docs/manifest-schema.yaml`（新） | 0.5 天 |
| 新建 skill_pack Rust 模块 | `src-tauri/src/skill_pack/`（新） | 2 天 |
| 实现 skill_pack_install IPC | `src-tauri/src/ipc/skill_pack.rs`（新） | 2 天 |
| 实现 skill_pack_uninstall/list/info IPC | 同上 | 1 天 |
| 实现 MCP 批量注册 + 模板替换 | `src-tauri/src/skill_pack/mcp_template.rs`（新） | 1.5 天 |
| 实现 Vault 密钥管理 | `src-tauri/src/vault/`（新），依赖 `keyring` crate | 1.5 天 |
| 前端 IPC 封装 | `src/lib/ipc/skill-pack.ts`（新） | 0.5 天 |
| 前端 Skill Pack 管理页面 | `src/features/skill-pack/`（新） | 2 天 |
| 前端 Vault 管理面板 | `src/features/settings/VaultPanel.tsx`（新） | 1 天 |
| 编写 Skill Pack 开发文档 | `docs/skill-pack-dev-guide.md`（新） | 1 天 |

**Phase 1 交付物：**
- Corey 可以安装/卸载/列出 Skill Pack
- MCP Server 自动注册到 config.yaml
- Vault 密钥存储可用
- 前端有管理界面

### Phase 2：首个行业包 — 跨境电商第一期（2-3 周）

**依赖：** Phase 1 完成 + SP-API 注册通过

**mcp-amazon-sp 开发技术方案：**

```python
# 技术栈：Python 3.11+ + mcp-sdk + amazon-sp-api
# 安装：pip install mcp-amazon-sp

# mcp_amazon_sp/server.py 核心结构：

from mcp.server import Server
from amazon_sp_api import SPAPIClient

server = Server("amazon-sp")

@server.tool("list_ad_campaigns")
async def list_ad_campaigns(profile_id: str) -> list[dict]:
    """列出卖家的所有广告活动"""
    client = SPAPIClient(
        client_id=os.environ["LWA_CLIENT_ID"],
        client_secret=os.environ["LWA_CLIENT_SECRET"],
        refresh_token=os.environ["AMAZON_REFRESH_TOKEN"],
        region=os.environ.get("AMAZON_REGION", "NA"),
    )
    return await client.advertising.list_campaigns(profile_id)

@server.tool("get_search_term_report")
async def get_search_term_report(
    campaign_id: str,
    start_date: str,
    end_date: str,
) -> list[dict]:
    """获取搜索词报告（用于找废词）"""
    # 返回: [{keyword, search_term, clicks, impressions, cost, orders, acos}, ...]

@server.tool("add_negative_keywords")
async def add_negative_keywords(
    campaign_id: str,
    keywords: list[str],
    match_type: str = "exact",  # exact | phrase
) -> dict:
    """添加否定关键词（一键否词）"""
    # 执行后返回: {success: true, added: 3}
```

**ERP 数据对接方案（零自研）：**

```
客户 ERP 数据库（MySQL/PostgreSQL/Oracle）
  ↓
DBHub MCP（基座预装，配置连接串即可）
  ↓
LLM 用自然语言查询 ERP 数据
  ↓
例如："查询 SKU-A 的近 30 天日均销量"
  → DBHub 自动生成 SQL: SELECT AVG(daily_qty) FROM order_lines WHERE sku='SKU-A' AND date > NOW()-30
  → 返回结果给 LLM
```

| 任务 | 工作量 | 说明 |
|------|--------|------|
| 编写跨境电商 manifest.yaml + 3 个机器人 prompt | 2 天 | 广告守卫/库存哨兵/利润分析 |
| 编写 4 个知识库 .md（政策/合规/术语/FBA规则） | 1 天 | 行业专家可参与编写 |
| 开发 `mcp-amazon-sp` Python MCP Server | 5 天 | 广告/库存/订单/报告 API |
| ERP 对接（DBHub 配置，非自研） | 0.5 天 | 只需配置连接串 |
| 实现 3 个工作流 YAML（广告巡检/库存巡检/利润日报） | 1 天 | 定时触发 + IM 推送 |
| Prompt 注入验证（对话中行业知识是否生效） | 1 天 | 端到端测试 |
| 端到端测试 | 2 天 | 真实数据验证 |

**Phase 2 交付物：**
- 完整的跨境电商 Skill Pack（第一期：3 个机器人）
- 1 个自研 MCP Server（mcp-amazon-sp）+ 1 个零配置 MCP（DBHub 连 ERP）
- AI 对话中具备跨境电商专业知识
- 工作流定时巡检 + IM 推送

**IM 推送一键执行的技术实现：**

```
用户在微信/钉钉收到广告守卫推送
  ↓
用户回复 "否词" 或 "确认"
  ↓
Hermes Gateway 收到消息 → 匹配到机器人
  ↓
机器人识别为执行指令 → 调用 mcp-amazon-sp.add_negative_keywords
  ↓
执行结果推送到 IM："✅ 已添加 3 个否定关键词"
```

实现方式：在 `ad-guardian.md` prompt 中定义指令识别规则：

```markdown
## 指令识别
当用户回复包含"否词"、"确认"、"执行"时：
1. 提取上下文中的废词列表（上一条推送中的 ❌ 标记项）
2. 调用 amazon-sp.add_negative_keywords 工具
3. 将执行结果格式化后回复用户
```

### Phase 3：模板化复制（持续）

每个新行业包的步骤（以海外仓为例）：

| 步骤 | 工作量 |
|------|--------|
| 编写 manifest.yaml + skill .md 文件 | 2 天 |
| 编写知识库 .md | 1 天 |
| 开发 2-3 个 MCP Server | 5-8 天 |
| 编写工作流 YAML | 1 天 |
| 测试 | 2 天 |

**并行开发策略：**
- prompt/知识库部分可以由行业专家编写（不需要开发能力）
- MCP Server 用脚手架生成（10 分钟出模板），只需填 API 对接逻辑
- 工作流 YAML 是纯配置

### Phase 4：白标部署体系（2-3 周）

| 任务 | 工作量 |
|------|--------|
| customer.yaml schema + 解析 | 0.5 天 |
| 自动导入流程（`check_and_import_customer_config`） | 2 天 |
| 功能隐藏机制（Rust + 前端，运行时驱动） | 2 天 |
| 品牌定制（App 名称/Logo/配色，运行时应用） | 1 天 |
| 痕迹清除（删除 yaml、清除历史、二进制持久化） | 1 天 |
| 测试：标准安装包 + 导入 customer.yaml → 完整行业产品 | 2 天 |

### Phase 5：跨境电商第二期 — 差评 + 竞品（2 周）

| 任务 | 工作量 | 说明 |
|------|--------|------|
| 接入第三方 Reviews API（Jungle Scout / Helium10） | 3 天 | 或自建爬虫方案 |
| 差评监控机器人 prompt + 工作流 | 2 天 | 实时差评推送 + AI 分析 |
| 竞品雷达机器人（SP-API Catalog + Puppeteer） | 5 天 | 价格/Buy Box 用 API，Coupon/主图用爬虫 |
| ASIN 诊断机器人（综合所有数据） | 3 天 | 六维诊断 + 红绿灯 |
| 一键执行（IM 回复"确认"自动操作） | 3 天 | 否词/调价/清仓 |
| 端到端测试 | 2 天 | 真实店铺数据验证 |

### Phase 6：多平台 + 超越麦多（持续）

| 任务 | 说明 |
|------|------|
| Shopify MCP Server | 对接 Shopify Admin API |
| Temu MCP Server | 对接 Temu Seller API |
| TikTok Shop MCP Server | 对接 TikTok Shop API |
| AI 生图 | 产品场景图生成（拍照 → 场景图） |
| 远程更新服务 | 搭建 update.coreyos.com |

---

## 8. 技术约束与风险

| 风险 | 缓解措施 | 优先级 |
|------|---------|--------|
| SP-API 注册审核被拒 | 准备详细用例说明，参考 Amazon 官方 SP-API 审核指南；备选：通过第三方 SP-API 代理服务 | P0 |
| MCP Server 开发成本高 | 提供 Python MCP Server 脚手架，10 分钟出模板；DBHub 复用减少 50% 自研量 | P0 |
| 行业 prompt 质量参差 | 内置 prompt 测试框架，量化评估输出质量；行业专家审核 | P1 |
| 外部 API 不稳定 | MCP Server 内置重试 + 降级 + 缓存 + 断路器 | P1 |
| 多 Skill Pack 冲突 | depends_on + conflicts_with 声明 + 安装时检查 | P0 |
| 敏感信息泄露 | Vault 用 OS 密钥链存储，manifest 中只允许 ${vault.xxx} 引用 | P0 |
| 客户不愿提供 ERP 数据库连接串 | 提供只读账号创建指南；支持 ODBC/REST API 作为替代方案 | P1 |
| Amazon 无 Reviews API | 第二期再实现差评监控，第一期专注有官方 API 的广告/库存/利润 | P1 |
| Hermes 版本升级破坏兼容 | corey_version 声明 + 安装时检查 + 版本锁定 | P1 |
| 客户逆向 feature flag | 运行时驱动但持久化为不可读二进制；customer.yaml 导入后删除 | P2 |
| 工作流引擎复杂度 | MVP 只支持 3 种 step（tool_call / ai_transform / notify） | P1 |

---

## 9. 总结

**一句话：** 一个基座 + 一个 customer.yaml = 定制产品，导入后痕迹全无，Corey 更新不覆盖数据。

**市场定位：** 不正面硬刚麦多AI（中小卖家 SaaS），而是面向中大型企业（年销 1 亿+），做本地部署的 AI 运营中枢，连接客户已有 ERP/WMS 系统。

**核心价值：**
- 所有客户下载同一个 Corey 安装包，我们只需导入 customer.yaml 即完成定制
- 导入后 customer.yaml 自动删除，功能隐藏写入不可读二进制，客户和 Hermes Agent 都找不到痕迹
- Corey 更新只替换 App 二进制，不动 `~/.hermes/` 下的任何数据
- 定制化从"改代码构建"变成"导入配置文件"，交付周期从月级降到分钟级
- 白标交付，品牌可定制，客户感知不到底层是同一个产品

**跨境电商第一期（3 个机器人）：**
- 广告守卫：SP-API Advertising → 废词巡检 → 一键否词（IM 推送）
- 库存哨兵：SP-API Inventory + 客户 ERP → 断货/滞销预警（IM 推送）
- 利润分析：SP-API Settlement + 客户 ERP → 利润看板 + 周报

**关键依赖：**
- SP-API 开发者账号注册（前置条件，1-2 周审核）
- mcp-amazon-sp 自研 MCP Server（唯一需要自研的 MCP，5 天）
- 客户 ERP 数据库连接串（DBHub 零代码对接）
- Hermes 已有的 skills 系统和 Skill Hub 是基础，不重复造轮子
- MCP Server 管理已有 CRUD，只需扩展批量注册和模板替换
- 基座预装 DBHub + Filesystem + freeweb-mcp，覆盖 80% 数据访问需求
- Vault 用 OS 密钥链，安全且零运维
- Feature flag 运行时驱动，customer.yaml 导入后删除，不可逆向

**交付节奏：**
- Phase 1（1-2 周）：Skill Pack 基础设施（安装/卸载/Vault/MCP 注册）
- Phase 2（2-3 周）：跨境电商第一期（3 个机器人 + mcp-amazon-sp）
- Phase 3（持续）：模板化复制到其他 7 个行业
- Phase 4（2-3 周）：白标部署体系（customer.yaml + 功能隐藏）
- Phase 5（2 周）：跨境电商第二期（差评 + 竞品 + ASIN 诊断）
- Phase 6（持续）：多平台（Shopify/Temu/TikTok Shop）+ AI 生图
