# 当前项目新功能与代码质量评审（2026-04-26）

## 评审目的

本文档用于汇总对 CoreyOS 当前“最近新增功能”的文档与代码交叉分析结果，重点回答以下问题：

- 最近到底新做了哪些功能
- 这些功能是否真的落地到代码中
- 当前实现质量如何
- 哪些模块最值得继续投入，哪些模块最该优先重构

本文以 `docs/05-roadmap.md`、`docs/phases/` 下相关阶段文档，以及当前前端 / Rust 代码实现为依据。

---

## 一、总体结论

当前项目最近新增功能很多，而且大部分不是空壳，而是真正落地了前端页面、IPC 接口、Rust 实现、配置存储与部分运行逻辑。

整体判断如下：

- 项目已经不再只是一个聊天壳子，而是明显向“多 Agent 控制台 + 工作流自动化平台”方向发展。
- 新功能完成度总体较高，尤其是 Multi-Agent / LLM Profiles、Voice、Workflow、File Intelligence 几条线。
- 整体工程质量在个人高强度快速推进的项目里，属于中上到偏强。
- 但复杂度正在快速累积，尤其是 Chat、Settings、Workflow 三条主线，已经出现明显的“中心文件过重”趋势。
- 文档整体有参考价值，但部分 phase 文档 / roadmap 文档会把“计划”“目标”“阶段性状态”和“当前事实”混在一起，使用时需要结合代码再次核对。

一句话总结：

**CoreyOS 当前已经具备相当强的功能密度和落地深度，但下一阶段最重要的不是继续猛加功能，而是收敛主线、压技术债、同步文档。**

---

## 二、评审方法

本次评审采用以下方法：

1. 通读核心规划与阶段文档
   - `docs/05-roadmap.md`
   - `docs/phases/phase-7.5-multi-agent.md`
   - `docs/phases/phase-8-optional.md`
   - `docs/phases/phase-9-workflow.md`
   - 以及此前已读的 `docs/agent/*`

2. 对照关键前端入口
   - `src/app/routes.tsx`
   - `src/features/agents/*`
   - `src/features/models/*`
   - `src/features/voice/*`
   - `src/features/workflow/*`
   - `src/features/chat/*`
   - `src/features/knowledge/*`
   - `src/features/memory/*`
   - `src/features/settings/*`

3. 对照关键 IPC / Rust 实现
   - `src/lib/ipc.ts`
   - `src-tauri/src/ipc/*.rs`
   - `src-tauri/src/workflow/*`
   - `src-tauri/src/adapters/hermes/mod.rs`
   - `src-tauri/src/attachments.rs`
   - `src-tauri/src/db.rs`

---

## 三、最近新增功能总览

从 roadmap 和 phase 文档来看，最近主要新增的能力集中在以下几个阶段：

- Phase 7.5：Multi-LLM + Multi-Agent
- Phase 8：Voice / Multimodal
- Phase 9：Workflow Engine
- Phase 10：Browser Automation
- Phase 11：Polish
- Phase 12：File Intelligence

其中，本次重点核查的功能线为：

- Multi-Agent / LLM Profiles
- Voice
- Workflow
- Browser Automation
- File Intelligence / Vision degrade
- Knowledge / Memory / Learning 延展能力

---

## 四、分模块评审

## 4.1 Multi-LLM + Multi-Agent（Phase 7.5）

### 文档结论

文档中宣称最近完成了：

- `LlmProfile` 资料库
- `/agents` 独立页面
- Agent Wizard 引导式创建
- `/models` 页的 LLM profile 管理 UI
- provider templates 扩展
- 删除安全交互
- 原生 `<select>` 替换为统一主题组件

### 代码落地情况

这部分基本都能在代码中确认：

前端：

- `src/features/agents/index.tsx`
  - 独立 `/agents` 页面存在
- `src/features/settings/index.tsx`
  - 存在 `HermesInstancesSection`
- `src/features/settings/AgentWizard.tsx`
  - 存在两步向导式 agent 创建流程
- `src/features/models/LlmProfilesSection.tsx`
  - 存在 profile 卡片列表、Drawer 编辑、连接探测、Secret 管理、删除确认
- `src/app/shell/AgentSwitcher.tsx`
  - 存在顶部 Agent 切换器、健康状态、default/active 标识
- `src/stores/agents.ts`
  - 存在 active adapter 持久化与后台刷新逻辑

IPC / 类型层：

- `src/lib/ipc.ts`
  - 存在 `llmProfileList`
  - `llmProfileUpsert`
  - `llmProfileDelete`
  - `llmProfileEnsureAdapter`
  - `HermesInstance.llm_profile_id`

### 质量评价

优点：

- 抽象合理：`LlmProfile` 与 `HermesInstance` 分离是正确方向。
- 交互成熟：Wizard、Card、Drawer、Probe、Secret 管理、双击删除都有较完整设计。
- 可扩展性不错：后续继续增加 provider 或 profile 逻辑时，架构并未完全阻塞。

问题：

- `AgentWizard.tsx` 和 `LlmProfilesSection.tsx` 已明显进入“单文件偏重”状态。
- 局部状态和探测逻辑较多，继续迭代会推高维护成本。
- 文档与当前 UI 细节并非完全同步，阶段描述更像“阶段结果总结”而不是严格的最新规格书。

### 结论

这部分是当前项目中质量较高、成熟度也较高的一条线。既有产品价值，也有较完整的工程落地。

---

## 4.2 Voice / Multimodal（Phase 8）

### 文档结论

Phase 8 文档原本是计划导向，但 roadmap 已将其标为已完成，包含：

- push-to-talk
- ASR / TTS
- 多 provider 支持
- 聊天中的语音能力
- 审计日志
- Voice 设置页

### 代码落地情况

语音部分代码落地明确存在。

前端：

- `src/features/voice/index.tsx`
  - 存在 Voice 设置页、测试页、审计页
  - 支持录音 / 转写 / TTS / audit 查看
- `src/features/chat/index.tsx`
  - 已接入 `voiceRecord`
  - `voiceRecordStop`
  - `voiceTranscribe`
  - 支持把转写结果写回输入框
- `src/features/chat/MessageBubble.tsx`
  - 已接入 `voiceTts(content)` 进行消息朗读

IPC / Rust：

- `src/lib/ipc.ts`
  - `voiceTranscribe`
  - `voiceTts`
  - `voiceGetConfig`
  - `voiceSetConfig`
  - `voiceAuditLog`
  - `voiceRecord`
  - `voiceRecordStop`
- `src-tauri/src/ipc/voice.rs`
  - 存在多 provider 实现
  - 目前已确认至少支持 OpenAI / Zhipu / Groq / Edge

### 质量评价

优点：

- 不是空页面，而是完整接进了 Chat 主流程。
- Settings / Chat / Bubble 三条线打通了。
- Provider 选择模式清晰，扩展性较好。
- 审计日志意识较强，符合桌面工具的可信性预期。

问题：

- Phase 8 文档更像原计划文档，不应直接当当前实现说明书。
- chat 内部语音集成逻辑属于“可用版 v1”，还没有完全抽成独立能力层。
- 视频相关规划在文档里写得完整，但当前能明确确认的落地强度，明显不如语音成熟。

### 结论

语音能力已真实落地，完成度中上，属于当前项目较亮眼的新功能之一。视频 / 更广义 multimodal 叙事则需要谨慎看待，不能简单按文档乐观理解。

---

## 4.3 Workflow Engine（Phase 9）

### 文档结论

文档设定了非常完整的目标：

- YAML 工作流定义
- DAG 调度
- agent / tool / browser / parallel / branch / loop / approval 等步骤类型
- 可视化流程编辑器
- 实时运行状态
- scheduler 绑定
- 人工审批

roadmap 将其标为已 shipped。

### 代码落地情况

这块不是空想，代码里已经存在完整骨架。

前端：

- `src/features/workflow/index.tsx`
  - 工作流列表
  - 新建 / 编辑
  - 运行
  - 运行状态轮询
  - 审批操作
- `src/features/workflow/Editor.tsx`
- `src/features/workflow/PropertyPanel.tsx`
- `src/features/workflow/nodes/*`

IPC / 类型：

- `src/lib/ipc.ts`
  - `workflowList`
  - `workflowGet`
  - `workflowSave`
  - `workflowDelete`
  - `workflowValidate`
  - `workflowRun`
  - `workflowRunStatus`
  - `workflowActiveRuns`
  - `workflowExtractIntent`
  - `workflowApprove`

Rust：

- `src-tauri/src/ipc/workflow.rs`
- `src-tauri/src/workflow/model.rs`
- `src-tauri/src/workflow/store.rs`
- `src-tauri/src/workflow/engine.rs`
- `src-tauri/src/workflow/planner.rs`
- `src-tauri/src/workflow/context.rs`
- `src-tauri/src/workflow/templates.rs`
- `src-tauri/src/workflow/templates/*`

此外，`workflow.rs` 中还包含：

- workflow intent extract
- run / approve / active runs
- browser config 相关 IPC
- `StepExecutor` 及其 agent / browser 执行路径

### 质量评价

优点：

- 架构完整度很高，不是“只有编辑器 UI”。
- 有真正的 Rust 执行层与状态层。
- YAML / editor / run / approval / template 基本形成了闭环。
- 是项目里最具平台化价值的新模块之一。

问题：

- 这是当前项目复杂度最高、未来维护风险最大的功能。
- `workflow_extract_intent` 目前更像启发式匹配，属于有用但脆弱的 v1。
- Workflow 前端编辑态 / 运行态 / 审批态未来容易相互耦合。
- `src-tauri/src/ipc/workflow.rs` 目前承担的职责已经偏多。

### 结论

工作流模块价值极高，而且已经不是 PPT 级别，而是真正落地到了前后端。但它也是最有可能在未来成为技术债中心的模块，需要尽早做边界收敛与架构整理。

---

## 4.4 Browser Automation（Phase 10）

### 文档结论

roadmap 声称：

- 已集成 Stagehand + Playwright runner
- 已有 browser workflow step
- 已有 browser profile / cookie 路径
- 已有 Browser LLM config UI

### 代码落地情况

这部分已有明显实现证据：

- `src-tauri/src/workflow/browser_config.rs`
- `src-tauri/src/ipc/workflow.rs`
  - `browser_config_get`
  - `browser_config_set`
  - `execute_browser(...)`
  - `find_browser_runner()`
- `scripts/browser-runner.cjs`（从 Rust 侧逻辑可见其被调用）
- `src/features/settings/index.tsx`
  - 已接入 `browserConfigGet`
  - `browserConfigSet`

### 质量评价

优点：

- 并非孤立功能，而是嵌入到了 workflow execution 体系中。
- Rust 负责 orchestration，Node / browser runner 负责具体执行，职责划分思路合理。
- Browser LLM Config 被抽为独立配置项，整体设计不是临时拼接。

问题：

- 这是天然脆弱的跨进程 / 跨生态链路：
  - runner 路径
  - node 环境
  - 浏览器环境
  - cookie/profile
  - 外部网页变化
- 稳定性上限取决于日志、超时、错误恢复、观察性，目前更像“可用版专家功能”，不算完全硬化。

### 结论

Browser Automation 是真实接进系统能力链路的功能，产品价值高，但稳定性和可维护性仍需持续打磨。

---

## 4.5 File Intelligence / Vision degrade（Phase 12）

### 文档结论

roadmap 中提到：

- 非视觉模型保护
- 文件内容提取
- 支持 docx / xlsx / pdf
- NVIDIA NIM provider template

### 代码落地情况

这块落地明确存在。

Vision / degrade 路径：

- `src/features/chat/index.tsx`
  - 聊天请求中传入 `model_supports_vision`
- `src/lib/ipc.ts`
  - chat DTO 中包含 `model_supports_vision`
- `src-tauri/src/ipc/chat.rs`
  - send / stream 路径均传递该字段
- `src-tauri/src/adapters/hermes/mod.rs`
  - 根据 `model_supports_vision` 处理附件呈现策略

文件提取路径：

- `src-tauri/src/adapters/hermes/mod.rs`
  - 纯文本直接读取
  - `extract_docx_text(...)`
  - `extract_xlsx_text(...)`
  - `extract_pdf_text(...)`
- PDF 提取使用了 `lopdf`

### 质量评价

优点：

- 这是非常实用的增强能力，且集成位置选得对。
- vision degrade 策略合理，比直接报错更好。
- 文档类型抽取能力对真实使用场景帮助很大。

问题：

- 文档解析质量不会对所有复杂文档都稳定，尤其 PDF / 表格类文档仍可能存在局限。
- 当前更像“聊天增强能力”，而不是高保真文档解析平台。

### 结论

这是一条低调但非常实用的能力线，质量偏高，值得继续保留和增强。

---

## 4.6 Knowledge / Memory / Learning 相关能力

### 代码落地情况

此前已确认：

- `src/features/memory/index.tsx`
  - `agent / user / search` 三个 tab
  - memory 编辑
  - compact memory
  - session search
- `src/features/knowledge/index.tsx`
  - 上传
  - 列表
  - 删除
  - 搜索
- `src-tauri/src/ipc/learning.rs`
  - `learning_extract`
  - `learning_index_message`
  - `learning_search_similar`
  - `learning_detect_pattern`
  - `learning_suggest_routing`
  - `learning_compact_memory`
- `src-tauri/src/ipc/session_search.rs`
  - session FTS 搜索
- `src-tauri/src/db.rs`
  - embeddings 表与相关存储支持

### 质量评价

这条线的特点是：

- 工程落地是真实存在的
- 但概念密度较高
- 对用户是否“看得懂 / 用得顺”还有待观察

也就是说：

- 能力层是存在的
- 产品层的叙事与易用性还需要继续打磨

---

## 五、文档质量评价

## 5.1 优点

当前 `docs/` 体系整体质量不低：

- 结构完整
- 阶段划分清晰
- 有目标、交付物、exit criteria、测试思路
- 对理解项目方向、设计意图、历史决策非常有帮助

## 5.2 问题

但需要特别注意：

- roadmap / phase 文档并不总是与最新代码严格同步
- 某些 phase 文档仍然保留了“计划文档”的表达方式
- roadmap 又可能把某个阶段写成 shipped，导致读者误以为“文档细节 = 当前事实”

因此，对文档的正确使用方式应当是：

- 用来理解方向、范围、设计意图
- 不直接把每条描述当成当前事实
- 对关键功能仍需回到代码核对

---

## 六、整体工程质量评价

## 6.1 综合评级

按维度判断：

- 功能完成度：高
- 架构设计：中上到高
- UI / 交互成熟度：中上
- 可维护性：中上，但开始承压
- 文档可信度：中上，但存在时差

## 6.2 最值得肯定的地方

- 不是只会堆页面，而是大部分新增功能都有完整闭环：
  - 页面
  - IPC
  - Rust 实现
  - 数据 / 配置存储
  - i18n
  - 基本测试意识
- 功能很多，但不是纯演示型代码，很多都能看出实际使用场景导向。
- Multi-Agent、Workflow、Voice、File Intelligence 这些功能组合起来，已经让产品形态从“聊天客户端”明显升级。

## 6.3 最值得警惕的地方

- 功能扩张速度很快，复杂度开始陡增。
- Chat、Settings、Workflow 正在形成几个新的“大中心文件 / 大中心模块”。
- 若继续高速加功能而不重构，未来维护成本会明显上升。
- 文档如果不继续梳理，会越来越难作为“可信现状来源”。

---

## 七、最该重构的 5 个文件 / 模块

以下排序不是按“代码最差”，而是按：

- 复杂度
- 影响面
- 未来扩展压力
- 一旦出问题的代价

综合得出的优先级。

## 7.1 第一优先级：`src/features/chat/index.tsx`

### 原因

这是当前最危险的中心文件之一。

目前它已承载：

- 聊天发送 / 流式响应
- 搜索
- 语音录音 / 转写接入
- workflow intent detection
- scheduler intent detection
- knowledge / rag / learning 相关触发
- vision capability 传递
- session / model / adapter 路由
- composer 状态
- suggestion card 触发

### 风险

- 职责过载
- 回归风险高
- 很难做局部验证
- 后续所有“新能力”都会继续往这里挂

### 重构建议

优先拆分为：

- `useChatSendFlow`
- `useComposerActions`
- `useChatIntentSuggestions`
- capability / model / adapter resolver

### 结论

这是最值得最先动手重构的文件。

---

## 7.2 第二优先级：`src/features/settings/index.tsx`

### 原因

Settings 正在演变成超级配置中心，已聚合：

- gateway 配置
- Hermes instances
- sandbox scopes
- browser config
- routing rules
- learning / suggestion 相关内容
- 以及其他设置 section

### 风险

- 文件规模大
- section 之间耦合上升
- review 成本高
- 小改动也容易碰到大文件

### 重构建议

拆出：

- `sections/`
- `hooks/`
- 每个 section 自己的状态与 helper

例如：

- `BrowserConfigSection.tsx`
- `HermesInstancesSection.tsx`
- `SandboxScopesSection.tsx`
- `RoutingRulesSection.tsx`

### 结论

它和 Chat 是当前项目最值得优先压技术债的两个前端中心文件。

---

## 7.3 第三优先级：`src/features/workflow/*`

重点是：

- `src/features/workflow/index.tsx`
- `src/features/workflow/Editor.tsx`

### 原因

Workflow 已经是复杂系统，而不只是普通页面。涉及：

- 列表态
- 编辑态
- 运行态
- 审批态
- 节点与属性面板
- React Flow 结构

### 风险

- 编辑器状态容易失控
- 转换逻辑容易分散到 UI 各处
- 运行态与编辑态未来会互相影响

### 重构建议

尽快明确分层：

- workflow list
- workflow editor shell
- canvas adapter
- property form renderer
- run monitor
- DTO / graph 转换层

### 结论

这是当前最复杂的新模块，越晚整理成本越高。

---

## 7.4 第四优先级：`src-tauri/src/ipc/workflow.rs`

### 原因

这个文件目前已同时承担：

- workflow CRUD IPC
- validate
- run / status / active runs
- intent extract
- approval
- browser config get / set
- `StepExecutor`
- `execute_agent`
- `execute_browser`

### 风险

- IPC 层和执行层边界开始模糊
- browser 逻辑与 workflow IPC 纠缠在一起
- 后续扩展会越来越重

### 重构建议

拆成三层：

- IPC commands
- application service
- executor adapters

并考虑把 browser config 独立出 `ipc/workflow.rs`。

### 结论

这是后端 / IPC 侧最值得优先整理的中心文件。

---

## 7.5 第五优先级：`src/features/models/LlmProfilesSection.tsx` 与 `src/features/settings/AgentWizard.tsx`

### 原因

它们的共同特征是：

- 功能完整
- 状态多
- 表单和探测逻辑多
- 现在还能维护，但已经接近“该组件化”的临界点

### 风险

- 继续加功能会继续变肥
- 逻辑复用难
- 局部测试难

### 重构建议

`LlmProfilesSection.tsx`：

- `LlmProfilesList`
- `LlmProfileCard`
- `LlmProfileDrawer`
- `useLlmProfiles`
- `useProfileProbe`

`AgentWizard.tsx`：

- `SourcePickerStep`
- `DetailsStep`
- `useAgentWizardState`
- `useProviderProbe`
- `useProfileLinking`

### 结论

紧急性低于 Chat / Settings / Workflow，但从长期看，应尽早做结构整理。

---

## 八、下一阶段建议

如果下一阶段要提升项目质量，不建议继续无节制增加功能，而应优先做以下三件事：

## 8.1 收敛产品主线

需要明确 CoreyOS 的核心叙事更偏向：

- 多 Agent 控制台
- 还是工作流自动化平台

现在两个方向都在长，但如果不收敛，未来用户认知和产品设计会越来越分散。

## 8.2 压核心技术债

优先处理：

- `src/features/chat/index.tsx`
- `src/features/settings/index.tsx`
- workflow 前后端边界

## 8.3 梳理文档体系

建议把文档分成三类：

- 规划文档（计划 / why / scope）
- 现状文档（当前事实）
- 变更记录（worklog / changelog）

否则 roadmap / phase / agent 文档继续混写，后续很容易出现“能看，但不敢全信”的情况。

---

## 九、最终结论

CoreyOS 当前项目状态可以概括为：

- 新功能很多，而且大部分已经真实落地
- 工程实现不是表面功夫，而是有前后端闭环
- Multi-Agent、Voice、Workflow、Browser Automation、File Intelligence 共同把产品推向了更强的平台化方向
- 整体质量中上偏强，但复杂度增速很快
- 下一阶段最重要的不是继续加模块，而是重构 Chat / Settings / Workflow 三大复杂中心，并同步文档体系

最终判断：

**这是一个“已经有明显产品雏形、值得继续做，但必须开始控制复杂度”的项目。**
