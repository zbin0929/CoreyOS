# Hermes 能力清单 vs Corey 暴露面 Gap 分析

> 创建日期：2026-05-15
> 来源：[hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/) 完整阅读
> 目的：作为 HD-1 决策依据 — 任何 "Corey 需要新功能" 的需求，必须先比对此文档，确认 Hermes 上游没有提供，再考虑在 Corey 实现
> 维护节奏：每次 Hermes 大版本更新后刷新（HD-5/HD-7）

---

## 零、本文档的来历

2026-05-14 美正燃油费率 workflow 执行 27 分钟未完成。我（Cascade）的第一反应是「在 Corey 基座加 `script` / `browser_script` 步骤类型」，写了 ~300 行设计文档。

被用户的 HD-1 原则纠正后，回头查官方文档，发现 **Hermes 已经有 `execute_code` 工具**专门解决这个问题。300 行设计文档作废。

为避免重蹈覆辙，本文档把 Hermes 已有的全部上游能力列清，作为下次"想加新功能"前的必读。

---

## 一、Hermes 已有能力（按官方分类）

### 1.1 学习闭环（Closed Learning Loop）

| 能力 | 官方实现 | Corey 当前暴露 | Gap |
|---|---|---|---|
| Agent-curated memory + periodic nudges | ✅ `MEMORY.md` (2200B) + `USER.md` (1375B) | 部分（Long-term Memory 页面） | 未显示字节用量，未对接 `nudge_interval` |
| Autonomous skill creation | ✅ `skill_manage` 工具 | ❌ | 完全没暴露 "Agent 自动建技能" 状态 |
| Skill self-improvement during use | ✅ v0.12+ Curator | ❌ | 没暴露 Curator 状态 |
| FTS5 cross-session recall + LLM summarization | ✅ Session Search | 部分（Session search 页面） | 没暴露 FTS5 高级搜索 |
| Honcho dialectic user modeling | ✅ 外部 memory provider 之一 | ❌ | 8 个 provider 都未暴露 |

### 1.2 终端后端（Terminal Backends — 6 种）

```yaml
terminal:
  backend: local | docker | ssh | singularity | modal | daytona | vercel_sandbox
```

| 后端 | 用途 | Corey 现状 |
|---|---|---|
| **local** | 跑在用户机器 | ✅ 默认 |
| **docker** | 容器隔离 | ❌ 未暴露 |
| **ssh** | 远程机器执行 | ❌ 未暴露 |
| **singularity** | HPC 集群 | ❌ 未暴露（专业用户少） |
| **modal** | Serverless（空闲零费） | ❌ **重大缺口** |
| **daytona** | Serverless 持久化 | ❌ **重大缺口** |
| **vercel_sandbox** | Vercel 沙箱 | ❌ 未暴露 |

**结论**：Corey 应该在 Settings 加 **Terminal Backend 选择器**，至少暴露 local/docker/modal/daytona 四种。

### 1.3 平台接入（20+ 平台，Gateway）

> Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email, SMS,
> **DingTalk, Feishu, WeCom, Weixin, QQ Bot, Yuanbao**, BlueBubbles,
> Home Assistant, Microsoft Teams, Google Chat...

| 平台类别 | 平台 | Corey Channels 现状 |
|---|---|---|
| **国际主流** | Telegram / Discord / Slack | 待核查 |
| **企业 IM** | WhatsApp / Signal / Matrix / Mattermost / Teams / Google Chat | 待核查 |
| **🇨🇳 国内主流** | **DingTalk 钉钉 / Feishu 飞书 / WeCom 企微 / Weixin 微信 / QQ Bot / Yuanbao 元宝** | **大概率未暴露** |
| **其他** | Email / SMS / BlueBubbles / Home Assistant | 待核查 |

**结论**：CoreyOS 商业模式是国内定制客户，**Hermes 已经原生支持飞书/企微/钉钉/微信** —— 这是 Corey 最被低估的优势，Channels 页面应优先暴露这 4 个。

### 1.4 模型支持（Model Provider — 全平等）

> Use **any model you want** — Nous Portal, OpenRouter (200+ models),
> NovitaAI, NVIDIA NIM (Nemotron), Xiaomi MiMo, z.ai/GLM, Kimi/Moonshot,
> MiniMax, Hugging Face, OpenAI, or your own endpoint.

**关键事实**：官方**没有任何"推荐顺序"**。视频里"Nous Portal > OpenRouter > Ollama" 是误导。Corey 的 Models 页面应保持中立。

### 1.5 Skills 系统（6 个 Hub 来源）

```bash
hermes skills browse # 浏览所有
hermes skills search <query> [--source <hub>]
hermes skills install <slug>
hermes skills inspect <slug>
hermes skills tap add <owner/repo>  # 自定义 GitHub 源
```

| Hub | 内容 | Corey Skills 页面现状 |
|---|---|---|
| **official** | Hermes 仓库自带 optional skills | 部分 |
| **skills-sh** | Vercel 的 skills.sh 公共目录 | ❌ |
| **well-known** | 任何 `/.well-known/skills/index.json` | ❌ |
| **github** | openai/skills, anthropics/skills, VoltAgent/awesome-agent-skills 等 | 部分 |
| **clawhub** | clawhub.ai 第三方市场 | ❌ |
| **claude-marketplace** | Claude 兼容的 plugin 仓库 | ❌ |

**额外**：还有 `agentskills.io`（开放标准）。

**结论**：Corey Skills 页面应有"来源切换器"，否则用户只能看到一小部分。

### 1.6 记忆系统（8 个外部 Provider）

```bash
hermes memory setup    # 选 provider
hermes memory status   # 查看状态
```

| Provider | 类型 | 特点 |
|---|---|---|
| Honcho | Dialectic user modeling | 官方推荐之一，Hermes README 唯一明确提到的 |
| OpenViking | - | - |
| Mem0 | - | 业界知名 |
| Hindsight | PG + 向量 + 知识图谱 | 视频独宠的那个 |
| Holographic | - | - |
| RetainDB | - | - |
| ByteRover | - | - |
| Supermemory | - | - |

**关键事实**：官方文档明确说"外部 provider **不替代**内置 memory，是并行增强"。视频说"必装 Hindsight"是过度推销。

### 1.7 Context Compression（视频抄对了）

```yaml
compression:
  enabled: true
  threshold: 0.50          # 触发阈值
  target_ratio: 0.20       # 压缩到的比例
  protect_last_n: 20       # 保留最后 N 条
  hygiene_hard_message_limit: 400  # 硬性消息数上限（gateway）

auxiliary:
  compression:
    model: ""              # 空 = 用主模型；可换便宜模型
    provider: "auto"
    base_url: null
```

**热配置**：编辑 `config.yaml` 后**不需重启**，下条消息生效（gateway 自动 rebuild agent，HD-9 局部失效，可能需更新规则）。

### 1.8 Code Execution（`execute_code` 工具）⭐ 关键

> Programmatic Tool Calling — collapses multi-step pipelines into single LLM turn

**机制**：
1. Agent 写 Python 脚本，用 `from hermes_tools import ...`
2. 脚本在子进程跑，工具调用通过 Unix socket RPC 回主进程
3. **中间结果不进 LLM context**，只有 `print()` 输出回 LLM
4. 多步流水线 → 单次 LLM 推理

**可用工具**：`web_search`, `web_extract`, `read_file`, `write_file`, `search_files`, `patch`, `terminal`（前台）

**不可用**：浏览器工具（`browser_*` 不在内）

**触发条件**：
- 3+ tool calls 且需要中间逻辑
- Bulk filtering / conditional branching
- 遍历结果

**平台限制**：⚠️ **仅 Linux/macOS 支持**，Windows 自动 fallback 到顺序工具调用。**违反 Corey XP-1（Windows + macOS 同等）**。

### 1.9 子代理委托（Delegates & Parallelizes）

> Spawn isolated subagents for parallel workstreams.

| 能力 | 用途 |
|---|---|
| Isolated subagents | 独立会话、独立 terminal、独立 RPC |
| Zero-context-cost pipelines | 子代理的中间状态不进父代理 context |
| Parallel workstreams | 真并行（不是 LLM 内部模拟） |

**Corey 现状**：完全未暴露。这是 Pattern B（多源并行）应该用的能力。

### 1.10 Cron 调度

> Natural language cron scheduling — 运行在 gateway

Corey 已有 Workflows + Scheduler 页面，但 **scheduler 已被 demote 到 Settings → Advanced**（N-3）。考虑是否提升回主入口。

### 1.11 全 Web 控制

| 能力 | 工具 |
|---|---|
| Web search | `web_search` |
| Web extraction | `web_extract` |
| Browser automation | `browser_navigate`, `browser_click`, `browser_extract_text`, `browser_snapshot` 等 |
| Vision | 视觉理解 |
| Image generation | TTS / 图像生成 |

### 1.12 MCP 支持

> Connect to any MCP server for extended tool capabilities

Corey 已有 MCP 页面（在 More 组）。

### 1.13 Research-ready 能力

| 能力 | 用途 | Corey 现状 |
|---|---|---|
| Batch processing | `batch_runner.py` | ❌ |
| Trajectory export | 训练数据导出 | 部分（Trajectory 页面） |
| RL training with Atropos | 强化学习训练 | ❌（不是 Corey 目标用户） |

### 1.14 OpenClaw 迁移

```bash
hermes claw migrate
```

迁移内容：SOUL.md / MEMORY.md / USER.md / Skills / API keys / TTS assets / 平台配置

**对 Corey 启示**：可以做"从其他 AI 工具迁移"的入口（白标客户上手）。

### 1.15 LLM 友好文档

- `/docs/llms.txt`（17KB 索引，可直接喂 LLM）
- `/docs/llms-full.txt`（1.8MB 全量）

**对 Corey 启示**：可以做"问 Corey 怎么用"内置 Q&A，直接喂 `llms.txt` 给当前 chat agent。

### 1.16 Curator / Persistent Goals / Event Hooks

文档树里还出现的功能（待详读）：
- Curator（自动整理 skill 库，7 天周期）
- Persistent Goals
- Event Hooks
- Credential Pools（多 key 轮换）
- Iteration Budget Pressure
- Auxiliary Models（任务级模型分配）
- Reasoning Effort 配置
- Smart Approvals / Checkpoints
- Delegation / Clarify

---

## 二、Corey 当前暴露面 Gap（优先级排序）

### 🔴 P0 — 立即可做（不需基座开发，仅 UI wrapper）

1. **Channels 暴露国内 IM**：Hermes 已原生支持飞书/企微/钉钉/微信，Corey 只需暴露配置 UI。这是 CoreyOS 国内定制业务的核心优势。
2. **Skills Hub 切换源**：当前只看到一部分，加来源切换器（official / skills-sh / well-known / github / clawhub）。
3. **Compression 配置 UI**：滑块 threshold / target_ratio / protect_last_n。直接写 `config.yaml`（HD-8 atomic_write）。

### 🟡 P1 — 战略级机会（中等开发量）

4. **Terminal Backend 选择**：Settings 加 backend 选择器，至少 local / docker / modal。Modal serverless 是杀手级，"AI 不占本地资源" 的卖点。
5. **Memory Provider 选择**：Long-term Memory 页面加 8 选 1 的 wizard。
6. **agency-agents-zh 一键导入**：211 个中文角色没有 Hermes 适配，Corey 做第一个。Personality / SOUL.md 编辑器对接。
7. **`hermes setup` 一键向导集成**：替代视频的"7 步配置"。新用户首次启动跑一次。

### 🟢 P2 — 锦上添花

8. **Curator 状态可视化**：展示 Agent 自创的 skill / 7 天 prune 周期。
9. **Subagent 调度面板**：并行子代理状态。
10. **LLM 文档问答**：内置 `llms.txt` 喂给 chat agent。

### ❌ 不应做（Hermes 已有，重复造轮子违反 HD-1）

- ~~workflow `script` 步骤类型~~（用 `execute_code` 即可）
- ~~workflow `browser_script` 步骤类型~~（违反 XP-1，浏览器自动化只能走 agent）
- ~~Corey 自己实现飞书/企微适配器~~（Hermes 已有）
- ~~Corey 自己实现 cron~~（Hermes 已有）
- ~~Corey 自己实现 skill 注册表~~（Skills Hub 已有 6 个源）

---

## 三、给 HD-1 流程的检查清单

下次有人提"Corey 需要 X"时，按此顺序回答：

1. **`hermes <command> --help`** 找有没有 CLI 对应
2. **`hermes skills search <keyword>`** 看 skills hub 有没有现成
3. **读 docs/user-guide/features/** 看 Hermes 文档有没有这功能
4. **读 docs/user-guide/configuration** 看是不是 config 项就能开
5. **读本文档 § 一** 看是不是已经在 known capabilities 里
6. **如果以上都没有** → 真新功能，可以考虑 Corey 自研

跳过 1-5 直接写 Corey 代码 = HD-1 违规。

---

## 四、视频内容真假对照（避免被二手信息误导）

[抖音"三阳LINK"《一文帮你理清 Hermes 全部高级配置》核查](#)

| 视频说法 | 真假 | 备注 |
|---|---|---|
| MEMORY.md 2200B / USER.md 1375B | ✅ | 一字不差 |
| Compression threshold/target_ratio/protect_last_n | ✅ | 一字不差 |
| SOUL.md + `/personality` | ✅ | 准确 |
| Hindsight 向量记忆 | ✅ 真，但 ❌ 不是必装 | 8 个 provider 之一 |
| **"L0/L1/L2 三层架构"** | ❌ 假 | 自创术语 |
| **"五大抓取技能必装"** | ❌ 假 | Skills Hub 几百个，没"五大套装" |
| **"Nous Portal > OpenRouter > Ollama"** | ❌ 假 | 官方模型中立 |
| **"上下文 ≥ 64K 才能启动"** | ❌ 未找到依据 | 不是硬性门槛 |
| **"Token 降 80-90%"** | ❌ 营销 | 无数据 |
| **"5 大引擎"分类** | ❌ 假 | 自创框架 |
| `agency-agents-zh` 211 个中文角色 | ✅ | GitHub 仓库真实 |

---

## 五、Hermes 版本与 Corey 配套版本

- Hermes：每 1-2 周一发，README 显示有 12+ releases
- Corey：v0.2.x 在 v0.2.5
- **HD-7**：config.yaml 当前 version 17。每次 Hermes 大版本要核查兼容性
- **HD-5**：`docs/hermes-dependency-map.md` 是 Corey 受影响代码定位的事实源

---

## 六、维护

- 此文档每月或 Hermes 大版本后由人工刷新
- 任何 Corey 新功能 PR 应在 description 引用本文档对应章节
- 此文档与 `docs/01-architecture.md` § Pack Architecture 共同构成 Corey 设计约束

