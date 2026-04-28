# CoreyOS 定制化方案

> 版本：v1.0 · 2026-04-29
> 状态：设计阶段

---

## 1. 核心理念

**Corey = 通用 AI 基座 + 行业 Skill Pack**

- 基座提供：AI 对话、工具调用（MCP）、工作流引擎、权限沙箱、数据持久化
- 定制 = 行业专属的 **Prompt 包 + MCP Tool 包 + 可选 UI 组件**
- **核心代码零分支**，所有行业差异通过配置和插件解决
- 客户拿到的是同一个 Corey 安装包 + 不同的 Skill Pack 授权

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
│  ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ 跨境电商 │ │ 海外仓   │ │ 尾程物流 │  ...      │
│  └─────────┘ └─────────┘ └─────────┘           │
└─────────────────────────────────────────────────┘
```

---

## 2. 三层定制架构

### 2.1 第一层：Prompt + 知识注入（零代码）

每个行业有专属的 prompt 模板和知识文档，注入到 AI 的 system prompt 中。

**目录结构：**

```
~/.hermes/skills/<skill-pack-id>/
├── manifest.yaml            # 元信息
├── prompts/                 # 系统提示词
│   ├── system.md            # 行业角色定义
│   ├── knowledge/           # 行业知识库片段
│   │   ├── compliance.md    # 合规要点
│   │   ├── glossary.md      # 行业术语表
│   │   └── sop/             # 标准 SOP
│   │       ├── order_processing.md
│   │       └── returns.md
│   └── templates/           # 输出模板
│       ├── listing.md       # Amazon Listing 模板
│       └── quote.md         # 报价单模板
├── tools.yaml               # 声明需要的 MCP tool
├── workflows/               # 自动化工作流
│   ├── order_sync.yaml
│   └── inventory_alert.yaml
└── schemas/                 # 行业数据结构
    ├── product.schema.json
    └── shipment.schema.json
```

**manifest.yaml 规范：**

```yaml
# 必填字段
id: cross-border-ecom           # 全局唯一标识
name: 跨境电商助手                # 显示名称
version: 1.0.0
description: 跨境电商全链路 AI 助手
author: CoreyOS Team
corey_version: ">=0.1.0"         # 兼容的 Corey 最低版本

# 依赖的其他 Skill Pack（可选）
depends_on: []

# 需要的 MCP Tool（安装时检查，缺失则提示）
required_tools:
  - amazon_sp_api
  - erp_product_sync
optional_tools:
  - shopify_admin
  - ebay_api

# Prompt 注入配置
prompts:
  system: prompts/system.md      # 主 system prompt 片段
  knowledge:
    - prompts/knowledge/compliance.md
    - prompts/knowledge/glossary.md

# 工作流
workflows:
  - workflows/order_sync.yaml
  - workflows/inventory_alert.yaml

# 行业数据 Schema（用于结构化输入/输出校验）
schemas:
  product: schemas/product.schema.json
  shipment: schemas/shipment.schema.json

# UI 扩展点（可选）
ui:
  sidebar_items:                 # 侧边栏新增入口
    - id: product-listing
      label: Listing 优化
      icon: Package
      route: /skills/cross-border-ecom/listing
  settings_panels:               # 设置页新增面板
    - id: marketplace-config
      label: 平台配置
      fields:
        - key: amazon_region
          type: select
          options: [US, EU, JP]
```

### 2.2 第二层：MCP Tool 扩展（低代码）

每个行业需要对接不同的外部系统，通过 MCP Server 暴露为 Corey 可调用的 tool。

**MCP Server 开发规范：**

```python
# 每个 MCP Server 是一个独立进程
# 通过 stdio 或 SSE 与 Corey 通信
# 遵循 MCP 协议标准

# 示例：海外仓 MCP Server
@mcp.tool()
async def query_inventory(sku: str, warehouse: str) -> dict:
    """查询 SKU 在指定仓库的库存"""
    return await wms_client.get_inventory(sku, warehouse)

@mcp.tool()
async def create_inbound_order(items: list, warehouse: str) -> dict:
    """创建入库单"""
    return await wms_client.create_inbound(items, warehouse)
```

**各行业 MCP Tool 清单：**

| 行业 | MCP Server | 核心 Tool | 对接系统 |
|------|-----------|----------|---------|
| **跨境电商** | `amazon-sp-api` | `get_listings`, `update_price`, `get_orders`, `create_fba_shipment` | Amazon SP-API |
| | `erp-product-sync` | `sync_product`, `get_sku_info`, `update_stock` | ERP 系统 |
| | `shopify-admin` | `get_products`, `update_listing`, `get_orders` | Shopify |
| **海外仓** | `wms-inventory` | `query_inventory`, `reserve_stock`, `inbound_booking` | WMS |
| | `putaway-optimize` | `suggest_location`, `confirm_putaway` | WMS |
| **尾程物流** | `carrier-rate-shop` | `get_rates`, `compare_carriers` | 多 Carrier API |
| | `label-gen` | `generate_label`, `void_label` | Carrier API |
| | `pod-track` | `get_tracking`, `confirm_pod` | Tracking API |
| **头程** | `booking-request` | `create_booking`, `update_booking`, `cancel_booking` | 船司/货代 API |
| | `bl-draft` | `generate_bl`, `validate_bl` | 文档系统 |
| | `customs-decl` | `create_declaration`, `check_hs_code` | 海关系统 |
| **卡派** | `ltl-quote` | `get_ltl_rates`, `book_pickup` | LTL Carrier |
| | `appointment-sched` | `schedule_delivery`, `reschedule` | 仓库预约系统 |
| **客服** | `ticket-crud` | `create_ticket`, `update_ticket`, `escalate` | Zendesk/Freshdesk |
| | `sla-monitor` | `check_sla`, `get_breach_risk` | SLA 引擎 |
| | `auto-reply` | `draft_reply`, `send_reply` | 邮件/IM API |
| **报价** | `rate-calc` | `calculate_rate`, `get_surcharge` | 计价引擎 |
| | `margin-check` | `calc_margin`, `suggest_price` | 利润模型 |
| | `quote-pdf-gen` | `generate_quote`, `send_quote` | PDF 生成 |
| **财务** | `invoice-gen` | `create_invoice`, `send_invoice`, `reconcile` | 财务系统 |
| | `recon-match` | `match_payment`, `flag_discrepancy` | 银行流水 |
| | `fx-hedge` | `get_fx_rate`, `suggest_hedge` | 外汇 API |

### 2.3 第三层：UI 组件扩展（可选，按需定制）

行业专属的交互界面，通过 Corey 前端插件机制加载。

**扩展方式：**

```tsx
// 每个 Skill Pack 可以注册 UI 扩展点
// Corey 前端通过动态加载实现

// 1. 侧边栏入口（manifest.yaml 中声明）
// 2. 自定义页面组件（Skill Pack 提供 React 组件）
// 3. 设置面板扩展（行业专属配置项）
```

**典型 UI 扩展：**

| 行业 | UI 扩展 | 说明 |
|------|---------|------|
| 跨境电商 | Listing 优化面板 | 输入产品信息 → AI 生成标题/五点/A+ |
| 海外仓 | 库存看板 | 可视化多仓库存水位 |
| 尾程物流 | 运单追踪 Widget | 聚合多 carrier 追踪信息 |
| 报价 | 报价计算器 | 输入参数 → AI 算价 → 一键生成 PDF |
| 财务 | 对账面板 | 上传银行流水 → AI 自动匹配 |

---

## 3. 技术实现

### 3.1 Skill Pack 安装机制

```bash
# 安装 Skill Pack
hermes skill install cross-border-ecom

# 列出已安装
hermes skill list

# 卸载
hermes skill uninstall cross-border-ecom

# 更新
hermes skill update cross-border-ecom
```

**安装流程：**

```
1. 解析 manifest.yaml
2. 检查 corey_version 兼容性
3. 检查 depends_on 是否已安装
4. 检查 required_tools 对应的 MCP Server 是否可用
5. 复制 prompt 文件到 ~/.hermes/skills/<id>/
6. 注册 MCP tool 声明到 config.yaml
7. 注册工作流到 workflows/
8. 如有 UI 扩展，注册到前端路由
9. 重载 Hermes 配置（热加载，无需重启）
```

### 3.2 Prompt 注入机制

Corey 已有 `HERMES_BUNDLED_SKILLS` 环境变量机制。扩展为：

```rust
// 启动时加载所有已安装 Skill Pack 的 prompt
fn build_system_prompt() -> String {
    let mut prompt = base_system_prompt();  // Corey 通用 prompt
    
    for skill in installed_skills() {
        // 按依赖顺序注入
        prompt.push_str(&skill.system_prompt());
        for knowledge in skill.knowledge_docs() {
            prompt.push_str(&knowledge);
        }
    }
    
    prompt
}
```

**注入优先级：**

1. Corey 基础 prompt（不可覆盖）
2. 行业 Skill Pack system prompt（追加）
3. 行业知识库片段（追加）
4. 用户自定义 prompt（最高优先级，可覆盖）

### 3.3 MCP Tool 注册

Corey 已有 MCP 网关（`127.0.0.1:8649`），扩展为：

```yaml
# ~/.hermes/config.yaml 中自动追加
mcp_servers:
  # Corey 内置
  corey-native:
    url: http://127.0.0.1:8649/
  
  # Skill Pack 带来的
  amazon-sp-api:
    command: python
    args: ["-m", "mcp_amazon_sp_api"]
    env:
      AMAZON_REGION: "${skill.amazon_region}"
      AMAZON_ACCESS_KEY: "${vault.amazon_access_key}"
  
  wms-inventory:
    command: python
    args: ["-m", "mcp_wms_inventory"]
    env:
      WMS_URL: "${skill.wms_url}"
      WMS_API_KEY: "${vault.wms_api_key}"
```

### 3.4 工作流引擎

```yaml
# workflows/order_sync.yaml
name: 订单同步
trigger:
  type: schedule          # 定时触发
  cron: "0 */2 * * *"    # 每2小时
  # 或 type: event       # 事件触发
  # event: new_order

steps:
  - id: fetch_orders
    tool: amazon-sp-api.get_orders
    params:
      marketplace: US
      since: "{{last_run_time}}"
    
  - id: transform
    type: ai_transform    # AI 数据转换
    prompt: |
      将 Amazon 订单数据转换为 ERP 标准格式
      字段映射规则：...
    input: "{{steps.fetch_orders.result}}"
    
  - id: sync_to_erp
    tool: erp-product-sync.sync_orders
    params:
      orders: "{{steps.transform.result}}"
    
  - id: notify
    type: notify
    channel: chat
    message: "同步完成：{{steps.sync_to_erp.result.count}} 笔订单"
```

### 3.5 敏感信息管理

API Key 等敏感信息不存入 manifest.yaml，统一走 Corey Vault：

```bash
# 设置密钥（加密存储）
hermes vault set amazon_access_key AKIAIOSFODNN7EXAMPLE
hermes vault set wms_api_key xxx

# Skill Pack 的 manifest.yaml 中用 ${vault.key_name} 引用
# 运行时由 Corey 替换为真实值
```

---

## 4. 行业 Skill Pack 规划

### 4.1 跨境电商（首个落地包）

**目标用户**：Amazon / Shopify 卖家运营团队

**核心场景：**

| 场景 | Prompt | Tool | 工作流 |
|------|--------|------|--------|
| Listing 优化 | Listing 专家 prompt | `get_listings`, `update_listing` | 定时巡检 + AI 优化建议 |
| 竞品分析 | 竞品分析 prompt | `get_competitor_data` | 每周竞品报告 |
| 合规检查 | 合规知识 prompt | `check_compliance` | 上架前自动合规扫描 |
| 库存补货 | 补货逻辑 prompt | `get_inventory`, `create_fba_shipment` | 库存低于阈值自动建议 |
| 广告优化 | 广告 prompt | `get_campaigns`, `adjust_budget` | ACoS 预警 + 自动调价 |

**交付物：**
- `manifest.yaml` + 5 个 prompt 文件
- 2 个 MCP Server（`amazon-sp-api`, `erp-product-sync`）
- 3 个工作流模板
- 1 个 UI 扩展（Listing 优化面板）

### 4.2 海外仓

**核心场景：** 入库预约、库存查询、拣货优化、出库打单、盘点

### 4.3 尾程物流

**核心场景：** 比价打单、轨迹追踪、异常件处理、POD 确认

### 4.4 头程

**核心场景：** 订舱、提单草拟、报关申报、到港通知

### 4.5 卡派

**核心场景：** LTL 报价、预约送仓、交货证明

### 4.6 客服

**核心场景：** 工单处理、SLA 监控、自动回复草拟、升级流转

### 4.7 报价

**核心场景：** 运费计算、利润校验、报价单生成、历史报价查询

### 4.8 财务

**核心场景：** 开票、对账、汇兑、应收应付

---

## 5. 商业模式

```
┌──────────────────────────────────────────────┐
│              Corey 基座（免费/开源）            │
│  AI 对话 + MCP 网关 + 工作流 + 沙箱           │
├──────────────────────────────────────────────┤
│         Skill Pack Store（付费）               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 跨境电商  │  │ 海外仓    │  │ 尾程物流  │   │
│  │ ¥XXX/月   │  │ ¥XXX/月   │  │ ¥XXX/月   │   │
│  └──────────┘  └──────────┘  └──────────┘   │
├──────────────────────────────────────────────┤
│         MCP Tool Store（按调用量计费）          │
│  amazon-sp-api  wms-inventory  carrier-api   │
├──────────────────────────────────────────────┤
│         定制开发服务（项目制）                   │
│  专属 MCP Server 开发 · UI 定制 · 私有部署     │
└──────────────────────────────────────────────┘
```

**定价层级：**

| 层级 | 内容 | 价格模式 |
|------|------|---------|
| 基座 | Corey 核心 + 通用 AI | 免费开源 |
| Skill Pack | 行业 prompt + 工作流模板 | 按行业包订阅 |
| MCP Tool | 外部系统对接 | 按调用量 / 自建免费 |
| 定制开发 | 专属 MCP Server + UI | 项目制 |

---

## 6. 落地路线图

### Phase 1：Skill Pack 基础设施（1-2 周）

- [ ] 定义 `manifest.yaml` 完整 schema
- [ ] 实现 `hermes skill install/list/uninstall/update` 命令
- [ ] 实现 prompt 注入机制（按依赖顺序拼接 system prompt）
- [ ] 实现 MCP tool 声明检查 + 自动注册到 `config.yaml`
- [ ] 实现 Vault 密钥管理（`hermes vault set/get`）
- [ ] 编写 Skill Pack 开发文档

### Phase 2：首个行业包 — 跨境电商（2-3 周）

- [ ] 编写跨境电商 `manifest.yaml` + prompt 文件
- [ ] 开发 `amazon-sp-api` MCP Server（Python）
- [ ] 开发 `erp-product-sync` MCP Server（Python）
- [ ] 实现 3 个核心工作流
- [ ] 实现 Listing 优化 UI 面板
- [ ] 端到端测试：安装 → 对话 → 调用 tool → 工作流触发

### Phase 3：模板化复制（持续）

- [ ] 海外仓 Skill Pack
- [ ] 尾程物流 Skill Pack
- [ ] 头程 Skill Pack
- [ ] 卡派 Skill Pack
- [ ] 客服 Skill Pack
- [ ] 报价 Skill Pack
- [ ] 财务 Skill Pack
- [ ] 每个 Pack = prompt + 2-3 个 MCP Server + 工作流模板

### Phase 4：Skill Pack Store（4-6 周）

- [ ] 在线 Skill Pack 仓库（类似 npm registry）
- [ ] Web 管理界面：浏览、安装、管理 Skill Pack
- [ ] MCP Tool Store：在线浏览、一键配置
- [ ] 计费系统对接

---

## 7. 技术约束与风险

| 风险 | 缓解措施 |
|------|---------|
| MCP Server 开发成本高 | 提供 Python/TypeScript MCP Server 脚手架，10 分钟出模板 |
| 行业 prompt 质量参差 | 内置 prompt 测试框架，量化评估输出质量 |
| 外部 API 不稳定 | MCP Server 内置重试 + 降级 + 缓存 |
| 多 Skill Pack 冲突 | 依赖声明 + 互斥检测 + 加载顺序控制 |
| 敏感信息泄露 | Vault 加密存储，manifest 中只允许 ${vault.xxx} 引用 |

---

## 8. 总结

**一句话**：Corey 基座提供 AI + 工具调用 + 工作流引擎，行业定制 = Prompt 包 + MCP Tool 包 + 可选 UI，全部配置驱动，核心代码零分支。

**核心价值**：
- 客户买的是同一个产品，只是启用了不同的 Skill Pack
- 新行业上线 = 写 prompt + 开发 MCP Server，不碰 Corey 核心代码
- 定制化从"改代码"变成"配插件"，交付周期从月级降到周级
