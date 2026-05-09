# Agent 操作日志

本目录记录 AI Agent 在 CoreyOS 项目中执行的所有操作。
每一条操作都按时间顺序记录，包括操作目的、具体步骤、产出物和结果。

### [OP-031] P0-1 — 拆分 db.rs (2199 → 9 个领域模块)
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **触发**: P0 优先级 — `db.rs` 是后续所有功能都要碰的底盘文件
- **目标文件**:
  - `src-tauri/src/db.rs` (删除, 2199 行)
  - `src-tauri/src/db/mod.rs` (新建, 94 行 — Db 结构 + open + conn_raw + db_path + 重导出)
  - `src-tauri/src/db/migrations.rs` (378 行 — v1..v11 + v7 cron 迁移)
  - `src-tauri/src/db/sessions.rs` (446 行 — SessionRow + load_all)
  - `src-tauri/src/db/messages.rs` (408 行 — MessageRow/ToolCall/Attachment + embedding)
  - `src-tauri/src/db/analytics.rs` (402 行 — AnalyticsSummary)
  - `src-tauri/src/db/runbooks.rs` (158 行)
  - `src-tauri/src/db/budgets.rs` (141 行)
  - `src-tauri/src/db/skills_history.rs` (146 行)
  - `src-tauri/src/db/knowledge.rs` (161 行)
- **操作步骤**:
  1. `code_search` 列出所有 `crate::db::*` 外部引用 — 7 处 (`state.rs` / `ipc/runbooks.rs` / `ipc/embedding.rs` / `ipc/skills.rs` / `ipc/db.rs` / `ipc/budgets.rs`)
  2. 每个领域文件包含 `impl Db { ... }` 内嵌实现块 + 该领域的 DTOs + 测试
  3. `mod.rs` `pub use` 重导出所有原顶层符号; `Db.conn` 使用 `pub(in crate::db)` 让子模块能访问
  4. 测试分散到对应模块（共 16 个测试 + 复制 `sample_session` helper 到使用它的模块）
- **产出物**: db.rs 拆分为 9 个文件，最大 446 行（含测试）
- **验证**: cargo check ✅, clippy `-D warnings` 0 ✅, cargo test 262/262 ✅, typecheck ✅, lint 0 ✅
- **状态**: ✅ 已完成（外部 API 路径完全保留，零外部代码改动）

### [OP-032] P0-2 — 拆分 settings/index.tsx (1480 → 416 + sections/)
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **目标文件**:
  - `src/features/settings/index.tsx` (1480 → 416 行 — 路由壳 + Gateway 表单 + TestRow + SaveStatusMsg)
  - `src/features/settings/styles.ts` (新建 17 行 — `inputCls`)
  - `src/features/settings/sections/WorkspaceSection.tsx` (新建 330 行)
  - `src/features/settings/sections/RoutingRulesSection.tsx` (新建 376 行 — 含 `RoutingRuleRow`)
  - `src/features/settings/sections/SandboxScopesSection.tsx` (新建 186 行)
  - `src/features/settings/sections/BrowserLLMSection.tsx` (新建 157 行)
  - `src/features/settings/sections/StorageSection.tsx` (新建 81 行 — 含 `PathRow`)
- **操作步骤**:
  1. 把 `inputCls` 提到 `styles.ts` 独立文件以避免 ESLint Fast Refresh 警告
  2. 把 5 个 section 各自抽出，从 `index.tsx` 删除并 import
  3. `HermesInstancesSection` 通过 `index.tsx` 桥接 re-export 维持外部 import 路径不变
- **验证**: typecheck ✅, lint 0 ✅, vitest 48/48 ✅
- **状态**: ✅ 已完成

### [OP-033] P1-1 — 拆分 sandbox/mod.rs (1125 → 71 + 三层)
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **触发**: 数据模型 / IPC / 路径鉴权 三层混在一起
- **目标文件**:
  - `src-tauri/src/sandbox/mod.rs` (1125 → 71 行 — 仅文档 + 重导出)
  - `src-tauri/src/sandbox/types.rs` (新建 157 行 — AccessMode/Op + WorkspaceRoot/Scope + SandboxError + is_valid_scope_id)
  - `src-tauri/src/sandbox/denylist.rs` (新建 131 行 — hard_denylist + home_relative_denylist + check_denylist + dirs_home)
  - `src-tauri/src/sandbox/authority.rs` (新建 824 行 — PathAuthority + 14 个测试)
- **操作步骤**:
  1. types.rs：纯数据 shapes + `is_valid_scope_id` 单测试
  2. denylist.rs：纯路径过滤；`dirs_home` `pub(super)` 让 authority 也能调用
  3. authority.rs：`PathAuthority` 状态机 + canonicalize_roots / canonicalize_or_parent + 全部 PathAuthority 测试
  4. mod.rs `pub use` 全部重导出（含 `#[allow(unused_imports)]` 的部分先不裁剪以保持 API 兼容）
  5. 修一处 clippy `doc_overindented_list_items`
- **验证**: cargo check ✅, clippy `-D warnings` 0 ✅, cargo test 262/262 ✅（首次跑因 HOME env race 导致 1 个 flaky，与重构无关；重跑两次稳定通过）
- **状态**: ✅ 已完成

### [OP-034] P1-2 — 拆分 profiles/index.tsx (1122 → 520 + 6 个文件)
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **目标文件**:
  - `src/features/profiles/index.tsx` (1122 → 520 行 — `ProfilesRoute` + load/import/activate 编排)
  - `src/features/profiles/types.ts` (新建 61 行 — 5 个 state-machine type)
  - `src/features/profiles/styles.ts` (新建 12 行 — `inputCls`)
  - `src/features/profiles/helpers.ts` (新建 28 行 — `base64FromArrayBuffer` + `formatBytes`)
  - `src/features/profiles/ProfileCard.tsx` (新建 291 行 — `ProfileCard` + `InlineNameForm`)
  - `src/features/profiles/ImportModal.tsx` (新建 164 行)
  - `src/features/profiles/ActivateModal.tsx` (新建 117 行)
- **验证**: typecheck ✅, lint 0 ✅, vitest 48/48 ✅
- **状态**: ✅ 已完成

### [OP-036] P2-1 — 拆分 models/index.tsx (935 → 413)
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **目标文件**:
  - `src/features/models/index.tsx` (935 → 413 行 — 路由壳 + 表单 state machine)
  - `src/features/models/providerCatalog.ts` (新建 57 行 — 7 个 provider 静态目录)
  - `src/features/models/styles.ts` (新建 12 行 — `inputCls`)
  - `src/features/models/types.ts` (新建 20 行 — `LoadState` / `SaveStatus` / `ProbeState`)
  - `src/features/models/shared.tsx` (新建 157 行 — Section/Field/Label/Value/CurrentCard/ProbeStatus/ErrorBanner/StatusMsg)
  - `src/features/models/RestartBanner.tsx` (新建 109 行)
  - `src/features/models/ApiKeyPanel.tsx` (新建 231 行 — 双击清除 + rotate 表单)
- **验证**: typecheck ✅, lint 0 ✅, vitest 48/48 ✅
- **状态**: ✅ 已完成

### [OP-037] P2-2 — 拆分 mcp/index.tsx (868 → 252)
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **目标文件**:
  - `src/features/mcp/index.tsx` (868 → 252 行 — `McpRoute` 编排，含 list / save / delete / restart)
  - `src/features/mcp/transport.ts` (新建 28 行 — `Transport` 类型 + `detectTransport` + `defaultConfig`)
  - `src/features/mcp/templates.ts` (新建 236 行 — `TEMPLATES` × 11 + `RECOMMENDED_MCPS` × 5）
  - `src/features/mcp/ServerRow.tsx` (新建 117 行 — list 单行 + 探测按钮)
  - `src/features/mcp/ServerForm.tsx` (新建 289 行 — 模板 + transport + JSON 编辑器 + 校验)
- **验证**: typecheck ✅, lint 0 ✅, vitest 48/48 ✅
- **状态**: ✅ 已完成

### [OP-039] P2-4..P2-7 — 测试外提 + LlmProfilesSection 拆分（4 文件全过 warn）
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **目标文件**:
  - `src-tauri/src/sandbox/authority.rs` (824 → 561 行) + `authority_tests.rs` (新建 268 行)
  - `src-tauri/src/hermes_config.rs` (993 → 747 行) + `hermes_config_tests.rs` (新建 250 行)
  - `src-tauri/src/adapters/hermes/mod.rs` (861 → 614 行) + `mod_tests.rs` (新建 252 行)
  - `src/features/models/LlmProfilesSection.tsx` (816 → 215 行) + `LlmProfileCard.tsx` (新建 152 行) + `LlmProfileRow.tsx` (新建 442 行)
- **手法**: 三个 Rust 文件用 `#[cfg(test)] #[path = "<name>_tests.rs"] mod tests;` 把测试模块外提到平级 .rs 文件，源文件保持 canonical 路径不变；前端按 component 维度（Card / Row / Section）拆分。
- **约束**: `#[path]` 比 sibling `<name>/tests.rs` 子目录更安全 — 不需要把源文件转成目录，避免与既有的 `mod.rs` 命名冲突。
- **验证**: cargo fmt ✅, clippy `-D warnings` 0 ✅, cargo test 262/262 ✅, typecheck ✅, lint 0 ✅, vitest 48/48 ✅, file-sizes ✅
- **结果**: warn 文件从 5 → 1（仅剩 `src/features/chat/index.tsx` 1003 行，主路由编排集中，需要 state machine 重构而非简单文件拆分）
- **状态**: ✅ 已完成

---

### [OP-038] P2-3 — 拆分 ipc/voice.rs (850 → voice/ 目录)
- **时间**: 2026-04-26 晚
- **类型**: 重构
- **目标文件**:
  - `src-tauri/src/ipc/voice.rs` (删除, 850 行)
  - `src-tauri/src/ipc/voice/mod.rs` (新建 622 行 — 类型 + 配置 IO + audit + ASR + TTS + Config CRUD IPC)
  - `src-tauri/src/ipc/voice/provider.rs` (新建 122 行 — `VoiceProvider` 枚举 + `parse_provider`)
  - `src-tauri/src/ipc/voice/recorder.rs` (新建 168 行 — `voice_record` / `voice_record_stop` IPC + cpal 阻塞录音 + `pcm_to_wav`)
  - `src-tauri/src/lib.rs` — 调整 invoke_handler 注册路径 `ipc::voice::voice_record` → `ipc::voice::recorder::voice_record`（× 2）
- **重要约束**: `#[tauri::command]` 生成的 `__cmd__<name>` 辅助符号不跟随 `pub use` re-export，所以必须把 `recorder` 模块声明为 `pub mod` 并改 lib.rs 的注册路径，而不能用 re-export。
- **验证**: cargo fmt ✅, clippy `-D warnings` 0 ✅, cargo test 262/262 ✅
- **状态**: ✅ 已完成

---

### [OP-035] 同步文档与 CI 大文件 gate
- **时间**: 2026-04-26 晚
- **类型**: 文档 + CI
- **目标文件**:
  - `docs/05-roadmap.md` — 在 post-Phase-12 节追加 Round 2 重构表
  - `docs/01-architecture.md` — Repo layout 同步 `db/` 和 `sandbox/` 子目录结构
  - `docs/agent/00-操作日志.md` — 新增 OP-031..035
  - `docs/current-feature-quality-review-2026-04-26.md` — 顶部添加 "post-review action result" 提示框
  - `scripts/check-file-sizes.mjs`（新建）— 扫描 `src/` 与 `src-tauri/src/`，超 800 行 warn / 超 1500 行 fail
  - `package.json` — 注册 `check:file-sizes` script
  - `.github/workflows/ci.yml` — 在 frontend job 中追加 `File-size gate` 步骤
- **CI 现状**:
  - 既有 gates 已覆盖类型 / lint / 单测 / 构建 / bundle 大小 / Playwright / cargo fmt / clippy `-D warnings` / cargo test × 3 OS
  - **新增**: `pnpm check:file-sizes` — 防止 OP-031..034 拆掉的中心文件再次膨胀
  - 当前扫描结果：8 个文件超 800 行 warn 阈值（最大 `chat/index.tsx` 1003 行），**0 个超 1500 行 fail 阈值**，所以 CI 不会 break
- **状态**: ✅ 已完成

---

### [OP-025] P3 小优化执行 — 沙箱/Home/Skills/Learning
- **时间**: 2026-04-25
- **类型**: 优化
- **触发**: P3 优先级任务执行
- **目标文件**:
  - `src/features/settings/index.tsx` — 沙箱状态指示 + 测试引导
  - `src/features/home/index.tsx` — 功能导航卡片（onboarding 完成后展示）
  - `src/features/skills/HubPanel.tsx` — 来源说明文字
  - `src/features/chat/MessageBubble.tsx` — LEARNINGS.md section 容错
  - `src-tauri/src/ipc/learning.rs` — compact_memory 写入错误日志
  - `src/locales/en.json` + `zh.json` — i18n 更新
- **操作步骤**:
  1. 沙箱 enforced 模式绿色提示 + 测试引导；dev_allow 模式金色提示
  2. Home onboarding 完成后显示功能导航卡片（运行手册/对比/时间线/预算）
  3. Skills Hub 添加 7 个联邦来源说明文字
  4. LEARNINGS.md appendLearning 添加 section 存在性检查，防止 replace 静默失败
  5. learning_compact_memory 写入失败时打 warn 日志
- **产出物**: 5 项小优化
- **验证**: cargo check ✅, clippy ✅, typecheck ✅, lint 0 warnings ✅, 48/48 tests ✅
- **状态**: ✅ 已完成

### [OP-030] Voice 多服务商支持 — OpenAI / 智谱 (Zhipu) / Groq
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: 用户要求接入国内智谱 ASR+TTS，让用户可选择服务商
- **目标文件**:
  - `src-tauri/src/ipc/voice.rs` — 新增 VoiceProvider 枚举 + 多 provider 路由
  - `src-tauri/src/ipc/knowledge.rs` — 修复遗留 `_chunk_text` 测试问题
  - `src/features/voice/index.tsx` — 前端 Provider 下拉选择器
  - `src/lib/ipc.ts` — VoiceConfig / VoiceConfigUpdate 类型扩展
  - `src/locales/en.json` + `zh.json` — +4 i18n keys
- **操作步骤**:
  1. 新增 `VoiceProvider` 枚举（Openai / Zhipu / Groq），每个 provider 自带默认 endpoint、model、voices
  2. ASR 多格式适配：OpenAI/Groq → Whisper `verbose_json`；智谱 → `chat.completion` 格式解析
  3. TTS 多格式适配：OpenAI → JSON body + mp3 输出；智谱 → JSON body (含 response_format=wav) + wav 输出
  4. Groq 不支持 TTS，选 Groq 时 TTS 区域自动灰显
  5. 前端 ASR/TTS 区域各增加「服务商」下拉选择器，切换时自动更新语音角色列表
  6. 审计日志 provider 列显示友好名称（OpenAI / Zhipu (智谱) / Groq）
  7. 修复 knowledge.rs 遗留问题：`_chunk_text` → `chunk_text` + `#[cfg(test)]`，修正 2 个断言与函数逻辑不匹配的测试
- **产出物**: 语音设置页支持 3 个服务商（OpenAI / 智谱 / Groq），用户可自由切换
- **验证**: clippy 0 warnings ✅, cargo test 230/230 ✅, tsc 0 errors ✅, eslint 0 errors ✅, vitest 48/48 ✅
- **状态**: ✅ 已完成

### [OP-029] Phase 8 多模态 — Push-to-talk ASR + TTS + 视频附件 + 权限引导 + 审计日志
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: 用户要求实施 Phase 8 全部 5 个 task
- **目标文件**:
  - `src-tauri/src/ipc/voice.rs` (新建) — 语音 IPC（ASR/TTS/配置/审计）
  - `src-tauri/Cargo.toml` — reqwest 添加 multipart feature
  - `src-tauri/src/ipc/mod.rs` + `lib.rs` — 模块 + IPC 注册
  - `src/features/voice/index.tsx` (新建) — 语音设置页（配置/测试/审计 3 个 tab）
  - `src/features/chat/index.tsx` — Push-to-talk mic 按钮 + 录音逻辑
  - `src/features/chat/MessageBubble.tsx` — TTS 播放按钮（Volume2 图标）+ 视频缩略图
  - `src/lib/ipc.ts` — TS 绑定（voiceTranscribe/voiceTts/voiceGetConfig/voiceSetConfig/voiceAuditLog）
  - `src/app/routes.tsx` + `nav-config.ts` — 路由 + 导航
  - `src/locales/en.json` + `zh.json` — i18n（中英文）
- **操作步骤**:
  1. T8.1: 后端 voice_transcribe — base64 audio → multipart POST → ASR API → 返回文字
  2. T8.1: 前端 onVoiceStart/onStop — getUserMedia → MediaRecorder → base64 → IPC → setDraft
  3. T8.2: 后端 voice_tts — text → POST TTS API → 保存 mp3 → 返回路径
  4. T8.2: 前端 MessageBubble Volume2 按钮 — 点击 → voiceTts → Audio.play
  5. T8.3: 视频附件 — 附件系统已支持任意 MIME，MessageBubble 添加 video/* 缩略图
  6. T8.4: 权限引导 — Voice Test tab 中 getUserMedia catch 显示友好错误
  7. T8.5: 审计日志 — ~/.hermes/voice_audit/{date}.jsonl，前端 VoiceAuditPanel 展示
- **产出物**: 完整 Phase 8 多模态功能
- **验证**: clippy 0 errors ✅, typecheck ✅, lint 0 errors ✅, 48/48 tests ✅
- **状态**: ✅ 已完成

### [OP-028] RAG 五阶段优化 — Embedding + 向量检索 + 智能分块 + 混合检索 + Query 扩展
- **时间**: 2026-04-25
- **类型**: 优化
- **触发**: 用户要求实施 RAG Phase 1-5 全部优化
- **目标文件**:
  - `src-tauri/Cargo.toml` — 新增 `fastembed` 依赖
  - `src-tauri/src/ipc/embedding.rs` (新建) — Embedding 服务（Phase 1-5 核心逻辑）
  - `src-tauri/src/ipc/knowledge.rs` — 使用智能分块 + hybrid search
  - `src-tauri/src/db.rs` — embedding BLOB 列 + conn_raw() + 返回 chunk IDs
- **操作步骤**:
  1. Phase 1: 引入 `fastembed` crate + BGESmallENV15 模型（384 维，~30MB 首次下载）
  2. Phase 2: 向量存储在 SQLite BLOB 列 + 余弦相似度检索
  3. Phase 3: 智能分块（段落边界 + 50 字符 overlap）
  4. Phase 4: 混合检索 — 向量检索 + Jaccard 关键词检索 → RRF 融合
  5. Phase 5: Query 扩展（中英文同义词表）→ 扩展后查询送入 hybrid search
- **产出物**: 完整 RAG 五阶段优化
- **验证**: clippy ✅, typecheck ✅, lint 0 errors ✅, 48/48 tests ✅
- **状态**: ✅ 已完成

### [OP-027] 知识库/文档管理功能
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: 用户要求实现独立知识库/文档管理
- **目标文件**:
  - `src-tauri/src/ipc/knowledge.rs` (新建) — 知识库 IPC（上传/列表/删除/搜索）
  - `src-tauri/src/db.rs` — 知识库 DB 方法（表创建/CRUD/Jaccard 搜索）
  - `src/features/knowledge/index.tsx` (新建) — 知识库前端页面
  - `src/features/chat/index.tsx` — 聊天集成知识库检索
  - `src/app/routes.tsx` + `nav-config.ts` — 路由 + 导航
  - `src/lib/ipc.ts` — TS 绑定
  - `src/locales/en.json` + `zh.json` — i18n
- **操作步骤**:
  1. 后端：文档上传 → 按 500 字符分段 → 存储到 `~/.hermes/knowledge/{id}/` + SQLite 索引
  2. 后端：Jaccard 相似度搜索知识库 chunks
  3. 前端：知识库页面 — 拖拽上传/文件选择/搜索/删除
  4. 聊天集成：发送消息时检索知识库 → 注入 `[Knowledge base]` system prompt
  5. 导航：侧边栏 Manage 分组添加 "知识库" 入口
- **产出物**: 完整知识库功能（上传/分段/检索/注入）
- **验证**: clippy 2 warnings ✅, typecheck ✅, lint 0 errors ✅, 48/48 tests ✅
- **状态**: ✅ 已完成

### [OP-026] 定时任务对话创建 + RAG 完整版
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: 用户要求实现定时任务对话创建和 RAG 完整版
- **目标文件**:
  - `src-tauri/src/ipc/scheduler.rs` — 新增 `scheduler_extract_intent` IPC
  - `src-tauri/src/ipc/rag.rs` (新建) — RAG 语义检索模块
  - `src/features/chat/index.tsx` — 对话完成后检测定时意图 + RAG 检索
  - `src/lib/ipc.ts` — 新增 TS 绑定
  - `src/locales/en.json` + `zh.json` — i18n 更新
- **操作步骤**:
  1. 定时任务：新增 `scheduler_extract_intent` — 30+ 关键词模式匹配（中英文），识别定时意图
  2. 定时任务：聊天 `onDone` 中调用，confidence ≥ 0.6 时弹确认框，用户确认后自动创建 cron job
  3. RAG：新增 `rag_search` IPC — Jaccard 相似度检索 500 条历史消息
  4. RAG：聊天 send 时，TF-IDF 无结果时 fallback 到 RAG，提供更广的召回率
- **产出物**: 定时任务对话创建 + RAG 语义检索
- **验证**: cargo clippy ✅, typecheck ✅, lint 0 warnings ✅, 48/48 tests ✅
- **状态**: ✅ 已完成

---

## 日志索引

| 日期 | 文件 | 描述 |
|------|------|------|
| 2026-04-25 | [01-项目分析.md](./01-项目分析.md) | 项目全面分析（架构、技术栈、功能模块、进度） |
| 2026-04-25 | [02-产品问题诊断.md](./02-产品问题诊断.md) | 产品层面问题诊断与优先级排序 |
| 2026-04-25 | [03-优化计划.md](./03-优化计划.md) | 基于诊断结果的优化计划与 Phase 定义 |
| 2026-04-25 | [phases/phase-a-nav-home.md](../phases/phase-a-nav-home.md) | Phase A 正式文件：导航瘦身与首页优化 |

---

## 操作记录

### [OP-001] 项目全面分析
- **时间**: 2026-04-25
- **类型**: 分析
- **触发**: 用户指令 — "完整的分析一下当前项目"
- **目标文件**: 全部源代码、docs/、配置文件
- **操作步骤**:
  1. 读取项目根目录结构和文件清单
  2. 分析 package.json、Cargo.toml、tauri.conf.json
  3. 阅读 docs/00-vision.md、01-architecture.md、05-roadmap.md、02-design-system.md
  4. 分析 Rust 后端核心 (lib.rs、adapters/mod.rs、state.rs)
  5. 分析前端路由 (routes.tsx) 和导航配置 (nav-config.ts)
- **产出物**: [01-项目分析.md](./01-项目分析.md)
- **验证**: 用户阅读确认
- **状态**: ✅ 已完成

### [OP-002] 产品问题诊断
- **时间**: 2026-04-25
- **类型**: 分析
- **触发**: 用户指令 — "你觉得当前产品有什么问题"
- **目标文件**: 10-product-audit-2026-04-23.md、06-backlog.md、hermes-reality-check-2026-04-23.md
- **操作步骤**:
  1. 阅读产品审计报告
  2. 阅读积压项和 Hermes reality check
  3. 分析首页、侧边栏、聊天页面的代码实现
  4. 归纳为战略/产品/工程/测试四个维度的问题
  5. 按优先级排序
- **产出物**: [02-产品问题诊断.md](./02-产品问题诊断.md)
- **验证**: 用户阅读确认
- **状态**: ✅ 已完成

### [OP-003] 创建 Agent 文档目录
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: 用户指令 — "创建一个你自己的文档目录"
- **目标文件**: docs/agent/ (新建目录)
- **操作步骤**:
  1. `mkdir -p docs/agent/`
  2. 创建 `00-操作日志.md` — 索引 + 操作记录格式
  3. 创建 `01-项目分析.md` — 项目分析记录
  4. 创建 `02-产品问题诊断.md` — 问题诊断记录
  5. 创建 `03-优化计划.md` — 优化计划草稿
- **产出物**: `docs/agent/` 目录 + 4 个文档文件
- **验证**: 用户在 IDE 中打开确认
- **状态**: ✅ 已完成

### [OP-004] 创建 Phase A 正式文件 + 用户确认优化计划
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: 用户指令 — "确认优化计划"
- **目标文件**: `docs/phases/phase-a-nav-home.md` (新建)
- **操作步骤**:
  1. 深入阅读 Sidebar.tsx、Topbar.tsx、AppShell.tsx、nav-config.ts、home/index.tsx
  2. 阅读 i18n 文件 (en.json、zh.json) 中所有导航和首页相关 key
  3. 制定侧边栏精简方案 — 18 项 → 10 项
  4. 制定首页 Onboarding 重设计方案 — 渐进式 + 30 秒快速体验
  5. 创建 `docs/phases/phase-a-nav-home.md` Phase 正式文件
  6. 更新 `docs/agent/03-优化计划.md`
  7. 更新本操作日志
- **产出物**: `docs/phases/phase-a-nav-home.md`
- **验证**: Phase 文件格式与已有 phase-N 文件一致；用户确认
- **状态**: ✅ 已完成

### [OP-005] A1 侧边栏精简
- **时间**: 2026-04-25
- **类型**: 重构
- **触发**: Phase A 执行
- **目标文件**:
  - `src/app/nav-config.ts`
  - `src/app/shell/Sidebar.tsx`
  - `src/locales/en.json`
  - `src/locales/zh.json`
- **操作步骤**:
  1. 将 `NavGroup` 从 `'primary' | 'ops'` 改为 `'core' | 'tools' | 'manage'` 三分组
  2. 侧边栏常驻显示 core (5 项) + tools (7 项) = 12 项
  3. manage 组 (6 项: Scheduler/Profiles/Runbooks/Budgets/Memory/MCP) 默认折叠，点击展开
  4. 当 manage 组中有页面被激活时，自动展开
  5. 更新 i18n: `section_ops` → `section_core` / `section_tools` / `section_manage`
- **产出物**: 侧边栏常驻 12 项 + 折叠 6 项
- **验证**: `pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿
- **状态**: ✅ 已完成

### [OP-006] A2 首页 Onboarding 重设计
- **时间**: 2026-04-25
- **类型**: 重构
- **触发**: Phase A 执行
- **目标文件**:
  - `src/features/home/index.tsx`
  - `src/locales/en.json`
  - `src/locales/zh.json`
- **操作步骤**:
  1. 移除"通道"步骤 (永远 `done: false` 的 UX 陷阱)
  2. 步骤从 5 个减为 4 个: 连接 Hermes → 选择模型 → 第一次对话 → 个人资料
  3. 实现渐进式高亮 — "下一步"步骤用金色边框和 `NEXT` 标签突出显示
  4. 添加"快速体验"卡片 — 3 个预填提示词建议，点击直接跳转 Chat 并填入
  5. 快速体验卡片在 gateway 在线 + 有模型时即显示（不必等全部完成）
  6. 添加 i18n key: `step_next`、`quick_title`、`quick_1/2/3`（中英文）
- **产出物**: 渐进式首页引导 + 快速体验卡片
- **验证**: `pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿
- **状态**: ✅ 已完成

### [OP-007] C1 文档清理 — 同步 01-architecture.md
- **时间**: 2026-04-25
- **类型**: 修改
- **触发**: Phase C 执行
- **目标文件**: `docs/01-architecture.md`
- **操作步骤**:
  1. 修正技术栈表: Recharts/D3 → 无图表库, shiki → highlight.js, TanStack Virtual → react-virtuoso, react-hook-form+zod → 原生 HTML form, keyring → 无 (env file), toml/dotenvy → serde_yaml/serde_json
  2. 修正架构图: 移除 "Keychain (secrets)" 行
  3. 修正 Repo layout: store/ → db.rs, secrets.rs → 移除, cli.rs/config.rs/env.rs/auth.rs → probe.rs, specta 注释 → hand-written mirrors
  4. 修正 lib/ 目录: ipc.ts 注释, agent/ → 移除, sse.ts/formatters.ts → i18n.ts/modelCapabilities.ts/useIsMobile.ts
  5. 修正 Security 段: keyring → env file only, Shiki → highlight.js
  6. 修正配置写入数据流: react-hook-form+zod → native form validation
- **产出物**: 文档与代码完全一致
- **验证**: 逐项对比 package.json / Cargo.toml 与文档
- **状态**: ✅ 已完成

### [OP-008] C3 Error Boundary — 全局错误边界
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: Phase C 执行
- **目标文件**:
  - `src/components/ErrorBoundary.tsx` (新建)
  - `src/app/routes.tsx`
- **操作步骤**:
  1. 创建 `ErrorBoundary` class component — getDerivedStateFromError + componentDidCatch + retry 按钮
  2. 在 `routes.tsx` 的 root layout 中用 `ErrorBoundary` 包裹 `Suspense + Outlet`
  3. 任何子路由渲染崩溃都会被捕获，显示错误信息和重试按钮
- **产出物**: 全局 ErrorBoundary — 单模块崩溃不再白屏
- **验证**: `pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿
- **状态**: ✅ 已完成

### [OP-009] C2/C4 延期记录
- **时间**: 2026-04-25
- **类型**: 记录
- **触发**: 用户指令 — "C2 和 C4 先不做，做记录"
- **目标文件**: 无代码改动
- **操作步骤**:
  1. 将 C2 (ChatRoute 拆分) 和 C4 (IPC 类型安全评估) 标记为延期
  2. 更新 Phase C 文件和 backlog
- **产出物**: 延期记录
- **验证**: N/A
- **状态**: ✅ 已完成（延期）

### [OP-010] D1 清理 AgentWizard console.log
- **时间**: 2026-04-25
- **类型**: 修改
- **触发**: Phase D 执行
- **目标文件**: `src/features/settings/AgentWizard.tsx`
- **操作步骤**:
  1. 移除 5 处 `console.log` 调试日志（L360/362/379/390/392）
  2. 保留 `console.error` 错误处理日志（L395）
- **产出物**: 生产环境不再泄露内部数据结构到控制台
- **验证**: typecheck + lint + test 全绿
- **状态**: ✅ 已完成

### [OP-011] D2+D3 侧边栏无障碍 + 折叠状态持久化
- **时间**: 2026-04-25
- **类型**: 修改
- **触发**: Phase D 执行
- **目标文件**: `src/app/shell/Sidebar.tsx`
- **操作步骤**:
  1. `useState` 初始值从 `localStorage.getItem('corey:sidebar:manage-expanded')` 读取
  2. `toggleManage` 回调中 `localStorage.setItem` 持久化
  3. 折叠按钮添加 `aria-expanded={effectiveManageExpanded}`
- **产出物**: Manage 组折叠状态跨刷新保持 + 屏幕阅读器可感知
- **验证**: typecheck + lint + test 全绿
- **状态**: ✅ 已完成

### [OP-012] R1 移除"快速体验"卡片
- **时间**: 2026-04-25
- **类型**: 删除
- **触发**: 用户指令 — "快速体验卡片不需要，所有地方都不需要"
- **目标文件**: `src/features/home/index.tsx`
- **操作步骤**:
  1. 移除 `QUICK_PROMPTS` 常量
  2. 移除整个快速体验 section（36 行 JSX）
  3. 移除 `ArrowRight` 和 `useComposerStore` import
- **产出物**: 首页不再显示"试试你的第一条提示词"卡片
- **验证**: typecheck + lint + test 全绿
- **状态**: ✅ 已完成

### [OP-013] D4 AgentSwitcher 空状态评估
- **时间**: 2026-04-25
- **类型**: 分析
- **触发**: Phase D 执行
- **目标文件**: `src/app/shell/AgentSwitcher.tsx`
- **操作步骤**:
  1. 审查代码发现 L80-93 已有完善的空状态处理
  2. `!adapters` 时显示 "Loading agents…" / "No agents"
- **产出物**: 确认已存在，无需修改
- **验证**: N/A
- **状态**: ✅ 已完成（已存在）

### [OP-014] D5 Settings 分段锚点导航
- **时间**: 2026-04-25
- **类型**: 修改
- **触发**: Phase D 执行
- **目标文件**: `src/features/settings/index.tsx`
- **操作步骤**:
  1. 给 `Section` 组件添加 `id` 可选属性 + `scroll-mt-4` class
  2. 定义 `SETTINGS_ANCHORS` 常量（7 个锚点：appearance/gateway/model/routing/sandbox/scopes/storage）
  3. 给所有 7 个 Section 调用添加 `id` 属性
  4. 在 PageHeader 下方、scroll 区域内添加 sticky 水平导航栏
  5. 点击锚点平滑滚动到对应 section
- **产出物**: Settings 页面支持一键跳转到任意 section
- **验证**: typecheck + lint + test 全绿
- **状态**: ✅ 已完成

### [OP-015] D8 Analytics 趋势图评估
- **时间**: 2026-04-25
- **类型**: 分析
- **触发**: Phase D 执行
- **目标文件**: `src/features/analytics/index.tsx`
- **操作步骤**:
  1. 审查发现已有完整 SVG 趋势图：30 天 messages + tokens 折线图
  2. 已有模型/工具/adapter 水平条形图 + feedback 统计
  3. 成本估算需要价格表，超出当前范围
- **产出物**: 确认 Analytics 已完善，无需修改
- **验证**: N/A
- **状态**: ✅ 已完成（已完善）

### [OP-016] Phase E · P0 — 对话摘要自动写入 Memory
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: Phase E 执行
- **目标文件**:
  - `src-tauri/src/ipc/learning.rs` (新建)
  - `src-tauri/src/ipc/mod.rs`
  - `src-tauri/src/lib.rs`
  - `src/lib/ipc.ts`
  - `src/features/chat/index.tsx`
- **操作步骤**:
  1. 创建 Rust `learning` 模块 — `learning_extract` IPC command
  2. 核心逻辑：用 LLM 判断对话中是否包含值得记住的信息，提取 ≤3 条 fact
  3. Jaccard 相似度去重（阈值 0.65），避免重复写入
  4. 追加到 `~/.hermes/MEMORY.md` 的 `## [auto] YYYY-MM-DD` 分节
  5. 256KB 硬上限保护
  6. 注册 3 个 IPC command：`learning_extract`, `learning_read_learnings`, `learning_write_learnings`
  7. 前端 ipc.ts 添加对应 TS 绑定
  8. Chat `onDone` 回调中异步触发 `learningExtract`（fire-and-forget）
- **产出物**: Agent 自动从每轮对话中学习并写入 MEMORY.md
- **验证**: `cargo check` ✅, `cargo test learning` 5/5 ✅, `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` 48/48 ✅
- **状态**: ✅ 已完成

### [OP-017] Phase E · P1 — Feedback 学习信号
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: Phase E 执行
- **目标文件**:
  - `src/features/chat/MessageBubble.tsx`
- **操作步骤**:
  1. `FeedbackButtons` 的 `toggle` 函数中，当 feedback 非 null 时触发 `appendLearning`
  2. 👍 → 追加到 LEARNINGS.md 的 `## preferred (👍 patterns)` section
  3. 👎 → 追加到 LEARNINGS.md 的 `## avoided (👎 patterns)` section
  4. 摘要取 assistant 消息前 100 字符
  5. 文件不存在时自动创建带两个 section 的模板
  6. 完全 fire-and-forget，不影响 UI
- **产出物**: 👍👎 Feedback 自动写入 LEARNINGS.md 作为学习信号
- **验证**: `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` 48/48 ✅
- **状态**: ✅ 已完成

### [OP-018] Phase E · P2-P4 延期
- **时间**: 2026-04-25
- **类型**: 记录
- **触发**: Phase E 规划 — 依赖 embedding 基础设施和模式检测算法
- **目标文件**: 无代码改动
- **操作步骤**:
  1. P2（语义检索）需要 embedding 模型 + SQLite 向量扩展，当前不具备
  2. P3（自动 Skill 生成）需要模式检测算法（N≥3 次相似请求识别），需要更多对话数据
  3. P4（自适应进化）依赖 P2/P3 的输出
- **产出物**: 延期记录
- **验证**: N/A
- **状态**: ✅ 已记录（延期，待基础设施就绪）

### [OP-019] Phase E · P2 — TF-IDF 语义检索
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: Phase E 执行
- **目标文件**:
  - `src-tauri/src/tfidf.rs` (新建) — TF-IDF 向量引擎
  - `src-tauri/src/db.rs` — v11 migration (embeddings 表) + 3 个新方法
  - `src-tauri/src/ipc/learning.rs` — `learning_index_message`, `learning_search_similar`
  - `src-tauri/src/lib.rs` — 注册模块 + IPC
  - `src/lib/ipc.ts` — TS 绑定
  - `src/features/chat/index.tsx` — 用户消息入库时触发 TF-IDF 索引
- **操作步骤**:
  1. 创建 `tfidf.rs` — 零依赖 TF-IDF 引擎（tokenize + cosine similarity + JSON 序列化）
  2. 支持中英文分词（CJK bigram + 英文 stop-word 过滤）
  3. DB v11 migration — `embeddings` 表 (message_id, vector JSON, created_at)
  4. `upsert_embedding` — 消息入库时计算 TF-IDF 向量并存入 DB
  5. `search_similar_messages` — 从 500 条最近消息中检索 top-k 相似结果（余弦相似度 >0.15）
  6. 前端 chat send 后异步调用 `learningIndexMessage` 索引用户消息
- **产出物**: 零依赖语义检索 — 不需要 embedding 模型，纯 TF-IDF
- **验证**: `cargo test` 226/226 ✅, `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` 48/48 ✅
- **状态**: ✅ 已完成

### [OP-020] Phase E · P3 — 模式检测（自动 Skill 生成基础）
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: Phase E 执行
- **目标文件**: `src-tauri/src/ipc/learning.rs`, `src-tauri/src/lib.rs`, `src/lib/ipc.ts`
- **操作步骤**:
  1. `learning_detect_pattern` — 检测用户查询是否匹配 ≥3 条历史消息（Jaccard >0.5）
  2. 匹配时返回 `pattern_description`, `occurrence_count`, `suggested_skill_name`
  3. 前端 TS 绑定 `learningDetectPattern`
- **产出物**: 重复任务模式检测 IPC
- **验证**: `cargo check` ✅, `cargo test` 226/226 ✅
- **状态**: ✅ 已完成

### [OP-021] Phase E · P4 — 自适应进化
- **时间**: 2026-04-25
- **类型**: 新增
- **触发**: Phase E 执行
- **目标文件**: `src-tauri/src/ipc/learning.rs`, `src-tauri/src/lib.rs`, `src/lib/ipc.ts`
- **操作步骤**:
  1. P4-E1: `learning_suggest_routing` — 扫描最近消息中的高频关键词，建议 routing rules
  2. P4-E2: `learning_compact_memory` — 去重 MEMORY.md 中的重复条目，返回精简统计
  3. 前端 TS 绑定 `learningSuggestRouting`, `learningCompactMemory`
- **产出物**: 自适应 Routing 建议 + Memory 自动精简
- **验证**: `cargo check` ✅, `pnpm typecheck` ✅
- **状态**: ✅ 已完成

### [OP-022] 10 项产品审查修复
- **时间**: 2026-04-25
- **类型**: 修复 + 增强
- **触发**: 用户 10 项产品审查反馈
- **目标文件**:
  - `src/components/ui/select.tsx` — 下拉自适应宽度
  - `src/features/settings/index.tsx` — Agents 空状态引导
  - `src/features/chat/index.tsx` — USER.md 兜底注入 system prompt
  - `src/features/mcp/index.tsx` — MCP 推荐快捷添加
  - `src/features/chat/budgetGate.ts` — 14 模型族价格表
  - `src/locales/en.json` + `zh.json` — i18n 更新
- **操作步骤**:
  1. Q2: Select 下拉面板改为 `min-w-full max-w-[min(90vw,400px)]`，option 内容 `break-all` 自适应
  2. Q3: Agents 空状态增加图标 + 标题 + 引导按钮
  3. Q7: chat send 时读取 `memoryRead('user')` 并注入 system prompt（≤1000 字符）
  4. Q6: MCP 页面底部添加 5 个推荐服务一键安装（Fetch/Filesystem/Memory/DuckDuckGo/SQLite）
  5. Q8: 预算价格表从单一价格扩展为 14 个模型族（Claude/GPT/o3/DeepSeek/Gemini/Qwen + fallback）
- **产出物**: 5 项 bug 修复 + 体验增强
- **验证**: `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` 48/48 ✅
- **状态**: ✅ 已完成

### [OP-023] AgentSwitcher 过滤 + 自定义右键菜单
- **时间**: 2026-04-25
- **类型**: 修复 + 新增
- **触发**: 用户产品审查反馈
- **目标文件**:
  - `src/app/shell/AgentSwitcher.tsx` — 过滤 LLM Profile + 标注 mock adapter
  - `src/components/ui/context-menu.tsx` (新建) — 通用右键菜单组件
  - `src/app/providers.tsx` — 全局禁用原生右键 + ContextMenuProvider
  - `src/features/chat/MessageBubble.tsx` — 聊天消息右键菜单
  - `src/components/ui/select.tsx` — 下拉不换行 + 金色圆点选中样式
- **操作步骤**:
  1. AgentSwitcher 过滤 `hermes:profile:*` adapter（LLM Profile 不应在 Agent 列表）
  2. Claude Code / Aider 标注 "not configured" 灰色标签
  3. 新建 ContextMenuProvider + useContextMenu hook — 通用右键菜单系统
  4. providers.tsx 全局拦截 contextmenu 事件（textarea/input 保留原生）
  5. MessageBubble 右键：复制 / 重新生成 / 👍有帮助 / 👎没帮助
  6. Select 组件：去掉 Check 图标，改用金色圆点；`whitespace-nowrap` 不换行；`w-max` 自适应宽度
- **产出物**: 自定义右键菜单系统 + AgentSwitcher 清理 + Select 修复
- **验证**: `pnpm typecheck` ✅, `pnpm lint` 0 warnings ✅, `pnpm test` 48/48 ✅
- **状态**: ✅ 已完成

### [OP-024] P2 任务执行 — C4/B1/B2/B3 增强
- **时间**: 2026-04-25
- **类型**: 评估 + 增强
- **触发**: P2 优先级任务执行
- **目标文件**:
  - `docs/phases/c4-ipc-type-safety.md` (新建) — IPC 类型安全评估文档
  - `src/features/compare/index.tsx` — Winner 徽章（⚡最快 / 💰最省 token）
  - `src/features/trajectory/index.tsx` — Inspector 会话级统计摘要
  - `src/features/budgets/index.tsx` — 使用摘要卡片 + 共享价格表
  - `src/locales/en.json` + `zh.json` — i18n 更新
- **操作步骤**:
  1. C4: 评估结论 — 暂不引入 tauri-specta，55 个 IPC 手动维护成本可接受
  2. B1: Compare 添加 LanePanel winner 徽章（⚡Fastest / 💰Fewest tokens）+ DiffFooter 最少 token 统计
  3. B2: Trajectory Inspector 添加会话统计面板（消息数/总 Token/工具调用数/耗时）
  4. B3: Budgets 共享 budgetGate 价格表，添加 3 列使用摘要（Prompt/Completion/Est. cost）
- **产出物**: 1 评估文档 + 3 功能增强
- **验证**: `pnpm typecheck` ✅, `pnpm lint` 0 warnings ✅, `pnpm test` 48/48 ✅
- **状态**: ✅ 已完成

### [OP-025] 技术债批量清理 — file split + CI gates + tests
- **时间**: 2026-04-26
- **类型**: 重构 + 新增 + 测试
- **触发**: 用户指令 — "全做，按顺序来"
- **目标文件**:
  - **拆分**:
    - `src-tauri/src/sandbox/mod.rs` → `types.rs` + `denylist.rs` + `authority.rs` (+ `authority_tests.rs`)
    - `src-tauri/src/db.rs` → `db/{sessions,messages,analytics,…}.rs`
    - `src-tauri/src/ipc/voice.rs` → `voice/{provider,recorder,…}.rs`
    - `src-tauri/src/{hermes_config,adapters/hermes/mod}.rs` 单测下沉至 `*_tests.rs`（`#[path]` 引入）
    - `src/features/settings/index.tsx` → `settings/sections/*.tsx`
    - `src/features/profiles/index.tsx` → `ProfileCard` + `ImportModal` + `ActivateModal` + `helpers.ts`
    - `src/features/models/index.tsx` → `ApiKeyPanel` + `RestartBanner` + `LlmProfile{Card,Row}` + `shared.tsx`
    - `src/features/mcp/index.tsx` → `ServerRow` + `ServerForm` + `templates.ts` + `transport.ts`
    - `src/features/settings/AgentWizard.tsx` (727→115) → `SourceStep` + `DetailsStep` + `Helpers.tsx` + `agentWizardUtil.ts`
  - **CI gates 新增**:
    - `scripts/check-file-sizes.mjs`（warn ≥800 / fail ≥1500）
    - `scripts/check-ipc-contract.mjs` — Rust `#[tauri::command]` ↔ `lib.rs` ↔ `src/lib/ipc.ts` 三方 drift
    - `scripts/check-clippy-unwrap.mjs` + `clippy-unwrap-baseline.txt` (468) — `unwrap_used` 不增长基线
    - `pnpm check:rust-fmt` + `pnpm check:all` — 本地等价于 CI 套件
    - `.github/workflows/ci.yml` — 新增 file-size / IPC / unwrap 三个 gate step
  - **死代码清理**: 删除 `_retain_time_imports`、`_force_use`（含 `wrap` helper）+ unused `std::time` 导入
  - **测试新增** (+27, 50→77): `modelCapabilities` / `chatSearchMatch` / `profiles/helpers` / `mcp/transport` / `agentWizard/generateUniqueId`
  - **文档**: `docs/README.md`（顶层导航入口，cross-link `document-index.md`）
- **操作步骤**:
  1. P1a IPC drift 脚本 + frontend CI step
  2. P2a AgentWizard 拆 4 文件
  3. P3b 死代码 audit（21 处 `#[allow]` → 18，删除 hack pattern）
  4. P2b `docs/README.md` 顶层入口
  5. P3a clippy `unwrap_used` baseline + Linux CI gate
  6. P1b 5 个 helper 测试文件
  7. CI 修复 — `cargo fmt` 漏掉的空行（commit `1fc8a56`）
  8. 加 `pnpm check:all` 防再次本地漏跑（commit `1ecc4bb`）
- **产出物**: 6 个核心任务完成；P0 chat 状态机重构留单独 PR
- **验证**: `pnpm check:all` ✅; `cargo clippy -D warnings` ✅; `cargo test --lib` 262/262 ✅; CI green
- **遗留**: P0 `src/features/chat/index.tsx` (1003 行) 状态机重构 — 深度架构工作，单独分支处理
- **状态**: ✅ 已完成

---

## 操作记录格式

每条操作记录包含以下字段：

```
### [OP-XXX] 操作标题
- **时间**: YYYY-MM-DD HH:MM
- **类型**: 分析 / 修改 / 新增 / 删除 / 重构 / 测试
- **触发**: 用户指令 / Agent 主动
- **目标文件**: 涉及的文件列表
- **操作步骤**:
  1. 步骤一
  2. 步骤二
- **产出物**: 产出结果
- **验证**: 如何验证操作正确
- **状态**: 待执行 / 执行中 / 已完成 / 已回滚
```
