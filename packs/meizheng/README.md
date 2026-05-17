# 美正 Pack

美正国际物流业务 Pack，运行在 CoreyOS（白标后即美正OS）之上。

## 目录结构

```
meizheng/
├── manifest.yaml                           # Pack 元数据 + 注册表 + 定时任务
├── README.md                               # 本文件
├── REQUIREMENTS.md                         # 需求收集中心
├── config/
│   └── zone-config.yaml                    # 分区配置（承运商、ZIP3、upload_prefix）
├── skills/
│   └── meizheng_os_automation.md           # 主 skill 文件
├── workflows/
│   ├── update-usd-exchange-rate.yaml       # 每日汇率更新
│   ├── update-ups-zones.yaml               # 每月 UPS 分区更新
│   ├── update-usps-zones.yaml              # 每月 USPS 分区更新
│   ├── update-fedex-zones.yaml             # 每月 FedEx 分区更新
│   ├── update-fuel-rates-weekly.yaml       # 每周 UPS + FedEx 燃油更新
│   └── update-fuel-rates-monthly.yaml      # 每月 DHL 燃油更新
└── scripts/
    ├── date_utils.py                       # 共享日期工具（calculate_end_date）
    ├── scrape_boc_usd_rate.py              # 抓取中行美元汇率
    ├── update_exchange_rate_via_api.py      # 上传汇率到美正OS
    ├── download_ups_zones.py               # 下载 UPS 分区（HTTP API）
    ├── download_usps_zones.py              # 下载 USPS 分区（HTTP API）
    ├── download_fedex_zones.py             # 下载 FedEx 分区（CDP）
    ├── upload_zones_meizheng.py            # 上传分区到美正OS（多承运商通用）
    ├── scrape_ups_fuel_rate.py             # 抓取 UPS 燃油（CDP 表格提取）
    ├── scrape_fedex_fuel_rate.py           # 抓取 FedEx 燃油（CDP 表格提取）
    ├── scrape_dhl_fuel_rate.py             # 抓取 DHL 燃油（CDP 金额提取）
    └── update_fuel_rates_via_api.py        # 上传燃油到美正OS（POST创建+PUT审核）
```

## 已落地能力

### 每日汇率自动更新
- 每天早上 09:30 / 10:30 自动从中国银行抓取美元现汇卖出价
- 纯 HTTP，`requests` 抓取 boc.cn 页面
- Workflow: `update-usd-exchange-rate.yaml`

### 每月 UPS Ground 分区自动更新
- 每月1号自动从 UPS 下载全美 902 个 ZIP3 分区数据
- 纯 HTTP API，`requests` 抓取
- 自动转换格式并上传到美正OS，批量上传约 30 分钟，支持断点续传
- Workflow: `update-ups-zones.yaml`

### 每月 USPS 分区自动更新
- 每月1号自动从 USPS 公开 API 下载分区数据
- 纯 HTTP 请求，无需浏览器
- Workflow: `update-usps-zones.yaml`

### 每月 FedEx Ground 分区自动更新
- 每月1号通过 CDP 在浏览器中下载 FedEx 分区 PDF
- `pdfplumber` 解析 PDF，提取 2/3/4/5/6/7/8/9/17 区数据
- 按 ZIP3 拆分 Excel 并上传到美正OS
- Workflow: `update-fedex-zones.yaml`

### 每周 UPS + FedEx 燃油附加费更新
- 每周日 23:30 执行
- UPS: CDP 导航到 ups.com → 等待 React 渲染 → JS 提取 `table.table-content` 第一行
- FedEx: CDP 导航到 fedex.com → 等待渲染 → JS 提取第一个含月份日期的表格行
- 输出 Ground 和 Air 费率（百分比）
- Workflow: `update-fuel-rates-weekly.yaml`

### 每月 DHL 燃油附加费更新
- 每月最后一天执行（cron `0 0 28-31 * * *`，脚本内 `is_last_day_of_month()` 判断）
- DHL: CDP 导航到 dhl.com → JS 提取 `$X.XX USD per pound`（不带星号的第一条）
- 输出 Domestic Products 费率（金额，非百分比）
- Workflow: `update-fuel-rates-monthly.yaml`

## 脚本技术方案

### 抓取方式对照

| 数据 | 抓取方式 | 原因 |
|------|---------|------|
| 中行汇率 | `requests` 纯 HTTP | boc.cn 无 WAF，直连可用 |
| UPS 分区 | `requests` 纯 HTTP | UPS 分区 API 无 WAF |
| USPS 分区 | `requests` 纯 HTTP | USPS 公开 API |
| FedEx 分区 | CDP + `websocket` | fedex.com 有 WAF（Akamai），需浏览器 cookie |
| UPS 燃油 | CDP + `websocket` | ups.com 有 WAF，费率在 React 组件渲染的表格中 |
| FedEx 燃油 | CDP + `websocket` | fedex.com 有 WAF |
| DHL 燃油 | CDP + `websocket` | dhl.com 从中国网络无法直连 |

### CDP 工作流程

所有需要 CDP 的脚本遵循相同模式：
1. `GET http://localhost:9222/json/list` 获取浏览器 tab
2. `websocket.connect(ws_url)` 连接到 tab
3. `Page.navigate` 导航到目标 URL
4. `time.sleep(6~8)` 等待页面渲染
5. `Runtime.evaluate` 执行 JS 提取数据
6. `ws.close()` 关闭连接

### 美正OS API 流程

所有上传脚本遵循相同模式：
1. `POST /login/token` → 获取 token（Basic Auth）
2. 业务操作（创建费率/上传分区等）
3. `PUT .../admin/audit/{id}` → 自动审核（仅燃油）

### 燃油 API payload

```json
{
  "carrierId": 123,
  "effectiveDate": "2026-05-18",
  "validTo": "2026-05-25",
  "rate": 27.75
}
```

- UPS/FedEx: rate 是百分比（如 27.75）
- DHL: rate 是每磅金额（如 0.15）
- 创建后必须 `PUT .../admin/audit/{id}` 审核才生效

## 配置文件

运行时配置在 `~/.hermes/pack-data/meizheng/config/`：

- `fuel-rate-config.yaml` — 美正OS 连接信息、承运商燃油参数、凭证
- 分区配置在 UI 的 ZoneConfigEditor 中编辑，存入 `zone-config.yaml`

### 前置条件

- AI 浏览器已启动（CDP 端口 9222）— 所有燃油和 FedEx 分区脚本需要
- `websocket-client` 已安装 — `pip install websocket-client`
- 美正OS 凭证已配置在 `fuel-rate-config.yaml`

## 前端界面

### 业务首页（MeizhengDashboard）
- 侧边栏 Primary 区域，标题"美正OS"
- 燃油费率卡片：UPS / FedEx / DHL 当前费率、承运商标识色、生效日期
- 美元汇率卡片：中行美元现汇卖出价
- 承运商分区状态：UPS / USPS / FedEx 更新频率
- 自动化工作流：6 个工作流卡片，每个可一键手动执行
- 工作流执行注意：id 需加 `pack__meizheng__` 前缀（如 `pack__meizheng__update-fuel-rates-weekly`）

### 系统配置（MeizhengConfig）
- 侧边栏 Settings 区域
- 基础配置：美正OS Web/API 地址、账号密码
- 承运商配置：每个承运商的 sourceUrl、validityDays、cron、services
- 汇率配置：汇率数据源参数
- 分区配置：每个承运商的 enabled、upload_prefix、ZIP3 数量

## 待办

- [ ] 业务人设：填写 prompts/soul.md
- [ ] 高频问题 skill（"91701 是 zone 几"）
- [ ] Dashboard 数据源对接（目前燃油/汇率数据为静态，需要 IPC 从脚本输出读取）
- [ ] 集成：微信群机器人 / 钉钉推送
