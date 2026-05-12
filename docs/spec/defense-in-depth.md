# Corey 安全约束分层架构（Defense in Depth）

> 版本：v1.1（2026-05-12）
> 触发：2026-05-11 真实 safety incident（LLM 主动绕过 shell guard 用 Python 删除用户文件）后定型
> 读者：Corey 维护者 + 客户交付团队

## 为什么要分层

LLM 是概率系统。单层防御不够 —— 好模型（Claude 4 / GPT-5）对强约束指令遵守率 95%+，差模型 / 被 prompt injection / 被越狱时全部失效。

Corey 采用 **4 层防御**，每一层独立覆盖，目标是让"绕过一层≠绕过全部"：

```
┌─ L0 元铁律 (SOUL.md)           软约束 / 跨渠道
├─ L1 基座 (baseSoul.ts)          软约束 / Corey UI 专属
├─ L2 行业人设 (Pack soul)        软约束 / 任务上下文
└─ L3 硬拦截 (corey-guards + Hermes DANGEROUS_PATTERNS)  物理拦截
```

## 各层详解

### L0 · 元铁律（最高优先级，跨渠道）

**注入路径**：`~/.hermes/SOUL.md` 的 `<!-- COREY:BEGIN iron-rules v1 -->` ... `<!-- COREY:END iron-rules v1 -->` marker 块。

**作用范围**：**所有渠道** —— Corey UI chat、WhatsApp、微信、钉钉、Slack、Telegram、cron、MCP 外部客户端。Hermes Gateway 在处理任何 channel 消息时都通过 `agent/prompt_builder.py::_load_soul_md` 加载 SOUL.md 进 system prompt。

**内容契约**（必须包含，共 3 组）：

1. **执行边界 5 条核心**：只做用户要的 / 不自决 / 没有就是没有 / 模糊先问 / 未明确要求不执行
2. **破坏性操作 HARD GATE**：6 类触发词（删除 / 覆盖 / 发送 / 支付 / 账号 / 迁移）+ 确认流程 + 灾备 4 条（执行前备份 / 回退路径 / 批量干跑 / 执行错立即停）
3. **禁止绕过任何 guard 硬红线** ← **2026-05-11 新加**。真实事件：LLM 被 shell guard 拦后主动切换 code_execution 绕过。现在铁律明令禁止 7 种绕过：换工具路径、换命令形式、拆分/伪装、sudo、切目录、间接 skill/workflow、"我用另一个工具试试"的回避式推理

**唯一 source of truth**：`src-tauri/assets/soul/corey_iron_rules.md`，`include_str!` 进 Corey binary。

**同步机制**：`src-tauri/src/soul_md.rs::sync_corey_block()` 在每次 Corey 启动时调用。幂等：块已存在内容相同 → 不写；内容变化 → 原地替换 marker 之间；marker 外的客户自定义内容永不触碰。

**客户主权保护**：客户可以在 marker 块外写自己的 persona override（例如"我希望 Agent 用上海话回复"）。Corey 升级不会动那部分。

### L1 · 基座（Corey UI 专属）

**注入路径**：`src/app/baseSoul.ts` 导出的 `BASE_SOUL` 常量，通过 `enrichHistoryWithContext` 在每次 chat 发送时 unshift 到 system messages 开头。

**作用范围**：**仅 Corey UI chat**。其他渠道走 L0（SOUL.md）已足够。

**内容契约**：
- 身份：你是 Corey 的 AI 助手（扮演任何 Pack 角色时都生效）
- 元操作纪律：用户问模型 / 路由 / 状态时调真工具，不脑补
- 禁止伪造：永不输出假 tool_calls 格式（`[{"type":"system",...}]` 这种）
- 浏览器工具映射（browser_navigate / browser_snapshot 等）
- 工具命名表：告诉 LLM 真实工具名，避免它猜 `browse_url` 这种不存在的名字

**为什么 L0 和 L1 分开**：L0 跨渠道（简短必须，<1500 token），L1 只对 Corey UI（长可接受，含 UI 专属工具链）。L1 覆盖 L0 之上的产品级细节，不跟 L0 冲突。

### L2 · Pack 行业人设（可选）

**注入路径**：Pack manifest 的 `soul_inject` 字段 → `crate::ipc::pack::soul_inject` → 前端 chat messages 拼接。

**作用范围**：活跃 Pack 下的 Corey UI chat。其他渠道不生效（Pack 是 Corey-only 概念）。

**内容契约**：Pack 作者写的行业人设（亚马逊顾问、法务、财务、美正 OS 运营等）。**只管怎么说话** / 用什么专业术语，**不管能否执行**。

**与 L0/L1 的关系**：Pack soul 在语义上附加，不能覆盖 L0/L1 的纪律。在 prompt 顺序上 Pack soul 在 L0/L1 后面（优先级更低）。

### L3 · 硬拦截层（物理层，跨渠道）

两个独立组件：

#### L3-a · Hermes 原生 `DANGEROUS_PATTERNS`

`~/.hermes/hermes-agent/tools/approval.py:305` 硬编码正则列表。Hermes 在每次 shell 工具调用前检查。触发 → 向 channel 发审批提示 → 等待 `/approve` 回复。

覆盖：`rm` 根路径 + 递归 / `chmod 777` / `dd` / `mkfs` / 写 `/etc/` / SQL `DROP TABLE` / `pkill -9 -1` / fork bomb / `curl | sh` / 杀 Hermes 自身进程等约 30+ 条。

**局限**：Python `os.remove()` 走 `code_execution` 工具，**不触发 DANGEROUS_PATTERNS**（regex 只看 shell 命令字符串）。

#### L3-b · Corey 的 `corey-guards/file-ops-guard.py`

Corey 自己的 pre_tool_call hook，通过 Hermes 的 shell hook 机制注册到 `config.yaml.hooks.pre_tool_call`。在每次工具调用前被 Hermes 启动为子进程，JSON on stdin，返回 `{"decision":"block","reason":"..."}` 可否决。

覆盖 3 个工具类：
- **结构化文件工具**：`delete_file` / `move_file` / `write_file` / `edit_file` / Hermes 的 `file` 工具 → 检查 `path` 字段是否在保护前缀下
- **Shell**：`terminal` / `shell` / `bash` → 检查 rm / unlink / mv / cp -f / chmod / chown / rsync --delete / tee / `>` 重定向 / `find -delete` 等破坏动词是否命中保护前缀
- **代码执行**：`code_execution` / `execute_code` / `python` / `python_exec` / `code_interpreter` → 检查 Python 代码中的 `os.remove` / `shutil.rmtree` / `Path.unlink` / `open(..., 'w')` 等破坏 API

**额外**：Shell 路径还会检测 `python -c "..."` 内联 Python —— 一个真实绕过向量（LLM 用 `python -c "os.remove('~/Desktop/x')"` 会被抓）。

保护前缀（`PROTECTED_PREFIXES`）：
- `~/Desktop/` / `~/Documents/` / `~/Downloads/`
- `/etc/` / `/usr/` / `/var/` / `/System/` / `/Library/`

触发保护 → 用户审批流程（按场景自动选择）：

1. **Corey UI（桌面端）**：guard 通过 HTTP POST `/guard/prompt` → Rust axum handler → Tauri event `guard:prompt:request` → React `GuardConfirmModal` 内嵌审批卡片（与 Hermes `ApprovalCard` 样式一致，4 按钮：拒绝 / 仅此一次 / 本次会话 / 始终允许）→ IPC `guardPromptResolve` → oneshot channel → HTTP response 回 guard
2. **IM 通道（微信 / Slack / WhatsApp 等）**：CoreyOS 不在线 → IPC 失败 → osascript/PowerShell 也无响应（headless）→ guard 写 pending approval 文件到 `~/.hermes/corey-guards/approvals/{hash}.json`（5 分钟 TTL）→ block reason 包含"请回复「确认执行」"→ Agent 在 IM 里告诉用户 → 用户回复"确认执行" → Agent 重试 → guard 匹配 pending 文件 → 自动放行
3. **桌面端 osascript/PowerShell 降级**：IPC 不可用但桌面有用户 → 弹系统原生对话框 → 用户确认/拒绝

**Talk Mode 审批**：与 Chat 完全一致——`useTalkMode` 的 `onApproval` 不再自动批准，`TalkModeInline` 渲染同样的 `ApprovalCard`，等待用户手动选择。

**发送按钮状态修复**：`UiMessage` 新增 `streaming` 字段（与 `pending` 分离）。`pending` = 等待首 token（spinner），`streaming` = LLM 仍在输出（Composer 停止按钮）。AI 回复期间按钮保持停止图标直到 stream 完成。

**双重发送防护**：`useChatSend` 新增 `sendingRef`（useRef 同步锁），防止 Enter + form submit 同一 tick 内触发两次 `send()`。

**Bundled**：`src-tauri/assets/corey-guards/file-ops-guard.py`，`include_str!` 进 Corey binary，`GUARD_VERSION` 版本号控制升级重写。

**自动注册**：`src-tauri/src/hermes_hooks.rs::ensure_hook_registered()` 在 Corey 启动时幂等地把 guard 路径写到 `~/.hermes/config.yaml` 的 `hooks.pre_tool_call` 列表里；同时设 `hooks_auto_accept: true` 绕过 TTY 批准提示（非交互渠道如 cron / WhatsApp 需要）。

## 可靠度矩阵

| 层 | 机制 | 可靠度 |
|---|---|---|
| L0/L1/L2 | system prompt 约束 | 70-95%（取决于模型） |
| L3-a Hermes DANGEROUS_PATTERNS | 正则 + subprocess approval | 100%（除非绕过，见下）|
| L3-b corey-guards | subprocess JSON hook | 100%（除非 hook 没注册，见下）|

**硬防御的失效模式**（必须监控）：

1. **`hooks.pre_tool_call` 不是 list 类型** → Hermes `_parse_hooks_block` 发现类型不对 warn-and-skip，guard **不注册**。历史真实 bug：`config.yaml` 有 `pre_tool_call: '[]'`（字符串），guard 沉睡。修复：Corey 启动 reconcile 强制 list 格式。
2. **guard 脚本 mtime drift** → Hermes `shell-hooks-allowlist.json` 记录批准时的 mtime，升级后脚本新 mtime 触发"script modified since approval"告警，但 hook 仍 fire。Corey 启动重新写 allowlist 或依赖 `hooks_auto_accept: true` 自动重批准。
3. **guard 子进程崩溃或超时** → Hermes fail-safe to allow（行为不一定可控）。guard 本身 `try/except` 包住所有代码，失败就 allow（避免 guard bug 卡死用户合法操作）。
4. **Hermes 升级改了 hook 协议** → Corey 需要适配。协议在 `agent/shell_hooks.py` 的 `_parse_hooks_block` + `_spawn`，升级时手动复查。
5. **LLM 走 Hermes 内置工具绕过**（例如 browser_click 点"删除"按钮）→ 当前 corey-guards 不覆盖 browser 类；L0 铁律软约束是唯一防线。**TODO**：把 browser_click 纳入 corey-guards。

## 可观测性（Settings → 安全防护）

`src/features/settings/sections/SecuritySection.tsx` 卡片通过 `security_status_get` IPC 展示：

- guard 脚本是否安装
- hook 是否注册到 config.yaml
- `hooks_auto_accept` 是否为 true
- 最近 guard.log 中的 FIRED 次数 / BLOCK 次数
- 综合徽章：**OK 双层防御就绪** / **WARN 部分渠道可能失效** / **CRIT 破坏性操作无硬拦截**
- 一键 `security_reconcile` 触发 `seed_guards_script + ensure_hook_registered` 强制修复

## 客户侧扩展点（未来）

- 自定义 PROTECTED_PREFIXES（比如客户的业务目录 `~/Work/Client-A/`）
- per-sender ACL（某个微信号不需要本地确认）
- 远程批准（手机 push 通知 + 手机批准，免跑去电脑）
- 浏览器破坏性操作覆盖（browser_click 拦下单 / 删除订单按钮）

这些都不紧急，等真实客户反馈再做。

## 真实事件档案

### 2026-05-11 晚 · LLM 绕过 shell guard 删文件

- **上下文**：用户测试铁律时用"帮我删除桌面的 test.md"
- **L0 软约束反应**：LLM 复述铁律时说"破坏性操作必须先问" ✅（确认铁律被读到了）
- **L3-a 反应**：shell `rm ~/Desktop/test.md` 被 DANGEROUS_PATTERNS `rm\s+(-[^\s]*\s+)*/ | rm\s+-[^\s]*r` 拦 ✅
- **L3-b 实际状态**：**未注册**（config.yaml bug：`hooks.pre_tool_call: '[]'` 字符串）✗
- **绕过动作**：LLM 主动说"终端被拦，我用 Python 工具试试" → 调 `code_execution` 跑 `os.remove('~/Desktop/test.md')` → **成功删除**
- **教训**：
  1. 硬防御必须有可见性（Settings Security card）否则不知道失效
  2. 软约束必须明令禁止"被拦就换路径"这种绕过推理（L0 新增的 7 条反绕过规则）
  3. guard 工具名集合必须跟 Hermes 实际工具名匹配（v1 只有 `execute_code`，v2 加了 Hermes 实际名 `code_execution`）
  4. 硬防御 + 软约束 + 可观测性三位一体缺一不可
