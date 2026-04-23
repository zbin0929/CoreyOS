# Phase 8 · Multimodal (conditional)

**Goal**: Add push-to-talk voice and Hermes-backed video analysis surfaces **iff** the product is still on the Control-Plane track and Phases 6 + 7 landed cleanly. This phase explicitly does NOT pursue the digital-human, desktop-avatar, or always-on voice directions — see `docs/06-backlog.md` § Will not do.

**Est.**: 2–3 weeks solo, skippable.

**Preconditions** (all must hold to start Phase 8):

1. Phase 6 shipped and stable for ≥ 4 weeks (orchestrator, feedback loop, multi-instance in real use).
2. Phase 7 shipped or explicitly descoped.
3. No product-direction pivot toward Companion surface.
4. User demand signal: at least one concrete workflow where voice / video blocks adoption.

Without these, **skip Phase 8**. The engineering-to-impact ratio is the lowest of any phase.

## Positioning

Phase 8 is **additive minimum viability** for two modality axes, not a "full multimodal product". We ship:

- **Push-to-talk voice**: hold spacebar (or configured hotkey) to speak, release to send. No wake word, no always-on mic, no voice activity detection.
- **Video as Hermes capability surfacing**: user uploads a video → IPC forwards to Hermes' own video-processing tool → result renders in the chat bubble like any other tool output. Corey never decodes a frame locally.

Any deeper work (avatar, real-time meeting transcription, local ASR model, on-device video summarisation) is out of scope permanently, per `06-backlog.md`.

## Exit criteria

1. Holding the configured hotkey in the chat input starts recording; releasing stops, transcribes via cloud ASR, and submits the transcription as the next user message.
2. The ASR endpoint is user-configurable (OpenAI Realtime, Gemini Live, or any compatible endpoint). No vendor lock-in.
3. A toggle-able TTS plays back assistant replies. Voice and speed selectable.
4. Chat input accepts video attachments (mime `video/*`); the attachment flows through Hermes if and only if the active instance's `capabilities().video == true`. UI shows video thumbnail + result panel.
5. All audio I/O gates on macOS / Windows permission dialogs; we show a one-time onboarding.
6. Zero new Rust dependencies in the `audio` or `video` space (reqwest + base64 + existing attachment pipeline is enough).

## Task breakdown

### T8.1 — Push-to-talk voice input · ~4 days

- **Capture**: use the Web Audio API (`MediaRecorder`) on the frontend side. Tauri 2 has first-class `mediaDevices.getUserMedia` access.
- **Upload**: `MediaRecorder` chunk → Blob → base64 → new IPC `voice_transcribe(audio_b64, mime, endpoint)` which POSTs to the configured ASR endpoint and returns text.
- **Settings**:
  - `voice.hotkey` — hotkey string (default `Space+Meta`).
  - `voice.asr_endpoint` — URL to hit.
  - `voice.asr_api_key` — stored encrypted via OS keychain (Tauri plugin `tauri-plugin-keychain`; this is one new dep).
- **UX**:
  - Chat input shows a mic icon when voice is configured. Clicking opens a "hold to speak" overlay.
  - Live waveform visualisation while recording.
  - Release → immediate transcription preview (editable) → user confirms → message sends.
- **Tests**: Playwright — stub the ASR endpoint, simulate a short press, confirm the message appears. Rust — IPC round-trips with recorded fixture audio.

### T8.2 — TTS playback · ~3 days

- **Endpoint**: configurable, defaults to OpenAI's `/audio/speech`. Same `settings` pattern as T8.1.
- **Flow**: on chat `done` event, optionally auto-play the assistant's text. A speaker icon on each bubble toggles playback; click again to stop.
- **Streaming**: if the configured endpoint supports streamed audio, pipe chunks into a `<audio>` element via `MediaSource`. Otherwise download-then-play.
- **Voice / speed / pitch**: a new "Voice" subpanel under Settings › Chat, only visible when TTS is configured.
- **Accessibility**: auto-play defaults to OFF. User must opt in to avoid surprise audio.
- **Privacy**: audio chunks stream through the Hermes side ONLY IF the user explicitly configured Hermes as the TTS endpoint; otherwise direct from Corey → provider (same as T8.1 ASR).

### T8.3 — Video attachment surfacing · ~3 days

- **Ingestion**: extend the existing attachment pipeline (`src-tauri/src/attachments.rs`) to accept `video/*` MIME. Size cap 200 MB (raise only on explicit user request).
- **UI**: chat attachment strip shows a video thumbnail (first-frame extract via `<video>` on render — still no server-side frame processing; we just render the HTML5 video element).
- **Adapter gate**: `capabilities().video` flag added to the `Capabilities` struct. Hermes returns `true` only when the gateway config declares a video-capable model. If `false`, the UI rejects the upload with a clear error.
- **Pass-through**: the attachment is staged on disk as usual; the adapter is responsible for delivering it to its backend. Corey never reads frames.
- **Result rendering**: Hermes' response carries `ChatStreamEvent::ToolProgress` with `tool: "video_analyze"` → frontend renders a "Video analysis" panel next to the bubble, containing Hermes' text output + optional timeline markers.
- **Tests**: Playwright — attach a tiny test video → confirm it reaches the Hermes mock with correct MIME → render the mocked response.

### T8.4 — Permission onboarding · ~2 days

- First-time mic access: explain what we use it for, link to Settings. Chinese + English copy.
- First-time TTS: same pattern, plus a sample playback so users know the voice before enabling.
- macOS: handle the system-level "Allow microphone access" dialog gracefully — show an inline error and a deep-link to System Settings if denied.

### T8.5 — Privacy + audit · ~1 day

- Every voice / video IPC emits a `changelog.jsonl` entry: `voice.transcribe`, `voice.tts`, `video.upload`. Users can audit what modality data left their machine.
- Settings page adds a "Modality data events" view that filters the changelog to just these entries.

## Non-goals (documented for future-proofing)

- **Always-on voice wake word / VAD** → rejected. See `06-backlog.md`.
- **On-device ASR / TTS models (whisper.cpp, Piper, etc.)** → rejected in Phase 8. Bundle-size blow-up, model-quality gap vs cloud, and per-OS build complexity aren't worth it for a developer tool. Might reconsider once a 50 MB model matches GPT-4o-level ASR.
- **Local video processing (ffmpeg, frame extraction, on-device captioning)** → rejected. Same reasoning as `06-backlog.md` § Desktop-side video processing.
- **Digital human / avatar / 3D rendering** → rejected permanently. Separate-product territory.
- **Real-time meeting transcription (Zoom / Meet integration)** → rejected. OS-level permissions + vendor SDKs put this outside the scope of a keyboard-first desktop tool. A user who wants this runs Whisper locally and pipes to Corey; we don't bundle the integration.

## Test totals target

- Rust unit: **+3** (voice IPC shape, TTS streaming, video MIME gate).
- Playwright: **+3** (voice round-trip, TTS toggle, video attachment).
- Permission / onboarding: manual test checklist; Playwright can't drive OS dialogs.

## Deltas vs the original brainstorm

| Brainstorm item | Landed in Phase 8 as |
|-----------------|----------------------|
| 6.1 视频输入 | T8.3 (UI only; Hermes does the work) |
| 6.2 帧采样 | **Rejected** — Hermes responsibility |
| 6.3 视频摘要 | T8.3 (render Hermes' result) |
| 6.4 实时会议辅助 | **Rejected permanently** |
| 6.5 视频工具调用 | Covered via Phase 9+ tool-calling (see `docs/09-conversational-scheduler.md` Stage 3) |
| 7.1 语音唤醒 | **Rejected permanently** |
| 7.2 ASR | T8.1 |
| 7.3 TTS | T8.2 |
| 7.4 实时对话 | T8.1 push-to-talk UX |
| 7.5 声纹识别 | **Rejected** (research-grade; no product need) |
| 8️⃣ AI 人 / 数字人 (全部) | **Rejected permanently** |

## Demo script (end-of-phase, if shipped)

1. Open Settings › Voice. Enter an OpenAI API key. Save.
2. Return to Chat. Hold `Cmd+Space`. Say "show me yesterday's error logs". Release.
3. See the transcription appear in the input, press Enter (or let it auto-send). Assistant replies.
4. Click the speaker icon on the assistant reply — hear it read aloud.
5. Drag a `.mp4` into the input. Upload succeeds because the active Hermes instance declares `video: true`. Hermes' analysis renders below the video thumbnail.
6. Open Settings › Modality data events. See three entries (transcribe, tts, video.upload) in the audit log.
