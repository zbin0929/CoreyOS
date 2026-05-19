# 美金汇率自动更新功能设计

## 一、需求概述

### 业务目标
每天自动从中国银行获取美金对人民币汇率，更新到美正OS。

### 关键参数
| 项 | 值 |
|---|---|
| **数据源** | https://srh.bankofchina.com/search/whpj/search_cn.jsp |
| **更新频率** | 每天 2 次（9:30 和 10:30） |
| **抓取规则** | 找 9:30 之后的**第一笔现汇卖出价** |
| **数据转换** | 网站显示 `682.78` → 数据库存 `6.8278`（除以 100） |
| **操作类型** | **编辑**（update）已有 USD 记录（id=2），不是新增 |
| **备注格式** | `更新汇率2026/01/29 09:30:14  6.9639` |

### 为什么需要两次（9:30 和 10:30）
- **9:30**: 中国银行 9:30 后会有首笔交易数据，但可能存在延迟
- **10:30**: 兜底，如果 9:30 抓取失败（节假日、网站维护等），10:30 再尝试一次
- 两次都成功也无害，第二次会覆盖第一次（保持最新）

## 二、技术架构（复用 fuel-rate 模式）

### 架构对照
| 组件 | Fuel Rate | USD Exchange Rate |
|---|---|---|
| 配置文件 | `fuel-rate-config.yaml` | `exchange-rate-config.yaml` |
| UI 编辑器 | `CarrierConfigEditor.tsx` | `ExchangeRateConfigEditor.tsx` |
| 抓取脚本 | `scrape_dhl_fuel_rate.py` | `scrape_boc_usd_rate.py` |
| 上传脚本 | `update_fuel_rates_via_api.py` | `update_exchange_rate_via_api.py` |
| Workflow | `update-fuel-rates-weekly.yaml` | `update-usd-exchange-rate.yaml` |
| 调用方式 | API CREATE → audit | API **UPDATE**（直接编辑） |

### 调用流程
```
┌─────────────────────────────────────────────────────────┐
│ Hermes Scheduler (cron: 0 30 9 * * * / 0 30 10 * * *) │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Workflow: update-usd-exchange-rate.yaml                 │
│  1. 验证配置                                              │
│  2. 调用 scrape_boc_usd_rate.py 抓取 BOC 现汇卖出价        │
│  3. 调用 update_exchange_rate_via_api.py 更新美正OS       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 美正OS API                                                │
│  GET  /account/currency/list   (找到 USD 的 id)          │
│  POST /account/currency/update (更新 exchangeRate)       │
└─────────────────────────────────────────────────────────┘
```

## 三、配置文件设计

### `~/.hermes/pack-data/meizheng/config/exchange-rate-config.yaml`

```yaml
# 美金汇率自动更新配置
enabled: true

# 数据源
source:
  name: 中国银行
  url: https://srh.bankofchina.com/search/whpj/search_cn.jsp
  currency_pair: USD/CNY
  rate_type: 现汇卖出价   # 中国银行有 4 种价格，我们要这个
  earliest_time: "09:30"  # 找 9:30 之后的第一笔

# 数据转换
conversion:
  divide_by: 100  # 网站值 682.78 → 数据库值 6.8278

# 调度（两次抓取，兜底机制）
schedules:
  - name: 早盘抓取
    cron: "0 30 9 * * *"   # 每天 09:30
  - name: 兜底抓取
    cron: "0 30 10 * * *"  # 每天 10:30

# 美正OS API 配置（复用现有 API base 和 token）
target:
  currency_code: USD
  currency_name: 美金
  update_by: zidonghua   # 自动化操作员

# 备注模板（{datetime} / {rate} 占位符）
remark_template: "更新汇率{datetime}  {rate}"
remark_datetime_format: "%Y/%m/%d %H:%M:%S"

# 高级选项
advanced:
  retry_attempts: 3
  request_timeout: 30
  log_level: info
```

## 四、UI 设计

### 位置
在美正 Pack 配置页面，**承运商配置** 下方新增一个 **汇率配置** section。

### 视觉结构

```
┌──────────────────────────────────────────────────────────┐
│  📈 汇率配置                                              │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  ☑ 启用美金汇率自动更新                                    │
│                                                          │
│  ┌─ 数据源 ──────────────────────────────────────────┐  │
│  │ 名称: [中国银行            ]                       │  │
│  │ URL : [https://srh.bankofchi...]                   │  │
│  │ 货币对: USD/CNY  汇率类型: [现汇卖出价 ▾]           │  │
│  │ 抓取时间起点: [09:30] （取此时间后第一笔）           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 数据转换 ────────────────────────────────────────┐  │
│  │ 除以系数: [100]  示例: 682.78 ÷ 100 = 6.8278       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 抓取计划 ────────────────────────────────────────┐  │
│  │  ┌─ 计划 1 ─────────────────────────────────┐ [X] │  │
│  │  │ 名称: [早盘抓取        ]                  │     │  │
│  │  │ 触发: [每天 ▾] [09:30] 预览: 每天 09:30   │     │  │
│  │  └──────────────────────────────────────────┘     │  │
│  │  ┌─ 计划 2 ─────────────────────────────────┐ [X] │  │
│  │  │ 名称: [兜底抓取        ]                  │     │  │
│  │  │ 触发: [每天 ▾] [10:30] 预览: 每天 10:30   │     │  │
│  │  └──────────────────────────────────────────┘     │  │
│  │  [+ 添加抓取计划]                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 目标系统（美正OS） ──────────────────────────────┐  │
│  │ 货币代码: [USD]  货币名称: [美金]                  │  │
│  │ 操作人:   [zidonghua]                              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 备注模板 ────────────────────────────────────────┐  │
│  │ 模板: [更新汇率{datetime}  {rate}        ]         │  │
│  │ 预览: 更新汇率2026/01/29 09:30:14  6.9639          │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 最近一次更新 ─────────────────────────────────────┐  │
│  │ 时间: 2026-01-29 09:30:14                          │  │
│  │ 汇率: 6.9639                                       │  │
│  │ 状态: ✅ 成功                                       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### React 组件结构

```tsx
ExchangeRateConfigEditor
├── 启用开关 (enabled)
├── DataSourceSection
│   ├── name input
│   ├── url input
│   ├── rate_type select (现汇买入价/现汇卖出价/现钞买入价/现钞卖出价)
│   └── earliest_time time picker
├── ConversionSection
│   └── divide_by number input + 实时预览
├── SchedulesSection
│   ├── 复用 CarrierConfigEditor 的 Cron picker
│   ├── 支持多个计划（add / remove）
│   └── 每个计划：name + cron picker
├── TargetSection
│   ├── currency_code
│   ├── currency_name
│   └── update_by
├── RemarkTemplateSection
│   └── 模板输入 + 实时预览
└── LastUpdateStatus（只读，从最近一次执行结果读取）
```

### 复用 Cron Picker
**重要**：不重复造轮子，把 `CarrierConfigEditor.tsx` 中的 Cron picker 部分（`parseCron` / `buildCron` / `describeCron` + UI）抽成共享组件 `CronPicker.tsx`，供承运商配置和汇率配置共用。

抽出位置：`src/features/pack/templates/shared/CronPicker.tsx`

## 五、抓取脚本设计

### `scrape_boc_usd_rate.py`

**注意**：BOC 历史检索页面需要验证码，需用浏览器自动化处理。

```python
#!/usr/bin/env python3
"""
抓取中国银行美金现汇卖出价（需处理验证码）
使用 crawl4ai 浏览器自动化
输出 JSON 到 stdout
"""
import sys
import json
from datetime import datetime
from crawl4ai import AsyncWebCrawler

BOC_URL = "https://srh.bankofchina.com/search/whpj/search_cn.jsp"

async def scrape_boc_usd_rate(earliest_time: str = "09:30") -> dict:
    """
    抓取中国银行美金现汇卖出价
    
    Args:
        earliest_time: 取此时间后的第一笔（HH:MM 格式）
    
    Returns:
        {
            "currency": "USD",
            "rate_raw": 682.78,       # 网站原值
            "rate_converted": 6.8278, # 除以 100 后的值
            "publish_time": "2026-01-29 09:30:14",
            "source": "中国银行"
        }
    """
    async with AsyncWebCrawler(verbose=True) as crawler:
        # 步骤 1: 访问页面获取验证码图片
        result = await crawler.arun(
            url=BOC_URL,
            wait_for="captcha_img",
            page_timeout=30000,
        )
        
        # 步骤 2: 识别验证码（OCR 或人工）
        # TODO: 集成 OCR 库（如 pytesseract）或人工输入
        captcha_code = await solve_captcha(result)
        
        # 步骤 3: 填写表单并提交
        today = datetime.now().strftime("%Y-%m-%d")
        form_data = {
            "erectDate": today,
            "nothing": today,
            "pjname": "美元",
            "captcha": captcha_code,
            "head": "head_620.js",
            "bottom": "bottom_591.js",
            "first": "1",
            "token": result.metadata.get("token", ""),
        }
        
        result = await crawler.arun(
            url=BOC_URL,
            method="POST",
            data=form_data,
            wait_for="BOC_main",
        )
        
        # 步骤 4: 解析表格
        html = result.html
        # 解析逻辑同下（略）
        
        return {
            "currency": "USD",
            "rate_raw": 682.78,
            "rate_converted": 6.8278,
            "publish_time": "2026-01-29 09:30:14",
            "source": "中国银行"
        }

async def solve_captcha(crawler_result) -> str:
    """
    识别验证码
    
    方案 A: OCR（pytesseract）
    方案 B: 人工输入（交互式）
    方案 C: 第三方验证码识别服务
    """
    # TODO: 实现验证码识别
    return "placeholder"

if __name__ == "__main__":
    import asyncio
    earliest = sys.argv[1] if len(sys.argv) > 1 else "09:30"
    result = asyncio.run(scrape_boc_usd_rate(earliest))
    print(json.dumps(result, ensure_ascii=False))
```

**验证码处理方案（待选）**：
- **OCR**: `pytesseract` + `opencv`，识别率约 60-80%
- **浏览器自动化**: crawl4ai 或 Playwright，等待用户手动输入
- **第三方服务**: 超级鹰/打码平台，付费，识别率 95%+

### `update_exchange_rate_via_api.py`

```python
#!/usr/bin/env python3
"""
将抓取到的汇率更新到美正OS
1. GET /account/currency/list 找到 USD 记录
2. POST /account/currency/update 更新 exchangeRate + remark
"""
import sys
import json
import requests
from datetime import datetime

# 从环境变量读取（复用 fuel-rate 的认证机制）
import os
API_BASE = os.environ["MEIZHENG_API_BASE"]
TOKEN = os.environ["MEIZHENG_TOKEN"]

def find_currency(currency_code: str = "USD") -> dict:
    r = requests.post(
        f"{API_BASE}/account/currency/list",
        headers={"X-Mazon-Token": TOKEN, "Content-Type": "application/json"},
        json={"pageNo": 1, "pageSize": 20},
        timeout=15,
    )
    body = r.json()
    if body.get("code") != 0:
        return None
    
    for record in body["data"]["records"]:
        if record["currencyCode"] == currency_code:
            return record
    return None

def update_currency(record: dict, new_rate: float, remark: str) -> bool:
    payload = {
        **record,  # 保留原有所有字段
        "exchangeRate": new_rate,
        "remark": remark,
        "updateAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "updateBy": "zidonghua",
    }
    
    r = requests.post(
        f"{API_BASE}/account/currency/update",
        headers={"X-Mazon-Token": TOKEN, "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    body = r.json()
    return body.get("code") == 0 and body.get("data") is True

def main(scraped_json_path: str):
    with open(scraped_json_path) as f:
        scraped = json.load(f)
    
    if "error" in scraped:
        print(json.dumps({"status": "skipped", "reason": scraped["error"]}))
        sys.exit(0)  # 早于 9:30 或没找到记录，正常退出
    
    record = find_currency("USD")
    if not record:
        print(json.dumps({"status": "failed", "reason": "USD record not found"}))
        sys.exit(1)
    
    new_rate = scraped["rate_converted"]
    publish_time = scraped["publish_time"]
    
    # 备注格式: 更新汇率2026/01/29 09:30:14  6.9639
    dt_formatted = datetime.strptime(publish_time, "%Y-%m-%d %H:%M:%S").strftime("%Y/%m/%d %H:%M:%S")
    remark = f"更新汇率{dt_formatted}  {new_rate}"
    
    ok = update_currency(record, new_rate, remark)
    
    print(json.dumps({
        "status": "success" if ok else "failed",
        "old_rate": record["exchangeRate"],
        "new_rate": new_rate,
        "remark": remark,
    }, ensure_ascii=False))
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main(sys.argv[1])
```

## 六、Workflow 设计

### `~/.hermes/skill-packs/meizheng/workflows/update-usd-exchange-rate.yaml`

```yaml
id: update-usd-exchange-rate
name: 美金汇率自动更新
description: 每天 09:30 / 10:30 抓取中国银行美金现汇卖出价并更新到美正OS
version: 1

# 注意：这里写默认 cron，实际由 exchange-rate-config.yaml 的 schedules 覆盖
# CoreyOS 后端 schedules.rs 会读取配置文件中的 cron 覆盖 manifest 的 cron
trigger:
  type: cron
  expression: "0 30 9 * * *"

inputs: []

steps:
  - id: validate_config
    name: 验证配置
    type: agent
    after: []
    prompt: |
      ```bash
      ~/.hermes/hermes-agent/venv/bin/python ~/.hermes/skill-packs/meizheng/scripts/validate_exchange_rate_config.py
      ```
      验证通过返回 "配置 OK"，失败终止。

  - id: scrape_rate
    name: 抓取美金汇率
    type: agent
    after: ["validate_config"]
    timeout_minutes: 2
    prompt: |
      运行抓取脚本，结果写入 /tmp/boc-usd-rate.json
      ```bash
      ~/.hermes/hermes-agent/venv/bin/python ~/.hermes/skill-packs/meizheng/scripts/scrape_boc_usd_rate.py 09:30 > /tmp/boc-usd-rate.json
      cat /tmp/boc-usd-rate.json
      ```
      如果输出包含 `"error"`，不要重试，结束。

  - id: update_meizheng
    name: 更新美正OS
    type: agent
    after: ["scrape_rate"]
    timeout_minutes: 2
    prompt: |
      ```bash
      ~/.hermes/hermes-agent/venv/bin/python ~/.hermes/skill-packs/meizheng/scripts/update_exchange_rate_via_api.py /tmp/boc-usd-rate.json
      ```
      原样返回 stdout JSON。
```

### 双 schedule 支持
由于 Hermes manifest 只支持一个 trigger，**两次抓取通过配置文件覆盖**：
- `exchange-rate-config.yaml` 的 `schedules` 数组
- CoreyOS 后端 `schedules.rs` 安装时为每个 schedule 创建一个 Hermes job：
  - `update-usd-exchange-rate-9-30`（cron `0 30 9 * * *`）
  - `update-usd-exchange-rate-10-30`（cron `0 30 10 * * *`）
- 两个 job 指向同一个 workflow，时间不同

## 七、CoreyOS 后端改动

### 7.1 配置 IPC
新增 IPC 命令：
- `pack_exchange_rate_config_get` - 读取 `exchange-rate-config.yaml`
- `pack_exchange_rate_config_set` - 写入 + 触发 schedules 安装

### 7.2 Schedules 覆盖
`src-tauri/src/pack/schedules.rs` 中已有的 `install_schedules_with_overrides` 需要扩展：
- 读取 `exchange-rate-config.yaml`
- 为 `update-usd-exchange-rate` workflow 创建多个 schedule（不是覆盖单个 cron）
- 每个 schedule 一个独立的 Hermes job

实现要点：
```rust
// 伪代码
fn install_schedules_with_overrides() {
    // 现有逻辑：fuel-rate-config.yaml cron 覆盖
    apply_fuel_rate_overrides();
    
    // 新增逻辑：exchange-rate-config.yaml multi-schedule
    apply_exchange_rate_schedules();
}

fn apply_exchange_rate_schedules() {
    let cfg = read_exchange_rate_config();
    if !cfg.enabled { return; }
    
    // 移除所有以 "update-usd-exchange-rate-" 开头的 jobs
    remove_jobs_with_prefix("update-usd-exchange-rate-");
    
    // 为每个 schedule 创建一个 job
    for (idx, schedule) in cfg.schedules.iter().enumerate() {
        let job_id = format!("update-usd-exchange-rate-{}", idx);
        create_job(job_id, &schedule.cron, "update-usd-exchange-rate");
    }
}
```

## 八、实施清单

### 阶段 1：基础设施重构（先做）
- [ ] 抽出 `CronPicker.tsx` 共享组件
- [ ] `CarrierConfigEditor.tsx` 改用共享组件

### 阶段 2：配置层
- [ ] 定义 `exchange-rate-config.yaml` schema
- [ ] 创建默认配置文件
- [ ] CoreyOS Rust 端：`exchange_rate_config.rs` 模块（读/写/校验）
- [ ] IPC 命令：`pack_exchange_rate_config_get/set`

### 阶段 3：UI 层
- [ ] `ExchangeRateConfigEditor.tsx` 组件
- [ ] 集成到 `MeizhengConfig.tsx`
- [ ] 显示最近一次更新状态

### 阶段 4：脚本层
- [ ] `scrape_boc_usd_rate.py`（先用浏览器抓包确认实际表单参数）
- [ ] `update_exchange_rate_via_api.py`
- [ ] `validate_exchange_rate_config.py`

### 阶段 5：Workflow + Scheduler
- [ ] `update-usd-exchange-rate.yaml` workflow
- [ ] `schedules.rs` 扩展支持 multi-schedule

### 阶段 6：测试
- [ ] 9:30 触发测试（dry-run）
- [ ] 10:30 兜底测试
- [ ] 节假日处理（中国银行不出数据）
- [ ] 端到端测试：抓取 → 转换 → API 更新

## 九、风险与边界情况

### R-1: 验证码识别
**问题**：BOC 历史检索页面需要验证码，OCR 识别率不稳定  
**应对**：
- 方案 A：OCR（pytesseract），识别率 60-80%，可能失败
- 方案 B：第三方打码服务（付费），识别率 95%+
- 方案 C：浏览器自动化 + 人工输入（不可自动化）
- 建议先用方案 B 试点，验证码失败时 10:30 兜底抓取

### R-2: 节假日 / 周末
**问题**：中国银行节假日不更新数据  
**应对**：抓取脚本如果没找到当天的数据，返回 `{"error": "no_rate_found"}`，`sys.exit(0)` 正常退出，不报错。

### R-3: 9:30 时网站还没数据
**问题**：早盘可能延迟到 9:35 或更晚  
**应对**：
- 9:30 抓取失败 → 静默跳过
- 10:30 兜底必然能拿到
- UI 显示最近成功时间，让用户判断

### R-4: 现汇卖出价 ≠ 现钞卖出价
**问题**：BOC 表格有 4 列价格，必须取对  
**应对**：
- 配置文件 `rate_type` 字段明确指定（默认"现汇卖出价"）
- UI 下拉框给用户选择
- 抓取脚本按列名定位，不靠列索引（防止表格结构变化）

### R-5: 除以 100 是 BOC 的展示惯例
**问题**：BOC 表格显示 `682.78` 实际含义是 100 美元 = 682.78 人民币  
**应对**：
- 配置文件 `divide_by: 100` 明确转换系数
- 转换后保留 4 位小数（与美正OS 数据库精度一致）

### R-5: API 必须保留所有原字段
**问题**：`/currency/update` 接口要求传完整对象，缺字段会丢数据  
**应对**：
- 先 `list` 拿到完整记录
- `update` 时 `{...record, exchangeRate, remark, updateAt, updateBy}` 只覆盖需要变的字段

### R-6: 备注空格数量
**问题**：用户给的样例是 `更新汇率2026/01/29 09:30:14  6.9639`（双空格）  
**应对**：模板严格按用户给的格式：`更新汇率{datetime}  {rate}`（两个空格）

## 十、文档关联
- 修改：`docs/plans/enterprise-rpa-pack.md` 增加汇率自动化交付项
- 修改：`docs/status/TODO.md` 增加汇率任务
- 新建：本文档（设计稿）

## 十一、未决问题（实施前需确认）

1. ❓ **BOC POST 表单的完整参数**：需要实际抓包确认 `pjname=1316` 是否正确，可能还需要 token / referer
2. ❓ **schedules 多 cron 实现**：是把 manifest 改成数组，还是在 schedules.rs 里展开？倾向后者（manifest 不变，pack-side 配置驱动）
3. ❓ **UI 在 MeizhengConfig 还是独立 Tab**：当前规划是同页 section，是否考虑独立 tab？建议先用 section（同页直观），后续如果配置项多再拆 tab
4. ❓ **远期是否支持多币种**（EUR/GBP/JPY）：当前只做 USD，但配置结构已预留扩展（`target.currency_code` 字段）

---

**下一步**：等用户确认设计 → 进入阶段 1（重构 CronPicker）→ 阶段 2 配置层 → ...
