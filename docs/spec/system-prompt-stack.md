# System Prompt Stack — 三层 Soul 架构

> 版本：v1.2（2026-05-11 晚）
> 适用：v0.2.12+
> 维护：动这个文件前先读完整篇，分层契约不可单边违反。
>
> v1.1 修订（2026-05-11 早）：把 L1 base soul 的 source of truth 钉死为
> `src/app/baseSoul.ts`，Corey 永不写入 `~/.hermes/SOUL.md`。
>
> **v1.2 修订（2026-05-11 晚）：新增 L0 元铁律层，通过 marker-delimited
> block 写入 `~/.hermes/SOUL.md`**。触发原因：客户越来越多通过 WhatsApp /
> 微信 / 钉钉 / Slack / cron 等**非 Corey UI 渠道**让 Hermes Agent 工作，
> 这些渠道绕过前端 `enrichHistoryWithContext`，只能通过 SOUL.md 拿到
> 全局指令。Corey 对 SOUL.md 的写入恢复，但通过 **marker 分界块**保证
> 不覆盖客户自己在 SOUL.md 里写的任何内容（详见 L0 段）。
>
> v1.1 担心的"升级覆盖风险"在实际 Hermes 源码中不成立：Hermes 的
> `hermes_cli/config.py::_ensure_default_soul_md` **只在文件缺失时**写入，
> 已有文件永不触碰。Corey 的 marker 策略 + Hermes 的尊重既有文件策略
> 叠加 = 零覆盖风险。

## 为什么要分层

历史教训：v0.2.10 把"AI 必须调 corey-native MCP 工具"这种**产品级铁律**写进了 `cross_border_ecom` 的 Pack soul（行业人设）。直接后果：

1. 没装该 Pack 的客户，AI 不会调元操作工具 → 基座产品体验割裂。
2. 多 Pack 共存时每个 Pack 都得复制粘贴这套规则 → Pack 作者越权管基座。
3. Pack soul 又长又混乱（行业人设 + 产品规则混杂）→ 模型决策受干扰。

正解：**把"基座助手身份" + "产品操控纪律"提到 base 层**，Pack soul 只管行业人设。

## 分层定义

每次 chat 发送，前端通过 `enrichHistoryWithContext` 拼接 system messages，**unshift 顺序决定优先级**（最后 unshift 的最靠前，对模型权重最高）。

```
[L0] 元铁律 Meta Iron Rules   ← 注入路径：~/.hermes/SOUL.md（跨渠道）
[L1] 基座 Base Soul          ← 最高优先级，永远第一（注入路径：baseSoul.ts）
[L2] Pack Soul（active pack） ← 行业人设，可选 0 或 1 个主导
[L3] 检索上下文              ← Knowledge / 相似对话 / 用户偏好
[user/assistant 历史…]
```

L0 通过 Hermes Gateway 加载 `~/.hermes/SOUL.md` 进入 system prompt，
对**所有渠道**（Corey UI / WhatsApp / 微信 / 钉钉 / Slack / cron / MCP
客户端）都生效。L1-L3 只进入 Corey UI 前端路径。

### L0 · 元铁律（跨渠道层，v1.2+）

**唯一 source of truth**：`src-tauri/assets/soul/corey_iron_rules.md`（`include_str!` 编进 binary）。

**注入路径**：Corey 启动时 `soul_md::sync_corey_block(hermes_dir)` 把
铁律内容写进 `~/.hermes/SOUL.md` 的 **Corey 独占分界块**：

```
<!-- COREY:BEGIN iron-rules v1 -->
...(Corey-managed content)...
<!-- COREY:END iron-rules v1 -->
```

**客户主权不变**：marker 以外的内容 = 客户自己写的 persona / 偏好，
Corey **绝对不触碰**，升级也不会改。客户想覆盖 Corey 的 marker 块？
把它删掉就行 —— 下次启动 Corey 会重新 append，仍然尊重 marker 外的
其他内容。

**内容契约**（必须包含）：

1. **只做用户明确要求的事**：不多做、不少做、不顺手优化别的
2. **不自己决定方案**：多选项时先问用户
3. **没有就是没有**：用户问某功能存不存在，不主动提议"那我帮你建"
4. **有疑问先提问，等回答**：模糊指代时必须先澄清
5. **未被明确要求不执行**："想知道 X 在哪" = 只回位置，不执行 X

**特征**：
- 极短：< 1500 token，不挤占下层 Pack soul 额度
- 通用：跟渠道无关、跟行业无关、跟 Pack 无关
- 强约束：用 "🔴 元铁律" / "凌驾一切" / "任何一题不通过 → 不动手" 这种最高强度词汇

### L1 · Base Soul（基座层）

**唯一 source of truth**：`src/app/baseSoul.ts`（前端常量）。
编译进 binary，跟着 Corey 安装包到达每个客户机器，无需启动期 seed/reconcile。

**内容契约**（必须包含）：

1. **身份**：你是 Corey 的 AI 助手，扮演任何角色时这条都生效。
2. **元操作纪律**：用户问产品状态 / 切模型 / 跳页面 → 调对应 `mcp_corey_native_*` 工具。
3. **禁止伪造**：永不输出伪造的 tool 调用结果格式（如 `[{"type":"system",...}]`）。永不脑补模型名 / endpoint。
4. **决策归还 UX**：调完工具后回复 3 段（`🧠 / 💡 / 👇`）+ 用 `[文本](/路径)` 标准 markdown 链接做 deep-link。
5. **工具映射表**（v1 静态、v2 动态）：列出当前可用 corey-native 工具的完整名 + 触发关键词。
6. **浏览器操控**（v0.2.11+）：用户要"去/看/点/填/抓 + 外部网站"时主动调 Hermes browser 工具集。
7. **Memory 收藏夹**（v0.2.11+）：用户说"以后我说 X 就开 Y URL"时调 `memory(action="add",...)` 持久化，Pack soul 永远不要硬编码 URL 列表。

**特征**：
- 短：< 2000 token，不抢 Pack soul 的人设份额。
- 通用：跟具体行业无关，只跟"Corey 这个软件"有关。
- 强约束：用 "🚨 强制规则" / "❌ 禁止" 这种最高强度词汇压住模型。

#### L1 注入路径与 Hermes SOUL.md 的关系（v1.1 钉死）

Hermes Agent 自带一条 system prompt slot：
`agent/prompt_builder.py::_load_soul_md()` 会读 `~/.hermes/SOUL.md` 并注入。
但 Corey **永不写入** 这个文件，原因：

1. **客户主权（HD-3）**：Hermes 把 `~/.hermes/SOUL.md` 视为用户级 persona override，
   Corey 写它就违反了"不动用户主权数据"原则，升级时还可能丢失客户改动。
2. **避免双重注入**：v0.2.11 早期实验过"前端注入 + Hermes SOUL.md 加载"双轨，结果
   两边内容容易漂移（一处改了忘了同步另一处）。统一到前端 `baseSoul.ts` 一条路径。
3. **零客户端配置**：前端注入是 binary 自带，新版 Corey 装上就立即生效，无需启动期
   seed、无需 reconcile 协议、无需备份机制。

**L1 进入对话的路径只有一条**：
```
chat 发送
  → src/features/chat/enrichHistory.ts::enrichHistoryWithContext
  → 最末尾 enriched.unshift({ role: 'system', content: buildBaseSoul() })
  → messages 数组首位 → Hermes Gateway → LLM
```

**客户机器上的 `~/.hermes/SOUL.md`**：如果客户自己写过这个文件（如自定义 persona），
Hermes 会照常加载它，叠加在 Corey 注入的 base soul **之上**（Hermes 的 slot 优先级
通常高于 chat messages 里的 system role）。这是客户的合法 override 路径，Corey 尊重
并保留。

### L2 · Pack Soul（行业层）

**位置**：`<pack>/prompts/soul.md`，每个 Pack 自带，由 `manifest.yaml :: soul_inject` 声明。

**内容契约**：
- 只写**行业人设 + 行业话术 + 行业边界**。
- **禁止**写工具调用规则、决策格式、deep-link 语法（这些 L1 已声明）。
- 长度合理（< 2000 token）。

**激活策略 v1（一主多备）**：
- 用户启用 N 个 Pack，但**每个 chat session 只激活 1 个主导 Pack**。
- 主导 Pack 的 soul 进入 L2，其他 Pack 的**工具**仍在工具池里可用，但 soul 不上场。
- 切换：用户在 chat 头部选 / routing rule 自动选 / 用户用元操作工具切。

未来 v2 可考虑"软并存"——多 Pack soul 用 H2 标题分段叠加，但首版避免精分风险。

### L3 · 检索上下文（动态层）

**位置**：`enrichHistoryWithContext` 现有逻辑。

**内容**：
- 用户偏好 / Hermes USER.md（已存在）
- 知识库召回（已存在）
- 相似历史对话（TF-IDF，已存在）

**改动**：保持现状。L1 + L2 不影响这一层。

## 实现路径（v0.2.11）

### 第一阶段：立 L1（今晚做）

1. `src/app/baseSoul.ts` 写一份固定的 base soul 内容（v1 静态字符串）
2. `enrichHistoryWithContext` 最末尾 unshift L1（让它排到最前）
3. 把 `cross_border_ecom/prompts/soul.md` 里的工具调用规则段全部删除，只保留亚马逊顾问纯人设
4. 验证：直接 curl `8642` + 通过 chat UI

### 第二阶段：动态工具映射（明天做）

base soul 里的"工具映射表"目前是静态写死。改成：

1. 启动时调 `8649 tools/list`
2. 过滤出 `corey_*` 前缀的工具
3. 拼成 markdown 表格替换 base soul 里的占位符
4. 用户加 / 减 corey-native 工具时映射表自动更新

### 第三阶段：一主多备 Pack 切换（这周做）

1. `db/sessions` 加 `active_pack_id` 字段
2. 创建会话时根据 routing rule 选默认 Pack
3. chat 头部加 Pack 切换按钮 + `set_active_pack` 元操作工具
4. `packActiveSouls` IPC 改成只返回 active pack 的 soul

### 第四阶段：tool_call 协议适配（这周做）

1. `LlmProfile` 加 `tool_call_protocol: openai|deepseek_dsml|...` 字段
2. Picker 给不兼容的模型打 ⚠️
3. Corey 端 SSE 中间层识别 DSML，翻译成 OpenAI tool_calls
4. 不动 Hermes 一行

## 多 Pack 工具命名约定（已落地）

工具按 namespace 隔离，不会撞名：
- 基座：`mcp_corey_native_<tool>`（Hermes 加前缀后的全名）
- Pack：`mcp_pack__<pack_id>__<server>__<tool>`

L1 base soul 引用基座工具用全名，确保 AI 看到的就是它能调的。

## 不变量（动这个架构前必须遵守）

1. **L1 永远在最前**——Pack soul 不能覆盖基座规则。
2. **L2 一次最多一个**——避免多人设精分。
3. **基座工具命名固定**——`corey_*` 内部前缀 + Hermes `mcp_corey_native_` 外部前缀。
4. **不动 Hermes 一行**（HD-1/HD-2）。
5. **Pack soul 长度 < 2000 token，base soul < 1500 token**——总头部 < 5k token，给 history 留空间。

## 关联文档

- `docs/spec/architecture.md` § Pack Architecture
- `docs/spec/skill-pack-format.md` (TODO: soul.md 写作规范)
- `src-tauri/src/pack/manifest.rs` (soul_inject 字段定义)
- `src/features/chat/enrichHistory.ts` (注入实现)
