import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Send, Sparkles, Square } from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  chatStream,
  dbMessageSetUsage,
  generateTitle,
  ipcErrorMessage,
  type ChatMessageDto,
  type ChatStreamHandle,
} from '@/lib/ipc';
import { newMessageId, useChatStore, type UiMessage, type UiToolCall } from '@/stores/chat';
import { useComposerStore } from '@/stores/composer';
import { ActiveLLMBadge } from './ActiveLLMBadge';
import { MessageBubble } from './MessageBubble';
import { SessionsPanel } from './SessionsPanel';

/**
 * Module-level empty array so the `sessionMessages` selector returns a
 * STABLE reference when the current session has no messages (or when there
 * is no current session at all). Creating `[]` inline inside the selector
 * produced a fresh array each call — with `useSyncExternalStore` that made
 * React think the store snapshot had changed on every render, leading to
 * "Maximum update depth exceeded" loops on startup.
 */
const EMPTY_MESSAGES: UiMessage[] = [];

export function ChatRoute() {
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

  // Once hydrated, ensure there's always a current session. If the DB came
  // back empty, spin up a fresh one; otherwise the hydrate (dispatched
  // once at app boot by `Providers`) has already restored the MRU session.
  useLayoutEffect(() => {
    if (hydrated && !currentId) newSession();
  }, [hydrated, currentId, newSession]);

  return (
    <div className="flex h-full min-h-0 w-full">
      <SessionsPanel />
      {hydrated && currentId ? (
        <ChatPane
          sessionId={currentId}
          messages={sessionMessages}
          appendMessage={appendMessage}
          patchMessage={patchMessage}
          appendToolCall={appendToolCall}
          renameSession={renameSession}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-fg-muted">
          {hydrated ? 'Initializing…' : 'Loading sessions…'}
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

function ChatPane({
  sessionId,
  messages,
  appendMessage,
  patchMessage,
  appendToolCall,
  renameSession,
}: ChatPaneProps) {
  // T4.6: read pendingDraft as initial state so a Runbook launch is
  // reflected on the very first paint. Clearing it happens in the mount
  // effect below — doing it inside the initializer would race with
  // React StrictMode's double-invocation (the second mount would see an
  // already-cleared store and reset the composer to empty).
  const [draft, setDraft] = useState<string>(
    () => useComposerStore.getState().pendingDraft ?? '',
  );
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Live handle for the current stream, so Stop can cancel it.
  const streamRef = useRef<ChatStreamHandle | null>(null);
  // Also track the pending id to null-out the spinner on stop.
  const pendingRef = useRef<string | null>(null);

  // Reset composer when switching sessions. Also re-seeds from
  // pendingDraft so launching a runbook into a brand-new session reaches
  // the freshly-mounted pane. We do NOT clear pendingDraft here — the
  // clear is deferred to `send()` and `onDraftChange()` so StrictMode's
  // double-mount doesn't wipe it before the user sees it.
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

  // Auto-scroll on new messages / growing content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: UiMessage = {
      id: newMessageId(),
      role: 'user',
      content: trimmed,
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

    setDraft('');
    setSending(true);
    pendingRef.current = pendingId;
    // T4.6: the user has taken ownership of the prompt — drop any
    // pending runbook draft so a back-navigation doesn't re-seed it.
    clearPendingDraftIfSet();

    const historyForIpc: ChatMessageDto[] = [
      ...messages
        .filter((m) => !m.error && !m.pending)
        .map<ChatMessageDto>((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: trimmed },
    ];

    try {
      const handle = await chatStream(
        // Model is NOT sent — Hermes always uses its own ~/.hermes/config.yaml,
        // ignoring any `model` field in chat requests. See LLMs page for real
        // provider/model switching.
        { messages: historyForIpc },
        {
          onDelta: (chunk) => {
            // Read current content from store to append — avoids stale closures.
            const sess = useChatStore.getState().sessions[sessionId];
            const current = sess?.messages.find((m) => m.id === pendingId);
            patchMessage(sessionId, pendingId, {
              content: (current?.content ?? '') + chunk,
              pending: false,
            });
          },
          onTool: (progress) => {
            appendToolCall(sessionId, pendingId, {
              id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              tool: progress.tool,
              emoji: progress.emoji,
              label: progress.label,
              at: Date.now(),
            });
            // A tool event proves the stream is alive — clear the pending spinner.
            const sess = useChatStore.getState().sessions[sessionId];
            const current = sess?.messages.find((m) => m.id === pendingId);
            if (current?.pending) {
              patchMessage(sessionId, pendingId, { pending: false });
            }
          },
          onDone: (summary) => {
            patchMessage(sessionId, pendingId, { pending: false });
            setSending(false);
            streamRef.current = null;
            pendingRef.current = null;
            // T2.4: persist token usage so Analytics can roll it up. Fire-
            // and-forget — a DB hiccup shouldn't visibly break the chat.
            if (
              summary.prompt_tokens !== null ||
              summary.completion_tokens !== null
            ) {
              void dbMessageSetUsage({
                messageId: pendingId,
                promptTokens: summary.prompt_tokens,
                completionTokens: summary.completion_tokens,
              }).catch(() => {
                /* intentionally swallowed — see comment above */
              });
            }
            // After the FIRST full turn, ask the LLM for a better title.
            // We detect "first turn" by checking that the only user message
            // in this session is the one we just sent.
            const sess = useChatStore.getState().sessions[sessionId];
            if (!sess) return;
            const userCount = sess.messages.filter((m) => m.role === 'user').length;
            const firstAssistant = sess.messages.find(
              (m) => m.id === pendingId,
            )?.content;
            if (userCount === 1 && firstAssistant && firstAssistant.length > 0) {
              void generateTitle(trimmed, firstAssistant).then((title) => {
                if (title) renameSession(sessionId, title);
              });
            }
          },
          onError: (err) => {
            patchMessage(sessionId, pendingId, {
              content: '',
              pending: false,
              error: ipcErrorMessage(err),
            });
            setSending(false);
            streamRef.current = null;
            pendingRef.current = null;
          },
        },
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

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) {
      void stop();
    } else {
      void send(draft);
    }
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!sending) void send(draft);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Chat" subtitle="Hermes · streaming · Sprint 2" />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
          {messages.length === 0 ? (
            <EmptyHero onPick={(prompt) => void send(prompt)} />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} />)
          )}
        </div>
      </div>

      <div className="border-t border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center px-6 pt-3">
          <ActiveLLMBadge />
        </div>
        <form onSubmit={onSubmit} className="mx-auto flex max-w-3xl items-end gap-2 px-6 pb-4 pt-2">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              clearPendingDraftIfSet();
            }}
            onKeyDown={onTextareaKeyDown}
            rows={1}
            placeholder="Message Hermes…  (Enter to send, Shift+Enter for newline)"
            disabled={sending}
            className={cn(
              'min-h-[44px] max-h-[200px] flex-1 resize-none rounded-xl border border-border',
              'bg-bg-elev-1 px-4 py-3 text-sm text-fg placeholder:text-fg-subtle',
              'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
              'disabled:opacity-60',
            )}
          />
          {sending ? (
            <Button
              type="submit"
              variant="secondary"
              className="h-11 px-4"
              aria-label="Stop generating"
              title="Stop"
            >
              <Square className="h-4 w-4" fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={!draft.trim()}
              className="h-11 px-4"
              aria-label="Send message"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

function EmptyHero({ onPick }: { onPick: (prompt: string) => void }) {
  const suggestions = [
    '用一句话解释什么是 Hermes Agent。',
    'Summarize the TRAE sandboxing model in 3 bullets.',
    '帮我生成一个 Rust 的 Tokio 基础示例。',
  ];
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-500">
        <Sparkles className="h-6 w-6" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Talk to Hermes</h2>
        <p className="text-sm text-fg-muted">
          Connected through the local gateway on <code className="font-mono text-xs">:8642</code>.
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-1">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-bg-elev-1 px-4 py-3 text-left text-sm text-fg transition hover:border-gold-500/40 hover:bg-gold-500/5"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

