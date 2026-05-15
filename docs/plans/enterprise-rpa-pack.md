# 企业 RPA Pack 架构 — 设计 / 执行 / 扩展

> 创建日期：2026-05-14
> 最后更新：2026-05-15（燃油费率 API 方案已交付）
> 适用范围：所有 CoreyOS 企业定制客户（首个案例：美正）
> 目标版本：v0.3.0（美正落地）→ v0.4.x（架构通用化）
> 关联文档：`docs/01-architecture.md` § Pack Architecture v2.0、`docs/status/hermes-deps.md`、`docs/competitor-maiduo-ai.md`
>
> **2026-05-15 更新**：需求 #6（燃油费率）已从浏览器自动化方案升级为 API 直写方案并交付。美正OS 的燃油费率模块有完整的 REST API（login → CREATE → audit），单次更新从 8 分钟 / 6.3M tokens 降至 **1.5 秒 / 5K tokens**。其余 5 条需求仍按原计划，待客户对齐后启动。

---

## 零、前置工作：熟悉美正OS

在任何工程动作之前，先把美正OS 这套系统摸透。目标是让 Corey 团队有和客户同等级别的操作熟练度，确保后续 Adapter/Workflow 的需求不会靠猜。

### 0.1 封面调查（信息收集）

1. **账号与环境**：
   - 向客户索取至少两个真实账号（admin + finance/业务），确认是否需要 VPN/内网。
   - 让客户说明权限矩阵、常用模块入口、关键业务流程。
2. **文档资产**：
   - 收集美正OS 官方/内部操作手册、培训 PPT、FAQ。
   - 如果没有现成文档，约 30 分钟访谈录屏，请客户边操作边讲。
3. **系统版本与发布节奏**：了解美正OS 前端技术栈、每周/每月释放窗口、是否有可订阅的发布公告渠道。

### 0.2 路线踏勘（手把手实操）

1. **模块地图**：
   - 登录后逐页浏览，形成 sitemap（菜单结构、URL 结构、关键跳转）。
   - 对“汇率”“承运商设置”“订单管理”“财务中心”等模块写 1 行描述。
2. **目标流程拆解**（对应 6 条需求）：
   - 汇率维护：定位新增/编辑页面，观察字段、校验、提交反馈。
   - 承运商分区/燃油费率：找到上传/录入界面，记录模板下载格式。
   - 订单取消：记录订单列表→详情→取消按钮的路径、任何二次确认。
   - 发票/费用：确认导入/导出入口、支持的文件格式、校验规则。
3. **DOM 结构截取**：
   - 使用 Chrome DevTools/Playwright Inspector 抓 key selector（按钮、表格、输入框），截图存档。
   - 记录所有需要自动化的页面的 iframe / 动态加载特性。
4. **权限差异复盘**：
   - Admin / Finance / Logistics / Dropship 等账号逐个体验上述流程，记录能见/能操作的元素差异。

### 0.3 观察记录标准化

1. **Observation 日志模板**：`pack-data/meizheng/notes/` 建 Markdown 模板，字段包含：日期、账号、模块、路径、DOM selector、交互细节、注意事项。
2. **录屏归档**：所有探索操作录屏，命名规范 `yyyy-mm-dd_module_role.mp4`，存入共享盘。
3. **问题清单**：把模糊点、疑问、潜在风险汇总到 `open-questions.md`，供 Kickoff 会议追问。

完成标准：
- `notes/` 下每个目标流程都有一份 observation 记录。
- key selector 清单覆盖未来需要自动化的所有 UI 元素。
- 权限矩阵明确：哪个角色能够执行每个流程。
- 未解问题列入 Kickoff 待对齐事项。

## 一、设计目标与非目标

### 1.1 设计目标

- **统一 Pack 模型**：每个企业客户 = 一个 Pack，所有定制内容（skills、workflows、cron、views、Adapter）落在 `~/.hermes/skill-packs/<customer>/`
- **零额外硬件**：不要求客户买专用服务器，复用员工现有 PC
- **混合部署**：固定办公电脑（runner）跑 cron + 业务员笔记本（end_user）跑实时操作
- **目标系统无 API 也能做**：默认走 Browser Automation（RPA），目标系统出 API 时无缝切换
- **权限感知**：每个 workflow 声明所需角色，UI 视图按用户角色过滤
- **跨平台**：Windows + macOS 同等支持（XP-1 铁律）
- **可扩展**：新客户、新需求遵循同一套 Pattern + manifest，不重写底盘

### 1.2 非目标

- ❌ 不做 SaaS 多租户云服务（PD-1：本地部署 + 合同制）
- ❌ 不做拖拽式可视化流程编辑器（v2.0 已砍）
- ❌ 不做 Hermes 已有能力的二次实现（HD-1/HD-2）
- ❌ 不做客户管理后台
- ❌ 不做"用户群超大不可控"的方案

---

## 二、参考客户：美正

### 2.1 已知需求清单

| # | 需求 | 模式 | 触发 | 跑在哪 |
|---|---|---|---|---|
| 1 | 中行美金现汇卖出价 → 美正OS | A: Scrape → Push | 工作日 09:31 后 | runner |
| 2 | UPS/Fedex/USPS 月度分区文件 → 美正OS | B: 多源下载 → 规则 → Push | 每月 1 号后 | runner |
| 3 | 财务发票自动化 | D: 文档 → 结构化 → Push | 邮件/上传事件 | runner |
| 4 | 领星费用导出 → 美正OS | B: RPA 导出 → Push | 每月 1-3 号 | runner |
| 5 | 一件代发订单取消 | C: 事件 → 操作 | UI 按钮 | end_user |
| 6 | UPS/Fedex/DHL 燃油费率 | **API 直写**（非浏览器）| 每周日 23:30 + 每月 1 号 02:00 | runner | ✅ 已交付（2026-05-15）|

### 2.2 关键约束

- **美正OS 有 REST API**（燃油费率模块已验证：login → CREATE → audit），其他模块待确认
- **跨平台**：员工有 Win 有 Mac
- **角色权限**：不同员工在美正OS 内角色不同，可见数据 + 可用功能不同
- **固定机器**：财务、物流办公室有固定开机的电脑可承担 runner 角色
- **业务员**：用笔记本，移动办公

---

## 三、核心架构

### 3.1 组件总览

```
┌─────────────────────────────────────────────────────────┐
│                Pack: meizheng (Corey 安装包)             │
│                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────────────┐   │
│  │  Skills   │  │ Workflows │  │  Views (12 模板)   │   │
│  │ (Pattern  │→ │ (DAG yaml)│→ │  (DataTable / 战  │   │
│  │  knowledge│  │           │  │   场地图 / etc.)  │   │
│  └───────────┘  └─────┬─────┘  └───────────────────┘   │
│                       │                                 │
│                       ▼                                 │
│              ┌─────────────────┐                        │
│              │  Cron triggers  │                        │
│              │  (Hermes 原生)   │                        │
│              └─────────────────┘                        │
│                       │                                 │
│                       ▼                                 │
│   ┌────────────────────────────────────────────────┐   │
│   │  Adapter MCP: meizheng-os                      │   │
│   │  (预编译二进制 × 4 平台)                         │   │
│   │  内部：Playwright headless → 美正OS UI          │   │
│   │  Session 持久化、登录维护、读后写、验证回读      │   │
│   └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
        ▲                                  ▲
        │  分布式锁 / 心跳 / 审计           │  用户触发
        ▼                                  ▼
   ┌───────────┐                    ┌───────────┐
   │ runner #1 │  ←── failover ──→ │ runner #2 │
   │ 财务办公  │                    │ 物流办公  │
   └───────────┘                    └───────────┘
        ▲ (同 Pack，deployment_role=runner)
                                          
   ┌───────────┐  ┌───────────┐  ┌───────────┐
   │ user #1   │  │ user #2   │  │ user #N   │
   │ 业务员笔记本(deployment_role=end_user)     │
   └───────────┘  └───────────┘  └───────────┘
        │
        ▼
   ┌─────────────────────────────────────────────────┐
   │  美正OS（目标系统 + 分布式协调点）              │
   │  - 业务数据                                     │
   │  - corey_locks 表（任务去重锁 + 心跳）           │
   │  - 用户权限模型                                 │
   └─────────────────────────────────────────────────┘
```

### 3.2 五层抽象

| 层 | 职责 | 实现方 |
|---|---|---|
| **Cron** | 时间触发 | Hermes 原生 `~/.hermes/cron/jobs.json`，Pack 安装时写入 |
| **Workflow** | DAG 编排（步骤、重试、并行、断言、审批）| Corey `workflow_engine/`（需增强）|
| **Skill** | 领域知识（页面长啥样、字段叫啥、坑在哪）| Pack `skills/<id>/SKILL.md`（Hermes skill 格式）|
| **Adapter（MCP）** | 把目标系统包成 tools | Pack `mcp/<adapter>/`，预编译二进制 |
| **Pattern** | 同类 workflow 的可复用模板（A/B/C/D）| Pack `templates/patterns/` |

---

## 四、Pack 目录布局（美正实例）

```
~/.hermes/
├── skill-packs/meizheng/                  ← 只读，跟随版本升级
│   ├── pack.yaml                          ← manifest（见 § 4.1）
│   ├── soul/
│   │   ├── runner.md                      ← runner 用 soul（专业+严格）
│   │   └── end_user.md                    ← end_user 用 soul（贴心+引导）
│   ├── skills/
│   │   ├── boc-rate-fetch/SKILL.md        ← Pattern A 实例
│   │   ├── carrier-zone-fetch/SKILL.md    ← Pattern B 实例
│   │   ├── carrier-fuel-fetch/SKILL.md    ← Pattern A 实例
│   │   ├── lingxing-export/SKILL.md       ← Pattern B 浏览器版
│   │   └── invoice-ingest/SKILL.md        ← Pattern D
│   ├── workflows/
│   │   ├── daily-fx-rate.yaml             ← #1
│   │   ├── monthly-zone-update.yaml       ← #2
│   │   ├── invoice-pipeline.yaml          ← #3
│   │   ├── monthly-lingxing-fees.yaml     ← #4
│   │   ├── dropship-cancel.yaml           ← #5
│   │   └── weekly-fuel-surcharge.yaml     ← #6
│   ├── cron/jobs.yaml                     ← 触发表
│   ├── views/
│   │   ├── home-runner.yaml               ← 战场地图（runner 视角）
│   │   ├── home-end_user.yaml             ← 业务员主页
│   │   └── audit.yaml                     ← 审计页
│   ├── templates/patterns/                ← A/B/C/D 模板（Pack 间复用）
│   └── mcp/meizheng-os/
│       ├── pack.json                      ← MCP server 元数据
│       ├── darwin-arm64/meizheng-os-mcp
│       ├── darwin-x64/meizheng-os-mcp
│       └── windows-x64/meizheng-os-mcp.exe
│
└── pack-data/meizheng/                    ← 用户数据，永不被覆盖
    ├── customer.yaml                      ← 部署角色配置（每台机不同）
    ├── credentials.enc                    ← AES-GCM 加密凭证
    ├── browser-profiles/
    │   └── meizheng-os/                   ← 持久 Chromium user-data-dir
    ├── rules/
    │   ├── ups-zone-rules.yaml            ← 业务方可编辑
    │   ├── fedex-zone-rules.yaml
    │   └── usps-zone-rules.yaml
    ├── templates/
    │   └── invoice-fields.yaml
    ├── audit/
    │   └── 2026-05/                       ← 按月分目录
    │       └── <workflow>-<run_id>.json
    └── runs.db                            ← SQLite，run 历史、字段 diff
```

### 4.1 `pack.yaml` 示例（节选）

```yaml
pack_id: meizheng
version: 0.1.0
customer: 美正
soul_inject:
  runner: soul/runner.md
  end_user: soul/end_user.md
mcp_servers:
  meizheng-os:
    binary: mcp/meizheng-os/{platform}/meizheng-os-mcp{ext}
    transport: stdio
    env:
      MEIZHENG_OS_BASE_URL: ${customer.meizheng_os_url}
      MCP_DATA_DIR: ${pack_data_dir}/mcp/meizheng-os
deployment_roles: [runner, end_user]
user_roles: [admin, finance, logistics, dropship_operator, customer_service]
required_features: [browser_automation, distributed_lock]
```

### 4.2 `customer.yaml`（每台机一份，部署时落地）

```yaml
# 财务 A 办公电脑
deployment_role: runner
runner_id: runner-finance-1
user_role: finance
display_name: 财务-张三办公电脑
intranet_only: true                    # 美正OS 仅内网可达
power_management: keep_awake_on_ac
notification_channels: [wechat_work, desktop]
```

```yaml
# 业务员 王五 笔记本
deployment_role: end_user
user_role: dropship_operator
display_name: 业务-王五
intranet_only: false                   # 出差也能用（VPN）
power_management: respect_user
notification_channels: [desktop]
```

---

## 五、运行时设计

### 5.1 调度模型：「时间窗 + Owner + 分布式锁 + Failover」

每个 cron workflow 在 manifest 里声明：

```yaml
# workflows/daily-fx-rate.yaml
id: daily-fx-rate
trigger:
  type: cron
  schedule: "first_after 09:31 mon-fri"        # 时间窗而非准点
  fallback_window: 4h                          # 超过 4h 没跑 → 标 missed
owners:
  primary:
    deployment_role: runner
    user_role: [finance, admin]
  fallback:
    deployment_role: runner
    user_role: [logistics, admin]
    trigger_after_primary_offline: 30min
deduplication:
  key: "fx-rate-USD-${date}"
  ttl: 24h
  scope: cluster                                # 全公司一次
permission_check:
  - tool: meizheng-os.probe_permission
    require: { can_write_fx_rate: true }
notify_on:
  success: [desktop]
  fail: [wechat_work, desktop]
  human_required: [wechat_work]
steps:
  - id: fetch
    skill: boc-rate-fetch
    params:
      currency: USD
      after_time: "09:30:00"
    retry: { count: 3, backoff: 60s }
  - id: validate
    type: assert
    expr: "5.0 < fetch.rate < 9.0"
  - id: push
    mcp_tool: meizheng-os.update_fx_rate
    params:
      currency: USD
      rate: ${fetch.rate}
      effective_date: ${today}
    verify_readback: true
  - id: audit
    type: write_audit
```

### 5.2 分布式锁实现

**位置**：美正OS 内一张轻量表（合同里要求客户配合开放）。Fallback：客户网盘共享目录。

锁记录 schema：

```json
{
  "key": "fx-rate-USD-2026-05-14",
  "workflow_id": "daily-fx-rate",
  "claimed_by": "runner-finance-1",
  "claimed_at": "2026-05-14T09:31:12Z",
  "heartbeat_at": "2026-05-14T09:31:42Z",
  "completed_at": "2026-05-14T09:31:45Z",
  "status": "ok | running | failed | missed",
  "result_summary": "USD = 7.1234",
  "error": null
}
```

抢锁协议（每个 Corey runner 每 60s tick 一次）：

1. 计算 `key`（含日期等）
2. `SELECT WHERE key = ? AND completed_at IS NULL`
3. 已有 record：
   - `status=running` 且 `now - heartbeat > 5min` → 视为崩溃，可强抢
   - 否则跳过
4. 无 record 或可强抢 → `INSERT ... ON CONFLICT DO NOTHING`（依赖 key 唯一约束）
5. INSERT 成功的 runner 是 winner，开跑
6. 每 30s 更新 heartbeat
7. 完成时写 `completed_at + status + summary`

### 5.3 心跳与离线判定

每台 runner 每 60s 上报到同一张表的 `corey_heartbeats`：

```json
{ "runner_id": "runner-finance-1", "last_seen": "2026-05-14T09:30:00Z", "role": "finance" }
```

判定离线：`now - last_seen > 5min`。Fallback 调度逻辑：

- 当 trigger 时刻到达，扫 primary owners 的心跳，没有任何一个在线 → 不抢
- 等过 `trigger_after_primary_offline` 时间窗，再次扫 primary 仍全线下 → fallback 接管

### 5.4 幂等性

每个写入 Adapter tool 必须：

1. 先读现状（`probe` / `get_current_X`）
2. 与目标值 diff，相等则 short-circuit 返回 skipped
3. 写入
4. 读回验证（再次读 → 与写入值一致才算成功）

**双跑也无害**是底线。锁机制是优化，不是正确性的依赖。

### 5.5 审批与人工介入

- **预期内审批**：workflow 显式声明 `human_approve_if: <condition>`（如分区文件 diff > 100 行），Corey 在 IM 推审批卡片，授权后续跑
- **意外人工介入**：Adapter 检测到验证码 / 2FA / 登录失效 → workflow 状态置 `human_required` → IM 通知指定用户回电脑处理 → 超时（默认 1h）→ failover 或标失败

---

## 六、跨平台与锁屏

### 6.1 锁屏期间可执行能力矩阵

| 状态 | macOS | Windows | 可跑 |
|---|---|---|---|
| 屏幕亮 | ✅ | ✅ | ✅ |
| 锁屏未睡 | ✅ | ✅ | **✅** |
| 系统睡眠 | ❌ | ❌ | ❌ |
| 笔记本合盖 | 默认睡 | 默认睡 | 需配置 |
| 用户登出 | ❌ | ❌ | ❌ |

### 6.2 runner 安装向导自动配置

**macOS**：

```bash
sudo pmset -c sleep 0 displaysleep 30 disksleep 0
# 启用自动登录（GUI 引导一次）
# 注册 LaunchAgent，开机自启用户 session
```

**Windows**：

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0  # 合盖不睡
schtasks /create /tn "Corey-Runner" /tr ... /sc onlogon /rl highest
# 自动登录：注册表 AutoAdminLogon + 密码存 Credential Manager
```

**end_user**：不动用户电源设置。

### 6.3 进程保护

- macOS：Tauri 主进程调用 `NSProcessInfo.beginActivityWithOptions(.userInitiated | .idleSystemSleepDisabled)` 防 App Nap
- Windows：进程优先级保持 Normal，**禁止安装为 Service**（Session 0 隔离会断浏览器自动化）
- 浏览器子进程：headless Chromium，独立于桌面 session

### 6.4 失效场景兜底

| 场景 | 处理 |
|---|---|
| 重启后 cookie 失效 | Adapter 启动 probe，失效则自动重登 |
| 重登失败（验证码）| 状态置 human_required + IM 通知 |
| 笔记本带回家无内网 | Corey 探测美正OS 可达性失败 → 不参与抢锁 |
| 系统更新强制重启 | 开机自启 + lock 表里 status=running 的会被 5min 超时回收 |

---

## 七、Workflow 模式库（Pattern A/B/C/D）

每个 Pattern 是一个模板，新需求按模板填空。

### 7.1 Pattern A — Scrape & Push

```yaml
trigger: { type: cron, schedule: "..." }
owners: { primary: ..., fallback: ... }
steps:
  - { id: fetch,    skill: <data-source-skill>, params: {...} }
  - { id: validate, type: assert, expr: "..." }
  - { id: push,     mcp_tool: <target>.<write>, params: {...}, verify_readback: true }
  - { id: audit,    type: write_audit }
```

适用：#1 汇率。~~#6 燃油费率~~（已升级为 API 直写，见 § 2.1）

### 7.2 Pattern B — Multi-Source Download + Rule + Push

```yaml
steps:
  - parallel:
    - { skill: <source-1>, output: src1 }
    - { skill: <source-2>, output: src2 }
  - { id: apply_rules, rules_file: rules/<...>.yaml }
  - { id: diff,        type: diff_against_last_run }
  - { id: gate,        type: human_approve_if, condition: "diff.changed_rows > 100" }
  - { id: push,        mcp_tool: ..., verify_readback: true }
  - { id: audit,       type: write_audit }
```

适用：#2 分区文件、#4 领星费用导出、任何"多源合并入库"

**Hermes Kanban 可选**：`parallel` 步骤底层用 Kanban 投递子 task，dispatcher fork 多个 Hermes worker 真并行（每承运商独立 profile + 独立记忆）。简单场景用 workflow 引擎内并行即可。

### 7.3 Pattern C — Event → Action

```yaml
trigger: { type: event, source: ui_button | webhook | channel_command }
owners: { context: triggering_user }       # 谁触发谁跑
permission_check:
  - tool: meizheng-os.probe_permission
    require: { can_cancel_dropship: true }
steps:
  - { id: validate_input, type: assert, expr: "..." }
  - { id: pre_action,     mcp_tool: <carrier>.cancel_shipment }
  - { id: main_action,    mcp_tool: meizheng-os.mark_order_cancelled }
  - { id: notify,         channel: <triggering_user>, message: "..." }
  - { id: audit }
```

适用：#5 取消订单、所有"用户点按钮触发"的操作

### 7.4 Pattern D — Document Ingest

```yaml
trigger: { type: watch, source: email_imap | filesystem_dir | upload }
steps:
  - { id: ingest,    skill: <ocr-or-parser-skill>, output: raw }
  - { id: extract,   type: llm_extract, schema: templates/<...>.yaml }
  - { id: validate,  type: rule_check, rules: rules/<...>.yaml }
  - { id: human_review_if, condition: "extract.confidence < 0.85" }
  - { id: push,      mcp_tool: ..., verify_readback: true }
  - { id: audit }
```

适用：#3 财务发票、合同解析、报表导入

---

## 八、Adapter MCP 设计规范

### 8.1 Tool surface 抽象原则

- **以业务动词命名**：`update_fx_rate`、`cancel_dropship_order`，不是 `click_button`、`fill_form`
- **每个 write tool 内部必做**：read-before-write + write + verify-readback
- **input/output JSON schema 必填**：便于 LLM 准确调用、便于 workflow 静态校验
- **错误结构化**：返回 `{ ok: false, code: "session_expired" | "permission_denied" | "page_changed" | ..., detail }`，workflow 引擎按 code 决定重试/审批/失败

### 8.2 美正OS Adapter v0.1 tool 草案

```yaml
tools:
  - probe_permission:
      input:  { check: [can_write_fx_rate, can_cancel_dropship, ...] }
      output: { can_write_fx_rate: bool, ... }
  - update_fx_rate:
      input:  { currency, rate, effective_date }
      output: { ok, verified_rate, prev_rate, changed: bool }
  - update_zone_table:
      input:  { carrier, rows[] }
      output: { ok, inserted, updated, skipped }
  - update_fuel_rate:
      input:  { carrier, rate, week_of }
      output: { ok, verified_rate }
  - import_fees:
      input:  { source, rows[] }
      output: { ok, imported, errors[] }
  - cancel_dropship_order:
      input:  { order_id, reason }
      output: { ok, prior_status, new_status }
  - push_invoice:
      input:  { invoice }
      output: { ok, invoice_id_in_os }
  - acquire_lock / release_lock / heartbeat / list_locks    # 分布式锁原语
```

### 8.3 Session 管理

```
启动 → load browser profile from pack-data/meizheng/browser-profiles/meizheng-os/
     → probe by visiting a protected page
     → 已登录？yes → ready
              no  → load credentials.enc → automated login → save cookies
              验证码？→ trigger human_required + IM 推送
```

所有 tool 共享同一个 Chromium 进程 + 同一个 page tab（串行执行）。Adapter 进程生命周期内保持登录态。

---

## 九、权限与角色

### 9.1 三层权限

| 层 | 来源 | 用途 |
|---|---|---|
| **deployment_role** | `customer.yaml` | 决定参与哪些 cron（runner 抢锁、end_user 不抢）|
| **user_role** | `customer.yaml`（与美正OS 内角色对齐）| 决定 Workflow 可执行性 + UI 可见性 |
| **runtime permission** | 美正OS 内实际权限 | 通过 Adapter `probe_permission` 实时探测 |

### 9.2 UI 视图过滤

视图 manifest 声明 `visible_to: [user_role...]`：

```yaml
# views/audit.yaml
visible_to: [admin, finance]
widgets:
  - { type: DataTable, source: runs.db, filter: ... }
```

Corey 启动时按 `customer.yaml.user_role` 渲染对应视图集。

### 9.3 Workflow 角色门控

`required_role` + `permission_check` 双闸：

- `required_role` 静态过滤（编译期）：你这个角色根本看不到这个 workflow
- `permission_check` 运行时探测：你声称的角色实际在美正OS 里没这个权限 → 拒绝跑

---

## 十、凭证、审计、可观测性

### 10.1 凭证管理

- **存储**：`pack-data/<customer>/credentials.enc`，AES-256-GCM，密钥由用户输入主密码派生（Argon2id）
- **使用**：Adapter 进程启动时一次性解密入内存，用完即释放
- **轮换**：Corey 设置页提供"凭证库" UI，用户可更新
- **平台原生集成（可选）**：macOS Keychain / Windows Credential Manager 作为主密码缓存（一次解锁后免输）
- **审计**：任何 credentials.enc 的解密事件写入 `audit/credentials.log`

### 10.2 审计

每次 workflow run 产出一个 audit record：

```json
{
  "run_id": "uuid",
  "workflow": "daily-fx-rate",
  "started_at": "...",
  "ended_at": "...",
  "actor": { "runner_id": "...", "user_role": "finance", "host": "..." },
  "trigger": { "type": "cron", "scheduled_at": "..." },
  "lock_key": "fx-rate-USD-2026-05-14",
  "steps": [
    { "id": "fetch",  "status": "ok", "duration_ms": 1240, "output_summary": "rate=7.1234" },
    { "id": "push",   "status": "ok", "duration_ms": 3812, "diff": { "rate": [null, 7.1234] } }
  ],
  "result": "ok",
  "notifications_sent": [...]
}
```

写入：本地 `pack-data/<customer>/audit/<yyyy-mm>/<workflow>-<run_id>.json` + `runs.db` SQLite 索引表（供 UI 查询）。

### 10.3 可观测性

- `tracing::info!` 每步起止 + duration_ms（AC-4）
- IM 渠道：成功默认静默、失败必发、人工介入必发
- Corey UI：审计页（DataTable 视图）展示 run 历史 + 失败重试按钮
- 健康检查：每个 runner 主页 widget 显示「我今天接管了 N 个任务，X 成功 Y 失败」

---

## 十一、执行计划（按周）

### 11.1 阶段 0：客户对齐（Week 0，2-3 天）

**必须先于工程开始**：

- [ ] 美正技术对接人会议
  - 确认美正OS 是否真无任何 API（包括内部）
  - 确认是否能开放一张表给 Corey 存 `corey_locks` + `corey_heartbeats`
  - 拿到一个 admin 账号 + 测试环境登录
  - 拿到至少 1 个待操作页面截图（汇率录入页优先）
  - 确认前端发版通知机制（合同条款）
- [ ] 角色矩阵
  - 列出所有 user_role
  - 列出 runner 候选机器（数量、操作系统、放置位置、可否永不睡眠）
- [ ] 时间敏感度排期
  - 客户拍板 6 条需求的延迟容忍度
- [ ] 合规
  - 确认 Corey 操作真人账号在客户内部审计上无问题（让真人账号 admin 用户出具书面同意）

### 11.2 阶段 1：基础设施（Week 1-2）

- [ ] **Pack v2 加载器**完成（v0.2.0 B-3 任务，前置）
- [ ] **Workflow Engine 增强**
  - `parallel` / `retry` / `assert` / `human_approve_if` / `apply_rules` / `diff_against_last_run` / `write_audit` / `verify_readback` 节点
  - Owner + Lock + Failover 调度器
- [ ] **分布式锁库**（基于美正OS 表 / 共享文件夹两种 backend）
- [ ] **凭证库**（AES-GCM + 主密码 + Keychain 集成）
- [ ] **Adapter 框架**（Playwright 集成 + session 管理 + tool 注册）

### 11.3 阶段 2：美正 Pack v0.1（Week 3-4）

- [ ] `meizheng-os` Adapter 实现 `probe_permission` / `update_fx_rate` / `acquire_lock` 等 5 个 tool
- [ ] Skill：`boc-rate-fetch`、`carrier-fuel-fetch`
- [ ] Workflow：`daily-fx-rate`、`weekly-fuel-surcharge`
- [ ] customer.yaml 模板 + 安装向导（自动配置电源、自启动、角色）
- [ ] **真机验证**：2 台 runner（财务/物流办公）+ 1 台 end_user，跑一周看是否稳

### 11.4 阶段 3：美正 Pack v0.2（Week 5-7）

- [ ] Adapter：`update_zone_table` / `import_fees` / `cancel_dropship_order`
- [ ] Skill：`carrier-zone-fetch`、`lingxing-export`（基于 Hermes `vue-element-ui-automation`）
- [ ] Workflow：`monthly-zone-update`、`monthly-lingxing-fees`、`dropship-cancel`
- [ ] views：`home-runner` / `home-end_user` / `audit`
- [ ] 客户业务方培训（编辑 rules/、看 audit 页）

### 11.5 阶段 4：美正 Pack v0.3 — 财务发票（Week 8-11）

- [ ] 邮件/文件夹监听
- [ ] OCR / LLM 抽取
- [ ] `invoice-pipeline` workflow + 人审兜底
- [ ] Adapter：`push_invoice`

### 11.6 验收

每个阶段交付物：

- 端到端跑通的 workflow
- 真机审计日志样例
- 失败演练（断网、登出、UI 改版模拟）

---

## 十二、扩展模型

### 12.1 加一条新需求（既有 Pattern）

```
1. 选 Pattern（A/B/C/D）
2. 写 1 个 SKILL.md（描述新数据源/目标页面）
3. 抄一个已有 workflow.yaml 改字段
4. 如果目标系统是已包过的 → Adapter 加 1 个新 tool
   否则 → 新建一个 Adapter MCP
5. 添 cron 行（如需）
6. 测试 + 加 audit
```

预期工期：**1-3 天/条**（取决于 Adapter 是否需扩）。

### 12.2 加一条新需求（新 Pattern）

发生频率应当极低。判定规则：

- 触发方式不在 cron/event/watch 三类内 → 真新 Pattern
- 否则 → 现有 Pattern 加变体

新 Pattern 落地：

```
1. 在 templates/patterns/ 加模板
2. 在本文档 § 七 加章节
3. workflow engine 加可能的新节点类型
4. 实例化 1 个 workflow 验证模板
```

### 12.3 新增一个企业客户（如：客户 B）

```
1. 复制 meizheng/ → <customer>/，改 pack.yaml
2. 重写 soul/ 两个 md（行业 + 客户文化适配）
3. 评估目标系统 → 新 Adapter MCP（如果目标系统不同）
4. 复用 templates/patterns/ A-D
5. 复用现有 skills（行业相关的）+ 写新 skill
6. customer.yaml 调角色矩阵
7. License features 联动控制启用范围（B-4）
```

预期工期：**4-8 周**（取决于目标系统复杂度 + 需求条数）。

第 N 个客户的工期会显著下降，因为：
- workflow engine 节点累积
- pattern 模板复用
- skill 库复用（中行汇率、UPS 分区等水平知识跨客户复用）
- Adapter 框架复用（只是换 selectors）

### 12.4 跨客户水平知识管理

某些 skill 是真正的"行业知识"，不绑定特定客户：

- `boc-rate-fetch` — 任何用中行汇率的客户都用
- `carrier-zone-fetch` — 任何做跨境物流的客户都用
- `vue-element-ui-automation` — 已在 Hermes 上游（HD-1）

这些 skill 不应嵌入 `meizheng/` pack。应当：

- 跨客户共享的 → 单独的 `corey-horizontal-skills/` repo，多个 Pack 通过 `manifest.dependencies` 引用
- Hermes 已有的 → 直接靠 Hermes skill hub 安装，Corey 不重写

---

## 十三、风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 美正OS UI 改版 | 高 | 高 | Adapter 启动探测关键 selector + 合同要求提前通知 |
| 美正OS 不开放任何写入位置存锁 | 中 | 高 | Fallback 到客户网盘共享文件夹方案 |
| 反爬/账号风控 | 中 | 高 | session 复用 + 限频 + 失败回退到登录页 |
| 验证码/2FA 频发 | 中 | 中 | 自动 IM 通知人工介入；记入 ops 指标推动客户改风控策略 |
| 笔记本带回家失内网 | 高 | 低 | 探测可达性，不抢锁，无害 |
| 同步延迟造成双跑 | 低 | 低 | 幂等性兜底，最差结果是无操作 |
| LLM 抽取错误（Pattern D）| 中 | 中 | confidence gating + 人审 |
| 客户员工电脑乱关机 | 中 | 中 | 多 runner 互为 fallback + 告警 |
| Win 自动登录密码安全 | 中 | 中 | 用 Credential Manager + 限制物理访问；不推荐域账号 |
| Pack 升级影响客户线上 | 中 | 高 | Pack 版本灰度（admin 先升级，其他人手动触发）|

---

## 十四、待客户对齐的开放问题（Kickoff Meeting Checklist）

- [ ] 美正OS 是否真无 API？哪怕只读 API 也行？
- [ ] 能否在美正OS 里开一张专用表给 Corey 存锁和心跳？
- [ ] 美正OS 是否暴露 webhook（用于事件触发）？
- [ ] 美正OS user_role 完整列表 + 每个角色的权限范围
- [ ] runner 候选机器：数量、操作系统、是否在内网
- [ ] 内网/外网部署模式：员工在外能否访问美正OS（决定 end_user 的可用性）
- [ ] 财务发票来源：邮件、上传、扫描？哪种比例最大？
- [ ] 中行汇率延迟容忍度：必须 9:31 准点 还是当天上午即可？
- [ ] 失败通知首选渠道：企业微信 / 钉钉 / 飞书 / 邮件
- [ ] 合同条款：UI 改版提前通知 N 天
- [ ] 数据出境合规：所有数据在客户内网，Corey 是否需要任何外发（如 LLM 调用）→ 模型选型（本地 vs 云）

---

## 十五、参考与依赖

- `docs/01-architecture.md` § Pack Architecture v2.0
- `docs/status/hermes-deps.md` § Hermes 0.13 能力对接
- `docs/competitor-maiduo-ai.md`（行业对标）
- Hermes Skills：`vue-element-ui-automation`（已存在，HD-1 直接复用）
- Hermes 0.13 Kanban：可选作为 Pattern B 并行底层
- Phase 10 Browser Automation：Adapter 底层
- v0.2.0 B-3 Pack Loader：本计划的前置

---

## 十六、Agent 模式性能问题与解决方案（修订版 v0.2）

> ⚠️ **本节 v0.1 内容已作废**（曾建议给 Corey 基座新增 `script` / `browser_script` 步骤类型）。
> 作废原因：违反 HD-1（Check upstream first）。Hermes 上游已有 `execute_code` 工具专门解决此问题。
> 见 `docs/plans/hermes-capability-map.md` 为下次决策的事实源。

### 16.1 问题发现（2026-05-14 实测）

**场景**：美正 Pack `update-fuel-rates-weekly` workflow 执行燃油费率更新

**当前实现**：使用 `type: agent` 步骤，让 LLM 自主决策每一步浏览器操作

**实测性能**：
- UPS 步骤：568.9 秒（9.5 分钟）
- FedEx 步骤：1079.2 秒（18 分钟），因 API 调用超限（200 次）未完成
- **总耗时**：27+ 分钟（且 FedEx 失败）

**根本原因**：
```
Agent 模式执行流程（每个操作都需要 LLM 推理）：
1. 截图/提取 DOM → 发给 LLM（1-2s）
2. LLM 推理："我应该点哪个按钮？"（2-5s）
3. 执行操作：点击/输入（1-2s）
4. 验证结果：再截图 → 再问 LLM（1-2s）
5. 重复 50-200 次

单次循环：6-10 秒
总耗时：5-30 分钟（取决于页面复杂度）
```

### 16.2 传统 RPA 工具为何快速

**UiPath / Automation Anywhere / Blue Prism** 执行同样任务：
- 登录：2-3 秒
- 导航：1-2 秒
- 填表：1-2 秒
- **总计**：5-10 秒

**核心差异**：
```
RPA 模式执行流程（预定义操作序列）：
1. 开发时录制：确定每一步的精确 XPath/CSS Selector
2. 运行时回放：直接执行，无需"思考"
3. 元素定位：毫秒级
4. 无 LLM 开销

单次操作：0.1-0.5 秒
总耗时：5-30 秒
```

**适用场景对比**：

| 特性 | Agent 模式 | RPA 模式 |
|---|---|---|
| **速度** | 慢（5-30 分钟） | 快（5-30 秒） |
| **灵活性** | 高（页面改版仍可工作） | 低（页面改版需重录） |
| **开发成本** | 低（写 prompt 即可） | 高（需录制+调试） |
| **适用场景** | 页面结构不稳定、需智能决策 | 页面结构稳定、流程固定 |
| **典型案例** | 邮件分类、文档理解、异常处理 | 表单填写、数据录入、定时抓取 |

**美正燃油费率更新任务特征**：
- ✅ 流程固定（每次都一样）
- ✅ 页面结构稳定（美正OS 不会天天改版）
- ✅ 不需要智能决策（就是填表）
- ❌ 不需要 Agent 的"灵活性"

**结论**：这是典型的 RPA 场景，用 Agent 模式是"杀鸡用牛刀"

### 16.3 解决方案（修订）：使用 Hermes 已有的 `execute_code` 工具

#### 16.3.1 上游能力（HD-1 复检结果）

Hermes 已经提供 **`execute_code` 工具**（[官方文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/code-execution)）：

> Programmatic Tool Calling — collapses multi-step pipelines into single LLM turn

**核心机制**：
1. Agent 写 Python 脚本，`from hermes_tools import web_extract, ...`
2. 脚本在子进程跑，工具调用通过 Unix socket RPC 回主进程
3. **中间结果不进 LLM context**，只有 `print()` 输出回 LLM
4. 多步流水线 → 单次 LLM 推理

**可用工具**：`web_search`, `web_extract`, `read_file`, `write_file`, `search_files`, `patch`, `terminal`

**不可用**：浏览器自动化工具（`browser_*` 不在 `execute_code` 沙箱内）

#### 16.3.2 适用场景拆分

| 步骤 | 任务性质 | 工具选择 | 预期速度 |
|---|---|---|---|
| `scrape_ups` | HTTP 抓 UPS 公开页面 | `execute_code` + `web_extract` | **5-10 秒** |
| `scrape_fedex` | HTTP 抓 FedEx 公开页面 | `execute_code` + `web_extract` | **5-10 秒** |
| `update_meizheng_*` | 登录 Vue UI + 表单填写 | 仍需 `browser_*`（agent 模式） | 优化 prompt 到 2-3 分钟 |

**结论**：抓取步骤可以从 5-10 分钟降到 5-10 秒（提升 60 倍），但更新美正OS 仍需浏览器自动化。

#### 16.3.3 修改 workflow prompt 即可（不改基座）

在 `scrape_ups` / `scrape_fedex` 的 prompt 里明确要求：

```yaml
- id: scrape_ups
  type: agent
  prompt: |
    **使用 execute_code 工具一次性完成抓取，不要用浏览器**：
    
    ```python
    from hermes_tools import web_extract
    import re, json
    
    url = "https://www.ups.com/.../fuel-surcharges.page"
    result = web_extract([url])
    html = result["results"][0]["content"]
    
    rate = re.search(r'Ground\s+Surcharge[^\d]*([\d.]+)%', html).group(1)
    date = re.search(r'Effective\s+(\w+\s+\d+,\s+\d{4})', html).group(1)
    
    print(json.dumps({"rate": float(rate), "effective_date": date}))
    ```
    
    返回 print 出的 JSON。
```

#### 16.3.4 平台限制（XP-1 风险）

⚠️ **`execute_code` 仅支持 Linux/macOS**（Unix domain socket）。Windows 自动 fallback 到顺序工具调用，性能优化失效。

**对 CoreyOS 的影响**：
- macOS 客户：抓取步骤 ~10 秒
- Windows 客户：抓取步骤仍是 5-10 分钟（fallback 到 agent 顺序调用）

**缓解方案**：
1. Windows 客户提示性能差异
2. 长期：等 Hermes 上游加 Windows 支持
3. 或在 Corey 基座做 Windows-specific 抓取路径（XP-1 平等性 vs 性能取舍）

### 16.4 更新美正OS 步骤的优化（不能用 execute_code）

由于浏览器工具不在 `execute_code` 内，更新美正OS 仍需走 agent 模式。优化方向：

#### 16.4.1 Prompt 优化（短期）

1. **登录后直接 URL 跳转**，不要逐级点菜单
2. **一次 `browser_snapshot` 看全表**，不要逐个 `browser_click`
3. **批量填表后一次提交**，不要逐字段验证

#### 16.4.2 Skill 优化（中期）

Hermes 已有 `vue-element-ui-automation` skill（HD-1，637 行），完整覆盖 Vue + Element UI 自动化。确保 workflow prompt 明确加载此 skill。

#### 16.4.3 Adapter MCP（长期，§ 八）

最终方案是把美正OS 包成 MCP server（`mcp/meizheng-os/`），暴露业务动词级 tool（`update_fx_rate`, `update_fuel_rate` 等），workflow 直接 `mcp_tool: meizheng-os.update_fuel_rate`。预期 5-15 秒。这是 § 三/§ 八 已规划的内容。

### 16.5 v0.1 作废内容备忘

v0.1 曾设计：
- 在 `WorkflowStep` 加 `script` / `browser_script` 字段
- 新增 `executor/script.rs` / `executor/browser_script.rs`
- 设计浏览器 DSL（`browser.fill`, `browser.click` 等）

**作废原因汇总**：
- 违反 **HD-1**：`execute_code` 已存在
- 违反 **XP-1**：自研 DSL 仍要解决 Windows，等于重做 Hermes 没做完的事
- 违反 **PD-2**：稳定优于功能，基座越大越脆
- 工作量 1-2 周 vs 修 prompt 30 分钟

### 16.6 行动项

- [x] 写本文档（修订作废 v0.1）
- [x] 写 `docs/plans/hermes-capability-map.md` 作为 HD-1 事实源
- [ ] 修改 `~/.hermes/skill-packs/meizheng/workflows/update-fuel-rates-weekly.yaml` 抓取步骤 prompt，要求用 `execute_code`
- [ ] 重跑 workflow，对比 27 分钟 vs 期望 < 5 分钟
- [ ] 如确认有效，更新 § 七 Pattern A 模板，把 `execute_code` 列为 fetch 步骤默认建议
- [ ] Adapter MCP（§ 八）仍按原计划推进，是长期方向

---

## ~~十六（v0.1，作废）~~：以下章节保留作 HD-1 反面教材

> 这段内容是 2026-05-14 写的，因违反 HD-1 已被 16.3+ 取代。保留以便未来回顾"过度设计的样子"。
> 
> **不要按这里的方案实施。**

#### 16.3.1 新增步骤类型

**当前支持**：`agent`, `tool`, `browser`, `parallel`, `branch`, `loop`, `approval`, `workflow`

**新增**：
- `script`：直接执行 Python/JavaScript 脚本（用于数据抓取、计算）
- `browser_script`：预定义的浏览器操作序列（用于 UI 自动化）

#### 16.3.2 `script` 步骤示例

```yaml
steps:
  - id: scrape_ups
    name: 抓取UPS燃油费率
    type: script
    language: python
    timeout: 30s
    script: |
      import requests
      import re
      from datetime import datetime
      
      # 从配置读取
      url = config['carriers']['ups']['source_url']
      
      # 抓取页面
      response = requests.get(url, timeout=10)
      html = response.text
      
      # 解析费率
      rate_match = re.search(r'Domestic\s+Ground\s+Surcharge[^\d]*([\d.]+)%', html, re.IGNORECASE)
      date_match = re.search(r'Effective\s+(\w+\s+\d{1,2},\s+\d{4})', html, re.IGNORECASE)
      
      if not rate_match or not date_match:
          raise ValueError("Failed to extract rate or date")
      
      rate = float(rate_match.group(1))
      effective_date = datetime.strptime(date_match.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
      
      # 返回结果（供后续步骤使用）
      return {
          'rate': rate,
          'effective_date': effective_date
      }
```

**执行时间**：5-10 秒（vs Agent 模式的 5-10 分钟）

#### 16.3.3 `browser_script` 步骤示例

```yaml
steps:
  - id: update_meizheng
    name: 更新美正OS燃油费率
    type: browser_script
    timeout: 60s
    context:
      base_url: ${config.meizheng_os.base_url}
      username: ${config.credentials.username}
      password: ${config.credentials.password}
      rate: ${steps.scrape_ups.rate}
      effective_date: ${steps.scrape_ups.effective_date}
    script: |
      # 登录
      browser.navigate("${base_url}/login")
      browser.fill("input[name=username]", "${username}")
      browser.fill("input[name=password]", "${password}")
      browser.click("button[type=submit]")
      browser.wait_for_navigation()
      
      # 导航到燃油费率页面
      browser.navigate("${base_url}/settings/fuel-rates")
      
      # 选择承运商
      browser.select("select[name=carrier]", "UPS")
      
      # 填写费率
      browser.fill("input[name=rate]", "${rate}")
      browser.fill("input[name=effective_date]", "${effective_date}")
      
      # 提交
      browser.click("button.save")
      browser.wait_for_selector(".success-message")
      
      # 验证
      saved_rate = browser.get_text("td.rate-value")
      assert saved_rate == "${rate}", f"Rate mismatch: {saved_rate} != ${rate}"
```

**执行时间**：10-15 秒（vs Agent 模式的 10-15 分钟）

#### 16.3.4 完整 Workflow 示例

```yaml
id: update-fuel-rates-weekly
name: 每周燃油费率自动更新
trigger:
  type: cron
  expression: "0 30 23 * * 0"

steps:
  # 抓取 UPS（RPA 模式，5-10 秒）
  - id: scrape_ups
    type: script
    language: python
    script: |
      # ... 见 16.3.2
  
  # 抓取 FedEx（RPA 模式，5-10 秒）
  - id: scrape_fedex
    type: script
    language: python
    script: |
      # 类似 scrape_ups
  
  # 更新美正OS（RPA 模式，10-15 秒）
  - id: update_meizheng
    type: browser_script
    after: [scrape_ups, scrape_fedex]
    script: |
      # ... 见 16.3.3
      # 循环更新 UPS 和 FedEx
```

**总耗时**：30-40 秒（比 Agent 模式快 **40 倍**）

### 16.4 实现计划

#### 16.4.1 Rust 后端（`src-tauri/src/workflow/`）

**新增文件**：
- `executor/script.rs`：执行 Python/JS 脚本
- `executor/browser_script.rs`：执行浏览器脚本（基于 Playwright）
- `model.rs`：扩展 `WorkflowStep` 支持 `script` 和 `browser_script` 字段

**关键实现**：
```rust
// model.rs
pub struct WorkflowStep {
    // ... 现有字段
    #[serde(default)]
    pub script: Option<String>,           // script 内容
    #[serde(default)]
    pub language: Option<String>,         // python | javascript
    #[serde(default)]
    pub browser_script: Option<String>,   // 浏览器操作 DSL
    #[serde(default)]
    pub context: Option<serde_json::Value>, // 变量替换上下文
}

// executor/script.rs
pub async fn execute_script(
    step: &WorkflowStep,
    context: &WorkflowContext,
) -> Result<serde_json::Value> {
    match step.language.as_deref() {
        Some("python") => execute_python(&step.script.unwrap(), context).await,
        Some("javascript") => execute_javascript(&step.script.unwrap(), context).await,
        _ => Err("Unsupported language"),
    }
}

// executor/browser_script.rs
pub async fn execute_browser_script(
    step: &WorkflowStep,
    context: &WorkflowContext,
) -> Result<serde_json::Value> {
    // 解析 browser_script DSL
    // 调用 Playwright API
    // 返回结果
}
```

#### 16.4.2 浏览器脚本 DSL 设计

**支持的操作**：
```
browser.navigate(url)
browser.fill(selector, value)
browser.click(selector)
browser.select(selector, value)
browser.wait_for_selector(selector)
browser.wait_for_navigation()
browser.get_text(selector) -> string
browser.get_value(selector) -> string
browser.screenshot(path)
```

**变量替换**：
- `${config.xxx}`：从 Pack 配置读取
- `${steps.xxx.yyy}`：从前序步骤输出读取
- `${env.xxx}`：从环境变量读取

#### 16.4.3 安全性

**沙箱隔离**：
- Python：使用 `RestrictedPython` 或 subprocess 隔离
- JavaScript：使用 Deno runtime（内置沙箱）
- 浏览器：headless Chromium，独立 profile

**超时控制**：
- 每个 `script` / `browser_script` 步骤强制 timeout
- 默认 60 秒，可配置

**权限控制**：
- 脚本只能访问 `config` 和 `steps` 上下文
- 不能访问文件系统（除非显式声明）
- 不能执行系统命令

### 16.5 迁移路径

**现有 Agent 模式 workflow 不受影响**，新增的 `script` / `browser_script` 是可选的。

**迁移步骤**：
1. 识别"流程固定、页面稳定"的 workflow
2. 将 `type: agent` 改为 `type: script` 或 `type: browser_script`
3. 编写脚本（可从现有 Python 脚本迁移）
4. 测试验证
5. 对比性能（预期提速 10-50 倍）

### 16.6 优先级与工期

**优先级**：**高**（美正 Pack 的性能瓶颈）

**工期估算**：
- 后端实现（Rust）：3-5 天
- 浏览器脚本 DSL：2-3 天
- 测试 + 文档：2 天
- **总计**：1-2 周

**目标版本**：v0.3.0（与美正 Pack v0.2 同步）

### 16.7 长期方向

**Corey 应该同时支持两种模式**：

| 模式 | 适用场景 | 开发成本 | 执行速度 | 维护成本 |
|---|---|---|---|---|
| **Agent 模式** | 页面不稳定、需智能决策 | 低 | 慢 | 低 |
| **RPA 模式** | 页面稳定、流程固定 | 高 | 快 | 中 |

**用户选择权**：
- 快速原型：用 Agent 模式
- 生产环境：迁移到 RPA 模式（性能优化）
- 混合使用：数据抓取用 RPA，异常处理用 Agent

---

## 十七、变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-05-14 | v0.1 | 初稿 — 综合 4 轮设计讨论（Kanban 评估 / 美正需求拆解 / RPA Adapter / 混合 runner 模型 / 锁屏运行）|
| 2026-05-15 | v0.2 | 新增 § 十六：Agent vs RPA 性能对比 + `script` / `browser_script` 步骤类型设计 |
| 2026-05-15 | v0.3 | § 十六 修订：作废"新增步骤类型"方案，改为利用 Hermes 已有 `execute_code` 工具。原因：违反 HD-1。配套新建 `docs/plans/hermes-capability-map.md` 作为后续 HD-1 决策事实源 |
