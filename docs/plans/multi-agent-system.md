# 多 Agent 协作系统设计报告

> 状态：**Phase 1 完成** | 日期：2026-05-21
> 
> ⚠️ **硬约束：100% Pack 实现，零基座改动**

---

## 进度跟踪

### ✅ Phase 1: 迁移 Skills (已完成)

已创建 `~/.hermes/skill-packs/ecommerce/` Pack：

```
ecommerce/
├── manifest.yaml
├── skills/
│   ├── market-scanner/SKILL.md      ✅ 市场规模专家
│   ├── competitor-analyzer/SKILL.md ✅ 竞品拆解专家
│   └── profitability-evaluator/SKILL.md ✅ 盈利评估专家
└── workflows/
    ├── new-product-review.yaml      ✅ 新品评审（并行）
    └── quick-validation.yaml        ✅ 快速验证（串行）
```

### ⏳ 待验证

1. 重启 Corey 后 Pack 是否被扫描到
2. 在 Settings → Packs 启用 ecommerce Pack
3. 测试 Workflow 执行

---

## 〇、架构约束

### 基座 vs Pack 边界（不可违反）

```
基座（不改）                          Pack（全部在这里）
─────────────────────────────────────────────────────────────
✅ 12 视图模板                        ✅ agents/*.yaml
✅ Workflow 引擎                      ✅ agent-workflows/*.yaml  
✅ Chat 流式                          ✅ skills/*.md
✅ MCP 调用                           ✅ views/*.yaml
✅ Tauri Event                        ✅ mcp/ 预编译二进制
                                      ✅ soul_inject.md
```

### 实现策略：复用基座能力，不新增基座代码

| 需求 | 基座已有能力 | Pack 如何复用 |
|------|-------------|--------------|
| Agent 执行 | Workflow step `type: llm` | 每个 Agent = 1 个 Workflow step |
| 并行执行 | Workflow `parallel: true` | 工作流 YAML 声明并行 |
| 进度展示 | Workflow 进度 Event | 前端监听现有 Event |
| 汇总 | Workflow 最后一步 | 汇总 = 普通 LLM step |
| 触发 | Workflow trigger | 关键词触发 |
| UI | CompositeDashboard 模板 | views/ 声明布局 |

---

## 〇、现有资源盘点

### 飞哥电商 Skills 包（22 个 Skill）

已有一套成熟的 Claude Code Skills，可直接复用：

| 类别 | Skill | 功能 | 数据源 |
|------|-------|------|--------|
| **数据采集** | amazon-keyword-search | 关键词搜索结果 | Apify |
| | amazon-product-detail | 商品详情页 | Apify |
| | amazon-reviews | 用户评论 | Apify |
| | amazon-research | 综合采集 | Apify |
| | tavily-search | 行业报告搜索 | Tavily |
| **市场分析** | dtc-market-research | 4步深度调研（HTML报告） | 卖家精灵 MCP |
| | market-size-scanner | 市场规模扫描 | 纯 AI |
| | opportunity-spotter | 市场空白识别 | 纯 AI |
| **用户洞察** | user-pain-miner | 痛点挖掘 | 纯 AI |
| **竞品分析** | competitor-analyzer | 竞品拆解 | 纯 AI |
| | competitor-visual-analyzer | 竞品可视化 | 纯 AI |
| **决策支持** | product-decision-suite | 6步决策体系 | 纯 AI |
| | profitability-evaluator | 盈利评估 | 纯 AI |
| | supply-chain-validator | 供应链验证 | 纯 AI |
| **拓展规划** | dtc-product-expansion-html | 拓品规划 | 纯 AI |
| | product-vision | 产品视觉分析 | 视觉 API |
| | visual-strategist | 视觉策略 | 纯 AI |
| **办公输出** | office-pptx | PPT 生成 | 纯 AI |
| | office-xlsx | Excel 生成 | 纯 AI |
| **工具** | skill-creator | Skill 开发 | 纯 AI |
| | dtc-toolkit | 工具集 | - |

### 关键发现

1. **已有编排逻辑** — `product-decision-suite` 已定义 6 个 Skill 的串联流程
2. **分步输出** — `dtc-market-research` 已实现 4 步独立 HTML 报告
3. **数据源完整** — Apify + 卖家精灵 MCP + Tavily 覆盖主要数据需求
4. **格式规范** — Claude Code SKILL.md 格式，可直接迁移

### 差距分析

| 需求 | 飞哥 Skills | 需要补的 |
|------|-------------|----------|
| 多 Agent 并行 | ❌ 串行执行 | ✅ 并行引擎 |
| 实时进度 UI | ❌ 无 | ✅ Tauri Event + React |
| 汇总 Agent | ❌ 无 | ✅ Synthesizer |
| Agent 编辑 | ❌ 无 | ✅ 编辑器 UI |
| 对话触发 | ❌ 手动调用 | ✅ 触发识别 |

---

## 一、需求概述

### 1.1 核心需求

用户需要一个**多 Agent 协作系统**，支持：

1. **对话触发** — 在 Chat 中自然语言触发多角色协作
2. **工作流执行** — 按预设流程调用多个 Agent
3. **多 Agent 协作** — 选品、财务、运营等角色并行/串行处理
4. **执行进度 UI** — 实时看到哪个 Agent 在工作、完成了多少
5. **最终汇报** — 汇总所有 Agent 输出，生成结论
6. **Agent 可编辑** — 用户能修改 Agent 的 prompt/配置

### 1.2 业务场景

以跨境电商为例：

```
用户: 帮我评估这个新品 B0XXXXXX

系统: 正在召集专家团队分析...

【🔍 选品专家】 ✅ 完成 (2.3s)
市场机会评分: 7/10
- 月销量 $2M，竞争中等
- 头部卖家 3 家，评论集中在 4.2-4.5

【💰 财务】 ✅ 完成 (1.8s)
- 成本 $12，售价 $29.99
- 毛利率 42%，回本周期 3 个月

【📦 运营】 🔄 执行中...
- 上架难度中等，需 A+ 页面
- 预计 2 周上架

【📋 综合建议】 ⏳ 等待中
```

### 1.3 与现有系统的关系

| 现有能力 | 新系统 |
|----------|--------|
| Hermes Personalities | 单角色切换 → **多角色并行** |
| Workflow 工作流 | 步骤执行 → **Agent 编排** |
| Pack 视图模板 | 数据展示 → **Agent 进度展示** |
| Skills | 知识注入 → **Agent 专业能力** |

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Chat 对话                            │
│  用户: 帮我评估这个新品 B0XXXXXX                             │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   触发器 (Trigger)                           │
│  识别: @新品评审 / 自然语言匹配 / 工作流触发                   │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                Agent 工作流引擎 (Rust)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  任务: 新品评审                                       │   │
│  │  输入: B0XXXXXX                                      │   │
│  │  状态: running                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ 选品专家  │  │   财务   │  │   运营   │   ← 并行执行      │
│  │ ✅ done  │  │ 🔄 run   │  │ ⏳ wait  │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│                      ↓                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  汇总 Agent (Synthesizer)                            │   │
│  │  综合所有意见，生成最终报告                            │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           ↓ Tauri Event
┌─────────────────────────────────────────────────────────────┐
│                     执行进度 UI (React)                      │
│  ┌─ 新品评审 ─────────────────────────────────────────────┐ │
│  │ 进度: ████████░░ 80%                                   │ │
│  │                                                        │ │
│  │ ✅ 选品专家 (2.3s)     市场机会 7/10, 竞争中等...       │ │
│  │ ✅ 财务 (1.8s)         毛利率 42%, 回本 3 个月...       │ │
│  │ 🔄 运营 (执行中...)                                    │ │
│  │ ⏳ 汇总                                                │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
Pack manifest.yaml
    ├── agents/                    # Agent 定义
    │   ├── product_selector.yaml
    │   ├── ppc_strategist.yaml
    │   ├── finance_analyst.yaml
    │   └── operations.yaml
    │
    ├── agent-workflows/           # Agent 工作流（多 Agent 编排）
    │   ├── new_product_review.yaml
    │   └── ads_optimization.yaml
    │
    └── views/                     # 视图（现有）
        └── dashboard.yaml
```

---

## 三、Agent 定义规范

### 3.1 Agent YAML Schema

```yaml
# packs/ecommerce/agents/product_selector.yaml

# === 基础信息 ===
id: product_selector
name: 选品专家
name_en: Product Selector
icon: search                    # Lucide icon
color: "#10B981"                # 标签颜色

# === 角色定义（CrewAI 风格）===
role: "跨境电商选品战略专家"

goal: |
  发现高潜力产品机会，通过市场数据、竞争格局和利润空间分析，
  为卖家提供可执行的选品建议，最大化投资回报率

backstory: |
  你是一位拥有 10 年亚马逊运营经验的选品专家。你曾帮助超过 200 个品牌
  从 0 到 1 打造爆款产品，累计创造超过 5000 万美元销售额。
  
  你的核心能力：
  - 精通 Jungle Scout、Helium 10、Keepa 等选品工具
  - 深谙亚马逊 A9/A10 算法和搜索排名机制
  - 擅长从评论中挖掘用户痛点和市场空白
  - 熟悉 FBA 费用结构、物流成本和利润计算
  
  你的分析框架：
  1. 市场容量：月搜索量、销售额、增长趋势
  2. 竞争格局：头部卖家数量、评论分布、品牌集中度
  3. 利润空间：采购成本、FBA 费用、广告成本、净利率
  4. 进入壁垒：专利、认证、供应链难度、季节性

# === 约束条件 ===
constraints:
  - 不使用 emoji 和 hashtag
  - 不使用"颠覆性"、"革命性"等夸张词汇
  - 所有数据必须标注来源或说明是估算
  - 利润计算必须包含 FBA 费用、广告成本、退货率

# === 输出格式 ===
output_format: |
  ## 产品评估报告
  
  ### 市场机会评分: X/10
  
  ### 关键数据
  | 指标 | 数值 | 来源 |
  |------|------|------|
  | 月搜索量 | ... | ... |
  
  ### 竞争分析
  - ...
  
  ### 利润测算
  - 预估净利率: X%
  
  ### 风险点
  1. ...
  
  ### 建议
  - 上架/观望/放弃

# === 可选配置 ===
model: deepseek                 # 指定模型（可选）
temperature: 0.3                # 温度（可选）
max_tokens: 2000                # 最大 token（可选）
tools: []                       # 可用工具（可选）
```

### 3.2 Agent 工作流 YAML Schema

```yaml
# packs/ecommerce/agent-workflows/new_product_review.yaml

# === 基础信息 ===
id: new_product_review
name: 新品评审
name_en: New Product Review
description: 多角色评估新品上架可行性
icon: clipboard-check

# === 触发条件 ===
triggers:
  keywords:
    - "新品评审"
    - "评估新品"
    - "分析产品"
    - "能不能上这个品"
  patterns:
    - "帮我看看.*能不能做"
    - "分析一下.*这个产品"

# === 输入参数 ===
inputs:
  - name: product_id
    type: string
    description: ASIN 或产品链接
    required: true
    extract_pattern: "B0[A-Z0-9]{8,9}"  # 自动从用户输入提取

# === 执行步骤 ===
steps:
  # 步骤 1：并行分析
  - id: parallel_analysis
    type: parallel                # parallel | sequential
    agents:
      - product_selector
      - finance_analyst
      - operations
    timeout: 60s                  # 超时时间
    
  # 步骤 2：汇总
  - id: synthesis
    type: agent
    agent: synthesizer            # 内置汇总 Agent
    input_from: parallel_analysis # 引用上一步输出
    prompt_override: |
      你是决策协调者。综合以上专家意见，给出：
      1. 最终建议（上架/观望/放弃）
      2. 优先级（A/B/C）
      3. 关键风险点
      4. 下一步行动

# === 输出模板 ===
output_template: |
  ## 🎯 新品评审报告
  
  **产品**: {{inputs.product_id}}
  **评审时间**: {{timestamp}}
  
  ---
  
  {{#each steps.parallel_analysis.outputs}}
  ### {{agent.icon}} {{agent.name}}
  {{output}}
  
  ---
  {{/each}}
  
  ### 📋 综合建议
  {{steps.synthesis.output}}

# === 回调（可选）===
on_complete:
  - action: notify
    channel: workflow
  - action: save_to_knowledge
    category: product_reviews
```

---

## 四、跨境电商 Agent 库

### 4.1 复用飞哥 Skills（直接迁移）

| 原 Skill ID | 转为 Agent | 职责 | 数据源 |
|-------------|-----------|------|--------|
| `market-size-scanner` | 市场规模专家 | 市场容量、增长率、增量/存量判断 | 纯 AI |
| `user-pain-miner` | 用户洞察专家 | 痛点挖掘、需求分层、价格敏感度 | 纯 AI |
| `competitor-analyzer` | 竞品拆解专家 | 卖点DNA、弱点矩阵、差异化机会 | 纯 AI |
| `opportunity-spotter` | 机会发现专家 | 需求-供给缺口、创新方向 | 纯 AI |
| `profitability-evaluator` | 盈利评估专家 | 五维评分、三场景模拟、Go/No-Go | 纯 AI |
| `supply-chain-validator` | 供应链专家 | 1688寻源、成本结构、定价策略 | 纯 AI |

### 4.2 新增 Agent（补充角色）

| ID | 名称 | 职责 | 来源 |
|----|------|------|------|
| `ppc_strategist` | 广告投放专家 | PPC 策略、ACOS 优化 | agency-agents-zh |
| `listing_optimizer` | Listing 优化师 | 标题、五点、A+ 页面 | 新建 |
| `inventory_forecaster` | 库存预测专家 | 需求预测、安全库存 | agency-agents-zh |
| `synthesizer` | 决策协调者 | 汇总多方意见、最终建议 | 内置 |

### 4.3 预设工作流（复用 product-decision-suite 编排）

| ID | 名称 | 涉及 Agent | 场景 | 来源 |
|----|------|-----------|------|------|
| `quick_validation` | 快速验证 | 市场规模 → 盈利评估 | 30分钟 Go/No-Go | 飞哥 |
| `standard_decision` | 标准决策 | 市场→痛点→竞品→盈利 | 2-4小时横向对比 | 飞哥 |
| `full_development` | 深度开发 | 6步完整链路 | 1-2天产品开发包 | 飞哥 |
| `new_product_review` | 新品评审 | 市场+竞品+盈利（并行） | 多角色协作 | 新建 |
| `ads_optimization` | 广告优化 | 广告+财务+数据 | 优化广告组 | 新建 |
| `competitor_deep_dive` | 竞品深挖 | 竞品+痛点+机会 | 深度竞品分析 | 新建 |

---

## 五、实现方案（100% Pack 实现）

### 5.1 核心思路：Agent = Workflow Step + Skill

**不新增基座代码**，而是：
- **Agent 定义** = Skill（SKILL.md 格式，Hermes 原生支持）
- **Agent 编排** = Workflow（现有 Workflow 引擎）
- **Agent UI** = 视图模板（CompositeDashboard + Timeline）

```
Pack 目录结构
─────────────────────────────────────────────────────────────
packs/ecommerce/
├── manifest.yaml              # Pack 声明
├── skills/                    # Agent 定义（复用 Hermes Skill 格式）
│   ├── market-scanner/
│   │   └── SKILL.md           # 市场规模专家
│   ├── pain-miner/
│   │   └── SKILL.md           # 用户洞察专家
│   ├── competitor-analyzer/
│   │   └── SKILL.md           # 竞品拆解专家
│   └── profitability/
│       └── SKILL.md           # 盈利评估专家
│
├── workflows/                 # Agent 编排（复用 Workflow 引擎）
│   ├── new-product-review.yaml
│   ├── quick-validation.yaml
│   └── competitor-deep-dive.yaml
│
├── views/                     # UI（复用视图模板）
│   └── agent-dashboard.yaml   # CompositeDashboard 展示进度
│
└── soul_inject.md             # Pack 级人格注入
```

### 5.2 Agent 定义 = Skill

直接复用 Hermes Skill 格式，**不发明新格式**：

```markdown
<!-- packs/ecommerce/skills/profitability/SKILL.md -->
---
name: profitability-evaluator
description: "盈利性评估专家。对候选产品进行五维评分和三场景收益模拟，
输出 Go/No-Go/Watch 决策。触发词：盈利评估、能不能赚钱、Go/No-Go。"
version: 1.0.0
author: 飞哥
---

# 💰 盈利性评估专家

你是一位资深的电商财务分析师，擅长评估产品盈利性。

## 核心能力
1. **五维评分卡**：市场空间/竞争难度/利润水平/运营复杂度/风险因子
2. **三场景模拟**：保守/基准/乐观收益预测
3. **决策输出**：Go/Watch/No-Go + 一句话理由

## 输出格式
（保持原有格式...）

## 约束
- 所有数据必须标注来源
- 必须给出明确的 Go/Watch/No-Go 结论
```

### 5.3 Agent 编排 = Workflow

复用现有 Workflow 引擎，**不新增引擎代码**：

```yaml
# packs/ecommerce/workflows/new-product-review.yaml
id: new-product-review
name: 新品评审
description: 多角色评估新品上架可行性
icon: clipboard-check

triggers:
  keywords:
    - "新品评审"
    - "评估新品"
    - "能不能上这个品"
  patterns:
    - "帮我看看.*能不能做"

inputs:
  - name: product_id
    type: string
    description: ASIN 或产品链接
    extract_pattern: "B0[A-Z0-9]{8,9}"

steps:
  # 并行执行 3 个 Agent
  - id: parallel_analysis
    type: parallel
    steps:
      - id: market
        type: llm
        skill: market-scanner          # 引用 Pack 内 Skill
        prompt: |
          请分析产品 {{inputs.product_id}} 的市场规模。
          
      - id: competitor
        type: llm
        skill: competitor-analyzer
        prompt: |
          请分析产品 {{inputs.product_id}} 的竞品格局。
          
      - id: profit
        type: llm
        skill: profitability-evaluator
        prompt: |
          请评估产品 {{inputs.product_id}} 的盈利性。

  # 汇总步骤
  - id: synthesis
    type: llm
    prompt: |
      你是决策协调者。综合以上专家意见：
      
      ## 市场分析
      {{steps.market.output}}
      
      ## 竞品分析
      {{steps.competitor.output}}
      
      ## 盈利评估
      {{steps.profit.output}}
      
      请给出：
      1. 最终建议（上架/观望/放弃）
      2. 关键风险点
      3. 下一步行动

output_template: |
  ## 🎯 新品评审报告
  **产品**: {{inputs.product_id}}
  **评审时间**: {{timestamp}}
  
  {{steps.synthesis.output}}
```

### 5.4 进度 UI = 视图模板

复用 CompositeDashboard + Timeline 模板：

```yaml
# packs/ecommerce/views/agent-dashboard.yaml
id: agent-dashboard
title: Agent 协作看板
nav_section: workspace
icon: users

layout:
  type: CompositeDashboard
  columns: 2
  
widgets:
  - id: active_workflows
    type: Timeline
    title: 执行中的任务
    data_source: workflow_runs
    filter:
      status: running
    display:
      show_progress: true
      show_steps: true
      
  - id: recent_reports
    type: DataTable
    title: 最近报告
    data_source: workflow_runs
    filter:
      status: completed
    columns:
      - workflow_name
      - inputs
      - completed_at
      - duration
    actions:
      - label: 查看报告
        action: view_output
```

### 5.5 零基座改动验证

| 功能 | 实现方式 | 基座改动 |
|------|---------|---------|
| Agent 定义 | Skill (SKILL.md) | ❌ 无 |
| Agent 执行 | Workflow step `type: llm` + `skill:` | ❌ 无 |
| 并行执行 | Workflow `type: parallel` | ❌ 无 |
| 进度展示 | Workflow Event + Timeline 模板 | ❌ 无 |
| 汇总 | Workflow 最后一步 LLM | ❌ 无 |
| 触发 | Workflow triggers | ❌ 无 |
| UI | CompositeDashboard 模板 | ❌ 无 |
| Agent 编辑 | Skill 文件编辑（用户在 pack-data 覆盖） | ❌ 无 |

### 5.6 基座能力依赖检查

需要确认基座已支持以下能力：

| 能力 | 基座模块 | 状态 |
|------|---------|------|
| Workflow `type: parallel` | workflow engine | ⚠️ 待确认 |
| Workflow step `skill:` 字段 | workflow engine | ⚠️ 待确认 |
| Pack skills/ 目录扫描 | pack loader | ⚠️ 待确认 |
| Timeline 视图模板 | view templates | ⚠️ 待确认 |
| Workflow triggers | workflow engine | ✅ 已有 |
| CompositeDashboard | view templates | ✅ 已有 |

**如果基座缺少某能力**：
- 优先方案：等基座 v0.2.0 补齐（12 视图模板 + Workflow 增强）
- 备选方案：用现有能力组合实现（如用多个串行 step 模拟并行）

---

## 六、UI 设计（复用视图模板）

### 6.1 Chat 内展示

Workflow 执行时，Chat 已有进度展示能力。无需新增 UI。

### 6.2 Agent 看板（可选）

如果需要独立看板，用 CompositeDashboard 模板声明：

```yaml
# packs/ecommerce/views/agent-dashboard.yaml
# （见 5.4 节）
```

### 6.3 Agent 编辑

用户编辑 Agent = 编辑 Skill 文件。两种方式：

1. **直接编辑** — 用户在 `pack-data/ecommerce/skills/` 覆盖 SKILL.md
2. **UI 编辑** — 基座 Skills 页面已有编辑能力（如果有的话）

---

## 七、实现计划（纯 Pack 工作）

### 7.1 阶段划分

| 阶段 | 内容 | 工作量 | 基座改动 |
|------|------|--------|---------|
| **Phase 1** | 迁移飞哥 Skills 到 Pack | 0.5 天 | ❌ 无 |
| **Phase 2** | 编写 Workflow YAML | 1 天 | ❌ 无 |
| **Phase 3** | 测试 + 调优 | 0.5 天 | ❌ 无 |

**总计: 2 天**（如果基座能力已就绪）

### 7.2 前置条件

在开始 Pack 工作前，需确认基座支持：

- [ ] Workflow `type: parallel` 并行执行
- [ ] Workflow step `skill:` 字段引用 Skill
- [ ] Pack `skills/` 目录被扫描加载
- [ ] Workflow triggers 关键词触发

### 7.3 详细任务

#### Phase 1: 迁移 Skills (0.5 天)

```bash
# 目标目录结构
packs/ecommerce/skills/
├── market-scanner/SKILL.md
├── pain-miner/SKILL.md
├── competitor-analyzer/SKILL.md
├── opportunity-spotter/SKILL.md
├── profitability-evaluator/SKILL.md
└── supply-chain-validator/SKILL.md
```

- [ ] 复制飞哥 6 个核心 Skill
- [ ] 调整 frontmatter 格式（如需要）
- [ ] 验证 Hermes 能加载

#### Phase 2: 编写 Workflows (1 天)

```bash
packs/ecommerce/workflows/
├── quick-validation.yaml      # 快速验证（串行）
├── new-product-review.yaml    # 新品评审（并行）
└── competitor-deep-dive.yaml  # 竞品深挖（并行）
```

- [ ] 编写 3 个工作流 YAML
- [ ] 配置 triggers 关键词
- [ ] 测试触发和执行

#### Phase 3: 测试 (0.5 天)

- [ ] 端到端测试：Chat 触发 → 执行 → 输出
- [ ] 调优 prompt 和输出格式
- [ ] 文档

---

## 八、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 基座不支持 parallel | 无法并行 | 用串行 + 提示"正在分析..." |
| 基座不支持 skill: 字段 | 无法引用 Skill | 把 Skill 内容内联到 prompt |
| Workflow 输出太长 | Chat 卡顿 | 分步输出 + 折叠 |

---

## 九、后续扩展

### 9.1 基座 v0.2.0 后

- 用 Timeline 模板展示进度
- 用 FormRunner 模板做 Agent 编辑器

### 9.2 Pack 内扩展

- 更多 Agent（广告、库存、Listing）
- 更多 Workflow（广告优化、库存规划）
- MCP 集成（卖家精灵、Apify）

---

## 十、参考资料

- [CrewAI Agent 定义](https://docs.crewai.com/en/concepts/agents)
- **飞哥电商 Skills 包** — 22 个成熟 Skill，可直接复用
- CoreyOS Workflow 引擎文档
- CoreyOS Pack 架构文档

---

## 附录：飞哥 SKILL.md → Pack Skill 映射

| 飞哥 SKILL.md | Pack skills/xxx/SKILL.md |
|---------------|-------------------------|
| `name` | `name`（保持） |
| `description` | `description`（保持） |
| 正文 | 正文（保持） |

**格式完全兼容，直接复制即可。**
