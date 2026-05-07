# B-8 Talk Mode v1 — 工程计划（豆包式 · 全本地 STT/TTS）

> **状态**：v0 / v0.1 已合入 main，v1 待启动。
> **目标版本**：v0.3.x（前置，不再等 v0.4.0）。
> **启动条件**：用户已确认（2026-05-06 晚）— 见下方"用户最终要求"。

## 用户最终要求（2026-05-06 晚锁定）

> "我要除 LLM 外其他完全免费 + 兼容 Win 和 macOS + 像打电话一样直接对话（不要按键，开口就说，停下就发）"

豆包真相：豆包整套跑在字节服务器，**"豆包体验"的本质 = VAD 自动断句 + 流畅来回 + 边说边打断**，**不是"本地"**。我们做的版本 = 豆包体验 + STT/TTS 全本地（LLM 走现有 Hermes 配置，可云可本地由用户决定）。

## 已交付（push-to-talk 阶段）

- **`5a87f95`** v0 骨架 — `useTalkMode` 状态机 + `<TalkModeOverlay>` 三态 UI + Topbar 麦克风入口 + Push-to-talk（Space 按住）。
- **`a525be4`** v0.1 — readiness gate（探测 voice config 未就绪显示 Settings 跳转）+ 转写持久化到 active chat session（含历史上下文）。
- **当前能力**：在已配 OpenAI / Zhipu voice provider 的机器上完整循环可跑。
- **保留**：v1 上线后 push-to-talk 作为非自动模式 fallback 保留（Settings 切换"自动监听 / 按键"）。

## v1 技术栈（最终锁定）

| 组件 | 选择 | 跨平台 | 大小 | 中文质量 |
|---|---|---|---|---|
| **STT** | **whisper.cpp** + `ggml-base-q5_1.bin` | ✅ | bin 5 MB + 模型 60 MB | 80+ 分 |
| **TTS** | **Piper TTS** + `zh_CN-huayan-medium.onnx` | ✅ | bin 8 MB + 模型 60 MB | 85+ 分 |
| **VAD** | **silero-vad ONNX**（用 `ort` crate） | ✅ | 模型 2 MB | 业界标准 |
| **音频 I/O** | `cpal`（已用） | ✅ | 0 | — |
| **LLM** | 现有 Hermes adapter（用户配什么用什么） | — | — | — |

**为什么选这套**
- 三组件全部 C++ / ONNX 预编译二进制，Rust 直接 spawn 子进程或 FFI，**0 Python 依赖**
- MIT / Apache，商用零授权费
- 模型一次下载后断网正常工作

## 包大小代价

- 安装包 +13 MB（whisper.cpp + piper bin × 各平台一份）+ ~20 MB onnxruntime（Win 必须 ship；mac 用 CoreML / 静态链接）
- 首次启用 Talk Mode 时拉 **122 MB 模型**（whisper-base 60 + piper-huayan 60 + silero-vad 2）

## 工程拆解（11 项 · 共 ~15 工作日 ≈ 3 周）

| # | 任务 | 工期 | 备注 |
|---|---|---|---|
| 1 | `crate::talk` 模块骨架 + `LocalTalkBackend` trait + 二进制路径常量 + 重构 v0 为 backend-pluggable | 0.5 d | **下次会话起手第 1 步**，不破坏现有 v0 |
| 2 | silero-vad ONNX 用 `ort` crate 加载 + 推理（32 ms 帧滑窗 + 700 ms 静音判定） | 1.5 d | **下次会话起手第 2 步**；有 VAD 立刻能 demo 无按键持续对话（先用现有 voice provider 做 STT/TTS） |
| 3 | Tauri sidecar 打包 whisper.cpp 二进制（macOS x64/arm64 + Windows x64） | 1.5 d | GitHub Actions matrix 三平台编译 |
| 4 | Tauri sidecar 打包 piper 二进制 | 1 d | 同上 |
| 5 | `crate::talk::stt` — spawn whisper.cpp，feed PCM，读 stdout | 1.5 d | `tokio::process::Command` |
| 6 | `crate::talk::tts` — spawn piper，feed text，读 stdout PCM 流 | 1.5 d | 同上 |
| 7 | 持续监听循环（核心状态机）— mic → VAD → STT → LLM → TTS → mic 自动循环 | 2 d | 含打断逻辑（用户开口立刻 cancel TTS） |
| 8 | 模型下载管理 UI（参考 BGE-M3 离线包模式） | 1.5 d | Settings → Voice → "下载本地语音包"，进度条 + 校验和 |
| 9 | 重写 `<TalkModeOverlay>` — 取消 push-to-talk，自动模式 + VAD 实时音量条 | 1 d | 三态保留，加 VAD 音量环 |
| 10 | Settings → Voice 新增 "Local (whisper.cpp + Piper)" provider | 1 d | 复用现有 provider 选择 UI |
| 11 | 跨平台 e2e（macOS arm64/x64 + Windows x64 各跑 3 轮真实对话） | 1 d | — |

## 期望延迟（M1/M2 Mac · LLM 走现有云）

| 阶段 | 耗时 |
|---|---|
| VAD 判定说完 | < 100 ms |
| whisper.cpp base 转写 3 秒话 | ~1-2 s |
| LLM（OpenAI/Zhipu/etc.，~100 字回复） | ~2-3 s |
| Piper 出第一段音频 | ~150 ms |
| **整圈** | **3-5 s** |

豆包是 ~1-2 s（字节自家 GPU），本地达不到那么快，但跟早期 ChatGPT Voice 体验相当，可接受。

## 不做（v1 范围外）

- ❌ Linux 支持
- ❌ 系统原生 TTS / STT 兜底（macOS AVSpeechSynthesizer / Windows SAPI）— 中文质量不及格
- ❌ 唤醒词 / Voice Wake — v0.4.1+
- ❌ Voice Directives（LLM 控制声音 / 语速）— v0.4.1+
- ❌ MLX 本地 TTS（Apple Silicon 加速）— v0.4.1+ 看是否真的更好
- ❌ 强制 Ollama 本地 LLM — LLM 这一段保持用户配什么用什么

## 风险

| 风险 | 缓解 |
|---|---|
| Windows onnxruntime DLL 体积膨胀 | 用 `ort` 的 `load-dynamic` feature 运行时按需加载 |
| whisper.cpp Windows ARM 无官方 build | 不影响（Win ARM 用户极少） |
| piper 中文音色少（zh_CN-huayan / zh_CN-mengxiang） | 接受现实；未来切 sherpa-onnx 多音色 |
| 首次 122 MB 下载体验差 | 进度条 + 校验和 + 离线 zip fallback（参考 BGE-M3） |

## 价值

- 客户演示一句"**全离线、零成本、本地高质量中文 TTS / STT**"
- 对比豆包 / ChatGPT Voice / OpenClaw — 都需要联网或付费
- 不依赖任何外部账号即可 demo（机器上有 Ollama 时连 LLM 也是零外部依赖）
