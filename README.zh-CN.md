# CoreyOS

[![CI](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml/badge.svg)](https://github.com/zbin0929/CoreyOS/actions/workflows/ci.yml)
[English](./README.md) | **中文**

> 开发者优先的 AI 控制平面，基于 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 构建。
>
> 多模型聊天、行业技能包管理、工作流编排、多渠道消息路由——一个键盘优先的 macOS / Windows 桌面应用搞定。

**Tauri 2** 桌面应用 · **15 MB** 二进制 · **50–100 MB** 内存 · macOS 12+ / Windows 10+

---

## 功能特性

### 聊天 & 多 Agent

- 🤖 **多模型聊天** — 流式 SSE、工具进度、Markdown 渲染、语法高亮。在输入框一键切换 DeepSeek、GPT-4o、Claude、Qwen、Kimi、Gemini 和本地 Ollama。
- 🔀 **多 Agent 控制台** — 同时运行多个 Hermes 实例，每个实例独立的 LLM 配置、适配器和预算。
- 📎 **文件附件** — 拖拽、粘贴或文件选择器。PDF/Word/Excel 内容提取。按 Agent 隔离的沙箱作用域。
- 🔄 **模型对比** — 同一个提示词，N 个模型并行输出，逐字对比。

### 知识 & 记忆

- 📚 **知识库（RAG）** — 上传文档，自动分块，Jaccard 关键词匹配或 BGE-M3 语义向量搜索 + RRF 融合。自动注入每轮对话。
- 🧠 **记忆编辑器** — `MEMORY.md` + `USER.md`，语法高亮，容量计，FTS5 会话搜索。全息事实库统计（事实数、分类、衰减）。
- 🎙️ **语音** — 按键说话 ASR + TTS（OpenAI、智谱、Groq、Edge TTS）。

### 工作流 & 自动化

- ⚡ **工作流引擎** — DAG 工作流编辑器，支持条件分支、循环、浏览器自动化步骤和并行执行。
- ⏰ **定时任务** — cron 表达式触发提示词，输出捕获为 Markdown。
- ✅ **任务 & 审批** — 跟踪 Agent 发起的任务，审批或拒绝危险操作。
- 🛡️ **文件守卫** — 跨平台 file-ops-guard，对 Desktop/Documents/Downloads 的破坏性操作（删除/覆盖）弹出原生确认对话框。

### 技能 & MCP

- 🧩 **技能中心** — 浏览并安装 7+ 社区来源的技能，封装 `hermes skills` CLI。
- 📦 **技能包（Skill Packs）** — 行业定制包（视图、技能、工作流、MCP 服务器、定时任务），通过 `manifest.yaml` 加载。支持 `customer.yaml` 白标定制。
- 🔌 **MCP 服务器管理** — stdio + URL 传输，按 Pack 自动注册 MCP，桌面原生工具（通知、文件选择器、深链接）。

### 可观测性

- 📊 **分析** — Token 用量、成本估算、延迟追踪、错误率、健康雷达、CSV 导出。
- 🕸️ **轨迹（Trajectory）** — 将历史会话可视化为消息 + 工具调用的时间线。嵌套子 Agent 委托树。每条消息的 Token/延迟统计。
- 💰 **预算** — 按模型/配置的消费上限，80% 预警。
- 📜 **日志** — 实时 Gateway + Agent 日志查看器。

### 平台 & 渠道

- 📡 **16 种消息网关** — Telegram、Discord、Slack、企业微信、微信、飞书、Matrix、WhatsApp、Signal、钉钉、邮件、短信、iMessage、Mattermost、Webhooks、Home Assistant。
- 🧰 **LLM 配置库** — 在 `/models` 页面定义 `{provider, base_url, model, api_key_env}`，跨 Agent 复用。11 个预置模板，含 6 个国产大模型。
- ⌨️ **键盘优先** — `⌘K` 命令面板，每个页面都有快捷键直达。
- 🌏 **中文 + English** — 完整 zh-CN 本地化；自动检测语言。

---

## 截图

_截图将在 v0.3.0 版本发布时补充。_

---

## 安装

从 [GitHub Releases](https://github.com/zbin0929/CoreyOS/releases) 下载最新版本。从源码构建请看 **[SETUP.md](./SETUP.md)**。

### 运行前提

- **Hermes Agent** 已安装并可访问本地网关（通常是 `http://127.0.0.1:8642`）。从 [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/docs/quickstart) 安装。没有 Hermes 时 CoreyOS 以只读模式运行——可以浏览但大部分功能不可用。
- **操作系统**：macOS 12+ / Windows 10+。

### 首次运行

打开应用 → 首页。引导清单自动检测：

1. **连接 Hermes** — 绿色标签 = 网关可达。不可达则跳转设置页。
2. **选择模型** — 任意 OpenAI 兼容提供商，在 Hermes 中配置。
3. **开始第一次聊天** — 发一条消息就行。
4. **设置个人资料** — 在 记忆 → 用户资料 写一两句话，让 Agent 了解你。
5. **连接消息渠道**（可选）— 从 渠道 页面配置 Telegram / Discord 等。

在任何页面按 `⌘K` 模糊搜索所有页面和 Runbook。点击页面标题旁的 `?` 图标查看上下文帮助。

---

## 页面一览

| 页面 | 说明 |
|------|------|
| **聊天** | 多模型流式聊天，工具进度，斜杠命令，附件，Token 追踪 |
| **首页** | 仪表盘，引导清单，Hermes 状态，快捷操作 |
| **工作流** | DAG 工作流编辑器，浏览器自动化，条件分支，定时调度 |
| **任务** | Agent 任务追踪，审批流程 |
| **模型** | LLM 配置库 — 定义一次，处处复用 |
| **技能** | 浏览、安装和管理 Hermes 技能，7+ 来源 |
| **知识库** | 上传文档 → 自动分块 → 关键词/语义搜索 → 注入对话 |
| **记忆** | 编辑 MEMORY.md / USER.md，查看全息事实库统计 |
| **MCP** | MCP 服务器管理 — stdio + URL 传输，桌面原生工具 |
| **渠道** | 16 种消息网关（Telegram、Discord、企业微信等） |
| **轨迹** | 会话时间线 — 消息、工具调用、子 Agent 树、Token/延迟统计 |
| **分析** | Token 用量、成本、延迟、错误率，CSV 导出 |
| **日志** | 实时 Gateway + Agent 日志查看器 |
| **预算** | 按模型/配置的消费上限 |
| **设置** | 提供商配置、Profile、语音、定时任务、Runbook、终端等 |

---

## 状态

| 里程碑 | 状态 |
|---|---|
| Phase 0–12（基础 → 文件智能） | ✅ 全部完成 |
| v0.2.0（白标 + Pack 加载器 + 12 视图模板 + 授权 + 分析） | ✅ 已发布 |
| v0.2.13（Windows 文件守卫修复，跨平台对话框） | ✅ 已发布 |
| v0.3.0（跨境电商 Pack） | 🔧 开发中 |

测试：Rust **555** · Vitest **112** · Playwright **77** · 全部通过。

完整路线图见 [`docs/status/roadmap.md`](./docs/status/roadmap.md)；变更日志见 [`CHANGELOG.md`](./CHANGELOG.md)。

---

## 架构

Tauri 2 桌面应用（单二进制，无 Electron）。

- **Rust**（`src-tauri/`）：193+ IPC 命令，SQLite 会话存储，沙箱门控，Pack 加载器，工作流引擎，MCP stdio 桥接，知识库（Jaccard + BGE-M3 RAG），文件操作守卫，Hermes `/v1/runs` 适配层。
- **TypeScript**（`src/`）：React 18 + TanStack Router，zustand 状态管理，Tailwind + shadcn 风格组件，12 个 Pack 视图模板。
- **数据**：所有状态存储在 `~/.hermes/`（配置、技能、工作流、记忆、MCP 服务器）。无远程服务器。

详见 [`docs/spec/architecture.md`](./docs/spec/architecture.md)。

---

## 参与贡献

从这里开始：

- **[SETUP.md](./SETUP.md)** — 从源码构建（Node 20、pnpm 9、Rust stable）。
- **[`docs/spec/architecture.md`](./docs/spec/architecture.md)** — Rust ↔ TypeScript 分工、Pack 架构、数据流。
- **[`docs/spec/agent-adapter.md`](./docs/spec/agent-adapter.md)** — `AgentAdapter` trait 说明。
- **[`CHANGELOG.md`](./CHANGELOG.md)** — 按日期的版本记录。

运行 `pnpm tauri:dev:clean` 开始开发。

---

## 命名

**CoreyOS** 是项目名。Rust crate 名为 `caduceus`（历史遗留，不值得改名）。应用包名为 `Corey`。

---

## 许可证

详见 [`docs/spec/licensing.md`](./docs/spec/licensing.md)。
