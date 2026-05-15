# 承运商配置说明

## 问题 1: 有效期"整月"

DHL 等承运商的燃油费率有效期是"整月"，但不同月份天数不同（28/29/30/31天），固定天数无法准确表示。

## 问题 2: 必须在"月末最后一天"执行

标准 cron 不支持 `L`（Last day）语法，需要用"每天执行 + 脚本判断"方案。

## 解决方案

### UI 层

在有效期下拉框中新增选项：
- `7 天`
- `30 天`
- `90 天`
- **`整月（脚本自动计算到月末）`** ← 新增

选择"整月"时，`validityDays` 字段保存为 `-1`。

### 脚本层

抓取脚本需要处理 `validityDays = -1` 的情况：

```python
from datetime import datetime, timedelta
import calendar

def calculate_end_date(start_date: datetime, validity_days: int) -> datetime:
    """
    计算有效期结束日期
    
    Args:
        start_date: 起始日期
        validity_days: 有效天数，-1 表示整月
    
    Returns:
        结束日期（不含当天，即下一期起始日）
    """
    if validity_days == -1:
        # 整月：计算到当月最后一天的下一天（即下月1号）
        year = start_date.year
        month = start_date.month
        # 获取当月最后一天
        last_day = calendar.monthrange(year, month)[1]
        # 返回下月1号
        if month == 12:
            return datetime(year + 1, 1, 1, 0, 0, 0)
        else:
            return datetime(year, month + 1, 1, 0, 0, 0)
    else:
        # 固定天数
        return start_date + timedelta(days=validity_days)

# 示例
start = datetime(2026, 2, 1, 0, 0, 0)  # 2月1号
end = calculate_end_date(start, -1)
print(end)  # 2026-03-01 00:00:00 (2月只有28天)

start = datetime(2026, 1, 1, 0, 0, 0)  # 1月1号
end = calculate_end_date(start, -1)
print(end)  # 2026-02-01 00:00:00 (1月有31天)
```

### 配置示例

```yaml
carriers:
  dhl:
    name: DHL
    enabled: true
    sourceUrl: https://www.dhl.com/...
    updateFrequency: monthly
    cron: "0 0 2 1 * *"  # 每月1号凌晨2点
    validityDays: -1     # ← 整月
    services:
      - sourceName: Domestic Products
        country: US
        applyTo: default
```

## 实现清单

### ✅ 已完成
- [x] UI 下拉框新增"整月"选项
- [x] 保存 `-1` 到配置文件
- [x] 创建 `date_utils.py` 通用日期计算模块
- [x] `scrape_dhl_fuel_rate.py` 支持 `-1` 值
- [x] `scrape_fedex_fuel_rate.py` 支持 `-1` 值
- [x] `scrape_ups_fuel_rate.py` 支持 `-1` 值

### 📝 实现细节
所有抓取脚本已更新，使用 `calculate_end_date()` 函数：
- `validity_days > 0`: 固定天数
- `validity_days = -1`: 自动计算到当月最后一天的下一天（下月1号）

## 测试场景

### 场景 1: 2月整月（28天）
- 配置: `validityDays: -1`
- 抓取日期: 2026-02-01
- 预期结果:
  - `valid_from`: 2026-02-01 00:00:00
  - `valid_until`: 2026-03-01 00:00:00
  - 实际有效天数: 28 天

### 场景 2: 1月整月（31天）
- 配置: `validityDays: -1`
- 抓取日期: 2026-01-01
- 预期结果:
  - `valid_from`: 2026-01-01 00:00:00
  - `valid_until`: 2026-02-01 00:00:00
  - 实际有效天数: 31 天

### 场景 3: 闰年2月（29天）
- 配置: `validityDays: -1`
- 抓取日期: 2024-02-01
- 预期结果:
  - `valid_from`: 2024-02-01 00:00:00
  - `valid_until`: 2024-03-01 00:00:00
  - 实际有效天数: 29 天

## 月末最后一天执行方案

### 问题
某些承运商（如 DHL）要求必须在**月末最后一天**执行，但标准 cron 不支持 `L` 语法。

### 解决方案：每天执行 + 脚本判断

#### 1. Cron 配置
```yaml
cron: "0 0 20 * * *"  # 每天20点执行
```

#### 2. 脚本开头加月末判断
```python
#!/usr/bin/env python3
import sys
from datetime import datetime, timedelta

def is_last_day_of_month():
    """判断今天是否是月末最后一天"""
    today = datetime.now().date()
    tomorrow = today + timedelta(days=1)
    return tomorrow.day == 1  # 明天是1号 = 今天是月末

# 如果不是月末，直接退出
if not is_last_day_of_month():
    print("今天不是月末，跳过执行")
    sys.exit(0)

# 今天是月末，执行实际逻辑
print("今天是月末，开始抓取...")
# ... 实际抓取代码 ...
```

#### 3. 实际执行时间
- 1月31号 20:00 ✅
- 2月28号 20:00 ✅（平年）
- 2月29号 20:00 ✅（闰年）
- 3月31号 20:00 ✅
- 4月30号 20:00 ✅
- 其他日期：脚本立即退出，不执行

#### 4. 优点
- ✅ 精确匹配"月末最后一天"
- ✅ 自动处理28/29/30/31天的月份
- ✅ 自动处理闰年
- ✅ 脚本退出快（非月末日期几毫秒就退出）
- ✅ Hermes scheduler 不会报错（exit 0 是正常退出）

#### 5. 缺点
- ❌ 每天都会触发一次（但非月末日期立即退出，几乎无开销）
- ❌ 日志中会有29-30条"跳过执行"记录

## 向后兼容

- 现有配置中的 `validityDays: 7/30/90` 继续正常工作
- 只有显式设置为 `-1` 才会触发"整月"逻辑
- 如果脚本尚未支持 `-1`，会按固定天数处理（需要更新脚本）
