# System Prompt Stack — 三层 Soul 架构

> 版本：v1（2026-05-10）
> 适用：v0.2.11+
> 维护：动这个文件前先读完整篇，分层契约不可单边违反。

## 为什么要分层

历史教训：v0.2.10 把"AI 必须调 corey-native MCP 工具"这种**产品级铁律**写进了 `cross_border_ecom` 的 Pack soul（行业人设）。直接后果：

1. 没装该 Pack 的客户，AI 不会调元操作工具 → 基座产品体验割裂。
2. 多 Pack 共存时每个 Pack 都得复制粘贴这套规则 → Pack 作者越权管基座。
3. Pack soul 又长又混乱（行业人设 + 产品规则混杂）→ 模型决策受干扰。

正解：**把"基座助手身份" + "产品操控纪律"提到 base 层**，Pack soul 只管行业人设。

## 分层定义

每次 chat 发送，前端通过 `enrichHistoryWithContext` 拼接 system messages，**unshift 顺序决定优先级**（最后 unshift 的最靠前，对模型权重最高）。

```
[L1] 基座 Base Soul          ← 最高优先级，永远第一
[L2] Pack Soul（active pack） ← 行业人设，可选 0 或 1 个主导
[L3] 检索上下文              ← Knowledge / 相似对话 / 用户偏好
[user/assistant 历史…]
```

### L1 · Base Soul（基座层）

**位置**：`src/app/baseSoul.ts`（前端常量）或 `src-tauri/assets/base/system.md`（后端文件，未来动态生成）。

**内容契约**（必须包含）：

1. **身份**：你是 Corey 的 AI 助手，扮演任何角色时这条都生效。
2. **元操作纪律**：用户问产品状态 / 切模型 / 跳页面 → 调对应 `mcp_corey_native_*` 工具。
3. **禁止伪造**：永不输出伪造的 tool 调用结果格式（如 `[{"type":"system",...}]`）。永不脑补模型名 / endpoint。
4. **决策归还 UX**：调完工具后回复 3 段（`🧠 / 💡 / 👇`）+ 用 `[文本](/路径)` 标准 markdown 链接做 deep-link。
5. **工具映射表**（动态生成）：列出当前可用 corey-native 工具的完整名 + 触发关键词。

**特征**：
- 短：< 1500 token，不抢 Pack soul 的人设份额。
- 通用：跟具体行业无关，只跟"Corey 这个软件"有关。
- 强约束：用 "🚨 强制规则" / "❌ 禁止" 这种最高强度词汇压住模型。

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
