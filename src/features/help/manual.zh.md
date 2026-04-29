# CoreyOS 用户手册

> CoreyOS 是你本地 AI Agent 生态的桌面控制台。所有 LLM、所有 IM 平台、所有技能/记忆/工具/工作流，集中到一个 Tauri 应用里。

**最后更新**：2026-04-29 · 覆盖至 v0.1.8 · 21 个功能页

---

## 目录

1. [简介](#简介)
2. [安装与首次启动](#安装与首次启动)
3. [快速开始](#快速开始)
4. [功能页详解](#功能页详解)
   - [Home（主页）](#home主页)
   - [Chat（对话）](#chat对话)
   - [Compare（多模对比）](#compare多模对比)
   - [Models（LLM 配置库）](#modelsllm-配置库)
   - [Agents（多 Agent 控制台）](#agents多-agent-控制台)
   - [Profiles（Hermes 配置集）](#profileshermes-配置集)
   - [Channels（平台通道）](#channels平台通道)
   - [Skills（技能库）](#skills技能库)
   - [Runbooks（运行手册）](#runbooks运行手册)
   - [Memory（记忆）](#memory记忆)
   - [Knowledge（知识库）](#knowledge知识库)
   - [Trajectory（轨迹）](#trajectory轨迹)
   - [Workflow（工作流）](#workflow工作流)
   - [Scheduler（定时任务）](#scheduler定时任务)
   - [Budgets（预算）](#budgets预算)
   - [Analytics（统计）](#analytics统计)
   - [Voice（语音）](#voice语音)
   - [MCP（工具协议）](#mcp工具协议)
   - [Terminal（终端）](#terminal终端)
   - [Logs（日志）](#logs日志)
   - [Settings（设置）](#settings设置)
5. [横向能力](#横向能力)
   - [快捷键](#快捷键)
   - [搜索面板（⌘K Palette）](#搜索面板k-palette)
   - [中英双语](#中英双语)
   - [备份与迁移](#备份与迁移)
6. [典型场景与最佳实践](#典型场景与最佳实践)
7. [常见问题](#常见问题)
8. [故障排查](#故障排查)
9. [术语对照](#术语对照)

---

## 简介

### 是什么

**CoreyOS** 是 [Hermes Agent](https://hermes-agent.nousresearch.com/) 的桌面控制台。Hermes 是一个本地运行的、OpenAI 兼容的 Agent 网关；CoreyOS 给它一张键盘+图形化的脸，把命令行翻译成可视化操作。

- 一份二进制（~30 MB），跨 macOS / Windows / Linux
- 不依赖 Electron、不要求云后端、不发送遥测
- 数据全部保存在本地 `~/.hermes/` 和 `~/Library/Application Support/com.caduceus.app/`（macOS）

### 是给谁的

**两类目标用户**同时覆盖：

1. **开发者 / 重度 AI 用户** — 多模型对比、跨 agent 配置、命令行集成
2. **运营 / 自动化用户** — 群聊机器人、定时任务、工作流编排，不写代码

### 不是什么

- ❌ 不是 ChatGPT 客户端（虽然能聊 GPT）
- ❌ 不是 LangChain 编排器（虽然能多步工作流）
- ❌ 不是云服务（应用在你的电脑上独立跑）

---

## 安装与首次启动

### 系统要求

- **macOS** 12+ / **Windows** 10+ / 任意 **Linux** with WebKit2GTK
- **磁盘**：应用本体 ~30 MB · 数据库与附件按使用增长
- **内存**：≥ 4 GB（启动 ~120 MB，对话过程中可能上 500 MB）

### 安装 Hermes（必需）

打开 [hermes-agent.nousresearch.com/docs/quickstart](https://hermes-agent.nousresearch.com/docs/quickstart)，按你平台的 brew/scoop/curl 命令安装。

CoreyOS 会自动检测：
- ✅ 二进制存在 `$PATH` 或 `~/.local/bin/hermes`
- ✅ 网关运行在 `127.0.0.1:8642`
- ✅ `~/.hermes/config.yaml` 可读写

如果未装 Hermes，CoreyOS 会进入**只读 stub 模式**——能浏览界面但不能真聊天。

#### Windows 一键安装

Windows 用户可以在 Corey 内点击**一键安装**按钮，自动完成以下操作：

1. **检测环境** — Windows 版本、Git、Python
2. **安装 Hermes Agent** — 通过 ghfast.top 镜像 clone 代码 + 清华 PyPI 安装依赖（无需代理）
3. **创建虚拟环境** — 使用 `uv venv` + Python 3.11
4. **配置 PATH** — 将 hermes 加入用户 PATH
5. **启动 Gateway** — 自动使用 `hermes gateway run`

安装过程中会弹出 PowerShell 窗口显示实时进度。安装完成后 Gateway 自动运行。

> **安装位置**：Hermes 安装到 Corey 所在目录下（如 `E:\Program Files\Corey\hermes-agent\`）。HERMES_HOME 默认为 `C:\Users\<用户名>\.hermes\`。

### 首次启动

1. 打开 CoreyOS → 落到 **Home** 页
2. 看右上角 onboarding 检查清单：
   - 🟢 **Hermes 已连接** — 网关就绪
   - 🟡 **配置默认模型** — 跳到 `/models` 加你的第一个 LLM Profile
   - 🟡 **写一句话用户档案** — 跳到 `/memory` 写 USER.md
   - 🟢 **完成** — 整体 onboarding 成功
3. 任意时候按 ⌘K 调起命令面板，或 ⌘1–⌘9 跳到任意主功能页

### 首条对话验证

1. ⌘1 → Chat 页
2. 输入"你好"
3. 看到流式回复 = 整条链路通了

---

## 快速开始

### 60 秒上手三件事

#### ① 加一个 LLM Profile（如果你只用 Hermes 默认配置可跳过）

1. ⌘ + `models`（或左侧导航 Models）
2. 点右上角 **+ 新建**
3. 选 Provider 模板（DeepSeek / OpenAI / Claude / Kimi …）
4. 粘贴 API Key → 选模型 → 保存
5. 默认勾选成 default → 自动应用到 Chat

**支持的 Provider**（13 个）：

| 国际 | 国产 | 本地 |
|---|---|---|
| OpenAI | DeepSeek | Ollama |
| Anthropic Claude | 通义千问 (Qwen) | |
| Google Gemini | 智谱 GLM | |
| OpenRouter | Kimi (Moonshot) | |
| NVIDIA | 零一万物 (Yi) | |
| | 百川 | |
| | 腾讯混元 | |

#### ② 接入第一个 IM 平台（可选）

1. ⌘K → 输入 channels
2. 选 Telegram → 编辑
3. 粘贴 bot token → **0.5 秒后自动 inline 显示** ✅ `已验证：@YourBotName`
4. 保存 → 提示重启网关 → 一键重启
5. 在 Telegram 给你的 bot 发消息 → CoreyOS 这边也能看到

#### ③ 写第一个 Runbook（命名 prompt）

1. 进 Runbooks 页 → 新建
2. Name: `日报`，Template: `请把以下要点整理成日报：\n{{points}}`
3. 保存
4. ⌘K → 输入"日报" → 回车 → 弹窗填入参数 → 自动跳到 Chat 发送

---

## 功能页详解

### Home（主页）

**路径**：`/` · **快捷键**：⌘1

#### 包含
- **Onboarding 清单**（仅首次显示直到全部完成）
- **快速开始**：3 个最常用入口
- **统计卡片**：今日消息数 / Token 消耗 / 活跃模型
- **最近会话**：MRU 排序，点击直接进 Chat 续聊

#### 用法提示
- 检查清单完成后会被收起；可在 Settings 里手动重置
- 所有数字点击可跳到对应详情页

---

### Chat（对话）

**路径**：`/chat` · **快捷键**：⌘2 · **是默认入口**

#### 主要功能

##### 1) 流式多轮对话
- 输入框支持 Markdown
- 回车发送 / Shift+回车换行
- 流式渲染 Token，可中途按 **Stop** 取消
- 支持模型的"思考链"（如 DeepSeek-Reasoner）会折叠显示

##### 2) 附件支持
- **拖放**：把文件拖到输入框
- **粘贴**：⌘V 直接贴图（截图）
- **选择**：点回形针图标
- 支持类型：
  - 图片（PNG/JPEG/WebP）→ 多模态模型直接看
  - PDF → 自动文本提取
  - DOCX/XLSX → 自动文本提取
  - 任意文本 → 内容内联

##### 3) 会话内切换模型
- Chat 顶部金色 badge 显示当前模型
- 点击弹出 picker：
  - 可选任一已配置 LLM Profile
  - 可临时覆盖（仅本会话），不影响默认
  - 显示模型能力图标（vision / function / reasoning）

##### 4) 操作每条消息
- **复制** 消息原文
- **重新生成**（仅最后一条 assistant）— retry 守卫不会孤立后续消息
- **👍/👎** — 持久化记录到 SQLite，反馈率在 Analytics 显示
- **TTS 朗读** — 调用 Voice 设置的 TTS 提供商

##### 5) 会话内搜索
- ⌘F 在当前会话内全文搜索
- 高亮匹配片段
- ↑↓ 跳转

##### 6) 语音输入
- 麦克风图标 → 录音 → 自动 ASR → 转写文字进 composer
- 支持 OpenAI / Zhipu / Groq 三家 ASR

##### 7) 会话管理
- 左侧 SessionsPanel 列出所有会话
- 自动派生标题（LLM 异步重写）
- 重命名 / 删除 / 导出（Markdown / JSON）
- 一键转存为 Skill

#### 进阶用法
- **多 Agent 模式**：左侧顶部 AgentSwitcher 切换不同 Hermes agent
- **Routing rules**：Settings 里配置规则，根据消息内容自动路由（如"含代码 → Claude"）

#### 网关会话（Gateway Sessions）

通过 IM 平台（微信、钉钉、Telegram 等）与 Hermes 进行的对话会**自动出现在左侧对话列表**中。

- **自动同步**：Corey 每 60 秒自动检查并导入新的网关会话
- **来源标记**：每个网关会话前面有彩色 badge 标识来源平台：

| 来源 | 标记 | 颜色 |
|------|------|------|
| 微信 | 微信 | 红色 |
| 钉钉 | 钉钉 | 蓝色 |
| 飞书 | 飞书 | 紫色 |
| 企业微信 | 企微 | 橙色 |
| QQ | QQ | 青色 |
| Telegram | TG | 天蓝 |
| Discord | DC | 靛蓝 |
| Slack | SL | 翠绿 |
| WhatsApp | WA | 绿色 |
| CLI | CLI | 琥珀 |

- **默认标题**：自动命名为"微信聊天记录"、"Telegram 聊天记录"等
- **只读**：网关会话不可编辑，只能查看历史记录
- **审批提示**：对话中如果 Hermes 发起了安全审批，会以 ⚠️ 标记显示

---

### Compare（多模对比）

**路径**：`/compare` · **快捷键**：⌘K → "compare"

#### 用途
**同一个 prompt 同时推 N 个模型，看谁的回答最好。**

#### 步骤
1. 点 Compare 页
2. 默认 2 个 lane（最多 4 个）
3. 每个 lane 用 ModelPicker 选不同模型 / Profile
4. 顶部输入框写 prompt → 一键 **Run All**
5. 所有 lane 并行流式输出
6. 看完后选"赢家" lane → 系统记录在 SQLite 用于后续分析

#### 高级功能
- **Diff Footer**：自动算每对回答的字符差异
- **报告导出**：所有 lane 的回答 + 元数据（model / tokens / latency）整理成 Markdown
- **Lane 独立设置**：可针对单一 lane 设 system prompt 或 temperature

#### 适合场景
- 选哪个模型 cost-effective
- A/B 测 prompt
- 多模型集成决策（投票 / 多数派）

---

### Models（LLM 配置库）

**路径**：`/models` · **快捷键**：⌘K → "models"

#### 概念

**LLM Profile** = `{provider, base_url, model, api_key_env, label}` 的组合，存在 `~/.hermes/llm_profiles.json`。

定义一次，所有 Agent / Chat / Compare 都能引用。

#### 内置 Provider 模板（13 个）

| 国际 | base_url | 默认模型示例 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | gpt-4o · gpt-4o-mini · o1 |
| Anthropic | `https://api.anthropic.com` | claude-3-5-sonnet |
| Google | `https://generativelanguage.googleapis.com/v1beta` | gemini-2.0-flash |
| OpenRouter | `https://openrouter.ai/api/v1` | 任意 |
| NVIDIA | `https://integrate.api.nvidia.com/v1` | nemotron, llama-3.3 |

| 国产 | base_url | 默认模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | deepseek-chat · deepseek-reasoner |
| 通义千问 (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-max · qwen-plus |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | glm-4-plus · glm-4-flash |
| Kimi (Moonshot) | `https://api.moonshot.cn/v1` | moonshot-v1-128k |
| 零一万物 (Yi) | `https://api.lingyiwanwu.com/v1` | yi-large |
| 百川 | `https://api.baichuan-ai.com/v1` | Baichuan2-Turbo |
| 腾讯混元 | `https://api.hunyuan.cloud.tencent.com/v1` | hunyuan-pro |

| 本地 | base_url | 默认模型示例 |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | llama3 · qwen2.5 · 任意已 pull |

#### 操作

##### 新建一个 Profile
1. 点右上 **+ New profile**
2. 选模板 → 自动填 base_url
3. 填 API Key（直接保存到 `~/.hermes/.env`，永不在前端回显）
4. 选模型（输入框带自动补全）
5. **Probe** 按钮验证连接 + 探测能力（vision / function call）
6. 保存

##### 编辑 / 删除
- 卡片点击 → 表单
- 删除前如果有会话引用，会弹窗确认
- 修改 default → 影响所有未明确指定模型的新会话

##### 配套环境变量
- 所有 API Key 写入 `~/.hermes/.env` 的 `*_API_KEY` 行
- Hermes gateway 启动时读取
- 修改后需重启 gateway 生效（应用会提示）

---

### Agents（多 Agent 控制台）

**路径**：`/agents` · **快捷键**：⌘K → "agents"

#### 概念

**Hermes Instance** = 一个独立运行的 Hermes agent 实例：
- 自己的 base_url（默认 `127.0.0.1:8642`）
- 自己的 API Key（如果暴露公网）
- 自己的默认模型
- 自己的沙箱 scope

可以同时跑多个，比如：
- `default` 用主模型给个人用
- `worker` 用便宜模型跑批
- `customer` 接客服群专用

#### 操作

##### 快速添加（Quick Add）
1. **+ Quick add** → AgentWizard
2. 选模板（pre-configured）
3. 设 ID + label（如 `worker` / "批量任务"）
4. 选 LLM Profile
5. 选 Sandbox Scope（默认 / 限定路径）
6. **Probe** 验证 → 保存

##### 高级（Advanced）
- 直接编辑所有字段
- 可填非默认 base_url（连远程 Hermes）

##### 在 Chat 切换 Agent
- 左侧 SessionsPanel 顶部 AgentSwitcher
- 切换后新会话自动归属新 agent
- 旧会话保留 `adapter_id` 列，标识归属

##### 删除
- 如果有会话引用，弹窗确认（删除 agent 不会删除会话）

---

### Profiles（Hermes 配置集）

**路径**：`/profiles` · **快捷键**：⌘K → "profiles"

#### 概念

Hermes 自身支持**多 profile** — 每个 profile 是 `~/.hermes/profiles/<name>/` 下的一个目录，包含：
- `config.yaml` — gateway 配置
- `.env` — API Keys
- `skills/` — 技能库
- `memory.md` 等

可以在不同 profile 间切换：工作 / 个人 / 测试。

#### 操作

##### 新建 Profile
- **+ New** → 取个名 → 自动复制 active 当模板

##### 切换 Activate
- 点卡片右下 ⚡ → 弹窗确认 from → to → 可选重启 gateway
- 切换后所有 chat 立即用新 profile 的配置

##### 复制（Clone）
- 给现有 profile 改个名留作备份

##### 重命名 / 删除
- 卡片菜单 → 删除会要确认输入名字

##### 导出（tar.gz）
- 点 ⬇ → 下载 `<name>.tar.gz`
- 包含 config.yaml + .env（**注意：含明文 API Key**）+ skills

##### 导入（tar.gz）
- 点 ⬆ → 选 .tar.gz → 弹窗预览 manifest（来源版本 / 文件数）
- 确认目标名（默认 manifest 内的名字）
- 同名时弹"覆盖"二次确认

#### 安全细节
- **Zip-slip 防御**：拒绝任何 `..` / 绝对路径 / 链接条目
- **Symlink 拒绝**：archive 含 symlink 直接报错
- 临时目录解压 → 原子 rename，失败回滚

---

### Channels（平台通道）

**路径**：`/channels` · **快捷键**：⌘K → "channels"

#### 支持的 8 个平台

| 平台 | 主要凭证 |
|---|---|
| **Telegram** | TELEGRAM_BOT_TOKEN |
| **Discord** | DISCORD_BOT_TOKEN |
| **Slack** | SLACK_BOT_TOKEN |
| **WhatsApp** | provider 凭证（如 Twilio） |
| **Matrix** | access_token + homeserver |
| **Feishu (Lark)** | app_id + app_secret |
| **WeiXin (个人微信)** | iLink account_id + token |
| **WeCom (企业微信)** | corp_id + secret |

#### 添加凭证（以 Telegram 为例）

1. 进 Channels 页 → 看到 8 张卡片
2. 点 Telegram 卡 → **Edit**
3. 在 `TELEGRAM_BOT_TOKEN` 字段粘贴 token
4. **0.5 秒后自动验证**：
   - 🔄 `正在验证 token…`
   - ✅ `已验证：@YourBotName`（绿色，鼠标悬停看 bot ID）
   - ❌ `Unauthorized`（红色，平台原始错误）
5. 配置可选 YAML 字段（`mention_required` / `free_chats` 等）
6. **Save** → diff 预览 → 确认
7. 弹窗"是否重启 gateway 让改动生效"→ 一键重启

#### 自动验证支持的平台

仅 Telegram / Discord / Slack（单 token 探测）。
其他平台需要双凭证或 OAuth，目前手填后保存才生效。

#### 实时状态

每张卡片右上角小圆点：
- 🟢 **online** — Hermes log 看到该 channel 最近 5min 内有活动
- 🔴 **offline** — log 显示通道关闭 / 错误
- ⚪ **unknown** — 没相关 log（多半未启用）

每 30 秒刷新一次缓存，可手动按 🔄。

#### 通用 YAML 字段说明

不同平台有不同字段，常见的：
- `mention_required: true` — 仅 @bot 才响应
- `free_chats: [123, 456]` — 这些群无需 @ 也响应
- `reactions: true` — 显示 thinking 表情

修改 YAML 字段保存后会用 diff 预览给你看 before/after。

---

### Skills（技能库）

**路径**：`/skills` · **快捷键**：⌘K → "skills"

#### 概念

Skill = 一个 Markdown 文件，存在 `~/.hermes/skills/<name>.md`。

Hermes agent 看到用户消息时会**自动检索**最相关的 skill 注入到 prompt 里。Skill 是一种"高质量提示模板"。

#### 文件格式

```yaml
---
name: code-review
description: 代码评审专家
version: 1.0.0
---

# 代码评审专家

你是一名严格的资深工程师...

## 评审维度

1. 正确性
2. 性能
...
```

#### 列表显示

- **左侧树状视图**按目录分组
- 每个文件显示：
  - **主标题**：Markdown 第一个 `# 标题`（中英文都行）
  - **副标题**：文件名（如 `code-review`）
  - **AI 徽章**：路径以 `auto/` 开头的是 AI 生成的

> **新功能**（2026-04-27）：Markdown 标题作为显示名 — 支持 YAML frontmatter 跳过；如无 H1 则 fallback 到 frontmatter 的 `display_name` / `name` 字段。

#### 操作

##### 新建技能
1. 点右上 **+ New**
2. 输入文件名（如 `code-review.md`）
3. 自动生成模板 → 在 CodeMirror 编辑器里写
4. ⌘S 或顶部 Save 按钮保存

##### 编辑
- 直接点左侧任一文件 → 右侧打开编辑器
- 显示"未保存"红点 / 顶部状态指示

##### 历史回滚
- 编辑界面 **History** 按钮 → 抽屉显示所有版本
- 选任一版本 → 预览 → Restore（自动备份当前版本）

##### 删除
- 编辑界面右上垃圾桶图标 → 二次确认

#### Skills Hub（社区源）

切到顶部 **Hub** tab：
- 7 个内置源：official / skills-sh / clawhub / lobehub / awesome-skills / community-pack / experimental
- 浏览 / 一键 Install
- 安装后写入 `~/.hermes/skills/<source-name>/`

---

### Runbooks（运行手册）

**路径**：`/runbooks` · **快捷键**：⌘K → "runbooks"

#### 概念

Runbook = 带 `{{参数}}` 占位符的命名 prompt 模板。

```
请把以下要点整理成会议纪要：

{{points}}

要求：
- {{tone}} 风格
- 不超过 {{length}} 字
```

#### 与 Skills 的区别

| | Skill | Runbook |
|---|---|---|
| **触发** | Hermes 自动检索注入 | 用户手动选用 |
| **格式** | 系统提示模板 | 用户消息模板 |
| **存储** | `~/.hermes/skills/*.md` | SQLite 本地 |
| **范围** | 全局 / 按 profile | 全局 / 按 profile |

#### 操作

##### 创建
1. **+ New** → 名字 + description + template
2. `{{param}}` 自动识别
3. 可选 scope_profile：限定到指定 Hermes profile

##### 使用
- ⌘K → 输入 runbook 名 → 回车
- 弹窗自动列出所有参数 → 填写 → **Launch**
- 直接跳到 Chat 并发送

##### 零参数 fast path
- 没参数的 runbook → 直接跳 Chat 发送，不弹窗

##### JSON 导入/导出
- **Export** 整个库为 `.json`
- **Import** `.json`，导入项分配新 ID

#### 范例

**日报模板**：
```
今天我做了：
{{morning}}

明天计划：
{{tomorrow}}

请按"成果 / 阻塞 / 决定"分类，每条≤一句话。
```

**翻译润色**：
```
把以下{{source_lang}}翻译成{{target_lang}}，要求：
1. 保留专业术语原文 + 括号注解
2. 中文用书面语
3. 句子长度不超过 30 字

原文：
{{text}}
```

---

### Memory（记忆）

**路径**：`/memory` · **快捷键**：⌘K → "memory"

#### 两个文件 + 一个搜索

##### MEMORY.md（agent 笔记）
- 路径：`~/.hermes/MEMORY.md`
- Hermes 把它注入到**每个**对话的 system prompt 里
- 适合：你希望 agent 永远记住的事实
- 例：项目代号 / 客户列表 / 偏好

##### USER.md（用户档案）
- 路径：`~/.hermes/USER.md`
- 也注入 system prompt，但单独一段标记为"用户信息"
- 适合：自我介绍 / 角色 / 兴趣
- 例："我是一名 Rust 工程师，偏好简洁回答"

##### Search（会话搜索）
- 第三个 tab，使用 SQLite **FTS5** 全文索引
- 跨所有历史会话搜索
- 支持中文分词
- 命中显示上下文 + 高亮
- 点击跳到 Trajectory 看完整轨迹

#### 操作

##### 编辑文件
- CodeMirror 编辑器
- ⌘S 即时保存
- 顶部容量计：当前字数 / 最大允许（256 KB）
- 状态栏：file path、is_dirty、saved_at
- **Reveal in Finder/Explorer** 按钮 → 系统文件管理器打开

##### Compact 操作
- 顶部 **Compact** 按钮
- Hermes 调用 LLM 自动压缩重复内容
- 删除旧的 [auto] 段落
- 保留人手编辑部分

#### 注意事项

- 直接在编辑器里改，不会触发 git；要版本控制请自行 `git init` 当前目录
- ⌘S 是唯一保存方式（无自动保存——避免误触改坏）
- Compact 不可逆，先备份

---

### Knowledge（知识库）

**路径**：`/knowledge` · **快捷键**：⌘K → "knowledge"

#### 概念

**RAG 知识库** — 上传文档，agent 在回答时**自动检索相关片段**注入 context。

#### 上传

- 拖放或选择文件
- 支持类型：
  - PDF（自动 OCR，需 Hermes 装了 lopdf）
  - DOCX
  - XLSX
  - TXT / Markdown
- 上传后自动：
  1. 提取文本
  2. 分块（默认 500 字符 + 50 重叠）
  3. 写入 SQLite（仅原文 + chunks，**不再做本地向量化**）

> **v9 起：本地向量索引（BGE-Small ONNX）已移除**。原因：模型下载依赖 HuggingFace，国内常失败 → 永远软失败为零向量。当前使用关键词检索。后续计划支持 BGE-M3 语义搜索（用户手动安装模型，从国内 CDN 下载）。

#### 在 Chat 里使用

##### 自动检索
- Chat 系统每次发送前会做两件事：
  1. **TF-IDF**：在你之前的对话里找相似条目（`learningSearchSimilar`）。
  2. **Knowledge keyword**：在你上传的文档里跑 Jaccard 关键词匹配（`knowledgeSearch`）。
- 命中的内容会自动拼到 system prompt 前面，无需手动操作。
- 真正的语义检索（RAG）会在接入 Hermes embeddings 之后回归。

##### 手动引用
- 在 prompt 里 `@knowledge:文件名`
- 强制引用某文档（绕过自动评分）。

#### 管理

- 列表显示所有文档 + 大小 + 上传时间。
- 点击查看分块预览。
- 删除即彻底清除（无向量库副本）。

---

### Trajectory（轨迹）

**路径**：`/trajectory` · **快捷键**：⌘K → "trajectory"

#### 概念

每次 chat 是一个 **Trajectory** — 完整记录所有：
- 用户消息（含附件）
- Assistant 消息（含 reasoning chain）
- 每个 tool call（参数 / 结果 / 耗时）
- 嵌套 subagent（delegate_task）
- Token 用量

#### 用途

- **Debug**：为啥 agent 给了错误答案？看它调了哪些工具
- **复盘**：成功的工作流什么样，能不能改成 runbook
- **审计**：合规要求看 agent 完整决策链

#### 视图

##### 主视图（Timeline）
- 左侧 Session Picker：所有历史会话
- 中央时间轴：每条消息、token、tool call 按时间垂直排列
- 工具调用以"工具丝带"显示在所属 assistant 消息下方
- 嵌套 subagent 折叠/展开

##### Inspector 抽屉（点任意条目）
- 完整 JSON payload
- 复制 ID / 内容
- 跳到该消息所属会话

#### 关键概念：Subagent Tree

当 agent 调用 `delegate_task` 拆任务给子 agent 时：
- 父 task 显示为父节点
- 子 agent 的所有 tool call 折叠为子树
- 可点击展开看子任务完整轨迹

---

### Workflow（工作流）

**路径**：`/workflows` · **快捷键**：⌘K → "workflows"

#### 概念

**Workflow** = DAG（有向无环图）形式的多步多 agent 自动化流程。

每个节点是一个 step，类型有：
- **agent** — 调 LLM，输出文本/JSON/Markdown
- **tool** — 调具体工具（telegram_send / http_request / shell …）
- **parallel** — 并行执行子 step
- **condition** — 分支
- **loop** — 循环执行直到 exit_condition
- **approval** — 人工审批
- **browser** — 浏览器自动化（headless）

Step 间通过 `after: [step_id]` 声明依赖，输出引用 `{{step_id.output}}`。

#### 三种创建方式

##### 1. ✨ 用对话生成（推荐）

> **新功能**（2026-04-27）

1. 点右上角 ✨ **用对话生成**
2. 抽屉滑出，输入框写白话需求：
   ```
   每天早上 9 点抓 V2EX 热帖前 10 条，
   让 GPT 总结成 3 句话，发到我的 Telegram。
   ```
3. 点 **生成工作流**（5-30 秒，看 LLM 速度）
4. 自动跳进可视化编辑器，DAG 已铺好
5. 审核 / 微调 → **保存**

##### 2. 从模板（6 个内置）

- `ai-comic-pipeline.yaml` — AI 漫画流水线
- `code-review-pipeline.yaml` — 代码评审
- `competitor-price-monitor.yaml` — 竞品监控
- `daily-news-digest.yaml` — 每日新闻摘要
- `douyin-hot-videos.yaml` — 抖音热门
- `ups-tracking.yaml` — 快递追踪

##### 3. 从零开始（可视化编辑器）

- 拖拽节点到画布
- 连线建立依赖
- 点击节点编辑属性面板

#### 运行

- 点工作流卡 **▶ Run**
- 弹窗填 inputs（如 `topic="AI"`）
- 实时显示每个 step 状态：⏳ pending / 🔄 running / ✅ done / ❌ failed
- approval 节点会暂停 → **Approve** / **Reject**

#### 持久化

- 工作流定义：`~/.hermes/workflows/<id>.yaml`
- 每次 run 输出：`~/.hermes/workflow-runs/<run-id>.json`
- Manual run 不限次；cron 触发的有自动归档

#### 与 Scheduler 的区别

| | Scheduler | Workflow |
|---|---|---|
| **复杂度** | 单 prompt 定时跑 | 多步多 agent DAG |
| **触发** | 仅 cron | manual / cron |
| **输出** | Markdown 文件 | 结构化 JSON + step 状态 |
| **审批** | 不支持 | 支持 |
| **分支** | 不支持 | 支持 |

---

### Scheduler（定时任务）

**路径**：`/scheduler` · **快捷键**：⌘K → "scheduler"

#### 概念

最简单的"定时跑一次 prompt"。无 DAG，无审批，无分支——一个 cron 表达式 + 一段 prompt 完事。

#### 创建

1. **+ New job**
2. Name: 如"早晨简报"
3. **Cron expression**：
   - `0 9 * * *` 每天 9 点
   - `0 9 * * 1` 每周一 9 点
   - `*/30 * * * *` 每 30 分钟
   - 实时校验 + 显示**下次触发时间**
   - 支持 6 段 Hermes 扩展（`秒 分 时 日 月 周`）
4. Prompt：写要让 agent 做什么
5. 启用

#### 输出归档

- 每次执行：`~/.hermes/scheduled-runs/<job-id>-<timestamp>.md`
- 顶部 metadata + 完整 LLM 输出
- 在 Scheduler 卡片点 ⏰ → 列出最近运行 → 预览

#### 状态指示

- 🟢 上次成功 / 🔴 上次失败
- 失败时显示错误原因
- ⏸ 可暂停（保留配置不删）

---

### Budgets（预算）

**路径**：`/budgets` · **快捷键**：⌘K → "budgets"

#### 概念

**给 LLM 调用设花费上限**，避免月底打开账单吓一跳。

#### 范围（Scope）

5 种 scope，组合使用：
- **Global** — 整个 CoreyOS 总预算
- **Model** — 某个模型（如 gpt-4o）
- **Profile** — 某个 LLM Profile
- **Adapter** — 某个 Hermes agent
- **Channel** — 某个 IM 平台（如 Telegram bot）

#### 周期（Period）

- Daily / Weekly / Monthly

#### 行为（Action on breach）

- **notify** — 仅显示警告
- **block** — 阻止新调用（confirm 跳过仍可发）
- **notify_block** — 警告 + 阻止

#### 创建

1. **+ New budget**
2. 选 scope_kind → 自动加载相关下拉（模型列表 / profile 列表 …）
3. 填金额（USD）+ period + action
4. 保存

#### 进度监控

每个 budget 卡片显示：
- 进度条（绿 → 黄 ≥80% → 红 ≥100%）
- 已花费 / 上限（如 `$3.20 / $10.00 (32%)`）
- 当前周期剩余天数

#### 默认价格表

CoreyOS 内置一个**简化的 token 价格表**（`FALLBACK_PRICE`），覆盖主流模型。
后续会做"模型目录"页让用户自己改。

---

### Analytics（统计）

**路径**：`/analytics` · **快捷键**：⌘K → "analytics"

#### KPI 卡片（5 个）

- 总 sessions
- 总 messages
- 总 tool calls
- 活跃天数（30 天内）
- 总 token

#### 图表

##### Activity 30 日趋势
- SVG 自绘，无外部图表库
- X = 日期，Y = 消息数
- 鼠标悬停显示具体数字

##### Token 30 日趋势
- 同上，Y = token 消耗

##### 模型 Top N
- 按使用次数排序的水平条形图
- 点击跳到 Compare 对比

##### 工具 Top N
- Hermes tool 调用频次

##### Adapter Top N
- 各 Hermes agent 的会话占比
- 显示名取自 `agents` 注册表（不是裸 ID）

##### 反馈率
- 👍 数 / 👎 数 / 比例 / 覆盖率
- 覆盖率 = 评分消息 / 总消息

#### 时间窗口

默认 30 天 UTC。Phase 2 后续会加自定义范围。

---

### Voice（语音）

**路径**：`/voice` · **快捷键**：⌘K → "voice"

#### 配置 Provider

##### ASR（语音转文本）

| Provider | 模型 | 备注 |
|---|---|---|
| OpenAI | whisper-1 | 多语言精度高 |
| Zhipu (智谱) | glm-asr | 中文友好 |
| Groq | whisper-large-v3 | 速度极快 |

##### TTS（文本转语音）

| Provider | 声音 | 备注 |
|---|---|---|
| OpenAI | alloy/echo/fable/onyx/nova/shimmer | 6 种 |
| Zhipu | tongtong/xiaobai 等 | 中文自然 |
| Edge TTS | 任何系统语音 | 免费，需 Edge 浏览器 |

#### 测试面板

- 录一段（最长 120 秒）→ 选 ASR provider → 看转写质量
- 输入文字 → 选 TTS provider + voice + speed → 试听

#### 在 Chat 集成

- Chat 输入框麦克风图标 → 调用配置的 ASR
- Chat 消息底部 🔊 → 调用配置的 TTS

#### 审计日志

第 3 个 tab：每次 voice 调用的：
- 时间
- Provider
- 持续时长
- 成功/失败

---

### MCP（工具协议）

**路径**：`/mcp` · **快捷键**：⌘K → "mcp"

#### 概念

**Model Context Protocol** 是 Anthropic 提的开放标准，让 LLM 能调用外部工具。

任何 MCP server 都可以接入 Hermes agent，常见的：

- **filesystem** — 读写本地文件
- **github** — 创建 issue / PR / 浏览代码
- **stripe** — 查看交易、创建发票
- **puppeteer** — 浏览器自动化
- **brave-search** — 网络搜索
- **sqlite** — 查询本地 SQLite

#### 配置

1. **+ New server**
2. Server ID（任取，如 `github`）
3. **Command** 或 **URL**：
   - Command 模式：`npx -y @modelcontextprotocol/server-github`
   - URL 模式：`http://localhost:3001`
4. **Args** + **Env**（如 GITHUB_TOKEN）
5. **Probe** 验证 → 保存

#### 在 Chat 用
- Hermes agent 启动时加载所有 MCP server
- 用户消息触发 agent 自动选合适工具
- Trajectory 页能看到完整工具调用链

#### 重启提示
- MCP 配置改完需要 Hermes reload；应用会提示

---

### Terminal（终端）

**路径**：`/terminal` · **快捷键**：⌘K → "terminal"

#### 用途

应用内嵌 xterm.js，跑你的 login shell。

适合：
- 不离开应用快速看个 git status
- 跑个一次性命令
- 给 MCP filesystem server 测试某些操作

#### 多 Tab

- **+ 按钮** 加 tab，最多无限制
- 每个 tab 独立 pty 进程
- 切 tab 不丢 scrollback
- × 关闭 tab：杀进程，邻居自动激活

#### 限制

- 没有 SSH 转发（用本地的）
- 没有内置工具（系统有什么用什么）
- ⌘C/⌘V 工作

---

### Logs（日志）

**路径**：`/logs` · **快捷键**：⌘K → "logs"

#### 三个标签

##### Gateway log
- `~/.hermes/logs/gateway.log` 实时 tail
- 显示最近 500 行
- 自动滚动跟随
- 暂停 / 复制 / 清屏

##### Agent log
- `~/.hermes/logs/agent.log`
- agent 决策推理详情

##### Channel logs
- 按通道切片（如 `telegram.log`）
- 看消息进出 / 错误

##### Changelog（最有用）
- **所有写入操作的审计 journal**
- 包括：
  - LLM Profile 改动
  - Channel 凭证改动
  - YAML 配置改动
  - Profile 切换
  - Workflow 创建 / 修改
- 每条记录：时间 / 操作 / before / after
- **一键回滚**到任意历史状态

---

### Settings（设置）

**路径**：`/settings` · **快捷键**：⌘K → "settings"

#### 6 个区段

##### Workspace
- 应用语言（zh / en / auto）
- 主题（light / dark / system）
- 数据库位置（默认 `~/Library/Application Support/com.corey.dev/`）

##### Hermes Instances
- 同 `/agents` 页（另一种视图）
- 列表 + 编辑

##### Sandbox Scopes（重要安全功能）

每个 agent 默认只能访问**白名单路径**：

- **default** scope：
  - 含 `~/`（用户主目录）
  - 自动拒绝 `~/.ssh`、`~/.aws/credentials` 等敏感路径
  - 自动拒绝 `/etc`、`/sys`、`/proc`
- **per-agent scope**：你给某个 agent 限定特定项目目录

操作：
1. **+ New scope**（如 `worker-only`）
2. 加 root：浏览器选目录 → 设 read 或 write
3. 把 agent 关联到该 scope（在 `/agents` 页编辑）

会话期 grant：
- agent 请求一次性访问超出 scope 的路径
- 弹窗征求同意 → 同意后该路径在本会话有效，重启失效

##### Routing Rules

按消息内容自动选 adapter：

```
当消息匹配 "代码|code|debug" → 路由到 claude-agent
当消息匹配 "翻译|translate" → 路由到 deepseek-agent
默认 → default agent
```

操作：
1. **+ New rule**
2. Pattern（正则或子串）
3. Target adapter
4. 优先级（数字越小越先匹配）

##### Storage
- DB 大小 / 附件占用
- 一键清理过期附件
- 一键 vacuum

##### Browser LLM
- 配置浏览器自动化 step 用的模型
- 用 vision 模型让它能看截图

---

## 横向能力

### 快捷键

#### 全局（任何页都生效）

| 快捷键 | 功能 |
|---|---|
| ⌘K | 命令面板（搜索 + 跳转） |
| ⌘1 | Home |
| ⌘2 | Chat |
| ⌘3 | Compare |
| ⌘4 | Skills |
| ⌘5 | Trajectory |
| ⌘6 | Analytics |
| ⌘7 | Workflow |
| ⌘8 | Logs |
| ⌘9 | Settings |
| ⌘, | 设置页（同 ⌘9） |

#### Chat 内

| 快捷键 | 功能 |
|---|---|
| 回车 | 发送 |
| Shift+回车 | 换行 |
| ⌘F | 会话内搜索 |
| ⌘N | 新会话 |
| ⌘W | 关闭/删除当前会话 |
| ⌘[ / ⌘] | 上/下一个会话 |
| Esc | 关闭 picker / 退出搜索 |

#### Skills / Memory 编辑器

| 快捷键 | 功能 |
|---|---|
| ⌘S | 保存 |
| ⌘F | 文件内搜索 |
| ⌘G | 跳到下一个匹配 |
| ⌘Z / ⌘⇧Z | 撤销 / 重做 |

### 搜索面板（⌘K Palette）

#### 能搜什么

- **页面**：输入 "chat" / "memory" 跳到对应页
- **会话**：输入会话标题或片段
- **Skill**：输入技能名
- **Runbook**：输入 runbook 名 → 回车直接调用
- **设置项**：输入 "sandbox" / "language"

#### 操作
- ↑↓ 选条目
- 回车 / 双击执行
- Esc 关闭

### 中英双语

- 检测浏览器语言自动切换
- 也可在 Settings → Workspace → Language 强制
- 部分技能 / runbook 会跟随语言变化（如 description）

### 备份与迁移

#### 一键导出（推荐）

- `/profiles` 页 → Active profile → **Export tar.gz**
- 包含：config / .env / skills / memory.md / 用户档案
- 不包含：会话数据库（在另一个目录）

#### 完整备份

复制以下目录：

| 内容 | 路径（macOS） |
|---|---|
| Hermes 数据 | `~/.hermes/` |
| CoreyOS 数据库 | `~/Library/Application Support/com.caduceus.app/` |
| 应用配置 | `~/Library/Preferences/com.caduceus.app.plist` |

Linux：
- `~/.hermes/`
- `~/.local/share/com.caduceus.app/`

Windows：
- `%USERPROFILE%\.hermes\`
- `%LOCALAPPDATA%\Corey\`（Corey 数据）

### 版本与更新

#### 查看版本号

左侧导航栏底部显示当前 Corey 版本号（如 `Corey v0.1.8`）。

#### 自动更新

- 有新版本时，右下角弹出更新提示
- 点击更新按钮，自动下载并安装
- 更新是**全量替换**——直接跳到最新版本，不逐版本递增
- 如果更新失败，会显示错误提示（5 秒后自动消失），可手动下载安装

---

## 典型场景与最佳实践

### 场景 A：个人 AI 工作台

**目标**：替代 ChatGPT 桌面版，但能用任何模型

1. `/models` 加 OpenAI + DeepSeek + Claude profile
2. `/memory` 写一段 USER.md：
   ```
   我是 Rust 工程师，主要做 Tauri 桌面应用。
   偏好简洁直接的回答，不要客套话。
   写代码注重错误处理 + 注释为什么不是做什么。
   ```
3. `/skills` 攒几个常用：
   - `code-review.md`
   - `commit-message.md`
   - `architecture-explain.md`
4. `/runbooks` 加常用快捷调用：
   - `日报`、`翻译`、`摘要`

**日常使用**：
- ⌘2 进 Chat
- ⌘K 输入"日报" → 填参数 → 自动生成
- 写代码就直接问，agent 已知道你是 Rust 工程师

### 场景 B：群聊机器人统一管理

**目标**：一个 bot 服务多个 IM 群

1. `/channels` 配 Telegram + Slack
2. token 自动验证通过 → save → 重启 gateway
3. 在每个 IM 群拉一遍 bot
4. `/skills` 写群专属技能：
   ```
   ---
   name: customer-support
   description: 客服话术
   ---
   你是 ACME 公司客服...
   ```
5. `/memory` 在 MEMORY.md 写公司知识库
6. 测试：在 Telegram @bot 发"产品价格" → bot 回应

**进阶**：
- `/agents` 给客服群单独一个 agent，用便宜模型
- `/sandbox` 限定客服 agent 只能访问 `~/Documents/customer-data/`

### 场景 C：自动化日报系统

**目标**：每天 9 点抓行业新闻 → 总结 → 推 Telegram

**方法 1（简单）**：用 Scheduler

1. `/scheduler` 新建 job
2. Cron `0 9 * * *`
3. Prompt：
   ```
   搜索今天关于"AI 大模型"的中英文新闻，挑出最重要的 5 条，
   每条提取标题 + 一句话摘要。最后总结今日趋势。
   返回 Markdown 格式。
   ```
4. 启用

**方法 2（带推送）**：用 Workflow

1. `/workflows` 点 ✨ 用对话生成
2. 输入：
   ```
   每天早上 9 点搜 AI 行业新闻前 5 条，让 GPT 总结，
   通过 Telegram 推送到我的群组。
   ```
3. 等 LLM 生成 → 进编辑器审核
4. 检查每个 step 的 prompt + 替换 `tool_args.chat_id`
5. 保存 → 启用 cron

### 场景 D：模型选型基准

**目标**：选最 cost-effective 的模型

1. `/models` 加 5 个候选 profile（GPT-4o-mini / DeepSeek / Kimi / Qwen-Plus / Claude-Haiku）
2. `/compare` 设 5 个 lane
3. 准备 10 个代表性 prompt（你日常会问的）
4. 每个 prompt 跑一遍 → 在 lane 里选"赢家"
5. `/analytics` 看：
   - 哪个模型胜率最高
   - 平均花费多少
   - latency 是否可接受
6. 把胜出的设为默认

---

## 常见问题

### Q1：Hermes 没装/装错怎么办？

应用会进入 stub 模式（只读）。Home 页 onboarding 会有：
- 平台特定安装命令
- "复制" 按钮
- "重新检测" 按钮

装完点 Re-check，绿点就出来。

### Q2：API Key 安全吗？

- 全部存在 `~/.hermes/.env`，跟 Hermes 自己的格式一致
- 应用前端**永远不显示** key 值，只显示"已设置"/"未设置"
- IPC 边界做了过滤，不会发送到任何外部
- 如果你担心，可以用环境变量管理工具（如 1Password CLI）注入而非写文件

### Q3：会话数据放在哪？怎么备份？

- SQLite 数据库：`~/Library/Application Support/com.caduceus.app/caduceus.db`（macOS）
- Windows：`%LOCALAPPDATA%\Corey\caduceus.db`
- 包含：会话标题 / 消息 / 反馈 / 工具调用轨迹 / 附件元数据
- 附件 blob：`~/.hermes/attachments/<hash>`
- 直接复制文件夹即可备份

### Q4：可以连远程 Hermes 吗？

可以。`/agents` 编辑 instance 时把 base_url 改成远程 URL（如 `http://192.168.1.100:8642`），加 API Key 鉴权。

### Q5：支持中文吗？

完全支持。
- 应用 UI 中英双语自动切换
- LLM 默认用中文回复（除非你切换或 system prompt 指定）
- Skills / Memory / Runbooks 都可中文写

### Q6：如何从其他工具迁移？

- **从 ChatGPT 网页**：导出 JSON → 写脚本批量 import 到 SQLite（暂无 GUI）
- **从 Cursor / VS Code**：直接挪 `~/.hermes/skills/` 文件即可
- **从 LangChain**：workflow 可手写 YAML 或用 ✨ 对话生成

### Q7：能离线用吗？

- **本地模型** + **本地工具**：完全离线（用 Ollama + 本地 MCP）
- **云模型**：必须联网

### Q8：性能瓶颈在哪？

- 大附件解析（PDF OCR）— 看 Hermes 的 lopdf 性能
- Vector search — Knowledge 文件超 10K chunks 后明显
- xterm 多 tab — 每 tab 占 ~20MB，10 个起就会感觉卡

### Q9：Windows 一键安装失败怎么办？

常见原因：
1. **Git 未安装** — 先安装 Git for Windows
2. **网络问题** — 确保能访问外网（脚本使用 ghfast.top 镜像，无需代理）
3. **PowerShell 版本过低** — Windows 10 自带的 PS 5.1 即可
4. **目录权限** — 如果装到 `C:\Program Files\` 需要管理员权限

查看日志：`%LOCALAPPDATA%\Corey\logs\bootstrap-windows.log`

### Q10：网关会话多久同步一次？

每 60 秒自动检查。新产生的 IM 对话（微信、钉钉等）最多 1 分钟后出现在 Corey 的对话列表中。

### Q11：如何查看 Corey 和 Hermes 的版本号？

- **Corey 版本**：左侧导航栏底部（如 `Corey v0.1.8`）
- **Hermes 版本**：Home 页右上角状态栏显示

---

## 故障排查

### 启动崩溃 / 白屏

1. 检查 `~/Library/Logs/com.caduceus.app/` 看 stack trace
2. 删除 `~/Library/Application Support/com.caduceus.app/`（**会丢会话**）重启
3. 装最新版本（GitHub Releases）

### Chat 消息发不出

按顺序检查：
1. `/logs` Gateway 标签 → 看是否有连接日志
2. ⌘K → "settings" → Hermes Instances → Probe 该 instance
3. 终端 `curl http://127.0.0.1:8642/health` → 应返 `{"ok":true}`
4. 如返 connection refused → `hermes gateway start` 启动网关
5. 仍不行 → 检查 LLM Profile 的 API Key 是否过期

### Channel 不响应消息

1. `/channels` → 看实时状态点
2. 🔴 offline → `/logs` Channel 标签看错误
3. ⚪ unknown → 通道未启动；保存配置 + 重启 gateway
4. 🟢 online 但 bot 不回应 → 看 free_chats 是否包含群 ID

### Workflow 生成失败

错误消息会告诉你：

| 错误 | 原因 | 解决 |
|---|---|---|
| `LLM call failed` | 模型不可达 | 检查默认 LLM Profile |
| `AI returned invalid YAML` | 模型输出乱了 | 简化描述 / 换更强的模型 |
| `validation (steps[1].after: ...)` | Schema 不合规 | 改描述更清楚 / 手动改 YAML |
| `no default adapter registered` | 还没配 LLM | 去 `/models` 设一个 default |

### 应用变慢

1. `/settings` → Storage → 看 DB 大小，>500MB 考虑清理
2. 关闭一些 Terminal tab
3. 重启应用

---

## 术语对照

| 中文 | 英文 | 解释 |
|---|---|---|
| 适配器 | Adapter | Hermes 后端 instance |
| 配置集 | Profile | Hermes 自身的 dir profile |
| 配置 | LLM Profile | 模型连接配置 `{provider, base_url, model, key}` |
| 技能 | Skill | Markdown 系统提示模板 |
| 运行手册 | Runbook | 带占位符的用户消息模板 |
| 工作流 | Workflow | DAG 多步流程 |
| 通道 | Channel | IM 平台 |
| 沙箱作用域 | Sandbox Scope | per-agent 文件路径白名单 |
| 路由规则 | Routing Rule | 按消息内容选 agent |
| 网关 | Gateway | Hermes 的 HTTP 服务 (`127.0.0.1:8642`) |
| 轨迹 | Trajectory | 会话完整审计记录 |
| 知识库 | Knowledge | RAG 文档库 |
| 记忆 | Memory | MEMORY.md / USER.md |
| 控制面板 | Palette | ⌘K 全局搜索 |

---

## 反馈与贡献

- Bug / 建议：[GitHub Issues](https://github.com/zbin0929/CoreyOS/issues)
- Roadmap：[`docs/05-roadmap.md`](../05-roadmap.md)
- 架构：[`docs/01-architecture.md`](../01-architecture.md)
- Changelog：[`CHANGELOG.md`](../../CHANGELOG.md)

---

**祝你用得开心！**

如果发现这份手册哪里过时或不准确，欢迎在 GitHub 提 PR 修正。
