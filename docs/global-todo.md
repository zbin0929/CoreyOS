# CoreyOS 全局 TODO

> 版本：v2.0 · 2026-05-01
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

#### B-2. customer.yaml 白标机制
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **内容**：
  - [ ] customer.yaml schema 设计 + 解析器（runtime 加载）
  - [ ] 品牌定制（app_name / logo / primary_color 运行时替换）
  - [ ] 导航定制（hidden_routes / pin_to_primary）
  - [ ] Pack 预装 + 预填配置
  - [ ] 文件系统监听（修改 customer.yaml 后提示重启）
- **价值**：定制交付的核心载体——同一个二进制，靠 yaml 让客户看到不同产品
- **依赖**：无

#### B-3. Pack 加载器 + 12 视图模板
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **内容**：
  - [ ] manifest.yaml schema_version=1 解析器
  - [ ] Pack 扫描 + 启用 / 禁用 / 卸载生命周期
  - [ ] MCP server 子进程管理（隔离 + 崩溃恢复 + 跨平台二进制选择）
  - [ ] Workflow / Schedule / Skill 注册管道（按 pack_id 标签）
  - [ ] 视图渲染管道 + **12 个内置视图模板**：
    - DataTable / MetricsCard / TimeSeriesChart / PivotTable
    - TrendsMatrix / Timeline / AlertList / WorkflowLauncher
    - SkillPalette / FormRunner / RadarChart / CompositeDashboard
  - [ ] ActionPanel 嵌入（视图旁的"决策归还"按钮）
  - [ ] 数据目录设计：`skill-packs/<id>/` 只读 + `pack-data/<id>/` 永不被覆盖
  - [ ] Pack 升级前自动备份（zip 到 `~/.hermes/backups/`，保留 7 天）
  - [ ] manifest migrations 机制（跨版本字段迁移）
  - [ ] Pack 配置 UI（动态表单）+ 导入 zip 按钮 + 卸载 UI
- **价值**：所有行业 Pack 的运行时基础
- **依赖**：无（可与 B-2 并行）
- **架构**：详见 `docs/01-architecture.md` § Pack Architecture

#### B-4. License Features 联动 Pack 加载
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **内容**：
  - [ ] `mint-license.sh` 已有的 `--features` 字段在 license 验证时启用
  - [ ] Pack 加载器读 `manifest.license_feature`，校验客户 license 包含此 feature
  - [ ] 缺 feature 时 UI 显示"需要授权"占位（不加载 MCP / 不挂路由）
  - [ ] 续费 / 加 Pack 流程文档化（重新签 token → 客户粘贴）
- **价值**：Pack 防盗版（客户 A 拷给 B 用不了）+ 按 Pack 收费
- **依赖**：B-3
- **不做**：在线激活 / JWT / 心跳 / 客户后台（已有 ed25519 离线方案够用）

#### B-5. BGE-M3 离线 zip 包导入
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **内容**：
  - [ ] 交付一份 `bge-m3-offline.zip`（约 2.3GB，CI 自动打包）
  - [ ] Knowledge / 设置页加"导入离线模型包"按钮
  - [ ] 解压到 `~/.hermes/models/bge-m3/` + 大小校验 + 校验通过后启用 RAG
- **价值**：内网无网客户可直接拿到模型，不依赖联网下载
- **依赖**：无（B-1 基础上的扩展）
- **工时**：约 1-2 天

### 第 2 层 — 应做（影响交付质量）

#### B-6. 用量 / 费用分析仪表盘
- **状态**：📋 已有详细计划
- **目标版本**：v0.2.0
- **内容**：见 `docs/plans/v0.2.0-b4-analytics.md`
  - [ ] Token 消耗统计（按 Agent / 模型 / 天）
  - [ ] 费用估算（按模型价格表）
  - [ ] 30 天趋势图
  - [ ] 预算使用进度（关联 Budgets）
- **价值**：客户付费后必问"花了多少钱"
- **依赖**：B-3（用 MetricsCard + TimeSeriesChart 模板渲染）

#### B-7. 卸载 / 重置功能（FEAT-001）
- **状态**：🔴 未开始
- **目标版本**：v0.2.0
- **内容**：
  - [ ] 设置页"清除 Hermes 数据"按钮
  - [ ] 设置页"重置 Corey 配置"按钮（保留 license 与 Pack）
  - [ ] 完整卸载手册（Windows + macOS）
- **价值**：出问题时的逃生通道，客户支持成本下降

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

### P-1. 跨境电商 Pack（首发，对标麦多AI 9 能力）

- **状态**：🔴 未开始
- **目标版本**：v0.3.0
- **交付方式**：**一次性全做完**（不分 P-1.1 / P-1.2，第一版上线即完整）
- **前置**：B-2 + B-3 + B-4（基座 v0.2.0 必须就绪）
- **前置外部**：申请 Amazon SP-API 开发者账号（审核 1-2 周，建议 v0.2.0 启动时同步申请）
- **9 能力清单**（对标 `docs/competitor-maiduo-ai.md`）：

| # | 能力 | CoreyOS 实现 | 用到的视图 |
|---|------|------------|-----------|
| 1 | 战场地图 | CompositeDashboard 多视图组合 | CompositeDashboard + MetricsCard + TrendsMatrix + DataTable |
| 2 | AI 智能体（总管） | Hermes 多 Agent 编排（已具备） | 对话 + ActionPanel |
| 3 | 广告守卫机器人 | Workflow + SP-API MCP + Skill | DataTable + AlertList |
| 4 | 库存哨兵机器人 | Scheduler + MCP | AlertList |
| 5 | 差评监控机器人 | Workflow + MCP | AlertList + 文档 |
| 6 | 数据分析机器人 | Skill + RAG（销量历史） | DocViewer + ActionPanel |
| 7 | 市场分析机器人 | Skill + 报告生成 | DocViewer |
| 8 | 战场雷达机器人 | Workflow + Browser Automation 抓竞品 | Timeline |
| 9 | 六维诊断机器人 | Skill + 多维评分 | RadarChart + AlertList |

- **核心交付物**：
  - [ ] `mcp-amazon-sp` MCP Server（Rust 或 Python，跨平台预编译，约 5-7 天）
  - [ ] manifest.yaml + 9 个 view 配置 + 12 个 Skill + 5 个 Workflow + 5 个 Schedule
  - [ ] 行业 Persona（prompts/soul.md）
  - [ ] 出厂数据（关键词词典 / 品类映射 / 合规术语）
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

> ⚠️ **不主动开发**。等到有真实付费客户签合同时再启动对应 Pack。每个 Pack 的设计沿用跨境电商 Pack 模板（manifest + 视图 + Skill + Workflow + MCP）。

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

v0.3.0（约 3-4 周）— 跨境电商 Pack 完整版
├── P-1  跨境电商 Pack（9 能力一次性全做）
└── 第一个真实客户上线

v0.4.0+ — 按客户需求拉新 Pack
└── 真实客户合同 → 启动对应 Pack（不主动）
```

---

## 五、依赖关系图

```
B-1 (RAG ✅) ───────────────────┐
                                ├─► P-1 (跨境电商 Pack)
B-2 (白标 customer.yaml) ──────┤      │
B-3 (Pack 加载器+12 视图模板) ─┤      │
B-4 (License Features 联动) ───┤      └─► 第一个真实客户
B-5 (BGE-M3 离线包) ───────────┤
                                │
B-6 (用量分析) ─────────────────┘ （依赖 B-3 视图模板）
B-7 (卸载/重置)  独立

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
| v0.1.13 | 📋 | Windows 端到端实测 + 验证收尾 |
| v0.2.0 | 📋 | 基座定制能力（白标 + Pack 加载器 + 12 视图模板 + license features） |
| v0.3.0 | 📋 | 跨境电商 Pack 完整版 + 第一个真实客户 |

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
| 2026-04-30 | 跨境电商 Pack 一次性全做 9 能力 | 第一版上线即完整 |
| 2026-04-30 | Persona 系统并入 Pack `soul_inject` | 不做单独系统 |
| 2026-04-30 | 不做商店 / 后台 / 远程心跳 | 与定制模式冲突 |

---

## 九、当前 Bug 跟踪

> 历史 Bug 修复见 `docs/bug-history.md`。

### 待 Windows 实测验证（v0.1.13 目标）

- BUG-007~009：数据目录统一后，Windows 上旧的 `E:\Corey\data\` 需手动删除
- BUG-008：对话白圈在 Windows 实测确认已解决
- BUG-010：BGE-M3 文件大小校验后触发重新下载

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
