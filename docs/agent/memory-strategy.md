# Memory 策略（v9 audit）

**日期**：2026-04-27  
**状态**：DECIDED — 走 Hermes holographic plugin，**不接 embedding API**  
**决策驱动者**：用户问 "一定要接 Hermes embeddings 么？网上不是有很多很好的方式么？"

---

## TL;DR

CoreyOS 不再自己造 RAG / embedding 轮子。**让 Agent 越学越聪明**这件事完全交给 Hermes 自带的 holographic memory plugin。

```
~/.hermes/config.yaml:
  memory:
    provider: holographic
  plugins:
    hermes-memory-store:
      auto_extract: true
      temporal_decay_half_life: 30
```

LLM 现在能调用 2 个新工具：`fact_store`（9 actions）和 `fact_feedback`（评分训练 trust）。session 结束时自动抽取 facts。

---

## 调研：Hermes 提供的 7 个 memory backend

| Backend | 类型 | 特点 |
|---|---|---|
| **holographic** ⭐ | 本地 SQLite + HRR | SHA-256 派生相位向量。零网络依赖、跨机确定性、信任评分 + 时间衰减 + 实体解析 |
| retaindb | 云 SaaS | 辩证综合 + Agent self-model + 共享文件库。要 API key |
| hindsight | 知识图谱 | 实体解析 + 多策略检索。cloud / local 双模式 |
| openviking | ByteDance | viking:// 文件系统 + L0/L1/L2 三层加载 |
| mem0 / honcho / byterover / supermemory | 各类 | 都要 API key |

**选 holographic** 的理由：
- 完全本地、零网络依赖（中国企业用户友好）
- 零额外费用、零 API key 风险
- 跨机确定性（同一份 facts 在不同机器上的相同查询返回相同结果）
- HRR 算法本身就支持组合性（`bind("客户", "王总")` → 复合实体向量）

---

## 关键洞察：HRR 不是神经网络 embedding

很多人以为"做 RAG 必须有 embedding 模型"。Hermes 的 holographic plugin **完全不用神经模型**：

| 神经 embedding | HRR (holographic) |
|---|---|
| 训练好的 transformer 输出 768/1024 维实向量 | SHA-256 哈希派生 1024 维 phase 向量 |
| 需要下载几十 MB 模型权重 | 不需要任何权重 |
| 不同模型版本结果不同 | 完全确定性，跨进程跨机器一致 |
| 通过梯度学到的语义相似性 | 通过哈希设计的随机几乎正交性 |
| 需要 GPU/ONNX runtime | 只需 numpy |
| 同义词、上下文敏感 | 字面相同 → 确定相似 |

HRR 的"语义"由 **FTS5 全文 + Jaccard 词集 + HRR 组合性** 三路融合得出，而不是单纯的向量相似度。这意味着：

- 一个文档里写"提速优化"，查询"性能优化" — HRR 单路命中率低
- 但 FTS5 + Jaccard 会把"优化"这个共同词捕获到
- 三路加权综合决定最终排序

对于"agent 长期记住业务事实"这类场景，HRR 的精确性 + 三路融合的召回率，**已经足够**。神经 embedding 在这个场景的边际收益不大。

---

## 自动学习循环（怎么"越学越聪明"）

```
用户跟 Agent 聊天 ──→ session 结束
                       │
                       ▼
              Hermes 用辅助 LLM 抽 facts
              （6 类：人物 / 偏好 / 决定 / 约定 / 知识 / 任务）
                       │
                       ▼
              写入 memory_store.db
                带 trust 分数 + timestamp
                       │
                       ▼
              下次 session 开始
                       │
                       ▼
              LLM 看到 "use fact_store to recall" 提示
              主动调 `fact_store search "客户王总"`
                       │
                       ▼
              拿到相关 facts 注入 prompt
                       │
                       ▼
              用户体验："这个 Agent 居然记得我上次说的"
```

**用户感受到的"越来越聪明"** = 每次 session 后 facts 越积越多 → 召回越来越准 → 回答越来越契合用户业务场景。

---

## 跟 CoreyOS 的关系

### 当前状态

CoreyOS 仍有自己的 `knowledge_upload / knowledge_search` IPC（v9 砍了向量化路径，退化为 SQL Jaccard）。这套和 Hermes 的 memory_store 是**两套独立系统**。

短期：可以共存。**Agent 自动学习走 Hermes**，**用户主动上传文档走 CoreyOS knowledge**。两边互不干扰。

### 长期方向

**让 CoreyOS knowledge_upload 走 Hermes memory store**：

- 用户在 GUI 上传 PDF / Markdown
- CoreyOS 把文档丢到一个新 chat session 里
- Prompt 模板："学习以下文档，把要点 fact 化存进记忆：\n{content}"
- LLM 自动调 `fact_store add` 把每条 fact 入库
- 用户后续 chat 自然能召回

这样：
- ✅ knowledge_upload 不再自己存储 / 索引（删 SQLite knowledge_chunks 表）
- ✅ 全统一到 Hermes memory store
- ✅ trust score / temporal decay 等都自动适用
- ✅ 跨 session 知识共享

但这是 P2 改造，不阻塞当前 MVP。

### Corey GUI 增强方向

P1 (MVP)：
- Settings 加 `/settings/memory` 子页：
  - 显示 memory backend 状态（"holographic 已启用，30 天衰减"）
  - 显示当前 fact 数 / 最近一周新增 / 最常召回
  - 编辑 USER.md（用户画像）

P2 (Polish)：
- 把 knowledge_upload 流程切到 Hermes memory store
- chat 中显示"召回了哪些 facts"（透明度）
- B2B：profile-scoped memory（不同公司账号互相隔离）— Hermes profiles 已经支持，CoreyOS 只需暴露切换

---

## 已知坑 / 需要观察

1. **auto_extract 真的工作不？** Hermes session 结束时调辅助 LLM 抽 facts。如果 deepseek-chat 抽得不准，可能要换更强的 model（在 `auxiliary.fact_extraction` 配 GPT-4-tier）。
2. **fact 太多导致 prompt 膨胀？** holographic 默认有 trust threshold (0.3) 过滤 + 时间衰减；先观察实际容量。
3. **跨 profile 隔离？** Hermes profile 切换会换 memory_store.db 路径（profile-scoped HERMES_HOME），所以 B2B 多账号本来就隔离。
4. **memory dump / 备份？** memory_store.db 是 SQLite 文件，直接 cp 即可备份。Corey 的 backup 机制可以加这个文件。

---

## 衍生 todo

- [ ] Corey Settings → Memory 页（显示 + 调参 + 编辑 USER.md）
- [ ] knowledge_upload 切换到走 Hermes memory store（P2）
- [ ] chat 中显示"已召回 X 条相关 facts"提示（透明度）
- [ ] backup 把 memory_store.db 也带上
- [ ] 文档：用户手册加一节"让 Corey 越来越懂你"
