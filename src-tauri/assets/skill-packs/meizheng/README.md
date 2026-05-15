# 美正 Pack

美正国际物流业务 Pack，运行在 CoreyOS（白标后即美正OS）之上。

## 目录结构

```
meizheng/
├── manifest.yaml                           # Pack 元数据 + 注册表
├── REQUIREMENTS.md                         # 持续收集业务需求
├── README.md                               # 本文件
├── config/
│   └── zone-config.yaml                    # 分区配置（carrier、ZIP3 数量、启用状态）
├── skills/
│   └── meizheng_os_automation.md           # 主 skill 文件
├── workflows/
│   ├── update-usd-exchange-rate.yaml       # 每日汇率更新
│   ├── update-ups-zones.yaml               # 每月 UPS 分区更新
│   └── update-usps-zones.yaml              # 每月 USPS 分区更新
└── scripts/
    ├── scrape_boc_usd_rate.py              # 抓取中行美元汇率
    ├── update_exchange_rate_via_api.py      # 更新汇率到美正OS
    ├── download_ups_zones_browser.py       # 下载 UPS 分区（Playwright）
    ├── download_ups_zones.py               # 下载 UPS 分区（旧版 HTTP）
    ├── download_usps_zones.py              # 下载 USPS 分区（纯 HTTP API）
    ├── download_fedex_zones.py             # 下载 FedEx 分区（开发中）
    ├── upload_zones_meizheng.py            # 上传分区到美正OS（支持多承运商）
    └── ensure_crawl4ai.py                  # 环境初始化
```

## 已落地能力

### ✅ 每日汇率自动更新
- 每天早上 09:30 / 10:30 自动从中国银行抓取美元现汇卖出价
- 自动更新到美正OS
- Workflow: `update-usd-exchange-rate.yaml`

### ✅ 每月 UPS Ground 分区自动更新
- 每月1号自动从 UPS 下载全美 902 个 ZIP3 分区数据
- 自动转换格式并上传到美正OS
- 批量上传约 30 分钟，支持断点续传
- Workflow: `update-ups-zones.yaml`

### ✅ 每月 USPS Priority Mail 分区自动更新
- 每月1号自动从 USPS 公开 API 下载分区数据
- 纯 HTTP 请求，无需浏览器，从中国可直接访问
- 自动转换为美正OS模板格式并上传
- Workflow: `update-usps-zones.yaml`

### 🔧 FedEx Ground 分区更新（开发中）
- 需要能访问 fedex.com 的网络环境
- 脚本已写好，等网络问题解决后即可启用

## 前端配置

- **ZoneConfigEditor** — 在美正OS 系统配置页面可启用/禁用承运商分区更新、配置 cron、参数
- **MeizhengConfig** — 美正OS 主配置页面，集成 ZoneConfigEditor

## 待办

- [ ] FedEx Ground 分区自动更新（等网络方案）
- [ ] 业务人设：填写 prompts/soul.md
- [ ] 高频问题 skill（"91701 是 zone 几"）
- [ ] 首页视图：燃油走势 + 告警 + 快捷入口
- [ ] 集成：微信群机器人 / 钉钉推送
