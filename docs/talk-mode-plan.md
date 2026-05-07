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

## v1 技术栈（最终锁定 · v1.1 更新）

| 组件 | 选择 | 跨平台 | 大小 | 中文质量 |
|---|---|---|---|---|
| **STT** | **whisper.cpp** + `ggml-medium-q5_0.bin`（v1.1 由 base 升 medium，实测 base 中文太差） | ✅ | bin 5 MB + 模型 540 MB | 95+ 分 |
| **TTS** | **sherpa-onnx** + `vits-melo-tts-zh_en`（v1.1 由 Piper 迁移，Piper macOS arm64 prebuilt 是 x86_64 字节，SIGABRT；上游半年没动；不支持流式合成） | ✅ | bin 30 MB + 模型 165 MB | 95+ 分 |
| **VAD** | **silero-vad ONNX**（用 `ort` crate） | ✅ | 模型 2 MB | 业界标准 |
| **音频 I/O** | `cpal`（已用） | ✅ | 0 | — |
| **LLM** | 现有 Hermes adapter（用户配什么用什么） | — | — | — |

**为什么选这套**
- 三组件全部 C++ / ONNX 预编译二进制，Rust 直接 spawn 子进程或 FFI，**0 Python 依赖**
- MIT / Apache，商用零授权费
- 模型一次下载后断网正常工作
- **v1.1 新增**：WAV post-processing（silence trim + RMS loudness normalization）减少 VITS-style 音量跳变；clause-level splitting + 并行 synth 消除长回复停顿

## 包大小代价

- 安装包 +13 MB（whisper.cpp + sherpa-onnx bin × 各平台一份）+ ~20 MB onnxruntime（Win 必须 ship；mac 用 CoreML / 静态链接）
- 首次启用 Talk Mode 时拉 **707 MB 模型**（whisper-medium-q5_0 540 + vits-melo-tts-zh_en 165 + silero-vad 2）
- **离线 zip 方式**（v1.1 新增）：4 个 cross-platform zip（bge-m3.zip 2.1 GB + talk-mac-arm64.zip 691 MB + talk-mac-x64.zip 686 MB + talk-win-x64.zip 674 MB），客户可离线导入全本地链路

## 工程拆解（11 项 · 共 ~15 工作日 ≈ 3 周）

| # | 任务 | 工期 | 备注 |
|---|---|---|---|
| 1 | `crate::talk` 模块骨架 + `Stt`/`Tts`/`Vad` traits + `TalkBackend` 容器 + 二进制/模型路径常量 + cloud backend 占位 + NoopVad | 0.5 d | ✅ **2026-05-07 完成**（fmt + clippy baseline 绿） |
| 2 | silero-vad ONNX 用 `ort` crate 加载 + 推理（32 ms 帧滑窗 + 700 ms 静音判定）+ `talk-local` feature 加 `ort`/`ndarray` | 1.5 d | ✅ **2026-05-07 完成**：SileroVad 推理 + LSTM 状态跨帧 + 22帧静音阈值转stateN + soft-fail；clippy `-D warnings` 双 feature 双绿，6 个单元测试 |
| 3 | Tauri sidecar 打包 whisper.cpp 二进制（macOS x64/arm64 + Windows x64） | 1.5 d | ✅ **2026-05-07 完成**：`.github/workflows/release-talk-binaries.yml` 3×OS matrix（macOS arm64 + Intel + Windows x64）从源编译 whisper.cpp、拉官方 piper 预构、打包 `talk-binaries-<triple>.zip` 上传 GitHub Releases；`scripts/fetch-talk-binaries.sh` 本地下载脚本带镜像回退；`talk::download::import_offline_zip` 扩展 后可识别 binary + piper-runtime/ 并打 +x（Unix） |
| 4 | Tauri sidecar 打包 piper 二进制 | 1 d | ✅ **2026-05-07 完成**（与任务 3 合并）：Piper 从 rhasspy/piper releases 拉预构（piper_macos_aarch64.tar.gz / piper_macos_x64.tar.gz / piper_windows_amd64.zip），stage 进同一个 per-triple zip，espeak-ng-data 附带 |
| 5 | `crate::talk::stt` — spawn whisper.cpp，feed PCM，读 stdout | 1.5 d | ✅ **2026-05-07 完成**：`WhisperCppStt::try_load` + `transcribe()` 跳 hound解码 → 全介合 16k 单声道重采样 → tempfile 暂存 → spawn whisper-cli（-otxt -nt -l auto）→ 读回转录；90s 超时；Windows CREATE_NO_WINDOW；本机冷启动 try_load 堆示“下载本地语音包”的提示 |
| 6 | `crate::talk::tts` — spawn piper，feed text，读 stdout PCM 流 | 1.5 d | ✅ **2026-05-07 完成**：`PiperTts::try_load` + `synthesize()` 文本 stdin 送入 piper `--output-raw`，raw s16le PCM 读出 stdout 后用 hound 包装 WAV；采样率从 piper config json 动态读取（60s 超时） |
| 7 | 持续监听循环（核心状态机）— mic → VAD → STT → LLM → TTS → mic 自动循环 | 2 d | ✅ **2026-05-07 完成（Phase A + B）**：Rust 后端 cpal + EnergyVad + Tauri events + 3 IPC；前端 `useTalkMode` 抽取 `processWavBase64` 共享管线 + auto 模式事件订阅 + speech-start 中断 TTS；权限失败静默回退 PTT |
| 8 | 模型下载管理 UI（参考 BGE-M3 离线包模式） | 1.5 d | ✅ **2026-05-07 完成**：`talk::download` 镜像 fallback 链（HF → hf-mirror.com → ghproxy/ghfast.top）解决国内直连 GitHub 问题；silero-vad / whisper-base-q5_1 / piper-huayan 三套模型 spec + 离线 zip 导入；Settings → Voice `<LocalVoicePackPanel>` 进度条 + 镜像身份显示；21 个 talk 测试 + clippy 双绿 |
| 9 | 重写 `<TalkModeOverlay>` — 取消 push-to-talk，自动模式 + VAD 实时音量条 | 1 d | ✅ **2026-05-07 完成**（与任务 7 一并落地）：mode toggle 胶囊 + auto-mode VU halo + 多模式 hint 文案 + Space 在 auto 模式自动脱开 |
| 10 | Settings → Voice 新增 "Local (whisper.cpp + Piper)" provider | 1 d | ✅ **2026-05-07 完成**：采用更低侵入性的路径 — `useTalkMode` 在 mount 同时探测 `talkLocalStatus`，local sidecar 就绪时自动路由到 `talk_local_transcribe` / `talk_local_tts`，provider 选项列表不变；`<LocalVoicePackPanel>` 表头塪香“全本地链路已启用（whisper + Piper）”当 stt+tts 都为 true |
| 11 | 跨平台 e2e（macOS arm64/x64 + Windows x64 各跑 3 轮真实对话） | 1 d | ✅ **2026-05-07 完成**（smoke 部分）：`e2e/talk-mode.spec.ts` Playwright 验证 topbar 麦克起点 → overlay 开启 → readiness gate 走云端 → mode toggle PTT↔auto（VU halo 现身）→ close 关闭；`tauri-mock.ts` 增加 voice/talk 指令 stub。真实麦克 + LLM 循环需人工跨平台实机验证 |

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
