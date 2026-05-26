---
name: financial-reconciliation
description: |
  Excel财务对账技能。支持三种核心场景：
  1. 两表互核（银行流水 vs 内部账目、AR/AP对账）
  2. 单表校验（合计校验、勾稽关系、重复检测、异常识别）
  3. 系统数据对比（ERP导出 vs 手工表）
  处理大规模Excel数据（十万行级别），自动识别差异并生成带颜色标记的对账报告Excel。
  触发词：对账、核对、reconciliation、银行对账、往来对账、差异、Excel比对、数据校验
version: 1.0.0
author: CoreyOS
license: MIT
metadata:
  hermes:
    tags: [finance, reconciliation, excel, accounting, 对账, 财务, 核对, 校验]
---

# Excel 财务对账技能

## 适用场景

| 场景 | 典型用途 | 命令模式 |
|------|----------|----------|
| **两表互核** | 银行流水 vs 内部账目，AR/AP 往来对账 | `compare` |
| **单表校验** | 合计验证、重复检测、缺失值、异常值 | `validate` |
| **模糊匹配** | 日期+金额近似匹配（无共同编号时） | `match` |

## 前置条件

本技能依赖 Python + pandas。Hermes bootstrap 已安装 Python 3.11，脚本首次运行会自动安装 pandas 和 openpyxl。

## 使用方法

本技能自带 Python 脚本 `reconcile.py`，位于 `{baseDir}/scripts/reconcile.py`。

### 1. 两表互核 (compare)

对比两份 Excel，按关键列匹配，找出差异。

```bash
python "{baseDir}/scripts/reconcile.py" compare "文件A.xlsx" "文件B.xlsx" \
  --keys "订单号" \
  --compare "金额,数量,状态" \
  --output "对账报告.xlsx"
```

**参数说明：**
- `--keys`: 匹配用的关键列名（逗号分隔，支持多列联合匹配）
- `--compare`: 要比对的数值/状态列（逗号分隔）
- `--sheet-a`, `--sheet-b`: 指定 sheet 名（默认第一个 sheet）
- `--output`: 输出报告路径（默认 `reconciliation_report.xlsx`）
- `--tolerance`: 数值容差（默认 0.01，金额允许的误差）

**输出报告包含：**
- **汇总** sheet：总行数、匹配数、差异数、仅在A/B中的条数
- **差异明细** sheet：匹配上但数值不同的行（红色标记差异列）
- **仅在文件A** sheet：文件B中没有的记录
- **仅在文件B** sheet：文件A中没有的记录

### 2. 单表校验 (validate)

检查单份 Excel 的数据完整性和准确性。

```bash
python "{baseDir}/scripts/reconcile.py" validate "财务表.xlsx" \
  --checks sum,duplicates,missing,outliers \
  --sum-col "金额" \
  --key-col "订单号" \
  --output "校验报告.xlsx"
```

**校验项：**
- `sum`: 数值列合计校验（检查小计/合计行是否正确）
- `duplicates`: 按关键列检测重复记录
- `missing`: 检测必填列的缺失值
- `outliers`: 数值列异常值检测（Z-score > 3）
- `balance`: 借贷平衡检查（需指定 `--debit-col` 和 `--credit-col`）

### 3. 模糊匹配 (match)

无共同编号时，按金额+日期近似匹配。

```bash
python "{baseDir}/scripts/reconcile.py" match "银行流水.xlsx" "内部账.xlsx" \
  --amount-a "交易金额" --amount-b "记账金额" \
  --date-a "交易日期" --date-b "记账日期" \
  --tolerance 0.01 \
  --date-range 3 \
  --output "匹配报告.xlsx"
```

**参数说明：**
- `--amount-a`, `--amount-b`: 两表的金额列名
- `--date-a`, `--date-b`: 两表的日期列名
- `--tolerance`: 金额容差（绝对值，默认 0.01）
- `--date-range`: 日期容差天数（默认 3 天）

## 执行流程

当用户请求对账时，按以下步骤执行：

1. **确认场景**：询问用户是哪种对账（两表互核/单表校验/模糊匹配）
2. **确认文件**：获取 Excel 文件路径
3. **预览数据**：先用 pandas 读取前 5 行，展示列名让用户确认关键列和比对列
4. **执行对账**：运行 reconcile.py 脚本
5. **报告解读**：读取输出报告的汇总 sheet，向用户说明差异情况
6. **建议处理**：针对差异给出处理建议

## 预览数据的命令

在正式对账前，先预览文件结构：

```bash
python "{baseDir}/scripts/reconcile.py" preview "文件.xlsx"
```

输出：sheet 列表、每个 sheet 的列名和前 5 行数据、行数统计。

## 大文件处理

- 脚本使用 pandas 分块读取，10万行以内直接处理
- 超过 10 万行自动启用分块模式（chunk_size=50000）
- 输出报告按 sheet 分页，不会超出 Excel 行数限制

## 注意事项

- 列名匹配区分大小写，请确保用户提供的列名与 Excel 完全一致
- 日期列会自动尝试解析为 datetime 格式
- 金额列会自动尝试转换为数值类型（去除千分位逗号、货币符号）
- 如果 Excel 有多个 sheet，默认使用第一个，可通过 `--sheet-a` / `--sheet-b` 指定
