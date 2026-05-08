# B-8 Talk Mode v1 — 工程计划（豆包式 · 全本地 STT/TTS）

> **状态**：v1 开发中，核心链路已跑通。
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

## v1 技术栈（v1.3 更新 · 2026-05-08）

| 组件 | 选择 | 跨平台 | 大小 | 中文质量 | 备注 |
|---|---|---|---|---|---|
| **STT** | **sherpa-onnx Zipformer bilingual zh-en (int8)** | ✅ | 188 MB | 95+ 分 | v1.3 替换 whisper.cpp（540→188MB），RTF 0.045-0.073，流式识别 |
| **TTS** | **sherpa-onnx in-process** + `vits-melo-tts-zh_en` | ✅ | 182 MB | 95+ 分 | 进程内引擎，零子进程 |
| **VAD** | **silero-vad v5 ONNX**（`ort` crate） | ✅ | 2 MB | 业界标准 | v1.3 接入，自动替换 EnergyVad |
| **音频 I/O** | `cpal`（已用） | ✅ | 0 | — | |
| **LLM** | 现有 Hermes adapter（用户配什么用什么） | — | — | — | |

### v1.3 变更日志（2026-05-08）

1. **STT 替换**：whisper.cpp → sherpa-onnx Zipformer bilingual (int8)
   - 模型大小：540 MB → 188 MB（4 个文件：encoder 173M + decoder 12M + joiner 3M + tokens 55K）
   - 推理延迟：1-2s → 62ms（RTF 0.045-0.073）
   - 实现文件：`talk/online_stt.rs`（新增）、`talk/stt.rs`、`ipc/talk.rs`
   - 自动 fallback：Zipformer 优先，加载失败回退 whisper.cpp

2. **流式 STT**：边说边出字，不再等整句说完
   - `session.rs` orchestrator 集成 `OnlineRecognizer`
   - 每帧（32ms）喂入 `OnlineStream`，每 6 帧解码一次 partial transcript
   - Tauri event `talk:partial-transcript` 推送实时识别结果
   - 前端 `TalkModeOverlay.tsx` 绿色脉冲 UI 显示正在识别的文字
   - `SpeechEnd` 时调用 `stream.input_finished()` 获取最终结果，跳过重复 STT

3. **Silero VAD 接入**：自动替换 EnergyVad
   - `session.rs` 的 `create_vad()` 优先加载 silero-vad 模型
   - `ResamplingSileroVad` 包装器处理 cpal 采样率 ≠ 16kHz 的情况
   - `Box<dyn Vad>` trait object 统一接口，fallback 到 EnergyVad
   - 首次加载时日志输出 "Silero VAD loaded"，便于确认

4. **Bug 修复**
   - 修复 `SpeechEnd` 重复 feed 整个 `speech_buffer`（改为 `input_finished()`）
   - 修复前端双重 STT 调用（`streamingTranscriptRef` 跳过已完成识别）
   - 修复 download.rs encoder 第 3 个 URL 指向 tar.bz2（移除无效 mirror）

### 模型文件清单

| 模型 | 路径（~/.hermes/talk/models/ 下） | 大小 |
|---|---|---|
| Zipformer encoder | `streaming-zipformer-bilingual-zh-en/encoder.int8.onnx` | 173 MB |
| Zipformer decoder | `streaming-zipformer-bilingual-zh-en/decoder.onnx` | 12 MB |
| Zipformer joiner | `streaming-zipformer-bilingual-zh-en/joiner.int8.onnx` | 3.1 MB |
| Zipformer tokens | `streaming-zipformer-bilingual-zh-en/tokens.txt` | 55 KB |
| MeloTTS | `vits-melo-tts-zh_en/` | 182 MB |
| Silero VAD | `silero-vad/silero_vad.onnx` | 2 MB |
| **总计** | | **~372 MB** |

## 包大小代价

- 安装包 +13 MB（sherpa-onnx bin × 各平台一份）+ ~20 MB onnxruntime
- 首次启用 Talk Mode 时拉 **~372 MB 模型**（zipformer 188 + melo-tts 182 + silero-vad 2）
- 离线 zip 方式：4 个 cross-platform zip，客户可离线导入全本地链路

## 期望延迟（M1/M2 Mac · LLM 走现有云）

| 阶段 | 耗时 |
|---|---|
| VAD 判定说完 | < 100 ms |
| Zipformer 流式转写 | **< 100 ms**（v1.3 大幅优化，原 whisper 1-2s） |
| LLM（OpenAI/Zhipu/etc.，~100 字回复） | ~2-3 s |
| MeloTTS 出第一段音频 | ~150 ms |
| **整圈** | **~2.5-3.5 s**（v1.2 为 3-5s） |

## 待做 / 未来优化

| # | 任务 | 优先级 | 说明 |
|---|---|---|---|
| 1 | AEC 回声消除升级 | 中 | 当前 NLMS 太弱，外放时 AI 声音回传 mic |
| 2 | TTS 音色选择 | 低 | 当前只有 MeloTTS 一个声音 |
| 3 | 等 OmniVoice ONNX 版发布后集成 | 低 | k2-fsa 官方 646 语言 TTS |
| 4 | 等 CosyVoice 2 / Qwen3-TTS ONNX 版 | 低 | 需 GPU（4-6GB），质量接近真人 |
| 5 | Voice Wake 唤醒词 | 低 | v0.4.1+ |
| 6 | Voice Directives（LLM 控制声音/语速） | 低 | v0.4.1+ |

## 不做（v1 范围外）

- ❌ Linux 支持
- ❌ 系统原生 TTS / STT 兜底（macOS AVSpeechSynthesizer / Windows SAPI）— 中文质量不及格
- ❌ 强制 Ollama 本地 LLM — LLM 这一段保持用户配什么用什么
- ❌ PyTorch-only 模型集成（CosyVoice/Qwen3-TTS）— 等 ONNX 版本

## 风险

| 风险 | 缓解 |
|---|---|
| Windows onnxruntime DLL 体积膨胀 | 用 `ort` 的 `load-dynamic` feature 运行时按需加载 |
| Silero VAD 在高采样率设备需要 resample | `ResamplingSileroVad` 包装器透明处理 |
| MeloTTS 中文音色单一 | 等 OmniVoice ONNX 版（646 语言） |
| 首次 372 MB 下载体验差 | 进度条 + 校验和 + 离线 zip fallback |

## 价值

- 客户演示一句"**全离线、零成本、本地高质量中文 TTS / STT**"
- 对比豆包 / ChatGPT Voice / OpenClaw — 都需要联网或付费
- 不依赖任何外部账号即可 demo（机器上有 Ollama 时连 LLM 也是零外部依赖）
