# Auto-Compress（Hermes 自动上下文压缩）

**日期**：2026-04-27  
**状态**：默认开启 — 来自 Hermes 自身能力，无需 Corey 侧改动  
**目标读者**：维护者 + 想调参数的高阶用户

---

## TL;DR

Hermes 自带**自动上下文压缩**。当 session 累积的 messages 把上下文窗口
塞到 50% 时，Hermes 会用辅助 LLM 把更早的对话总结成一段，把窗口压回
20% 左右，**最近 20 条不动**。

这是对"每次对话都把整个历史塞回 prompt"这个 LLM 协议事实的**减缓
方案**——不是消除（参考 `docs/agent/llm-stateless.md`，如有），但能让
长 session 不至于 token 爆炸。

---

## 配置项

写在 `~/.hermes/config.yaml` 里：

```yaml
compression:
  enabled: true        # 总开关
  threshold: 0.5       # 0..1：上下文窗口用到这个比例就触发压缩
  target_ratio: 0.2    # 0..1：压缩后的目标比例
  protect_last_n: 20   # 最近 N 条对话不参与压缩

# 用哪个 LLM 做压缩（默认走 main provider）
auxiliary:
  compression:
    provider: auto       # auto = 跟 main provider 同款
    model: ''            # 空 = main 默认 model；填具体 model 可用便宜些的
    base_url: ''
    api_key: ''
    timeout: 120
    extra_body: {}
```

## 默认值的取舍

| 参数 | 默认 | 解读 |
|---|---|---|
| `threshold: 0.5` | 50% | 比较保守。设到 0.7 会更晚触发，但风险是冲到上限的可能性更大 |
| `target_ratio: 0.2` | 20% | 比较激进。压完之后留下 20% 空间继续聊，再加新的 message。设到 0.4 会保留更多原文但下一次压缩来得快 |
| `protect_last_n: 20` | 20 条 | 最近 10-20 轮一定保留原文。这是模型理解"最近上下文"的关键 |

**默认值对当前场景已经合理**。除非你明确知道在做什么（比如你的 model 上下文窗口特别小，或者你愿意更频繁地压缩换更多原文保留），别改。

## 三档预设建议

如果未来要在 Corey GUI 暴露，建议用三档语言而不是数字：

| 预设 | threshold | target | protect | 适用 |
|---|---|---|---|---|
| **省 token** | 0.3 | 0.1 | 10 | 模型 context 小（≤16K），愿意丢上下文换便宜 |
| **平衡（默认）** | 0.5 | 0.2 | 20 | 主流 model（32K-128K），日常使用 |
| **保留更多原文** | 0.7 | 0.3 | 40 | 模型 context 大（≥128K），讨论需要长上下文 |

---

## 触发什么时候发生

Hermes 在每次发起 LLM 调用前评估当前 messages 的 token 数。一旦
`token_count / context_window >= threshold`，进入压缩流程：

1. 选取「除了最近 protect_last_n 条之外的所有 messages」
2. 拼成一个 system message："以下是早先的对话总结：…"
3. 调辅助 LLM（auxiliary.compression）生成总结
4. 用总结替换被压缩的 messages
5. 进入正式 LLM 调用

整个过程透明：用户在 chat 里看到的 message 列表**不变**（前端 store
里还是原始 messages），但发给 LLM 的 prompt 里被替换成总结。

---

## 怎么知道触发了

- `~/.hermes/logs/agent.log` 里搜 `Pre-compression:` 或 `compression`
- Corey 端 chat_stream done 的 `prompt_tokens` 突然下降一截，但 messages 数量没少 → 多半是压了

---

## 已知坑

1. **辅助 LLM 调用失败**：如果 auxiliary.compression 配置错或 provider 不通，会回退到 main provider 自压。可能慢/费 token 但不致死。
2. **首次触发延迟**：压缩本身要发一次 LLM 调用（~2-5 秒）。用户视角是"这一轮特别慢"。
3. **总结准确度**：辅助 LLM 越便宜越容易丢细节。如果你发现压缩后 model 突然"忘了"某条关键信息，把 `auxiliary.compression.model` 配成更强的 model。

---

## 衍生 todo（不阻塞当前迭代）

- [ ] 在 Corey Settings 加"上下文管理"页（三档预设 + 高级展开）
- [ ] 在 chat composer 旁加 token 使用率小条形图（可视化"快到阈值了"）
- [ ] 在 `chat_stream done` 日志里识别 prompt_tokens 突降，emit 一个"已自动压缩"的 UI 提示
- [ ] 文档纳入 `manual.zh.md` Knowledge 页之后（教用户感知 + 调）
