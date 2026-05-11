import type { ChatStreamHandle } from '@/lib/ipc';

/**
 * Module-level registry of in-flight chat-stream handles, keyed by
 * `sessionId`. Lives **outside** React so a `/chat` route unmount
 * (user switching to /settings, /workflows, etc. mid-stream) doesn't
 * GC the handle along with the component. On remount, `useChatSend`
 * reads from here and re-binds Stop to the live handle.
 *
 * Without this map, navigating away during streaming would freeze the
 * Composer in `sending=false` state on return — Stop would have no
 * handle to cancel, and the user would perceive the chat as
 * "terminated" even though the Tauri-side SSE task is still running
 * + still updating the global `useChatStore` (because Tauri
 * `listen()` registrations also outlive component unmount).
 *
 * Registry is process-lifetime: cleared only by `done` / `error` /
 * explicit `stop()`. Tauri Webview reload (rare, manual dev gesture)
 * resets the JS module so the map is naturally empty again — the
 * Rust-side stream task we lost track of will eventually reach its
 * own done/error and emit into the void, harmless.
 */
export const ACTIVE_STREAMS = new Map<string, ChatStreamHandle>();
