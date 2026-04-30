# 麦多AI（MaiduoX AI）竞品调研

> 创建日期：2026-04-30
> 调研者：Cascade（基于 eccang.com 官方资讯整理）
> 用途：CoreyOS 跨境电商 Pack 产品定义与基座视图模板设计的对标参考
> 状态：永久文档，后续 Pack 迭代时回查

---

## 一、产品概况

| 项目 | 内容 |
|------|------|
| **产品名** | 麦多AI（MaiduoX AI） |
| **出品方** | 易仓科技（ECCANG），深圳，2013 年创立 |
| **发布时间** | 2026 年初（春节前后正式向所有客户开放） |
| **定位口号** | "易仓ERP 是躯干，麦多AI 是大脑" |
| **核心绑定** | 必须先是易仓 ERP 客户才能使用 |
| **商业模式** | 免费送给易仓 ERP 老客户，用于留存和防止客户流失到其他 ERP |
| **冷启动数据** | 上线两周达 **800+ 客户、5000+ 店铺** 接入 |
| **目标用户** | 亚马逊运营总监 / 卖家老板 |

## 二、产品形态：9 个垂类智能体

麦多AI 自我定位为"AI 智能体矩阵"，包含 9 个固定预设的智能体（用户不能自定义新增）：

| # | 智能体 | 核心功能 | 触达方式 | 视图特征 |
|---|--------|---------|---------|---------|
| 1 | **战场地图** | Top 5 ASIN 上帝视角：竞品 / 热词 / 转化率 / 资金火力 | 自动生成（Top 5 ASIN） | 复合 Dashboard |
| 2 | **AI 智能体（总管）** | 70-100 步深度归因 → 浓缩为执行按钮（否词/关停/拦截） | 对话 + Action | 对话 + ActionPanel |
| 3 | **广告机器人** | 自动否词 / 关停 / ACoS 优化 | 后台巡检 | 表格 + 异常列表 |
| 4 | **库存机器人** | 断货 / 积压预警 | 后台巡检 + 推送 | AlertList |
| 5 | **差评机器人** | 24×7 监控所有 ASIN 差评，AI 翻译 + 提炼核心诉求 | 后台巡检 + 推送 | AlertList + Markdown |
| 6 | **数据分析机器人** | 销量变动归因 → 给出行动建议 | 触发即查 | 文字报告 + ActionPanel |
| 7 | **市场分析机器人** | 输入 ASIN → 健康度 → 自动生成《本周运营策略》 | 输入触发 | 文档报告 |
| 8 | **战场雷达机器人** | 竞品时间轴：谁开 Coupon、改主图、改价格 | 后台巡检 | **Timeline** |
| 9 | **新老诊断机器人** | 销售/库存/流量/广告/评分/退货 **六维红绿灯** + AI 1 分钟诊断方案 | 触发即查 | **RadarChart + AlertList** |

## 三、核心宣传卖点（市场话术摘录）

- **"店铺巡检 3 小时 → 5 分钟"**（运营时间压缩）
- **"70-100 步深度归因"**（多步推理深度）
- **"决策归还"**——把分析浓缩成"执行按钮"，一点即落地（agentic action 闭环）
- **"7×24 小时全域感知能力"**
- **"800 余位老客户、5000 多个店铺验证"**
- 把竞品 OpenClaw（"小龙虾"）作为映射，自称"国内安全版小龙虾"

## 四、技术与产品策略推断

| 维度 | 麦多AI 的选择 |
|------|--------------|
| **数据来源** | 强绑定易仓 ERP 数据库（订单/库存/广告/评论） + 亚马逊 SP-API |
| **部署形态** | 公有 SaaS（用户登录易仓 ERP 账号即用） |
| **能力扩展** | **不开放**。9 个智能体是固定预设，用户不能加新场景 |
| **二开/集成** | 不开放二次开发，不支持其他 ERP 数据源 |
| **行业覆盖** | **只做亚马逊**（部分能力延伸到沃尔玛 / 美客多） |
| **多 Agent 编排** | 看起来是固定流水线（不可视化编辑工作流） |

## 五、它的局限（CoreyOS 的差异化机会）

| 麦多AI 短板 | CoreyOS 差异化打法 |
|-----------|-------------------|
| 强绑定易仓 ERP，没用易仓的客户进不去（占跨境市场 70%+） | 不绑 ERP，通过 **MCP** 接任何 ERP / Excel / 自建系统 |
| 公有 SaaS，数据上云 | **本地部署 + 白标**，大客户合规 |
| 9 个垂类预设，用户不能加新场景 | 支持 **Skill + Workflow 自定义**，用户可落地非标场景 |
| 只做亚马逊 | **Pack 机制**可拓展财务 / 物流 / 客服等行业 |
| 封闭生态，不开放二开 | **MCP + Skill Pack** 是开放协议 |
| 智能体固定 9 个 | 用户可通过对话生成新 Skill |

## 六、对 CoreyOS 架构决策的关键启示

### 启示 1：基座视图模板从 10 个补到 12 个

麦多AI 的"战场地图"和"六维诊断"暴露了之前漏的两类视图。最终 Tier 1 模板清单：

```
1.  DataTable             通用表格
2.  MetricsCard           KPI 卡片
3.  TimeSeriesChart       折线 / 柱状 / 区域
4.  PivotTable            多级行项目展开（P&L / 损益）
5.  TrendsMatrix          产品 × 时间 + sparkline + 涨跌着色（Sellerboard 同款）
6.  Timeline              时间轴（货物追踪 / 战场雷达）
7.  AlertList             异常 / 预警列表
8.  WorkflowLauncher      Pack 工作流入口
9.  SkillPalette          Pack Skill 入口
10. FormRunner            表单 → MCP → 结果
11. RadarChart      ⭐    多维评分（六维诊断 / 健康度）
12. CompositeDashboard ⭐ 栅格容器（战场地图式多视图组合）
```

⭐ = 来自麦多AI 启示新加。

### 启示 2：Pack manifest 必须支持"动作面板嵌入"

麦多AI 的杀手锏是**"决策归还"——分析旁边直接放执行按钮**。每个视图都应该能在右侧 / 底部贴一组 ActionButton：

```yaml
views:
  - id: ad-monitor
    title: 广告守卫
    template: DataTable
    data_source: { mcp: amazon-sp, method: list_underperforming_ads }
    columns: [campaign, acos, spend, sales]
    actions:                          # ← 关键
      - { label: "否词", workflow: negate_keyword }
      - { label: "关停广告", workflow: pause_campaign }
      - { label: "调整出价", skill: adjust_bid }
```

### 启示 3：CompositeDashboard 用栅格 YAML 描述

不需要做拖拽编辑器，Pack 作者在 manifest 里手写 grid layout：

```yaml
views:
  - id: battleground
    title: 战场地图
    template: CompositeDashboard
    layout:
      - { x: 0, y: 0, w: 6, h: 4, view: { template: MetricsCard, ... } }
      - { x: 6, y: 0, w: 6, h: 4, view: { template: TrendsMatrix, ... } }
      - { x: 0, y: 4, w: 12, h: 6, view: { template: DataTable, ... } }
```

### 启示 4：跨境电商 Pack **直接对标麦多AI 9 个能力**

不要原创设计，先做"复刻 + 差异化"。差异化点只有三个：
1. **本地部署**
2. **不绑 ERP**（通过 MCP 接客户已有系统）
3. **用户可自定义新场景**（Skill / Workflow 编辑器）

| 麦多AI 能力 | CoreyOS 实现路径 | 难度 |
|-----------|-----------------|------|
| 战场地图 | CompositeDashboard + 多视图组合 | 中 |
| AI 智能体（总管） | Hermes 多 Agent 编排（**已具备**） | 已具备 |
| 广告机器人 | Workflow（每日触发）+ Amazon SP-API MCP + Skill | 易 |
| 库存机器人 | Scheduler + MCP + AlertList | 易 |
| 差评机器人 | Workflow + SP-API MCP + AlertList | 易 |
| 数据分析机器人 | Skill + RAG（销量历史） | 中 |
| 市场分析机器人 | Skill + DocViewer（生成 .md 报告） | 中 |
| 战场雷达 | Workflow + Browser Automation 抓竞品 + Timeline | 中-难 |
| 六维诊断 | Skill + RadarChart | 易 |

**结论：CoreyOS 用现有基座 + 跨境电商 Pack 能复刻 8/9 个能力，仅"战场雷达"需 Browser Automation（已有 Phase 10）。**

## 七、商业定位指引

- **不要去抢易仓 ERP 客户的生意** — 他们已经免费拿到麦多AI
- **目标客户**：不用易仓 ERP 的卖家（占跨境市场 70%+），即用船长 BI / 店小秘 / 积加 / 自建 ERP 的卖家
- **更高目标客户**：想要"本地部署 + 数据不出公司 + 多 ERP 集成"的中大型卖家——这是公有 SaaS 麦多AI 做不到的

## 八、行动清单（已应用到产品设计）

- [x] 视图模板清单从 10 个补到 12 个（RadarChart + CompositeDashboard）
- [x] Pack manifest schema 加入 `actions:` 段，支持视图旁动作按钮
- [x] 跨境电商 Pack 产品定义对标麦多AI 9 个能力
- [ ] Pack 加载机制设计时考虑 ActionPanel 嵌入位置（右栏 / 底栏）
- [ ] CompositeDashboard 模板用栅格 YAML 描述（非拖拽编辑器）

## 九、信息来源

- https://www.eccang.com/news/4549 — 易仓老客户专属通道发布
- https://www.eccang.com/news/4685 — 国内版"小龙虾"麦多AI 24 小时干活
- https://www.eccang.com/news/4667 — 致亚马逊运营总监：风险与未知托管给麦多AI
- https://www.eccang.com/news/4606 — 10 年亚马逊老兵转型麦多AI
- https://www.eccang.com/news/4703 — 龙虾养不活？麦多AI 已经养好

## 十、再次调研触发条件

- 麦多AI 推出"自定义智能体"或"开放二开" → 需重新评估差异化策略
- 麦多AI 接入其他 ERP / 跨平台 → 直接威胁 CoreyOS 目标客户群
- 麦多AI 发布"本地部署版" → 触发紧急对标
- 易仓 ERP 用户量从 30000+ 显著增长 → 评估护城河深度
