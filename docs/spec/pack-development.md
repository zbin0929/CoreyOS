# CoreyOS Skill Pack 开发指南

> 基座稳定后，交付 = 制作 Pack。本指南是 Pack 开发者的唯一的参考文档。

## 一、Pack 是什么

Pack 是一个**自包含的行业能力包**，由以下要素组成：

| 要素 | 作用 | 必填 |
|------|------|------|
| **manifest.yaml** | Pack 身份证 + 所有资源注册 | ✅ |
| **soul_inject** | 角色定义，注入 AI 系统提示词 | ❌ |
| **skills** | Hermes 格式的 .md 技能文件 | ❌ |
| **workflows** | YAML 定义的自动化流程 | ❌ |
| **views** | 12 种模板的可视化面板 | ❌ |
| **schedules** | Cron 定时任务 | ❌ |
| **mcp_servers** | 外部数据源连接器 | ❌ |
| **config_schema** | 用户首次启用时的配置表单 | ❌ |

一个 Pack **至少要有 manifest.yaml + soul_inject**（否则 AI 不知道自己是什么角色）。其他要素按需添加。

## 二、目录结构

```
my-pack/
├── manifest.yaml              ← 唯一入口
├── soul.md                    ← 角色定义（soul_inject 引用）
├── skills/                    ← Hermes 技能文件
│   ├── ad-guard.md
│   └── inventory-sentinel.md
├── workflows/                 ← 自动化流程
│   ├── daily-report.yaml
│   └── ad-monitor.yaml
├── knowledge/                 ← 知识文档（上传到 Knowledge Base）
│   ├── amazon-policy.md
│   └── fba-rules.md
└── mcp/                       ← MCP Server（如需）
    └── my-server/
        └── ...
```

`manifest.yaml` 中所有路径都相对于 Pack 根目录。

## 三、manifest.yaml 完整字段

```yaml
schema_version: 1                          # 固定为 1
id: my_pack                                # 全局唯一 [a-z0-9_]+
version: "1.0.0"                           # 语义化版本
title: 我的行业助手                          # 侧边栏显示名
description: 一句话描述                      # 设置页详情
author: 你的名字                             # 作者
icon: icon.png                              # 图标文件路径（可选）
license_feature: ""                         # 留空 = 免费 Pack

requires:
  corey: ">=0.2.0"                          # 最低 Corey 版本
  templates: []                             # 依赖的视图模板名

soul_inject:                                # 🎯 角色定义文件
  - soul.md

skills:                                     # Hermes 技能文件
  - skills/ad-guard.md
  - skills/inventory-sentinel.md

workflows:                                  # 自动化流程
  - workflows/daily-report.yaml
  - workflows/ad-monitor.yaml

schedules:                                  # Cron 定时任务
  - id: daily-ad-check
    cron: "0 9 * * *"                       # 每天 9:00
    workflow: daily-report.yaml
    description: 每日广告巡检

views:                                      # 可视化面板
  - id: overview
    title: 数据概览
    icon: chart
    nav_section: home                        # home / tools / more / pack
    template: MetricsCard
    metrics: [revenue, orders, acos]
    data_source:
      static:
        revenue: "—"
        orders: "—"
        acos: "—"
    actions:
      - label: 刷新数据
        workflow: daily-report.yaml
        confirm: false

config_schema:                              # 首次启用配置表单
  - key: seller_id
    label: Seller ID
    type: string
    required: true
    description: Amazon Seller Central ID
  - key: marketplace
    label: 站点
    type: enum
    options: [US, UK, DE, JP]
    default: US
    required: true

mcp_servers:                                # 外部数据源
  - id: my-database
    type: stdio
    command: ["npx", "-y", "mcp-server-mysql"]
    env:
      DB_URL: "${pack_config.db_connection}"
    auto_start: true
    timeout_ms: 30000
```

### 字段详解

#### `id`
全局唯一标识符，只允许 `[a-z0-9_]`。安装后不可更改。

#### `soul_inject`
**最重要的字段**。列出角色定义文件的路径。文件内容会在每次 AI 对话时注入到系统提示词最前面。

#### `skills`
Hermes 格式的 .md 文件。路径相对于 Pack 根目录。启用时复制到 `~/.hermes/skills/`，禁用时删除。

#### `workflows`
YAML 自动化流程。启用时复制到 `~/.hermes/workflows/`。

#### `schedules`
Cron 定时任务，关联到 workflows。格式：5 字段（分 时 日 月 周）。

#### `views`
可视化面板，使用基座内置的 12 种模板。`nav_section` 控制出现在侧边栏哪个分组。

#### `config_schema`
用户首次启用 Pack 时弹出的配置表单。`customer.yaml` 可以预填任何字段（白标场景）。

#### `mcp_servers`
外部数据源连接器。`command` 支持 `${platform}` 变量。`env` 支持 `${pack_data_dir}` 和 `${pack_config.<key>}` 模板变量。

## 四、Soul 文件编写

Soul 文件是 AI 的"角色定义"，决定了 AI 以什么身份、什么专业知识回答问题。

### 编写原则

1. **身份定位** — 明确 AI 是谁、服务谁、擅长什么
2. **知识边界** — 明确哪些是 AI 确定知道的，哪些需要查数据
3. **行为规范** — AI 应该怎么做（主动建议？保守建议？）
4. **输出风格** — 用什么格式回答（表格？JSON？分点叙述？）
5. **安全底线** — 绝对不能做什么

### Soul 文件模板

```markdown
# {行业名称} AI 顾问

## 身份
你是 {公司/行业} 的专属 AI 顾问，拥有 {X} 年 {行业} 从业经验。
你的服务对象是 {角色}，帮助他们在 {场景} 中做出更好的决策。

## 核心能力
1. **{能力1}** — {描述}
2. **{能力2}** — {描述}
3. **{能力3}** — {描述}

## 行为准则
- 主动发现问题并预警，而不是等用户问
- 给建议时附带数据依据，不说空话
- 不确定的事情明确标注"需核实"
- 涉及金额的建议，给出范围而非精确数字
- 每次回复末尾附上"下一步建议"

## 输出格式
- 日常分析：Markdown 表格 + 趋势判断
- 预警通知：🔴/🟡/🟢 三级 + 一句话说明 + 建议操作
- 周报/月报：分段式（概要 → 数据 → 分析 → 建议）

## 知识边界
- 确定知道：{行业基础知识、公开政策、通用方法论}
- 需要查数据：{实时数据、客户具体业务数据}
- 不知道的：{未来预测、竞争对手内部信息}

## 安全底线
- 绝不编造具体财务数字
- 绝不给出法律合规的确定性结论（建议咨询律师）
- 涉及大额决策时必须提醒用户二次确认
```

### 多文件 Soul

可以在 `soul_inject` 中列出多个文件，它们会按顺序拼接：

```yaml
soul_inject:
  - soul.md              # 基础角色定义
  - knowledge/glossary.md # 行业术语表
```

## 五、Skill 文件编写

Skill 文件遵循 **agentskills.io** 开放标准，兼容 Hermes / Claude Code / Cursor 等 AI 工具。

### Skill 文件格式

```markdown
---
name: ad-guard
description: Amazon 广告效果监控，自动识别浪费预算的关键词
triggers:
  - "广告效果"
  - "ACOS 太高"
  - "广告花费"
---

# Ad Guard — 广告守卫

## 触发条件
当用户提到广告效果、ACOS、广告花费、关键词表现时激活。

## 执行步骤

1. **数据收集**
   - 获取过去 7 天广告报告（Search Term Report）
   - 提取关键指标：Spend, Sales, ACOS, Conversion Rate

2. **分析逻辑**
   - 标记 ACOS > 目标阈值的关键词（默认 30%）
   - 标记 Spend > $10 但 0 转化的关键词
   - 标记点击率 < 0.2% 的关键词

3. **输出格式**
   | 关键词 | Spend | Sales | ACOS | 状态 | 建议 |
   |--------|-------|-------|------|------|------|
   | ...    | ...   | ...   | ...  | 🔴/🟡 | ... |

4. **建议动作**
   - 🔴 立即暂停（ACOS > 50% 且持续 7 天）
   - 🟡 降低出价（ACOS 30-50%，有转化潜力）
   - 🟢 保持观察（ACOS < 30%）

## 注意事项
- 不要仅凭 1 天数据做决策，至少看 7 天趋势
- 品牌词 ACOS 通常偏高，这是正常的
- 季节性产品需要对比去年同期数据
```

### Skill 编写原则

1. **触发条件明确** — AI 知道什么时候该用这个 Skill
2. **步骤可执行** — 每一步都是 AI 能直接执行的操作
3. **输出标准化** — 固定的表格/格式，方便用户快速理解
4. **包含判断逻辑** — 什么情况做什么决策，阈值是多少
5. **标注边界** — 什么时候不应该用这个 Skill

## 六、Workflow 文件编写

Workflow 是可自动运行的流程，支持手动触发、Cron 定时、Webhook 触发。

### Workflow 文件格式

```yaml
id: daily-ad-report
name: 每日广告报告
description: 每天早上 9 点自动分析广告数据并生成报告
version: 1

trigger:
  type: manual          # manual / cron / webhook

inputs:
  - name: date_range
    label: 分析天数
    type: string
    default: "7"
    required: true
  - name: acos_threshold
    label: ACOS 预警阈值 (%)
    type: string
    default: "30"
    required: true

steps:
  - id: analyze
    name: 分析广告数据
    type: agent
    after: []
    agent_id: hermes-default
    prompt: |
      你是广告分析专家。分析过去 {{inputs.date_range}} 天的广告数据。

      预警阈值：ACOS > {{inputs.acos_threshold}}%

      输出格式：
      1. 整体表现概要（3 句话）
      2. 需要关注的关键词表格
      3. 建议操作列表

      数据来源：{{pack_config.seller_id}} 的 Amazon Advertising 数据
    output_format: markdown

notify:
  on_done: true
  on_failure: true
  webhook_url: "https://oapi.dingtalk.com/robot/send?access_token=xxx"
  format: dingtalk
  message: "工作流 {{workflow_name}} {{status}}，耗时 {{duration}}"
```

### 通知配置（notify）

Workflow 完成或失败时可通过 Webhook 推送通知到 IM 工具。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `on_done` | bool | 否 | 完成时发送通知（默认 false） |
| `on_failure` | bool | 否 | 失败时发送通知（默认 true） |
| `webhook_url` | string | 是 | Webhook 地址 |
| `format` | string | 否 | 消息格式（dingtalk/feishu/wecom/generic，默认 generic） |
| `message` | string | 否 | 自定义消息模板 |

**支持的消息格式**：

| format | 平台 | 说明 |
|--------|------|------|
| `dingtalk` | 钉钉 | Markdown 消息格式 |
| `feishu` | 飞书 | 交互式卡片格式 |
| `wecom` | 企业微信 | Markdown 消息格式 |
| `generic` | 通用 | JSON 格式，包含 workflow_name、status、error、duration_ms |

**消息模板变量**：

| 变量 | 说明 |
|------|------|
| `{{workflow_name}}` | 工作流名称 |
| `{{status}}` | 状态（Completed/Failed/Canceled） |
| `{{error}}` | 错误信息（仅失败时） |
| `{{duration}}` | 执行时长（如 "2 分 30 秒"） |
| `{{duration_ms}}` | 执行时长（毫秒） |

### Step 类型

| type | 说明 |
|------|------|
| `agent` | 调用 LLM 生成内容 |
| `tool` | 调用 MCP 工具获取数据 |
| `browser` | 浏览器自动化操作 |
| `condition` | 条件分支 |
| `parallel` | 并行执行多个子步骤 |

### 变量模板

| 变量 | 说明 |
|------|------|
| `{{inputs.<name>}}` | 用户输入的参数 |
| `{{pack_config.<key>}}` | Pack 配置项 |
| `{{steps.<id>.output}}` | 上一步的输出 |
| `{{env.<name>}}` | 环境变量 |

## 七、Views 视图模板

基座内置 12 种视图模板，Pack 可以直接使用，无需开发前端代码。

### 可用模板

| 模板名 | 用途 | 典型场景 |
|--------|------|---------|
| `MetricsCard` | 关键指标卡片 | 今日销售额、订单数、ACOS |
| `DataTable` | 数据表格 | SKU 列表、关键词报告 |
| `CompositeDashboard` | 组合仪表盘 | 多指标总览页 |
| `TimeSeriesChart` | 时间序列图 | 销售趋势、流量变化 |
| `RadarChart` | 雷达图 | 多维对比分析 |
| `TrendsMatrix` | 趋势矩阵 | 热力图、四象限 |
| `PivotTable` | 透视表 | 交叉分析 |
| `Timeline` | 时间线 | 事件流、操作日志 |
| `AlertList` | 告警列表 | 预警通知、异常汇总 |
| `FormRunner` | 表单运行器 | 数据录入、参数配置 |
| `WorkflowLauncher` | 流程启动器 | 一键运行 Workflow |
| `SkillPalette` | 技能面板 | Skill 快捷入口 |

### View 示例

```yaml
views:
  - id: sales-overview
    title: 销售概览
    icon: trending-up
    nav_section: home
    template: MetricsCard
    metrics: [revenue, orders, avg_price, refund_rate]
    data_source:
      static:
        revenue: "—"
        orders: "—"
        avg_price: "—"
        refund_rate: "—"
    actions:
      - label: 刷新
        workflow: daily-report.yaml
        confirm: false

  - id: sku-table
    title: SKU 数据表
    icon: table
    nav_section: tools
    template: DataTable
    data_source:
      static: []
    options:
      columns:
        - key: sku
          label: SKU
        - key: title
          label: 商品名称
        - key: price
          label: 价格
        - key: stock
          label: 库存
```

### nav_section 位置

| nav_section | 侧边栏位置 | 适用场景 |
|-------------|-----------|---------|
| `home` | 首页卡片 | 高频核心指标 |
| `tools` | 工具区 | 数据表格、操作面板 |
| `more` | 更多（折叠） | 低频分析页 |
| `pack` | Pack 专属区 | Pack 默认位置 |

## 八、知识文档

知识文档通过 Knowledge Base 上传（Settings → Knowledge），不是 Pack manifest 的一部分。但 Pack 开发者需要准备这些文档。

### 知识文档类型

| 类型 | 示例 | 上传后效果 |
|------|------|-----------|
| 政策法规 | Amazon 禁售清单、FBA 入仓规则 | AI 回答时自动引用 |
| 操作指南 | 广告优化步骤、Listing 编写规范 | AI 给建议时参考 |
| 行业术语 | 跨境电商术语表、缩写对照 | AI 使用正确术语 |
| 模板范本 | 报告模板、分析框架 | AI 输出时套用格式 |
| 历史案例 | 过往运营经验、踩坑记录 | AI 避免重复错误 |

### 知识文档编写原则

1. **一份文档一个主题** — 不要把所有东西塞进一个文件
2. **标题清晰** — AI 用标题做语义匹配
3. **结构化** — 用标题层级（#、##、###）组织内容
4. **小于 5000 字** — 超长的文档拆分成多个
5. **保持更新** — 过时信息比没有信息更危险

### 上传方式

1. **手动上传** — Settings → Knowledge → 拖拽 .md / .txt / .pdf 文件
2. **API 上传** — `knowledge_upload` IPC 命令
3. **Pack 预装** — `customer.yaml` 的 `knowledge` 字段指定预装文档路径

上传后文档会被 BGE-M3 向量化（1024 维），通过 BM25 + 向量混合检索（RRF 融合）召回。

## 九、开发流程

### 从零制作一个 Pack 的步骤

```
1. 需求分析
   └── 客户是谁？痛点是什么？AI 能帮什么？

2. 写 Soul
   └── 定义 AI 角色、能力、行为规范
   └── 放到 soul.md

3. 写 Skills
   └── 每个核心场景一个 Skill
   └── 放到 skills/ 目录

4. 写 Workflows
   └── 可自动化的流程
   └── 放到 workflows/ 目录

5. 定义 Views
   └── 选择合适的模板
   └── 配置 data_source 和 actions

6. 配置 manifest.yaml
   └── 注册所有资源
   └── 设置 config_schema

7. 准备知识文档
   └── 上传到 Knowledge Base

8. 本地测试
   └── zip 打包 → 导入 → 启用 → 对话测试

9. 交付
   └── zip 发给客户 / 通过 customer.yaml 预装
```

### 测试清单

- [ ] Pack 导入成功，无报错
- [ ] 启用后 AI 对话有角色意识（问"你是谁"验证）
- [ ] Skills 在相关问题时被触发
- [ ] Workflows 可以手动运行
- [ ] Views 正确渲染
- [ ] 禁用后角色定义消失
- [ ] 知识文档被正确召回（问相关问题验证）

## 十、打包和分发

### 打包

```bash
# 在 Pack 根目录执行
cd my-pack/
zip -r ../my-pack.zip .
```

### 安装方式

| 方式 | 适用场景 |
|------|---------|
| Settings → Packs → Import ZIP | 开发测试 |
| `pack_import_zip` IPC | 批量部署 |
| `customer.yaml` 预装 | 白标交付 |

### customer.yaml 预装

```yaml
packs:
  preinstall:
    - id: cross_border_ecom
      source: "./skill-packs/cross_border_ecom.zip"
      enabled: true
  config:
    cross_border_ecom:
      seller_id: "A3XXXXXX"
      marketplace: "US"
```

## 十一、常见问题

### Q: Soul 太长会影响性能吗？
A: Soul 在每次对话时注入到 system prompt。建议控制在 2000 字以内。超长内容应该放到知识文档里（按需召回），而不是全部塞进 Soul。

### Q: 一个 Pack 可以有多少个 Skill？
A: 没有硬性限制。但建议 5-10 个 Skill 覆盖核心场景，太多会让 AI 难以选择正确的 Skill。

### Q: 多个 Pack 可以同时启用吗？
A: 可以。每个 Pack 的 Soul 会按安装顺序拼接。注意避免角色冲突（例如两个 Pack 给出矛盾的行为规范）。

### Q: Pack 可以依赖另一个 Pack 吗？
A: 当前版本不支持 `depends_on`。如果需要拆分，建议做成一个 Pack。

### Q: 知识文档和 Soul 的区别？
A: Soul = **AI 是谁**（身份、行为、规范），始终注入。Knowledge = **AI 知道什么**（知识、数据），按需召回。角色定义放 Soul，行业知识放 Knowledge。

### Q: 没有 SP-API 数据怎么办？
A: 用"报表上传"方案：用户手动导出 Amazon 报告 → 上传到 Knowledge Base → AI 分析。这是零开发成本的起步方案。等 SP-API 到位后升级为自动化。
