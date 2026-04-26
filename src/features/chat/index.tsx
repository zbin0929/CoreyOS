import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/app/shell/PageHeader';
import {
  chatStream,
  ipcErrorMessage,
  learningIndexMessage,
  voiceRecord,
  voiceRecordStop,
  voiceTranscribe,
  type ChatMessageDto,
  type ChatStreamHandle,
} from '@/lib/ipc';
import { visionSupport } from '@/lib/modelCapabilities';
import { describeBreach, evaluateBudgetGate } from './budgetGate';
import { useAppStatusStore } from '@/stores/appStatus';
import {
  newMessageId,
  useChatStore,
  type UiAttachment,
  type UiMessage,
  type UiToolCall,
} from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useComposerStore } from '@/stores/composer';
import { useRoutingStore } from '@/stores/routing';
import { resolveRoutedRule } from './routing';
import { ChatSearch } from './ChatSearch';
import { computeActiveMatchIndex } from './chatSearchMatch';
import { useChatIntentSuggestions } from './useChatIntentSuggestions';
import { usePostSendEffects } from './usePostSendEffects';
import { ChatHeaderActions, EmptyHero } from './ChatHelpers';
import { Composer } from './Composer';
import { LearningIndicator } from './LearningIndicator';
import { enrichHistoryWithContext } from './enrichHistory';
import { buildStreamCallbacks, resolveAdapterId, toDto } from './useStreamCallbacks';
import { MessageList } from './MessageList';
import { SessionsPanel } from './SessionsPanel';
import { useAttachments } from './useAttachments';
import type { VirtuosoHandle } from 'react-virtuoso';

/**
 * Module-level empty array so the `sessionMessages` selector returns a
 * STABLE reference when the current session has no messages (or when
 * there is no current session at all). Creating `[]` inline inside the
 * selector produced a fresh array each call — with `useSyncExternalStore`
 * that made React think the store snapshot had changed on every render,
 * leading to "Maximum update depth exceeded" loops on startup.
 */
const EMPTY_MESSAGES: UiMessage[] = [];

export function ChatRoute() {
  const { t } = useTranslation();
  const currentId = useChatStore((s) => s.currentId);
  const hydrated = useChatStore((s) => s.hydrated);
  const newSession = useChatStore((s) => s.newSession);
  const sessionMessages = useChatStore((s) =>
    s.currentId ? (s.sessions[s.currentId]?.messages ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const appendMessage = useChatStore((s) => s.appendMessage);
  const patchMessage = useChatStore((s) => s.patchMessage);
  const appendToolCall = useChatStore((s) => s.appendToolCall);
  const renameSession = useChatStore((s) => s.renameSession);

  // Once hydrated, ensure there's always a current session. If the DB
  // came back empty, spin up a fresh one; otherwise the hydrate
  // (dispatched once at app boot by `Providers`) has already restored
  // the MRU session.
  useLayoutEffect(() => {
    if (hydrated && !currentId) newSession();
  }, [hydrated, currentId, newSession]);

  return (
    <div className="flex h-full min-h-0 w-full">
      <SessionsPanel />
      {hydrated && currentId ? (
        // `key={currentId}` force-remounts ChatPane (and therefore
        // `MessageList` / Virtuoso) when the user switches sessions.
        // Without this, Virtuoso's `initialTopMostItemIndex` only
        // applies on first mount, so entering an old session scrolled
        // the user to the top of the history instead of the latest
        // reply. Remount cost is cheap — Virtuoso only renders
        // viewport rows regardless.
        <ChatPane
          key={currentId}
          sessionId={currentId}
          messages={sessionMessages}
          appendMessage={appendMessage}
          patchMessage={patchMessage}
          appendToolCall={appendToolCall}
          renameSession={renameSession}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-fg-muted">
          {hydrated ? t('chat_page.initializing') : t('chat_page.loading_sessions')}
        </div>
      )}
    </div>
  );
}

interface ChatPaneProps {
  sessionId: string;
  messages: UiMessage[];
  appendMessage: (sessionId: string, msg: UiMessage) => void;
  patchMessage: (
    sessionId: string,
    msgId: string,
    patch: Partial<Omit<UiMessage, 'id'>>,
  ) => void;
  appendToolCall: (sessionId: string, msgId: string, call: UiToolCall) => void;
  renameSession: (id: string, title: string) => void;
}

/**
 * Conversation pane — owns the lifecycle of a single chat session
 * (composing → sending → streaming → done / cancelled) and the side
 * effects that hang off it (post-send title generation + intent
 * detection + learning indexing).
 *
 * What got pulled OUT of this component (for sanity):
 *  - Drag/drop / paste / file-pick / chip removal → `useAttachments`
 *  - Footer JSX (composer + warnings + chips) → `Composer`
 *  - Bottom-of-pane "learning extracted" toast → `LearningIndicator`
 *
 * What stays HERE (because it's session-coupled):
 *  - `send()` / `retry()` / `stop()` — the chat-stream orchestration
 *    that wires together the budget gate, history, adapter routing,
 *    optimistic message append, and IPC handle. Tightly bound to the
 *    chat-store mutators and the `usePostSendEffects` hook.
 *  - Search bar state (Cmd+F + match-index navigation).
 *  - Voice record toggle (small enough to keep inline).
 *  - Composer textarea auto-resize (uses the same ref we hand to
 *    `<Composer>`).
 */
function ChatPane({
  sessionId,
  messages,
  appendMessage,
  patchMessage,
  appendToolCall,
  renameSession,
}: ChatPaneProps) {
  const { t } = useTranslation();
  // T4.6: read pendingDraft as initial state so a Runbook launch is
  // reflected on the very first paint. Clearing it happens in the
  // mount effect below — doing it inside the initializer would race
  // with React StrictMode's double-invocation (the second mount
  // would see an already-cleared store and reset the composer to
  // empty).
  const [draft, setDraft] = useState<string>(
    () => useComposerStore.getState().pendingDraft ?? '',
  );
  const [sending, setSending] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  // Live handle for the current stream, so Stop can cancel it.
  const streamRef = useRef<ChatStreamHandle | null>(null);
  // Also track the pending id to null-out the spinner on stop.
  const pendingRef = useRef<string | null>(null);

  // Attachment lifecycle (paste / drop / chip remove) — extracted
  // because the inline version was ~75 lines of pure UI plumbing
  // with no chat-state interlock beyond "snapshot on send".
  const att = useAttachments();

  // T-polish — ref + auto-resize effect for the composer textarea.
  // Default `<textarea rows={1}>` is fixed-height; users typing more
  // than one line see their prose scroll inside a cramped box. We
  // grow it to fit the content up to ~3× the base height (~132px)
  // and let overflow scroll after that — the composer is not a code
  // editor, and a bigger box starts to eat the message viewport.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Hidden file input driving the Paperclip button. Native HTML
  // element — no plugin dependency, browser/Tauri-identical.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // T4.4b — breaches flagged by the budget gate on the LAST send
  // attempt. Re-populated (or cleared) every time send() runs so the
  // list reflects the current turn, not stale state.
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([]);

  // T-polish — in-chat message search state. Query survives a close
  // so re-opening with Cmd+F jumps right back to where the user was.
  // Reset explicitly on session switch (effect below) because match
  // indices across two different sessions are semantically
  // meaningless.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const listRef = useRef<VirtuosoHandle | null>(null);

  const {
    pendingRef: intentPendingRef,
    handleSuggestionConfirm,
    handleSuggestionDismiss,
    detectIntents,
  } = useChatIntentSuggestions({ sessionId, patchMessage });

  const onStreamDone = usePostSendEffects({
    sessionId,
    renameSession,
    detectIntents,
  });

  // Cmd+F / Ctrl+F inside the chat route opens the search bar. We
  // register the handler on the ChatPane's root (below) rather than
  // globally so other routes keep the browser's native find-in-page
  // behaviour. The Tauri webview also respects the preventDefault.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-resize the composer textarea to fit its content, clamped to
  // a 3× ceiling. Reset first so SHRINKING the content also shrinks
  // the box (otherwise `scrollHeight` stays pegged at the max once
  // we've grown there). useLayoutEffect to avoid a one-frame flash
  // at the wrong height when the user pastes a multi-line blob.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const MAX = 132; // ~3× the 44px min-height
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX)}px`;
  }, [draft]);

  // Reset search state on session switch — matches jump between
  // conversations, stale index on a different message array is
  // confusing.
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchActiveIdx(0);
  }, [sessionId]);

  // T1.5c — resolve the effective model: per-session override wins
  // over the gateway-wide default. Subscribed so the composer reacts
  // live to a model switch in Settings or via the Models page.
  const sessionModelOverride = useChatStore((s) => s.sessions[sessionId]?.model ?? null);
  const defaultModel = useAppStatusStore((s) => s.currentModel);
  const effectiveModel = sessionModelOverride ?? defaultModel;
  const visionCap = visionSupport(effectiveModel);
  // Only warn about non-vision models when the user actually has an
  // image queued — non-image attachments still go through via the
  // `[attached: name]` text marker and don't need vision support.
  const hasPendingImage = att.pendingAttachments.some((a) => a.mime.startsWith('image/'));
  const imageBlockedByModel = visionCap === 'no' && hasPendingImage;

  // Reset composer when switching sessions. Also re-seeds from
  // pendingDraft so launching a runbook into a brand-new session
  // reaches the freshly-mounted pane. We do NOT clear pendingDraft
  // here — the clear is deferred to `send()` and `onDraftChange()`
  // so StrictMode's double-mount doesn't wipe it before the user
  // sees it.
  useEffect(() => {
    const pending = useComposerStore.getState().pendingDraft;
    setDraft(pending ?? '');
    setSending(false);
    streamRef.current = null;
    pendingRef.current = null;
  }, [sessionId]);

  function clearPendingDraftIfSet() {
    if (useComposerStore.getState().pendingDraft !== null) {
      useComposerStore.getState().setPendingDraft(null);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    const hasAttachments = att.pendingAttachments.length > 0;
    // Let the user send a message whose payload is purely
    // attachments — the provider still gets a "[attached: …]" marker
    // in the content.
    if ((!trimmed && !hasAttachments) || sending) return;

    // T4.4b — budget gate. Runs BEFORE we commit the message to the
    // store so a blocked send leaves the composer exactly as the
    // user typed it. `evaluateBudgetGate` fails-safe on IPC errors
    // (returns empty verdict), so a transient db/analytics hiccup
    // never locks the user out of chatting. `activeAdapterId` is
    // read imperatively (same pattern as the chatStream call below)
    // because the gate's verdict is tied to THIS send, not a
    // subsequent switcher change. Budget-gate should scope to
    // whichever adapter this turn will actually land on, which
    // mirrors the send() priority order below: profile pin > global
    // active > null.
    const gateSess = useChatStore.getState().sessions[sessionId];
    const gateProfilePin = gateSess?.llmProfileId ?? null;
    const activeAdapterIdForGate =
      (gateProfilePin
        ? `hermes:profile:${gateProfilePin}`
        : useAgentsStore.getState().activeId) ?? null;
    const verdict = await evaluateBudgetGate({
      effectiveModel,
      activeAdapterId: activeAdapterIdForGate,
    });
    if (verdict.blocks.length > 0) {
      const lines = verdict.blocks.map((b) => '  · ' + describeBreach(b)).join('\n');
      const ok = window.confirm(t('chat_page.budget_over_cap_confirm', { lines }));
      if (!ok) return;
    }
    if (verdict.warns.length > 0) {
      // Non-blocking: surface above the chip row for the next
      // render. We reset it once the stream starts so it's clearly
      // tied to this single send, not stale state.
      setBudgetWarnings(verdict.warns.map(describeBreach));
    } else {
      setBudgetWarnings([]);
    }

    // Bake pending attachments into the user message. Snapshot
    // before we clear so a fast follow-up paste doesn't attach to
    // the wrong turn.
    const snapshotStaged = att.takeSnapshotAndClear();
    const attachmentsSnapshot: UiAttachment[] = snapshotStaged.map((a) => ({
      id: a.id,
      name: a.name,
      mime: a.mime,
      size: a.size,
      path: a.path,
      createdAt: a.created_at,
    }));
    // T1.5b — the stored bubble content is now just the user's
    // typed text (attachments render as chips above/inside the
    // bubble). The LLM receives the same clean text PLUS an
    // `attachments` array on the outgoing ChatMessageDto; the Rust
    // adapter expands that into OpenAI's multimodal content array
    // (text part + image_url parts).
    const contentForMessage = trimmed;

    const userMsg: UiMessage = {
      id: newMessageId(),
      role: 'user',
      content: contentForMessage,
      attachments: hasAttachments ? attachmentsSnapshot : undefined,
      createdAt: Date.now(),
    };
    const pendingId = newMessageId();
    const pendingMsg: UiMessage = {
      id: pendingId,
      role: 'assistant',
      content: '',
      pending: true,
      createdAt: Date.now(),
    };

    appendMessage(sessionId, userMsg);
    appendMessage(sessionId, pendingMsg);

    void learningIndexMessage(userMsg.id, contentForMessage).catch(() => {});

    setDraft('');
    setSending(true);
    pendingRef.current = pendingId;
    intentPendingRef.current = pendingId;
    // T4.6: the user has taken ownership of the prompt — drop any
    // pending runbook draft so a back-navigation doesn't re-seed it.
    clearPendingDraftIfSet();

    const historyForIpc: ChatMessageDto[] = [
      ...messages
        .filter((m) => !m.error && !m.pending)
        .map<ChatMessageDto>((m) => toDto(m.role, m.content, m.attachments)),
      toDto('user', contentForMessage, hasAttachments ? attachmentsSnapshot : undefined),
    ];

    const finalHistory = await enrichHistoryWithContext(historyForIpc, contentForMessage);

    // T5.5b / T6.4 — adapter routing. Priority for THIS turn:
    //   1. Routing-rule match (handled below as `routedAdapterId`)
    //   2. Per-session LLM Profile pin — set when the user picked a
    //      Profile row in the model picker. Must win over the global
    //      AgentSwitcher choice, otherwise "pick profile X" silently
    //      keeps routing through whatever agent is globally active.
    //      NOTE: this does NOT look at session.adapterId — that
    //      field is purely for sidebar grouping and is frozen at
    //      creation (see db.rs :: upsert_session COALESCE).
    //   3. Global AgentSwitcher choice (`useAgentsStore.activeId`).
    //   4. Default registry entry (undefined → backend picks).
    const sendSess = useChatStore.getState().sessions[sessionId];
    const sendProfilePin = sendSess?.llmProfileId ?? null;
    const fallbackAdapterId =
      (sendProfilePin
        ? `hermes:profile:${sendProfilePin}`
        : useAgentsStore.getState().activeId) ?? undefined;
    const registered = new Set(
      useAgentsStore.getState().adapters?.map((a) => a.id) ?? [],
    );
    const matched = resolveRoutedRule(useRoutingStore.getState().rules, trimmed);
    const routedAdapterId =
      matched && registered.has(matched.target_adapter_id)
        ? matched.target_adapter_id
        : null;
    const activeAdapterId = routedAdapterId ?? fallbackAdapterId;
    if (routedAdapterId) {
      const priorUserCount = messages.filter((m) => m.role === 'user').length;
      if (priorUserCount === 0) {
        // Flip the session's pinned adapter before appending user +
        // pending bubbles so their adapter badge renders correctly.
        useChatStore.setState((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, adapterId: routedAdapterId },
            },
          };
        });
      }
    }

    try {
      const callbacks = buildStreamCallbacks(
        sessionId,
        pendingId,
        patchMessage,
        appendToolCall,
        setSending,
        streamRef,
        pendingRef,
        (pid, _text, summary) => onStreamDone(pid, trimmed, summary),
      );
      const handle = await chatStream(
        {
          messages: finalHistory,
          adapter_id: activeAdapterId,
          model: effectiveModel ?? undefined,
          model_supports_vision: visionCap !== 'no',
        },
        callbacks,
      );
      streamRef.current = handle;
    } catch (e) {
      patchMessage(sessionId, pendingId, {
        content: '',
        pending: false,
        error: ipcErrorMessage(e),
      });
      setSending(false);
      streamRef.current = null;
      pendingRef.current = null;
    }
  }

  /**
   * T-polish — regenerate the last assistant response.
   *
   * Scoped narrowly on purpose: only the trailing assistant message
   * is retriable. Mid-history retry would orphan subsequent messages
   * that were conditioned on the old reply, which is confusing and
   * hard to undo.
   *
   * Flow:
   *  1. Confirm the last message is a completed assistant bubble
   *     with an immediately-preceding user turn.
   *  2. Patch that assistant row in place: clear content / error /
   *     reasoning, drop its tool-call ribbon, flip pending=true.
   *     This keeps its id (and DB row) stable — tokens, feedback,
   *     and the title-generation trigger all key off the same id so
   *     reusing it avoids a cascade of side-effect cleanups.
   *  3. Re-stream into the same id with history[..target), i.e.
   *     every message up to (but not including) the assistant being
   *     retried, plus the preceding user turn as the tail.
   */
  async function retry() {
    if (sending) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.pending || last.error) return;
    // Walk back for the turn this assistant replied to. Guarding
    // against an assistant-first (malformed) session so we never
    // build a history with a dangling user-less reply.
    let userIdx = -1;
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i]!.role === 'user') {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return;

    const targetId = last.id;
    // Reset the assistant row. Undefined assignments clear those
    // fields via the existing `patchMessage` spread (it merges a
    // partial; undefined overwrites).
    patchMessage(sessionId, targetId, {
      content: '',
      reasoning: undefined,
      toolCalls: undefined,
      error: undefined,
      pending: true,
    });

    const historyForIpc: ChatMessageDto[] = messages
      .slice(0, messages.length - 1)
      .filter((m) => !m.error && !m.pending)
      .map<ChatMessageDto>((m) => toDto(m.role, m.content, m.attachments));

    const activeAdapterId = resolveAdapterId(sessionId, messages, '');

    setSending(true);
    pendingRef.current = targetId;
    try {
      const callbacks = buildStreamCallbacks(
        sessionId,
        targetId,
        patchMessage,
        appendToolCall,
        setSending,
        streamRef,
        pendingRef,
      );
      const handle = await chatStream(
        {
          messages: historyForIpc,
          adapter_id: activeAdapterId,
          model: effectiveModel ?? undefined,
          model_supports_vision: visionCap !== 'no',
        },
        callbacks,
      );
      streamRef.current = handle;
    } catch (e) {
      patchMessage(sessionId, targetId, {
        content: '',
        pending: false,
        error: ipcErrorMessage(e),
      });
      setSending(false);
      streamRef.current = null;
      pendingRef.current = null;
    }
  }

  async function stop() {
    const handle = streamRef.current;
    const pendingId = pendingRef.current;
    streamRef.current = null;
    pendingRef.current = null;
    setSending(false);
    if (handle) await handle.cancel();
    // Keep whatever content we got; drop the "thinking" state.
    if (pendingId) {
      patchMessage(sessionId, pendingId, { pending: false });
    }
  }

  function onVoiceStart() {
    if (voiceRecording) return;
    setVoiceRecording(true);
    void (async () => {
      try {
        const base64 = await voiceRecord(120);
        setVoiceRecording(false);
        try {
          const res = await voiceTranscribe(base64, 'audio/wav');
          if (res.text) {
            setDraft((d) => (d ? `${d} ${res.text}` : res.text));
          }
        } catch {
          /* non-critical */
        }
      } catch {
        setVoiceRecording(false);
      }
    })();
  }

  function onVoiceStop() {
    void voiceRecordStop().catch(() => {});
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) {
      void stop();
    } else {
      void send(draft);
    }
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // IME guard. `isComposing` alone is not enough on macOS WKWebView
    // + Chinese pinyin: after a candidate commit, some IMEs fire a
    // trailing Enter keydown with `isComposing === false` but
    // `keyCode === 229` (the "IME still processing" sentinel).
    // Without checking 229 we'd treat that trailing Enter as "send"
    // and split the user's typed CJK across a literal newline (bug:
    // "下午好" → bubble shows "下午\n好"). React's `KeyboardEvent`
    // doesn't expose `keyCode`, so read it off the native event.
    const ne = e.nativeEvent as unknown as { keyCode?: number };
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      ne.keyCode !== 229
    ) {
      e.preventDefault();
      if (!sending) void send(draft);
    }
  }

  function onDraftChange(next: string) {
    setDraft(next);
    clearPendingDraftIfSet();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={t('chat_page.title')}
        subtitle={t('chat_page.subtitle')}
        actions={<ChatHeaderActions sessionId={sessionId} messages={messages} />}
      />

      {/* T1.9 — virtualised list when we have messages; the empty-
       *  state hero gets its own layout so we don't pay Virtuoso's
       *  min-height default for a route with zero content. */}
      {messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
            <EmptyHero onPick={(prompt) => void send(prompt)} />
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* Floating-ish search bar: absolutely positioned INSIDE
              the scroll container so it doesn't steal layout height
              from the message list (no "bar pushes list down"
              jank). Kept above the list via z-10. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-6">
            <ChatSearch
              open={searchOpen}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onClose={() => setSearchOpen(false)}
              messages={messages}
              activeMatchIdx={searchActiveIdx}
              onActiveMatchChange={setSearchActiveIdx}
              onScrollToIndex={(index) =>
                listRef.current?.scrollToIndex({
                  index,
                  align: 'center',
                  behavior: 'smooth',
                })
              }
            />
          </div>
          <MessageList
            ref={listRef}
            messages={messages}
            activeMatchId={
              searchOpen && searchQuery.trim()
                ? (messages[
                    computeActiveMatchIndex(messages, searchQuery, searchActiveIdx)
                  ]?.id ?? null)
                : null
            }
            onRetryLastAssistant={() => void retry()}
            onSuggestionConfirm={handleSuggestionConfirm}
            onSuggestionDismiss={handleSuggestionDismiss}
          />
        </div>
      )}

      <Composer
        draft={draft}
        sending={sending}
        voiceRecording={voiceRecording}
        pendingAttachments={att.pendingAttachments}
        dragDepth={att.dragDepth}
        attachError={att.attachError}
        budgetWarnings={budgetWarnings}
        imageBlockedByModel={imageBlockedByModel}
        visionCap={visionCap}
        effectiveModel={effectiveModel}
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        onDraftChange={onDraftChange}
        onTextareaKeyDown={onTextareaKeyDown}
        onPaste={att.onPaste}
        onSubmit={onSubmit}
        onDragEnter={att.onDragEnter}
        onDragLeave={att.onDragLeave}
        onDragOver={att.onDragOver}
        onDrop={att.onDrop}
        onFilePicked={att.onFilePicked}
        onRemoveAttachment={(id) => void att.removePendingAttachment(id)}
        onVoiceStart={onVoiceStart}
        onVoiceStop={onVoiceStop}
      />
      <LearningIndicator />
    </div>
  );
}
