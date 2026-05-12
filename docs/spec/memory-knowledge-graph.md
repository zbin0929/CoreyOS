# Memory 知识图谱增强方案

> 版本：v1.2（2026-05-12）
> 触发：竞品分析（GBrain、Terax AI）+ Hermes holographic plugin 源码审计 + 升级兼容性验证
> 状态：P1 + P2-1/P2-3 已实现
> 读者：Corey 维护者

## 一句话

激活 Hermes holographic 已有的实体图谱能力 + 补 Hermes 缺失的 typed relations / 分级富化，不走 GBrain 的 pgvector 路线。

---

## 背景：三方对比

| 能力 | Hermes Holographic | GBrain | CoreyOS 现状 |
|---|---|---|---|
| 实体提取 | ✅ 英文正则（大写多词 + 引号 + AKA） | ✅ 正则 + LLM | ❌ 无（依赖 Hermes） |
| 实体存储 | ✅ `entities` 表 + `fact_entities` 多对多 | ✅ PGLite pages | ✅ 可读 Hermes DB |
| 实体消歧 | ✅ name + aliases 匹配 | ✅ entity resolution | ✅ 继承 Hermes |
| Typed relations | ❌ 只有 fact-entity 关联，无关系类型 | ✅ `works_at` / `invested_in` / `attended` 等 | ❌ |
| Entity Pages | ❌ 实体只是名字 | ✅ 独立 page + 时间线 + dossier | ❌ |
| 混合检索 | ✅ FTS5 + Jaccard + HRR 三路加权 | ✅ 向量 + 关键词 + RRF + 图遍历 | ❌ 未集成到 chat |
| HRR 代数推理 | ✅ probe / related / reason / contradict | ❌ | ❌ 未暴露给用户 |
| 分级富化 | ❌ | ✅ Tier 1/2/3 自动递进 | ❌ |
| Backlink boosting | ❌ | ✅ 被引用越多排名越高 | ❌ |
| 信任评分 | ✅ helpful +0.05 / unhelpful -0.10 | ❌ | ✅ 继承 Hermes |
| 时间衰减 | ✅ 可配 half_life | ❌ | ✅ 继承 Hermes |
| 矛盾检测 | ✅ entity overlap + content divergence | ❌ | ❌ 未暴露 |
| 自动 fact 提取 | ✅ session 结束时正则 | ✅ signal-detector 每条消息 | ✅ 继承 Hermes |
| Dream cycle | ❌ | ✅ 凌晨 cron 扫描 + 升级 | ❌ |
| 中文实体提取 | ❌ 只匹配英文大写 | ❓ 不清楚 | ❌ |
| Embedding | ✅ HRR（SHA-256 哈希，零模型） | ✅ text-embedding-3-large（OpenAI） | ✅ BGE-M3 ONNX（可选） |

### 关键发现

1. **Hermes 已有 80% 的图谱基础**：`entities` 表 + `fact_entities` 关联表 + `probe/related/reason/contradict` 四种图查询，CoreyOS 只是没激活
2. **Hermes 缺 typed relations**：`fact_entities` 只记录"fact A 关联 entity B"，不记录"关系类型"（`works_at` vs `invested_in`）
3. **Hermes 缺中文实体提取**：正则只匹配英文大写多词模式，中文人名/公司名完全漏掉
4. **GBrain 的 pgvector 路线不适合 CoreyOS**：CoreyOS 定位"完全本地、零网络"，HRR 已经够用
5. **CoreyOS 的 chat 没有自动调 fact_store**：用户每次对话不会自动检索相关 facts，holographic 的 probe/reason 白白浪费

---

## Hermes Holographic 现有 Schema（`memory_store.db`）

```
facts           (fact_id, content, category, tags, trust_score, hrr_vector, ...)
entities        (entity_id, name, entity_type, aliases, ...)
fact_entities   (fact_id, entity_id)              ← 多对多，无关系类型
memory_banks    (bank_id, bank_name, vector, ...)  ← 每 category 一个 bundle
facts_fts       (FTS5 虚拟表)                      ← 全文检索
```

Hermes 的 `_init_db()` 用 `CREATE TABLE IF NOT EXISTS`，没有 schema version，没有 migration 机制。每次启动跑一遍 `_SCHEMA`，已存在的表跳过。**不会删不认识的表。**

检索策略（`FactRetriever`）：
- `search(query)` → FTS5(40%) + Jaccard(30%) + HRR(30%) 三路加权 × trust_score × 时间衰减
- `probe(entity)` → HRR 代数 unbind：从 bank 中提取关联某实体的所有 facts
- `related(entity)` → 结构性关联：共享上下文的 facts
- `reason(entities)` → 多实体 AND 语义：找同时关联多个实体的 facts
- `contradict()` → 实体重叠高 + 内容相似度低 = 潜在矛盾

---

## Hermes 升级兼容性分析

### Hermes schema 管理方式

```python
# plugins/memory/holographic/store.py:_init_db()
def _init_db(self):
    self._conn.executescript(_SCHEMA)  # 全部 CREATE IF NOT EXISTS
    # 唯一的 "migration"：加 hrr_vector 列
    columns = {row[1] for row in self._conn.execute("PRAGMA table_info(facts)").fetchall()}
    if "hrr_vector" not in columns:
        self._conn.execute("ALTER TABLE facts ADD COLUMN hrr_vector BLOB")
```

特征：
- 无 `PRAGMA user_version`，无版本号
- `CREATE TABLE IF NOT EXISTS` 幂等
- 历史上只做过一次 migration（加 `hrr_vector` 列）
- **不会删除或修改不认识的表**

### CoreyOS 改动的三层风险

#### P1（激活已有能力）—— 零风险

| 改动 | 操作类型 | 升级影响 |
|---|---|---|
| P1-1: Chat 自动 fact 检索 | 只读 `memory_store.db` | **零影响**。SELECT 失败返回空列表，graceful degradation |
| P1-2: Memory 页 entity 列表 | 只读 `entities` 表 | **零影响** |
| P1-3: 中文实体提取 | 通过 Hermes tool-call 写入 | **零影响**。走 Hermes 自己的 `fact_store add` 接口，不直接操作 DB |
| P1-4: Chat bubble 显示召回 | 只展示数据 | **零影响** |

#### P2（增强）—— 低风险，需表名加前缀

| 改动 | 操作类型 | 升级影响 |
|---|---|---|
| P2-1: `corey_entity_relations` 表 | 新建表（`corey_` 前缀） | **低风险**。Hermes `_init_db()` 不删不认识的表 |
| P2-2: Entity Pages UI | 只读 | **零影响** |
| P2-3: `corey_entity_mentions` 表 | 新建表（`corey_` 前缀） | **低风险**。同上 |

**关键设计决策：所有 CoreyOS 自建的表用 `corey_` 前缀**，避免 Hermes 未来加同名表冲突。

#### P3（自动化闭环）—— 零风险

| 改动 | 操作类型 | 升级影响 |
|---|---|---|
| P3-1: enrichment skill | Hermes .md skill 文件 | **零影响**。skill 文件 Hermes upgrade 不碰 |
| P3-2: Dream cycle cron | Hermes cron job | **零影响**。cron job Hermes 自己管理 |
| P3-3: React Flow 图可视化 | 纯前端 | **零影响** |

### 最坏情况：Hermes holographic 大改 schema

如果 Hermes v0.14 重写 memory system：

1. **P1（只读）**：CoreyOS 的 SELECT 报错 → graceful degradation → 返回空 → 不影响 chat 主流程
2. **P2（`corey_*` 表）**：CoreyOS 自己的表不受影响。如果 Hermes 改了 `entities` 表结构，`corey_entity_relations.from_id` 引用的 entity_id 可能需要适配。但 SQLite 默认不强制 FK，数据不丢
3. **P3（skills/cron）**：不受影响

**防范**：
- 所有 CoreyOS 对 `memory_store.db` 的读操作必须 try-catch，失败返回空/默认值
- 不依赖 Hermes schema version（Hermes 也没有 version 机制）
- 不直接写 Hermes 管理的 5 张核心表（`facts`, `entities`, `fact_entities`, `memory_banks`, `facts_fts`）

---

## 方案

### 原则

1. **只读 Hermes 核心表**：CoreyOS 不写 `facts` / `entities` / `fact_entities`，所有写入走 Hermes tool-call 接口
2. **自建表加 `corey_` 前缀**：避免 Hermes 未来加同名表冲突
3. **Graceful degradation**：所有对 `memory_store.db` 的读操作失败时返回空，不影响主流程
4. **中文实体提取走 Hermes 上游**：优先提 PR 给 Hermes，不走 CoreyOS 直接写 DB 的路径

### P1：激活 Hermes 已有能力（1-2 周）

#### P1-1：Chat 自动 fact 检索

每条用户消息发送前，CoreyOS 读 `memory_store.db` 检索相关 facts，注入对话 context。

```
用户输入 "帮我联系王总"
  → CoreyOS 读 memory_store.db，用 FTS5 + Jaccard 搜索 "王总"
  → 拿到 3 条相关 facts（"王总是 ABC 公司的 CTO"、"上次讨论了 X 项目"）
  → 注入到发送给 Hermes 的 context 里
  → Agent 回答时已有王总背景，不需要再问"王总是谁"
```

实现方式：
- 在 `useChatSend.ts` 的 `send()` 中，发送消息前调 IPC
- Rust 端直接读 `memory_store.db`（SQLite），复用 Hermes 的 `facts_fts` 做全文检索
- 只读操作，不写 Hermes 管理的表
- 搜索失败时 graceful degradation：跳过 fact 注入，正常发送消息

#### P1-2：Memory 页展示 entity 列表

当前 Memory 页只显示 fact count / categories / USER.md。增加：

- Entity 列表（从 `entities` 表读取，按关联 fact 数排序）
- 点击 entity → 显示关联的 facts（读 `fact_entities` JOIN `facts`）
- 点击 fact → 显示关联的其他 entities（读 `fact_entities` JOIN `entities`）

全部只读操作。

#### P1-3：中文实体提取

Hermes 的 `_extract_entities()` 只匹配英文大写模式。需要加中文模式：

```python
# 当前只匹配：John Doe, "Python", 'pytest'
# 需要加：王总、张三、字节跳动、阿里巴巴

# 建议模式：
_RE_CN_PERSON = re.compile(r'[\u4e00-\u9fff]{2,4}(?:总|老师|经理|总监|CEO|CTO|VP|老板)')
_RE_CN_COMPANY = re.compile(r'(?:[\u4e00-\u9fff]{2,6})(?:有限公司|科技|集团|公司|实验室)')
```

**实现路径（按优先级）**：

1. **路径 A（首选）：提 PR 给 Hermes 上游**
   - 改 `plugins/memory/holographic/store.py` 的 `_extract_entities()`
   - 符合 HD-1 原则，Hermes 升级自然包含
   - 所有用户受益，不只是 CoreyOS 用户

2. **路径 B（备选）：CoreyOS 通过 Hermes tool-call 触发**
   - 不直接写 `entities` / `fact_entities` 表
   - 而是让 Hermes agent 在对话中自动调用 `fact_store add`
   - 通过 SOUL.md 或 skill 文件引导 agent 做中文实体识别
   - 缺点：依赖 LLM 主动性，不如正则确定性

3. **路径 C（不推荐）：CoreyOS Rust 端直接写 DB**
   - 绕过 Hermes 直接操作 `memory_store.db`
   - 风险：SQLite 并发写入冲突 + Hermes 升级可能破坏数据
   - 仅在路径 A/B 都不可行时使用

#### P1-4：chat 中显示"已召回 facts"

在 chat bubble 下方显示小标签："已召回 3 条相关记忆"，点击展开 fact 列表。让用户感知到 agent "记得"。

### P2：增强 Hermes 不够的部分（1 月）

#### P2-1：Typed Relations（`corey_entity_relations` 表）

在 `memory_store.db` 里新建 `corey_entity_relations` 表（`corey_` 前缀避免 Hermes 冲突）：

```sql
CREATE TABLE IF NOT EXISTS corey_entity_relations (
    from_id    INTEGER,  -- 对应 entities.entity_id
    to_id      INTEGER,  -- 对应 entities.entity_id
    rel_type   TEXT NOT NULL,  -- 'works_at', 'invested_in', 'attended', 'founded', ...
    confidence REAL DEFAULT 0.5,
    source     TEXT DEFAULT '',  -- 'auto_extract', 'user_told', 'web_enrichment'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (from_id, to_id, rel_type)
);
CREATE INDEX IF NOT EXISTS idx_corey_rel_from ON corey_entity_relations(from_id);
CREATE INDEX IF NOT EXISTS idx_corey_rel_to ON corey_entity_relations(to_id);
CREATE INDEX IF NOT EXISTS idx_corey_rel_type ON corey_entity_relations(rel_type);
```

**为什么用 `corey_` 前缀而不是 Hermes 可能加的 `entity_relations`**：
- Hermes 未来可能自己加 `entity_relations` 表（schema 相同或不同）
- 如果 CoreyOS 先占了名字，Hermes 的 `CREATE TABLE IF NOT EXISTS` 会发现表已存在并跳过
- 如果 Hermes 的 schema 和 CoreyOS 的不同，可能导致 Hermes 行为异常
- 用 `corey_` 前缀彻底隔离，Hermes 升级零影响

关系来源：
- **auto_extract**：从 fact content 中正则提取（"王总在 ABC 公司工作" → `works_at(王总, ABC)`）
- **user_told**：用户在 chat 中明确告诉 agent（"张三投资了 XYZ" → `invested_in(张三, XYZ)`）
- **web_enrichment**：P3 阶段的 web search 结果

图查询 API（CoreyOS Rust 端实现）：
- `graph_query(entity, depth=2)` → 从某个 entity 出发，BFS 遍历 `corey_entity_relations` N 层
- `graph_path(entity_a, entity_b)` → 两个实体之间的关系路径
- `graph_neighbors(entity, rel_type?)` → 某个实体的直接关联

#### P2-2：Entity Pages UI

Memory 页新增 entity cards：

```
┌─────────────────────────────┐
│ 王总                    CTO  │
│ ABC 科技有限公司              │
│ ─────────────────────────── │
│ 关联 facts: 12 条            │
│ 关联 entities: 5 个          │
│ 最近提到: 2026-05-12         │
│ ─────────────────────────── │
│ 关系:                        │
│  works_at → ABC 科技有限公司  │
│  attended → Q1 review 会议   │
│  invested_in → XYZ 项目      │
└─────────────────────────────┘
```

数据来源：
- facts 数量 → 读 Hermes `fact_entities` 表
- 关系 → 读 CoreyOS `corey_entity_relations` 表
- tier → 读 CoreyOS `corey_entity_mentions` 表

#### P2-3：Mention 计数 + 分级（`corey_entity_mentions` 表）

```sql
CREATE TABLE IF NOT EXISTS corey_entity_mentions (
    entity_id    INTEGER,  -- 对应 entities.entity_id
    session_id   TEXT NOT NULL,
    mentioned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source       TEXT DEFAULT 'chat',  -- 'chat', 'im', 'cron', 'web'
    PRIMARY KEY (entity_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_corey_mention_entity ON corey_entity_mentions(entity_id);
```

Tier 递进规则：
- Tier 3（stub）：1 个 source session → 只显示名字
- Tier 2（notable）：3+ 个不同 source sessions → 显示关联 facts
- Tier 1（key）：8+ sessions 或有 typed relation → 显示完整 dossier

mention 记录时机：CoreyOS 在每次 chat 发消息时，扫描 Hermes `fact_entities` 表看本 session 新关联了哪些 entities，写入 `corey_entity_mentions`。

UI 提示：当 entity 从 Tier 3 升到 Tier 2 时，Memory 页显示"王总已从 stub 升级为 notable entity"。

### P3：自动化闭环（季度）

#### P3-1：Enrichment Skill

写一个 Hermes skill `entity-enrichment.md`，让 agent 在空闲时自动做 web search enrich 高频实体：

```markdown
---
name: entity-enrichment
description: >
  Enrich high-mention entities with web search data.
  Runs on cron or idle time.
---

## Trigger
Entity reaches Tier 2 (3+ source sessions) and has no web enrichment.

## Steps
1. fact_store probe(entity) → check if entity already enriched
2. web_search("{entity_name} {company}") → gather public info
3. fact_store add → store enriched data as facts
4. corey_entity_relations → create typed relations from findings
5. Update entity tier to Tier 1
```

#### P3-2：Dream Cycle Cron

利用 Hermes cron 系统，设每日任务：

```yaml
{
  "name": "memory-dream-cycle",
  "schedule": "0 3 * * *",
  "prompt": "扫描 memory_store 中的 Tier 3 entities，检查是否有新的 mentions 满足升级条件。对满足条件的执行 entity-enrichment skill。",
  "toolsets": ["memory", "web"]
}
```

#### P3-3：图可视化

Memory 页新增 Graph View tab，用 React Flow（workflow 已在用）渲染实体关系图：

- 节点 = entities（大小 = mention count，颜色 = tier）
- 边 = typed relations（标签 = `works_at`, `invested_in` 等）
- 点击节点 → 右侧面板显示 entity details + 关联 facts

---

## 不做的事

| 不做 | 原因 |
|---|---|
| ❌ 自建独立 entity/relation 系统 | Hermes 已有 `entities` + `fact_entities` 表，重建是浪费（HD-1） |
| ❌ 接 embedding API（OpenAI text-embedding） | Holographic HRR 已经够用，零网络依赖，符合 CoreyOS 定位 |
| ❌ 迁移到 Postgres/pgvector | SQLite 够用，pgvector 增加 infra 复杂度，B2B 客户部署成本高 |
| ❌ 重写 retrieval 逻辑 | Hermes 的 probe/related/reason/contradict 已经比 GBrain 更强大（HRR 代数 > 简单图遍历） |
| ❌ 做 LLM-based 实体提取 | 确定性正则够用、零成本、可预测。LLM 提取留给 Hermes 上游决策 |
| ❌ 做 Terax 式终端/编辑器 | CoreyOS 定位是控制平面，不是 IDE |
| ❌ 直接写 Hermes 核心表 | 不写 `facts` / `entities` / `fact_entities`，所有写入走 Hermes tool-call 接口 |
| ❌ 不加 `corey_` 前缀的表 | 避免和 Hermes 未来同名表冲突 |

---

## 与现有架构的关系

| 规则 | 符合情况 |
|---|---|
| HD-1（Check upstream first） | ✅ Hermes 已有 entities/fact_entities，不重建 |
| HD-2（Corey = orchestration） | ✅ CoreyOS 只做 UI + Rust 读取层，智能留在 Hermes |
| HD-4（Skill format follows Hermes） | ✅ P3 enrichment skill 是标准 .md 格式 |
| HD-7（config.yaml writes are additive） | ✅ 不改 Hermes config，CoreyOS 自建表是增量 |
| HD-8（Shared files require atomic writes） | ✅ `corey_*` 表写入走 SQLite WAL，不跨进程抢锁 |
| AC-2（New capabilities land in hook/service first） | ✅ 图查询先做 Rust service，再做 UI |
| PD-2（Stable over feature-rich） | ✅ P1 只激活已有能力，风险极低 |
| CW-3（Data directory is sacred） | ✅ 所有数据在 `~/.hermes/memory_store.db`，不新建目录 |

---

## 衍生 todo

- [x] P1-1：Chat 发消息前自动读 `memory_store.db` 检索相关 facts，注入 context
- [x] P1-2：Memory 页展示 entity 列表（从 `entities` 表读取）+ fact 关联
- [ ] P1-3：中文实体提取正则，提 PR 给 Hermes 上游（`store.py:_extract_entities`）
- [x] P1-4：Chat bubble 显示"已召回 N 条记忆"
- [x] P2-1：`corey_entity_relations` 表 + Rust 图查询 service + IPC
- [ ] P2-2：Entity Pages UI（cards + dossier + React Flow 关系图）
- [x] P2-3：`corey_entity_mentions` 表 + Tier 递进逻辑
- [ ] P3-1：`entity-enrichment.md` Hermes skill
- [ ] P3-2：Dream cycle cron job
- [ ] P3-3：React Flow 图可视化

---

## 实现记录（v1.2）

> 2026-05-12 晚间 session 实现 P1 全部 + P2-1 + P2-3。

### 新增文件 / 改动

| 层 | 文件 | 变更 |
|---|---|---|
| Rust IPC | `src-tauri/src/ipc/hermes_memory.rs` | 新增 `memory_fact_search` / `memory_entity_list` / `memory_entity_facts` / `corey_relation_add` / `corey_graph_query`；新增 `MemoryFactHit` / `MemoryEntity` / `EntityRelation` / `GraphQueryResult` struct；新增 `ensure_corey_tables()` 自动建表 `corey_entity_relations` + `corey_entity_mentions`；新增 `sanitize_fact_query()` FTS5 输入清理 |
| Rust 注册 | `src-tauri/src/lib.rs` | invoke_handler 注册 5 个新 command |
| 前端 IPC | `src/lib/ipc/hermes-config.ts` | 新增 `MemoryFactHit` / `MemoryEntity` / `EntityRelation` / `GraphQueryResult` 类型 + 5 个 invoke 函数 |
| Chat 集成 | `src/features/chat/enrichHistory.ts` | 返回类型从 `ChatMessageDto[]` 改为 `EnrichResult{history, memoryFactCount}`；新增 fact 检索 block（FTS5 search → 注入 system message） |
| Chat 发送 | `src/features/chat/useChatSend.ts` | 解构 `EnrichResult`，`memoryFactCount > 0` 时 patch 到 assistant message |
| Chat 气泡 | `src/features/chat/MessageBubble.tsx` | assistant bubble 下方显示"已召回 N 条记忆"金色标签（Brain icon） |
| 消息类型 | `src/stores/chatTypes.ts` | `UiMessage` 新增 `memoryFactCount?: number` |
| Memory 页 | `src/features/settings/sections/MemorySection.tsx` | 新增 entity 列表面板（点击查看关联 facts，显示 category + trust score） |

### CI 验证

- tsc --noEmit ✅ / cargo check ✅ / cargo fmt ✅ / 555 tests ✅ / pnpm build ✅
