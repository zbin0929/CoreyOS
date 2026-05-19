# Talk Mode 深度分析报告

> 2026-05-19 · 对标 ChatGPT Advanced Voice / Claude Voice Mode

## 一、与热门产品对比

### ChatGPT Advanced Voice Mode (2024)

| 特性 | ChatGPT | CoreyOS Talk Mode | 差距 |
|---|---|---|---|
| **实时对话** | ✅ Realtime API (WebSocket) | ⚠️ 半实时 (STT→LLM→TTS) | 有延迟 |
| **打断 (Barge-in)** | ✅ 即时打断，AI 停止说话 | ✅ 已实现 | 无 |
| **Tool Calling** | ✅ 语音触发函数调用 | ⚠️ 部分支持 | 见下文 |
| **Hands-free 模式** | ✅ VAD 自动检测 | ✅ Auto 模式 | 无 |
| **Push-to-talk** | ✅ 支持 | ✅ 支持 | 无 |
| **多语言** | ✅ 50+ 语言 | ✅ 中英文 | 无 |
| **视觉输入** | ✅ 可以看图说话 | ❌ 不支持 | **缺失** |

### Claude Voice Mode (2025.5)

| 特性 | Claude | CoreyOS Talk Mode | 差距 |
|---|---|---|---|
| **Hands-free** | ✅ 默认模式 | ✅ Auto 模式 | 无 |
| **Push-to-talk** | ✅ 嘈杂环境用 | ✅ 默认模式 | 无 |
| **打断** | ✅ 说话即打断 | ✅ 已实现 | 无 |
| **文字/语音切换** | ✅ 同一对话无缝切换 | ✅ 已实现 | 无 |
| **Tool Calling** | ❌ 不支持 | ⚠️ 部分支持 | CoreyOS 领先 |

### OpenAI Realtime API (2024.10)

| 特性 | Realtime API | CoreyOS Talk Mode | 差距 |
|---|---|---|---|
| **延迟** | ~300ms (端到端) | ~2-3s (STT+LLM+TTS) | **显著** |
| **Function Calling** | ✅ 语音直接触发 | ⚠️ 支持但无进度反馈 | 体验差 |
| **流式 TTS** | ✅ 边生成边播放 | ✅ 句子级流式 | 无 |
| **MCP 支持** | ✅ 2025.5 新增 | ✅ 通过 Hermes | 无 |

---

## 二、当前 Talk Mode 能力清单

### ✅ 已实现

| 能力 | 实现方式 | 代码位置 |
|---|---|---|
| PTT 模式 | 按住空格说话，松开发送 | `useTalkMode.ts::pressPtt/releasePtt` |
| Auto 模式 | VAD 自动检测语音开始/结束 | `useTalkAutoMode.ts` |
| Barge-in 打断 | 用户说话时立即停止 AI 播放 | `useTalkMode.ts::cancelInFlight` |
| 句子级流式 TTS | 不等全部生成完，边生成边播放 | `useTalkTts.ts::enqueueSentences` |
| Echo 防护 | 300ms cooldown 防止 AI 声音被麦克风捕获 | `useTalkMode.ts::echoCooldownUntilRef` |
| Chat 融合 | Talk Mode 的对话自动写入当前 Chat Session | `useTalkMode.ts::chatStore.appendMessage` |
| Pack Soul 注入 | Talk Mode 继承 Pack 的行业人设 | `useTalkMode.ts::packActiveSouls` |
| Approval 卡片 | 工具调用需要审批时显示审批卡片 | `TalkModeInline.tsx::ApprovalCard` |
| 本地 STT/TTS | 支持 sherpa-onnx 离线语音 | `useTalkReadiness.ts::localRoute` |
| Markdown 清理 | 去除 TTS 不友好的格式 | `speechCleanup.ts::stripMarkdownForSpeech` |

### ⚠️ 部分实现

| 能力 | 现状 | 问题 |
|---|---|---|
| Tool Calling | Hermes adapter 会执行工具 | 工具执行过程不会语音播报 |
| | 审批卡片会显示 | 工具执行时间长时用户不知道在干嘛 |

### ❌ 未实现

| 能力 | 影响 | 优先级 |
|---|---|---|
| 视觉输入 | 不能看图说话 | P2 |
| 工具执行进度播报 | 长时间静默，用户以为卡死 | **P0** |
| 实时流式 STT | 录完再转，多 1-2s 延迟 | P1 |
| 语音指令 | 不能说 "慢一点" / "详细说明" | P3 |
| 多模态输出 | 不能语音描述图表/文件 | P3 |

---

## 三、"通过 Talk Mode 能做所有事情吗？"

### ✅ 能做的事情

| 场景 | 支持度 | 说明 |
|---|---|---|
| 日常问答 | ✅ 完美 | "今天天气怎么样" |
| 知识检索 | ✅ 完美 | "帮我查一下上周的销售数据" |
| 简单工具调用 | ⚠️ 可用 | 工具会执行，但用户看不到过程 |
| 审批操作 | ✅ 完美 | 审批卡片会显示，可以点击 |
| 长对话 | ✅ 完美 | 历史记录保留在 Chat Session |
| 行业咨询 | ✅ 完美 | Pack Soul 注入行业人设 |

### ❌ 不能做 / 体验差的事情

| 场景 | 问题 | 影响 |
|---|---|---|
| **浏览器自动化** | 工具执行 30s+，用户不知道进度 | 用户以为卡死了 |
| **文件操作** | 无法语音上传/查看文件 | 必须切回文字模式 |
| **图片分析** | 无视觉输入 | 必须切回文字模式 |
| **复杂工作流** | 多步骤工具调用无反馈 | 用户体验差 |
| **代码生成** | 代码不适合语音播报 | 应自动切换到文字显示 |

---

## 四、与 Chat 的融合度评估

### ✅ 已融合

| 功能 | 融合方式 | 代码位置 |
|---|---|---|
| 对话历史 | Talk Mode 消息写入 `useChatStore` | `useTalkMode.ts:147-151, 266-273` |
| Session 切换 | Talk Mode 跟随当前 Session | `useTalkMode.ts:144` |
| Pack Soul | Talk Mode 注入 `packActiveSouls()` | `useTalkMode.ts:168-178` |
| 审批卡片 | 复用 `ApprovalCard` 组件 | `TalkModeInline.tsx:205-210` |
| LLM Profile | Talk Mode 使用当前选中的模型 | `useTalkMode.ts:197-210` |
| 系统提示词 | Talk Mode 专用口语化提示词 | `useTalkMode.ts:156-166` |

### ❌ 未融合

| 功能 | 问题 | 建议 |
|---|---|---|
| **附件** | Talk Mode 不能发送/接收附件 | 需要 Vision 支持 |
| **工具结果** | 工具返回的数据不会语音播报 | 需要 summarize + TTS |
| **代码块** | 代码不适合语音播报 | 检测代码块时静默或简述 |
| **长列表** | 列表不适合语音播报 | 自动摘要 "共有 5 项..." |

---

## 五、优化路线图

### P0：工具执行进度播报（1-2 天）

**问题**：用户说 "帮我更新 UPS 分区"，Hermes 开始执行浏览器自动化，但 Talk Mode 静默 30 秒，用户以为卡死了。

**方案**：
```typescript
// 在 chatStream 的 onToolStart 回调中
onToolStart: (toolName) => {
  tts.enqueueSentence(`正在执行${toolName}，请稍候...`);
}

onToolEnd: (toolName, success) => {
  if (success) {
    tts.enqueueSentence(`${toolName}执行完成`);
  }
}
```

**需要改动**：
1. `chatStream` 添加 `onToolStart` / `onToolEnd` 回调
2. `useTalkMode` 在工具执行时播放进度提示
3. 状态机扩展：`thinking` → `tool_running` → `speaking`

**收益**：用户知道系统在干嘛，不会以为卡死

---

### P1：实时流式 STT（3-5 天）

**问题**：当前是录完再转，用户说完后要等 1-2 秒 STT 才开始。

**方案**：
- 使用 sherpa-onnx 的流式模式（已有 `talk:partial-transcript` 事件）
- 边说边转，用户松开时已经有部分文字
- 最终结果用完整 STT 校正

**需要改动**：
1. Rust `talk::session` 启用流式 STT
2. 前端在 `listening` 状态显示实时转写
3. `speechEnd` 时直接用已有文字，跳过二次 STT

**收益**：减少 1-2 秒延迟

---

### P2：工具执行中间状态 UI（2-3 天）

**问题**：工具执行时 Talk Mode 只显示 "thinking"，不知道在干嘛。

**方案**：
```
状态机扩展：
idle → listening → thinking → [tool_running] → speaking → idle
                              ↑
                              显示 "正在执行: 浏览器自动化"
                              显示进度条或动画
```

**需要改动**：
1. `TalkState` 添加 `'tool_running'`
2. `TalkModeInline` 添加工具执行 UI
3. `useTalkMode` 在 `onToolStart` 时切换状态

**收益**：用户有视觉反馈

---

### P3：语音指令（1 周）

**问题**：用户不能说 "慢一点" / "详细说明" / "简短回答"。

**方案**：
- 在 TALK_SYSTEM_PROMPT 中加入指令识别
- LLM 回复首行可带 JSON 指令：
  ```json
  {"voice_directive": {"speed": 0.8, "detail": "high"}}
  ```
- TTS 根据指令调整语速
- 指令不播报，只执行

**需要改动**：
1. 修改 `TALK_SYSTEM_PROMPT` 添加指令格式说明
2. `useTalkTts` 解析首行 JSON
3. 调整 TTS 参数

**收益**：更自然的对话控制

---

### P4：视觉输入（2 周）

**问题**：不能看图说话。

**方案**：
- 集成 Vision API（GPT-4V / Claude Vision）
- Talk Mode 添加 "拍照" 按钮
- 图片 base64 随语音一起发送

**需要改动**：
1. `chatStream` 支持 `images` 参数
2. `TalkModeInline` 添加相机按钮
3. 调用系统相机 API

**收益**：对标 ChatGPT Voice with Video

---

## 六、技术债务

| 项目 | 现状 | 建议 |
|---|---|---|
| `useTalkAutoMode` 依赖数组过长 | 可能导致不必要的重渲染 | 用 `useRef` 包装回调 |
| Echo cooldown 硬编码 300ms | 不同环境可能需要调整 | 改为可配置 |
| TTS 并发数硬编码 2 | M1 8GB 可能不够 | 根据内存动态调整 |
| 无 TTS 缓存 | 相同句子重复合成 | 添加 LRU 缓存 |

---

## 七、结论

### 当前状态

Talk Mode **基本实现了实时对话**，与 ChatGPT/Claude 的核心体验（PTT + Auto + Barge-in + Chat 融合）对齐。

### 最大差距

**工具调用体验差** — 用户通过语音触发工具后，不知道执行进度，长时间静默会让用户以为卡死。这是让 Talk Mode 真正"能做所有事情"的关键障碍。

### 建议优先级

| 优先级 | 功能 | 工期 | 收益 |
|---|---|---|---|
| **P0** | 工具执行进度播报 | 1-2 天 | 解决"卡死"体验 |
| **P1** | 实时流式 STT | 3-5 天 | 减少 1-2s 延迟 |
| P2 | 工具执行中间状态 UI | 2-3 天 | 视觉反馈 |
| P3 | 语音指令 | 1 周 | 自然对话控制 |
| P4 | 视觉输入 | 2 周 | 对标 ChatGPT |

### 下一步

实现 **P0：工具执行进度播报**，这是让 Talk Mode 真正"能做所有事情"的关键一步。
