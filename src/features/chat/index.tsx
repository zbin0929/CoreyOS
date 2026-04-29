import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/app/shell/PageHeader';
import { visionSupport } from '@/lib/modelCapabilities';
import { useAppStatusStore } from '@/stores/appStatus';
import { useChatStore, type UiMessage, type UiToolCall } from '@/stores/chat';
import { ChatSearch } from './ChatSearch';
import { computeActiveMatchIndex } from './chatSearchMatch';
import { useChatIntentSuggestions } from './useChatIntentSuggestions';
import { usePostSendEffects } from './usePostSendEffects';
import { ChatHeaderActions, EmptyHero } from './ChatHelpers';
import { Composer } from './Composer';
import { GatewayStatusBanner } from './GatewayStatusBanner';
import { ApprovalCard } from './ApprovalCard';
import { LearningIndicator } from './LearningIndicator';
import { MessageList } from './MessageList';
import { SessionsPanel } from './SessionsPanel';
import { useAttachments } from './useAttachments';
import { useChatSend } from './useChatSend';
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
  // Attachment lifecycle (paste / drop / chip remove) — extracted
  // because the inline version was ~75 lines of pure UI plumbing
  // with no chat-state interlock beyond "snapshot on send".
  const att = useAttachments();

  const gatewaySource = useChatStore((s) => s.sessions[sessionId]?.gatewaySource);

  const sourceLabel = gatewaySource
    ? t('chat_page.gateway_source', { source: gatewaySource })
    : null;

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

  // T-polish — send / retry / stop / voice / IME / draft state.
  // The hook owns `draft`, `sending`, `voiceRecording`,
  // `budgetWarnings` plus every imperative entry-point ChatPane
  // wires into shortcuts and buttons. See `useChatSend.ts` for the
  // full preserved-invariants list.
  const chat = useChatSend({
    sessionId,
    messages,
    attachments: att,
    effectiveModel,
    visionCap,
    appendMessage,
    patchMessage,
    appendToolCall,
    intentPendingRef,
    onStreamDone,
    t,
  });

  // Auto-resize the composer textarea to fit its content, clamped to
  // a 3× ceiling. Reset first so SHRINKING the content also shrinks
  // the box (otherwise `scrollHeight` stays pegged at the max once
  // we've grown there). useLayoutEffect to avoid a one-frame flash
  // at the wrong height when the user pastes a multi-line blob.
  // Stays in the page (not the hook) because it's a DOM-ref-bound
  // side-effect with no business-logic interlock.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const MAX = 132; // ~3× the 44px min-height
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX);
    el.style.height = `${next}px`;
    // Composer.tsx default-hides the scrollbar gutter so empty
    // textareas don't show a phantom "|" line on macOS WebKit.
    // Once the user has typed past the ceiling, we DO need the
    // scrollbar back so they can read what they've already
    // written. Toggle here rather than driving it from CSS so
    // the threshold matches the cap exactly.
    el.style.overflowY = el.scrollHeight > MAX ? 'auto' : 'hidden';
  }, [chat.draft]);


  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={t('chat_page.title')}
        subtitle={sourceLabel || t('chat_page.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <LearningIndicator />
            <ChatHeaderActions sessionId={sessionId} messages={messages} />
          </div>
        }
      />

      {/* T1.9 — virtualised list when we have messages; the empty-
       *  state hero gets its own layout so we don't pay Virtuoso's
       *  min-height default for a route with zero content. */}
      {messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
            <EmptyHero onPick={(prompt) => void chat.send(prompt)} />
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
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
            onRetryLastAssistant={() => void chat.retry()}
            onSuggestionConfirm={handleSuggestionConfirm}
            onSuggestionDismiss={handleSuggestionDismiss}
          />
        </div>
      )}

      <GatewayStatusBanner />
      {chat.pendingApproval && (
        <ApprovalCard
          approval={chat.pendingApproval}
          sessionId={sessionId}
          onResolved={() => chat.setPendingApproval(null)}
        />
      )}
      {!gatewaySource && (
      <Composer
        draft={chat.draft}
        sending={chat.sending}
        voiceRecording={chat.voiceRecording}
        pendingAttachments={att.pendingAttachments}
        dragDepth={att.dragDepth}
        attachError={att.attachError}
        budgetWarnings={chat.budgetWarnings}
        imageBlockedByModel={imageBlockedByModel}
        visionCap={visionCap}
        effectiveModel={effectiveModel}
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        onDraftChange={chat.onDraftChange}
        onTextareaKeyDown={chat.onTextareaKeyDown}
        onPaste={att.onPaste}
        onSubmit={chat.onSubmit}
        onDragEnter={att.onDragEnter}
        onDragLeave={att.onDragLeave}
        onDragOver={att.onDragOver}
        onDrop={att.onDrop}
        onFilePicked={att.onFilePicked}
        onRemoveAttachment={(id) => void att.removePendingAttachment(id)}
        onVoiceStart={chat.onVoiceStart}
        onVoiceStop={chat.onVoiceStop}
      />
      )}
    </div>
  );
}
