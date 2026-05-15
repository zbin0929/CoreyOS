# CloakBrowser — 反检测浏览器调研

> 创建日期：2026-05-16
> 来源：https://github.com/CloakHQ/CloakBrowser
> 当前版本：v0.3.28（Chromium 146）
> 许可证：MIT

## 一句话总结

CloakBrowser 是在 C++ 源码级别修改 Chromium 指纹的反检测浏览器，API 完全兼容 Playwright/Puppeteer，通过 Cloudflare Turnstile、reCAPTCHA v3（0.9 分）等所有主流 bot 检测。

## 核心特性

| 特性 | 说明 |
|------|------|
| 指纹修改 | 49 个 C++ 源码级 patch（canvas、WebGL、audio、fonts、GPU、screen、WebRTC、network timing 等） |
| reCAPTCHA v3 | 0.9 分（人类级别） |
| Cloudflare Turnstile | 自动通过（非交互式 + managed） |
| FingerprintJS | 通过 |
| BrowserScan | NORMAL（4/4） |
| `navigator.webdriver` | `false`（源码级 patch） |
| TLS 指纹 | 与真实 Chrome 一致（ja3n/ja4/akamai） |
| 人类行为模拟 | `humanize=True`：Bézier 曲线鼠标、逐字键盘输入、真实滚动 |
| 代理支持 | HTTP / SOCKS5 原生支持 |
| 地理自动匹配 | `geoip=True` 自动从代理 IP 检测时区和语言 |

## 安装

```bash
# Python
pip install cloakbrowser

# Node.js + Playwright
npm install cloakbrowser playwright-core

# Docker（无需安装）
docker run --rm cloakhq/cloakbrowser cloaktest
```

首次运行自动下载 stealth Chromium 二进制（~200MB，本地缓存）。

## API 用法

### Python（替代 Playwright）

```python
from cloakbrowser import launch

# 基础用法（headless）
browser = launch()
page = browser.new_page()
page.goto("https://protected-site.com")
browser.close()

# 带代理 + 地理自动匹配
browser = launch(proxy="socks5://user:pass@us-proxy:1080", geoip=True)

# 带人类行为模拟
browser = launch(humanize=True)

# 持久化 profile（跨 session 保持 cookie）
from cloakbrowser import launch_persistent_context
context = launch_persistent_context("/path/to/profile")
```

### 从 Playwright 迁移（一行改动）

```python
# Before
from playwright.sync_api import sync_playwright
pw = sync_playwright().start()
browser = pw.chromium.launch()

# After
from cloakbrowser import launch
browser = launch()
```

## 对 CoreyOS 的价值

### 当前痛点

CoreyOS 的浏览器自动化（UPS 分区下载等）使用 Playwright + stealth 插件，存在以下问题：

1. **Chrome 更新后 stealth 插件经常失效** — `playwright-stealth`、`undetected-chromedriver` 都是 JS 注入或 config 级 patch，每次 Chrome 更新都可能被检测
2. **部分网站 bot 检测越来越严** — Cloudflare Turnstile、Akamai Bot Manager 等

### 适用场景

| 场景 | 是否适用 | 说明 |
|------|----------|------|
| UPS 分区下载 | 可选升级 | 当前 Playwright 方案已可用，但 CloakBrowser 更稳定 |
| FedEx 分区下载 | 配合代理有效 | FedEx 封锁中国 IP，需美国代理 + 反检测 |
| USPS 分区下载 | 不需要 | 纯 HTTP API，无需浏览器 |
| 通用网页抓取 | 强烈推荐 | 替代 Playwright + stealth 插件方案 |

### 集成方式

CloakBrowser 可以作为 CoreyOS 浏览器自动化的 **默认引擎**：

1. **Phase 1（评估）**：在现有 UPS 下载脚本中替换 Playwright 为 CloakBrowser，验证稳定性
2. **Phase 2（集成）**：将 CloakBrowser 作为 `browser-runner.cjs` 的底层引擎
3. **Phase 3（通用化）**：所有 Pack 的浏览器自动化都走 CloakBrowser

### 依赖要求

- Python 3.10+（CoreyOS 已满足）
- `pip install cloakbrowser`（~200MB 二进制自动下载）
- Docker 可选：`cloakhq/cloakbrowser`

## 技术细节

### 为什么比 playwright-stealth 好

| 对比项 | playwright-stealth | CloakBrowser |
|--------|--------------------|--------------|
| Patch 级别 | JS 注入 | C++ 源码编译 |
| Chrome 更新后 | 经常失效 | 自动适配 |
| 检测方式 | 注入本身会被检测 | 二进制级别，无法区分 |
| TLS 指纹 | 不处理 | 与真实 Chrome 一致 |
| 维护状态 | 停滞 | 活跃（v0.3.28） |

### 与 Camoufox 对比

Camoufox 基于 Firefox，CloakBrowser 基于 Chromium。CoreyOS 的 Playwright 工作流都基于 Chromium，迁移到 CloakBrowser 成本更低。

## 注意事项

1. **CloakBrowser 解决 bot 检测，不解决地理封锁** — FedEx 的中国 IP 封锁需要美国代理配合
2. **二进制较大（~200MB）** — 首次下载需要时间，之后缓存
3. **MIT 许可证** — 可自由用于商业项目
4. **自动更新** — 后台检查新版本 stealth build

## 相关链接

- GitHub：https://github.com/CloakHQ/CloakBrowser
- PyPI：https://pypi.org/project/cloakbrowser/
- Docker Hub：`cloakhq/cloakbrowser`
- Profile Manager：https://github.com/CloakHQ/CloakBrowser-Manager
