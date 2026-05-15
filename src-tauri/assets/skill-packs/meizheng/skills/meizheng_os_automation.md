# 美正OS 自动化 Skill

## 概述

本 skill 提供 美正OS 企业 RPA 自动化能力，包括：

### 已实现的自动化

1. **美金汇率自动更新** — 每日从中国银行抓取美元现汇卖出价并更新到美正OS
2. **UPS Ground 分区月度更新** — 每月从 UPS 下载全美 902 个 ZIP3 分区数据并上传到美正OS

### 开发中

3. **FedEx Ground 分区月度更新** — 从 FedEx Rate Tools 下载分区数据并上传到美正OS（需解决网络访问问题）

### 脚本位置

| 脚本 | 用途 |
|------|------|
| `scripts/scrape_boc_usd_rate.py` | 抓取中行汇率 |
| `scripts/update_exchange_rate_via_api.py` | 更新汇率到美正OS |
| `scripts/download_ups_zones_browser.py` | 下载 UPS 分区 XLS（Playwright） |
| `scripts/upload_zones_meizheng.py` | 上传分区到美正OS |
| `scripts/download_fedex_zones.py` | 下载 FedEx 分区（AppleScript + Chrome，开发中） |

### Workflow

| Workflow | 文件 | 触发 |
|----------|------|------|
| 汇率更新 | `workflows/update-usd-exchange-rate.yaml` | 每天 09:30 / 10:30 |
| UPS 分区更新 | `workflows/update-ups-zones.yaml` | 每月1号 |

### 美正OS API

- 认证：`POST /login/token`（Basic Auth，用户 `zidonghua@admin`）
- 分区上传：`POST /admin/importPostCode`（解析）→ `POST /admin/update`（保存）
- Token 自动缓存，401 自动刷新

### 关键注意事项

- `importPostCode` 返回的字段名 `zoneSchemaItemPostcodeVOList` 需转为 `postcodeList`
- `importPostCode` 只解析不保存，必须再调 `admin/update`
- 所有批量操作支持 checkpoint 断点续传
- 902 个 ZIP3 批量上传约需 30 分钟
- FedEx 分区下载需要能访问 fedex.com 的网络环境（中国大陆需代理）
