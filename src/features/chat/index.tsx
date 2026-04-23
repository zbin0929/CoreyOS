import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { AlertTriangle, Paperclip, Send, Sparkles, Square, X } from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  attachmentDelete,
  attachmentStageBlob,
  chatStream,
  dbMessageSetUsage,
  generateTitle,
  ipcErrorMessage,
  type ChatMessageDto,
  type ChatStreamHandle,
  type StagedAttachment,
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

  // T1.5 — pending attachments staged but not yet sent. Local state (not in
  // a store) because it's purely UI-local and shouldn't survive navigation.
  // On send, these become `UiAttachment[]` on the user message; on remove,
  // we fire `attachmentDelete` to sweep the on-disk copy.
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  // Drag-over visual; toggled by the form-level handlers. Counter-based so
  // a child's enter/leave doesn't flicker the overlay during a drag.
  const [dragDepth, setDragDepth] = useState(0);
  // Hidden file input driving the Paperclip button. We keep it un-
  // rendered-as-chip by using the native HTML element — no extra library.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Transient error shown above the chip row when a stage fails.
  const [attachError, setAttachError] = useState<string | null>(null);
  // T4.4b — breaches flagged by the budget gate on the LAST send attempt.
  // Re-populated (or cleared) every time send() runs so the list reflects
  // the current turn, not stale state from minutes ago.
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([]);

  // T1.5c — resolve the effective model: per-session override wins over
  // the gateway-wide default. Subscribed so the composer reacts live to
  // a model switch in Settings or via the Models page.
  const sessionModelOverride = useChatStore((s) => s.sessions[sessionId]?.model ?? null);
  const defaultModel = useAppStatusStore((s) => s.currentModel);
  const effectiveModel = sessionModelOverride ?? defaultModel;
  const visionCap = visionSupport(effectiveModel);
  // Only warn about non-vision models when the user actually has an
  // image queued — non-image attachments still go through via the
  // `[attached: name]` text marker and don't need vision support.
  const hasPendingImage = pendingAttachments.some((a) => a.mime.startsWith('image/'));
  const imageBlockedByModel = visionCap === 'no' && hasPendingImage;

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

  /**
   * Read a File through FileReader and base64-encode it so the Rust
   * `attachment_stage_blob` command can decode once server-side. We
   * strip the `data:<mime>;base64,` prefix because the Rust helper
   * expects bare base64.
   */
  async function stageFile(file: File): Promise<void> {
    setAttachError(null);
    try {
      const base64Body = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(r.error ?? new Error('read failed'));
        r.onload = () => {
          const raw = typeof r.result === 'string' ? r.result : '';
          const comma = raw.indexOf(',');
          resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
        };
        r.readAsDataURL(file);
      });
      const staged = await attachmentStageBlob({
        name: file.name || 'pasted',
        mime: file.type || 'application/octet-stream',
        base64Body,
      });
      setPendingAttachments((prev) => [...prev, staged]);
    } catch (e) {
      setAttachError(ipcErrorMessage(e));
    }
  }

  async function removePendingAttachment(id: string) {
    const victim = pendingAttachments.find((a) => a.id === id);
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    if (victim) {
      // Fire-and-forget — the DB has no row yet (not sent), so only the
      // on-disk file needs sweeping. A missing file is not an error.
      void attachmentDelete(victim.path).catch(() => {
        /* intentionally ignored */
      });
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void stageFile(file);
        }
      }
    }
  }

  function onDragEnter(e: DragEvent<HTMLFormElement>) {
    // Only react to drags that actually carry files — ignore text drags
    // from within the app (e.g. highlighting a message bubble).
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  }
  function onDragLeave(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }
  function onDragOver(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    // preventDefault allows `drop` to fire.
    e.preventDefault();
  }
  async function onDrop(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragDepth(0);
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) await stageFile(f);
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) await stageFile(f);
    // Reset the input so picking the SAME file twice still fires `change`.
    e.target.value = '';
  }

  async function send(text: string) {
    const trimmed = text.trim();
    const hasAttachments = pendingAttachments.length > 0;
    // Let the user send a message whose payload is purely attachments —
    // the provider still gets a "[attached: …]" marker in the content.
    if ((!trimmed && !hasAttachments) || sending) return;

    // T4.4b — budget gate. Runs BEFORE we commit the message to the
    // store so a blocked send leaves the composer exactly as the user
    // typed it. `evaluateBudgetGate` fails-safe on IPC errors (returns
    // empty verdict), so a transient db/analytics hiccup never locks
    // the user out of chatting.
    const verdict = await evaluateBudgetGate({ effectiveModel });
    if (verdict.blocks.length > 0) {
      const lines = verdict.blocks.map((b) => '  · ' + describeBreach(b)).join('\n');
      const ok = window.confirm(
        `One or more budgets are over cap:\n\n${lines}\n\nSend anyway?`,
      );
      if (!ok) return;
    }
    if (verdict.warns.length > 0) {
      // Non-blocking: surface above the chip row for the next render.
      // We reset it once the stream starts so it's clearly tied to
      // this single send, not stale state.
      setBudgetWarnings(verdict.warns.map(describeBreach));
    } else {
      setBudgetWarnings([]);
    }

    // Bake pending attachments into the user message. Snapshot before
    // we clear so a fast follow-up paste doesn't attach to the wrong turn.
    const attachmentsSnapshot: UiAttachment[] = pendingAttachments.map((a) => ({
      id: a.id,
      name: a.name,
      mime: a.mime,
      size: a.size,
      path: a.path,
      createdAt: a.created_at,
    }));
    // T1.5b — the stored bubble content is now just the user's typed
    // text (attachments render as chips above/inside the bubble). The
    // LLM receives the same clean text PLUS an `attachments` array on
    // the outgoing ChatMessageDto; the Rust adapter expands that into
    // OpenAI's multimodal content array (text part + image_url parts).
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

    setDraft('');
    // Pending attachments have been baked into the message above; clear
    // them so a follow-up turn starts fresh. Do NOT sweep the files from
    // disk — the message now owns them and their lifecycle ties to the
    // DB row's cascade on session delete.
    setPendingAttachments([]);
    setSending(true);
    pendingRef.current = pendingId;
    // T4.6: the user has taken ownership of the prompt — drop any
    // pending runbook draft so a back-navigation doesn't re-seed it.
    clearPendingDraftIfSet();

    // Build the wire history. Prior messages' attachments ride along
    // too — if the user references an earlier image in the next turn
    // ("what colour was it?"), the provider needs that image back in
    // context. `attachments` is `undefined` on plain-text turns so the
    // Rust adapter keeps the classic string content shape.
    const toDto = (
      role: 'user' | 'assistant',
      content: string,
      atts: UiAttachment[] | undefined,
    ): ChatMessageDto =>
      atts && atts.length > 0
        ? {
            role,
            content,
            attachments: atts.map((a) => ({
              path: a.path,
              mime: a.mime,
              name: a.name,
            })),
          }
        : { role, content };

    const historyForIpc: ChatMessageDto[] = [
      ...messages
        .filter((m) => !m.error && !m.pending)
        .map<ChatMessageDto>((m) => toDto(m.role, m.content, m.attachments)),
      toDto('user', contentForMessage, hasAttachments ? attachmentsSnapshot : undefined),
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
        <form
          onSubmit={onSubmit}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={cn(
            'relative mx-auto flex max-w-3xl flex-col gap-2 px-6 pb-4 pt-2',
            dragDepth > 0 && 'ring-2 ring-gold-500/50 ring-offset-0',
          )}
          data-testid="chat-composer"
        >
          {/* Drag-drop overlay — appears when files are being dragged over
              the composer area so the user knows dropping will attach. */}
          {dragDepth > 0 && (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gold-500/10 backdrop-blur-[1px]"
              data-testid="chat-drop-overlay"
            >
              <span className="rounded-md border border-gold-500/40 bg-bg-elev-1 px-3 py-1.5 text-xs text-gold-500">
                Drop to attach
              </span>
            </div>
          )}

          {attachError && (
            <div
              className="rounded-md border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs text-danger"
              data-testid="chat-attach-error"
            >
              {attachError}
            </div>
          )}

          {/* T4.4b — non-blocking budget warnings from the last send.
              Blocking breaches are handled by a modal confirm in
              send() itself, not here. */}
          {budgetWarnings.length > 0 && (
            <div
              className="flex flex-col gap-0.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400"
              data-testid="chat-budget-warning"
            >
              <div className="inline-flex items-center gap-1.5">
                <Icon icon={AlertTriangle} size="sm" />
                <span className="font-medium">Budget over cap</span>
              </div>
              {budgetWarnings.map((line, i) => (
                <div key={i} className="pl-5 font-mono text-[11px] opacity-90">
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* T1.5c — surface when the active model clearly can't read
              images. We don't hard-block the send (the user may be
              mid-model-switch and know what they're doing); just warn
              once so nobody wonders why the model keeps saying "I can't
              see any image". Non-image attachments never trigger this
              because their [attached: name] text marker still works. */}
          {imageBlockedByModel && (
            <div
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400"
              data-testid="chat-vision-warning"
            >
              <Icon icon={AlertTriangle} size="sm" />
              <span>
                The current model{' '}
                <code className="rounded bg-amber-500/10 px-1">{effectiveModel}</code>{' '}
                does not accept images. Switch to a vision-capable model or
                send text-only.
              </span>
            </div>
          )}

          {pendingAttachments.length > 0 && (
            <ul
              className="flex flex-wrap items-center gap-1.5"
              data-testid="chat-attachment-chips"
            >
              {pendingAttachments.map((a) => (
                <li
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elev-1 px-2 py-0.5 text-xs text-fg"
                  data-testid={`chat-attachment-chip-${a.id}`}
                  title={`${a.mime} · ${formatBytes(a.size)}`}
                >
                  <Icon icon={Paperclip} size="xs" className="text-fg-subtle" />
                  <span className="max-w-[180px] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => void removePendingAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="rounded p-0.5 text-fg-subtle transition-colors hover:bg-bg-elev-2 hover:text-fg"
                  >
                    <Icon icon={X} size="xs" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            {/* Hidden input — Paperclip button clicks it to open the
                native file chooser. No plugin dependency, works in both
                browser (dev/e2e) and Tauri. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={onFilePicked}
              className="hidden"
              data-testid="chat-file-input"
            />
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-3"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach file"
              title={
                visionCap === 'no'
                  ? `Attach file (images will be ignored — ${effectiveModel ?? 'current model'} is text-only)`
                  : visionCap === 'unknown'
                    ? 'Attach file (image support for this model is unverified)'
                    : 'Attach file'
              }
              data-testid="chat-attach-button"
              data-vision-support={visionCap}
            >
              <Icon icon={Paperclip} size="md" />
            </Button>

            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                clearPendingDraftIfSet();
              }}
              onKeyDown={onTextareaKeyDown}
              onPaste={onPaste}
              rows={1}
              placeholder="Message Hermes…  (Enter to send, Shift+Enter for newline)"
              disabled={sending}
              className={cn(
                'min-h-[44px] max-h-[200px] flex-1 resize-none rounded-xl border border-border',
                'bg-bg-elev-1 px-4 py-3 text-sm text-fg placeholder:text-fg-subtle',
                'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
                'disabled:opacity-60',
              )}
              data-testid="chat-textarea"
            />
            {sending ? (
              <Button
                type="submit"
                variant="secondary"
                className="h-11 px-4"
                aria-label="Stop generating"
                title="Stop"
              >
                <Icon icon={Square} size="md" fill="currentColor" />
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                disabled={!draft.trim() && pendingAttachments.length === 0}
                className="h-11 px-4"
                aria-label="Send message"
                title="Send"
                data-testid="chat-send"
              >
                <Icon icon={Send} size="md" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Compact byte formatter used in attachment chip tooltips. `1` kb = 1024 b.
 * Lives here rather than in `@/lib/` because it's the only caller; lift it
 * out if a second feature needs it.
 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kib = n / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
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
        <Icon icon={Sparkles} size={24} />
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

