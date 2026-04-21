# Phase 1 · Chat Core

**Goal**: Replace Hermes TUI for everyday chat. Real gateway, real sessions, real tool calls, attachments, model selection.

**Est.**: 3–4 days solo.

**Depends on**: Phase 0.

## Exit criteria

1. User connects to a running Hermes gateway via a discovery step; status goes green.
2. Sessions list loads from `hermes` CLI; grouping by source works; sort by last message.
3. Sending a message streams deltas in real time; first token to screen < 150 ms after arrival.
4. Tool calls render as collapsible cards inline with text; args + result both visible.
5. Markdown renders with code highlighting; copy button on each code block.
6. File upload works for ≥ 3 types (txt, png, pdf); drag-and-drop + paste.
7. Global model selector lists all discovered models; per-session override persists.
8. Cancel mid-stream works cleanly; partial message preserved and flagged.
9. Reconnect on gateway restart without losing session state.
10. 10k-message session scrolls at 60 fps (virtualized).
11. Unit + e2e + Rust conformance tests all green on CI.

## Task breakdown

### T1.1 — Gateway client (1 day)

- `src-tauri/src/adapters/hermes/gateway.rs` — real implementation per `docs/04-hermes-integration.md`.
- SSE parsing with `eventsource-stream`; map to `Delta`s.
- Connection pool (reqwest client with keep-alive); timeouts: connect 3 s, idle 60 s.
- Cancellation via `tokio_util::sync::CancellationToken`.
- Recorded fixtures: 6 captured SSE streams (short message, long message, tool-call, multi-tool, error, interrupted).
- Tests: stream parsing from fixtures → asserts `Delta` sequence matches golden output.

### T1.2 — CLI wrapper (half day)

- `src-tauri/src/adapters/hermes/cli.rs` — `version`, `session_list/create/rename/delete`.
- Timeout each call; classify stderr into `AdapterError` variants.
- Tests: use a `cli-mock` binary written in Rust test helpers, invoked instead of `hermes` in CI.

### T1.3 — Chat IPC (half day)

- `src-tauri/src/ipc/chat.rs`:
  - `chat_send(req) -> StreamHandle`
  - `chat_cancel(handle)`
- Events:
  - `chat:delta:{handle}`
  - `chat:error:{handle}`
  - `chat:end:{handle}`
- Handle lifecycle managed by a `StreamRegistry` inside `AppState`.

### T1.4 — Chat UI (1 day)

- `src/features/chat/`:
  - `SessionsPanel.tsx` — virtualized list, grouped accordion by source, live session pinned top with spinner.
  - `ChatView.tsx` — virtualized message list (TanStack Virtual), auto-scroll-to-bottom with "jump to latest" affordance when user scrolled up.
  - `MessageItem.tsx` — role-aware rendering; user right-aligned, assistant left; timestamps on hover.
  - `ToolCallCard.tsx` — collapsible, diff between `args_partial` accumulating vs final, result preview.
  - `Markdown.tsx` — `react-markdown` + `remark-gfm` + Shiki (pre-compiled common langs: ts, js, py, rust, bash, json, yaml, md).
  - `Composer.tsx` — textarea with autosize, model override dropdown, file attachment tray, slash-command autocomplete (stubs in Phase 1; real in Phase 4).
  - `Inspector.tsx` — right rail; shows current message tool calls, token usage, model, latency.
- Stream store: `src/stores/chat.ts` — per-session reducer; listens to `chat:delta:{handle}` events.
- Cancel button in composer while streaming; cancelled messages get a "⎯ interrupted" tag.

### T1.5 — Attachments (half day)

- `src-tauri/src/ipc/attach.rs` — accept a file path or base64 blob, stage in `~/.caduceus/attachments/{session}/…`, return an ID.
- Frontend: drag-and-drop on the composer area, paste handler for images, file picker button.
- Only types allowed by the current model's capabilities; dynamically hide image upload when the model isn't vision.

### T1.6 — Model discovery (half day)

- `src-tauri/src/ipc/model.rs` — `model_list` aggregates:
  - Gateway's `/v1/models`.
  - `auth.json` provider credentials (enrich missing ones with each provider's `/v1/models` call).
- Result cached in TanStack Query; invalidated by file watcher on `auth.json`.
- Frontend: model selector in topbar (global default) and in composer (per-send override). Both share one combobox component with searchable, grouped-by-provider display.

### T1.7 — Resilience (half day)

- Heartbeat: `invoke('gateway_health')` every 10 s; status dot reflects result.
- If SSE disconnects mid-stream: synthesize `MessageEnd { finish_reason: Interrupted }`; toast with retry action that sends the last user message again with `continue_from=<message_id>` if supported.
- Reconnect logic hidden behind `gateway.rs`; the UI sees a stable stream.

## Files touched / created

```
src-tauri/src/
├── adapters/hermes/{gateway.rs, cli.rs, fixtures/*.json}
├── ipc/{chat.rs, attach.rs, model.rs}
├── state.rs           (AppState, StreamRegistry)
src/
├── features/chat/{SessionsPanel,ChatView,MessageItem,ToolCallCard,Markdown,Composer,Inspector}.tsx
├── stores/chat.ts
├── lib/ipc/chat.ts
└── components/ui/{Avatar, FileTray, StatusDot, StreamIndicator}.tsx
tests/
├── e2e/chat-stream.spec.ts
├── e2e/tool-call-render.spec.ts
└── fixtures/sse/*.jsonl
```

## Test plan

- **Golden stream tests** (Rust): 6 SSE fixtures → expected `Delta[]`.
- **UI reducer tests**: feed `Delta[]` into the chat store, assert final message tree.
- **e2e (Playwright)**: mock gateway (local hyper server replaying a fixture) + real adapter → send message → verify text appears + tool card renders + usage chip shows.
- **Performance**: 10k-message seeded session → scroll from top to bottom within 2 s; assert no frames > 16 ms via Playwright tracing.
- **Accessibility**: keyboard-only path (Tab to composer, type, Cmd+Enter to send, Escape to cancel stream).

## Demo script

1. Connect dialog detects a running Hermes; status flips to green.
2. Sidebar → Chat; sessions list populated; pick one.
3. Send "summarize this PDF" with a file attached; watch streaming tokens, tool cards fold in, final answer renders.
4. Switch model mid-conversation via composer dropdown.
5. Hit Esc mid-stream; show the interrupted tag; click retry.
6. Crash Hermes gateway in a terminal; status dot goes red; restart; stream resumes on next send.

## What Phase 1 does NOT do

- No model provider management (just reads `auth.json`, no writes).
- No usage analytics dashboard (just per-message chips).
- No skill editor, no trajectory view.
- No platform channel configuration.
- No web-only mode (Tauri-only).
