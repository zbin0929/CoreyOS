# 物流·头程·海运·仓储·关税 技能广场 — 学习笔记

> 来源：`docs/newinfos/物流头程海运仓储关税技能广场完整文档.md`
> 采集日期：2026-05-27 | 原始技能总数：113个

---

## 一、技能品类总览

| 品类 | 技能数 | 代表技能 | CoreyOS Pack相关度 |
|------|--------|---------|-------------------|
| 海运/头程/货运 | 7 | shipping-booking, eyun-freight, eyun-watch | ★★★★★ 核心 |
| FBA/亚马逊物流 | 9 | amazon-fba-prep, fba-finder, fba-margin-calculator | ★★★★★ 核心 |
| 仓储/海外仓 | 8 | warehouse-mgmt, 3pl-integration | ★★★★ 重要 |
| 快递追踪/物流查询 | 21 | qantas-freight-tracking, tracking-api | ★★★ 辅助 |
| 运费计算/物流优化 | 24 | freight-calculator, route-optimizer | ★★★★ 重要 |
| 海关/关税 | 18 | hs-code-lookup, duty-calculator, cargo-claim-drafter | ★★★★ 重要 |
| 退货/逆向物流 | 6 | return-handler, refund-processor | ★★★ 辅助 |
| 供应链/3PL/一件代发 | 20 | dropshipping-sourcing, supply-chain-mgmt | ★★★ 辅助 |

**缺口提示**：暂无 UPS/FedEx/USPS 专属API技能

---

## 二、高价值技能详解

### 2.1 shipping-booking（海运托书提取器）

**功能**：从各种格式的海运托书文件中提取结构化JSON数据

**关键设计模式**：
- 支持PDF/图片/Excel/Word/RTF多格式输入
- 需要AI视觉模型（图片/PDF场景）
- 触发条件=文件上传+关键词匹配（双条件必须同时满足）
- 输出标准JSON，可对接下游系统

**CoreyOS参考价值**：文档OCR+AI结构化提取的标准模式

### 2.2 cargo-flight（flyai货运航线查询）

**功能**：通过CLI调用flyai查询推荐/最便宜/最快/直飞货运航线

**工作流程**：
```
1. 收集参数（起运地、目的地、货物类型、重量等）
2. 参数映射（中文→IATA代码、货物→SHC代码）
3. 执行CLI命令: flyai route [子命令] [参数]
4. 格式化输出：推荐航线表格
5. 业务校验：ULD匹配、温控要求等
```

**参数域知识**：
- 地理映射：城市名→IATA三字码（上海→PVG/SHA, 洛杉矶→LAX）
- 货物分类→SHC特殊处理代码（活体动物AVI, 危险品DGR, 冷藏PER）
- 单位统一：重量→公斤, 体积→CBM, 温度→摄氏度

### 2.3 cargo-claim-drafter（Carmack Amendment货损索赔草案）

**功能**：起草美国州际货运货损/货差索赔函

**四阶段流程**：
```
Phase 1: Shipment Intake（运单信息采集）
├─ 采集BOL号、PRO号、承运人、发/收货方
├─ 货物明细：描述、数量、重量、declared value
└─ 只能从BOL/PRO文件中提取，禁止编造

Phase 2: Exception & Evidence（异常与证据）
├─ 损坏类型：loss/damage/shortage/concealed damage
├─ 发现时间线：送达→签收→检查→发现→通知
├─ 证据清单：照片、签收备注、OS&D报告
└─ 9个月时效提醒（Carmack Amendment要求）

Phase 3: Claim Computation（金额计算）
├─ 选择计算方法：invoice/declared/replacement/salvage
├─ 计算公式：claim = value - salvage + mitigation + freight
└─ 所有金额精确到分（$X,XXX.XX格式）

Phase 4: Letter Drafting（函件起草）
├─ 包含法律引用（49 U.S.C. §14706）
├─ 30天回复期限要求
└─ 草案标签：DRAFT — MUST BE REVIEWED BY QUALIFIED COUNSEL
```

**CoreyOS参考价值**：专业法律文书AI起草的标准流程模板

### 2.4 cargo-policy-analyzer（航空货运政策分析器）

**功能**：分析比较中国各省份航空货运扶持政策

**分析维度**：补贴力度、覆盖范围、申请条件、兑现时效、政策稳定性、产业配套

**输出**：政策汇总表+综合分析报告（全景图+排行+投资建议+风险提示）

### 2.5 eyun-freight / eyun-watch（Eyun运价系统）

**模式**：AI作为"透明传话者"，用户↔远端Eyun系统

**eyun-freight（运价查询）**：
- 步骤零：查配置（`openclaw config get skills.entries.eyun_freight`）
- 步骤一：调用curl POST → `{BASE_URL}/chat/sync`
- 步骤二：原文转发answer字段，保持session_id做多轮会话
- 行为准则：禁止旁白、禁止确认、禁止替用户决定、禁止创造内容

**eyun-watch（盯价任务）**：
```
收集航线参数(pol/pod) → 确认目标价格 → 最终确认展示
→ 确保cron就绪(openclaw cron add eyun-watch-poll) → 创建盯价任务
→ 回复用户+自动推送机制
```

**CoreyOS参考价值**：
- "透明代理"模式：AI不加工信息，只做传话者
- cron集成模式：后台轮询+主动推送通知
- 严格的角色约束：禁止AI擅自添加判断/建议

### 2.6 FBA相关技能簇（9个）

| 技能 | 核心功能 | 特色 |
|------|---------|------|
| amazon-fba-prep | FBA发货准备指南 | FNSKU标签+包装要求+常见拒收原因 |
| amazon-fba-finder | 高利润产品发现 | 机会评分=销售速度×30%+(100-竞争度)×25%+利润率×30%+趋势×15% |
| skill-fba-margin-calculator | FBA费用利润计算 | Amazon UAE FBA费率+DG危险品判定 |
| amazon-fba | FBA综合运营指南 | 全流程覆盖 |
| amazon-fba-product-finder | 产品发现引擎 | 类似fba-finder |
| mguozhen-amazon-fba-calculator | FBA计算器 | 中文向 |
| ecommerce-amazon-fba-calculator | 电商FBA计算器 | 多平台支持 |
| amazon-fba-ops | FBA运营操作 | 日常运营SOP |
| amazon-logistics-calculator | 物流成本计算 | 多物流方式对比 |

---

## 三、对CoreyOS跨境电商Pack的启示

### 3.1 可直接复用的能力

| 能力 | 对应Pack功能 | 实现方式 |
|------|------------|---------|
| 运价查询 | 物流成本分析 | 集成eyun-freight模式的API代理 |
| FBA费用计算 | 利润分析模块 | 内置FBA费率表+计算引擎 |
| 海关关税查询 | 合规检查 | HS编码映射+税率数据库 |
| 物流追踪 | 物流监控面板 | 多承运商API聚合 |
| 货损索赔 | 法务辅助 | 模板化文书生成 |

### 3.2 关键设计模式提取

1. **透明代理模式**（eyun系列）：AI不修改远端返回内容，适合对接外部专业系统
2. **CLI工具封装模式**（cargo-flight）：将复杂CLI工具用自然语言包装，参数映射是关键
3. **多阶段表单模式**（cargo-claim-drafter）：复杂任务分Phase收集信息，每阶段有校验
4. **配置优先模式**：所有外部API的URL/Key通过`openclaw config get`获取，禁止硬编码
5. **cron集成模式**（eyun-watch）：后台定时任务+主动推送，适合监控类场景

### 3.3 FBA费率速查（2026估算）

**Amazon US FBA配送费**：
| 尺寸等级 | 重量上限 | 费用 |
|---------|---------|------|
| Small Standard | 1lb | $3.22+ |
| Large Standard | 3lb | $4.75-$5.40 |
| Large Standard | 20lb | $5.40-$9.73 |
| Small Oversize | 70lb | $9.73+ |
| Large Oversize | 150lb | 按重量计 |

**Amazon UAE FBA配送费**：
| 尺寸等级 | 重量上限 | 费用(AED) |
|---------|---------|----------|
| Small Standard | 150g | 10 |
| Standard S | 350g | 13.5 |
| Standard M | 700g | 16.5 |
| Standard L | 1kg | 20 |
| Large Standard | 2kg | 26 |
| Oversize | 2kg+ | 38 |

---

## 四、关键术语表

| 术语 | 全称 | 说明 |
|------|------|------|
| BOL | Bill of Lading | 提单/海运提单 |
| PRO | Progressive Number | 承运人跟踪号 |
| AWB | Air Waybill | 空运运单 |
| POL | Port of Loading | 起运港 |
| POD | Port of Discharge | 目的港 |
| ETD | Estimated Time of Departure | 预计出发时间 |
| ETA | Estimated Time of Arrival | 预计到达时间 |
| IATA | International Air Transport Association | 国际航空运输协会 |
| SHC | Special Handling Code | 特殊处理代码 |
| ULD | Unit Load Device | 集装器 |
| CBM | Cubic Meter | 立方米 |
| MOQ | Minimum Order Quantity | 最小起订量 |
| DG | Dangerous Goods | 危险品 |
| HS Code | Harmonized System Code | 海关编码 |
| FBA | Fulfillment by Amazon | 亚马逊物流 |
| WFS | Walmart Fulfillment Services | 沃尔玛物流 |
| 3PL | Third-Party Logistics | 第三方物流 |
| OS&D | Over, Short, and Damage | 货物溢短损 |

---

> **总结**：113个物流技能中，与跨境电商Pack最相关的是FBA系列(9个)+海运查询(eyun)+关税计算(18个)。核心设计模式是"透明代理"和"CLI工具封装"。FBA费率计算和物流成本优化是Pack必备能力。
