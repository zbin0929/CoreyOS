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
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, Paperclip, Send, Sparkles, Square, Wand2, X } from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ExportSessionMenu } from './ExportSessionMenu';
import { SaveAsSkillDrawer } from './SaveAsSkillDrawer';
import { cn } from '@/lib/cn';
import {
  attachmentDelete,
  attachmentStageBlob,
  chatStream,
  dbMessageSetUsage,
  generateTitle,
  ipcErrorMessage,
  learningExtract,
  learningIndexMessage,
  learningSearchSimilar,
  learningReadLearnings,
  learningDetectPattern,
  memoryRead,
  skillSave,
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
import { useAgentsStore } from '@/stores/agents';
import { useComposerStore } from '@/stores/composer';
import { useRoutingStore } from '@/stores/routing';
import { resolveRoutedRule } from './routing';
import { ActiveLLMBadge } from './ActiveLLMBadge';
import { ChatSearch } from './ChatSearch';
import { computeActiveMatchIndex } from './chatSearchMatch';
import { MessageList } from './MessageList';
import { SessionsPanel } from './SessionsPanel';
import type { VirtuosoHandle } from 'react-virtuoso';

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
  // reflected on the very first paint. Clearing it happens in the mount
  // effect below — doing it inside the initializer would race with
  // React StrictMode's double-invocation (the second mount would see an
  // already-cleared store and reset the composer to empty).
  const [draft, setDraft] = useState<string>(
    () => useComposerStore.getState().pendingDraft ?? '',
  );
  const [sending, setSending] = useState(false);
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
  // T-polish — ref + auto-resize effect for the composer textarea.
  // Default `<textarea rows={1}>` is fixed-height; users typing more
  // than one line see their prose scroll inside a cramped box. We
  // grow it to fit the content up to ~3× the base height (~132px)
  // and let overflow scroll after that — the composer is not a code
  // editor, and a bigger box starts to eat the message viewport.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // T4.4b — breaches flagged by the budget gate on the LAST send attempt.
  // Re-populated (or cleared) every time send() runs so the list reflects
  // the current turn, not stale state from minutes ago.
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([]);

  // T-polish — in-chat message search state. Query survives a close so
  // re-opening with Cmd+F jumps right back to where the user was. Reset
  // explicitly on session switch (effect below) because match indices
  // across two different sessions are semantically meaningless.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const listRef = useRef<VirtuosoHandle | null>(null);

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

  // T1.9 — autoscroll is now owned by `MessageList` (Virtuoso's
  // `followOutput="smooth"`). It sticks to the bottom when the user
  // is already there and leaves them alone once they scroll up to
  // read back context — a genuine UX improvement over the old
  // yanks-you-to-bottom-on-every-token behaviour.

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
    // the user out of chatting. `activeAdapterId` is read imperatively
    // (same pattern as the chatStream call below) because the gate's
    // verdict is tied to THIS send, not a subsequent switcher change.
    // Budget-gate should scope to whichever adapter this turn will
    // actually land on, which mirrors the send() priority order
    // below: profile pin > global active > null.
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
      const ok = window.confirm(
        t('chat_page.budget_over_cap_confirm', { lines }),
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

    void learningIndexMessage(userMsg.id, contentForMessage).catch(() => {});

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

    // Phase E · P2 — inject similar historical context as a system prefix.
    // Fire-and-forget: if the search fails or returns nothing, we just
    // proceed without context. Capped at 3 results, each truncated to 200 chars.
    try {
      const similar = await learningSearchSimilar(contentForMessage, 3);
      if (similar.length > 0) {
        const contextParts = similar
          .map((r) => r.content.slice(0, 200).replace(/\n/g, ' '))
          .join('\n');
        historyForIpc.unshift({
          role: 'system',
          content: `[Relevant past conversations]\n${contextParts}`,
        });
      }
    } catch {
      // non-critical — proceed without context
    }

    // Phase E · P1 — inject LEARNINGS.md (user feedback patterns) as
    // a system prefix so the LLM can adjust its behaviour accordingly.
    try {
      const learnings = await learningReadLearnings();
      if (learnings && learnings.length > 10) {
        historyForIpc.unshift({
          role: 'system',
          content: `[User feedback patterns — follow preferred, avoid avoided]\n${learnings.slice(0, 800)}`,
        });
      }
    } catch {
      // non-critical
    }

    // Q7 fix — inject USER.md (user profile) as system prompt so the LLM
    // always knows user preferences, even if Hermes doesn't inject it.
    try {
      const userFile = await memoryRead('user');
      if (userFile.content && userFile.content.trim().length > 5) {
        historyForIpc.unshift({
          role: 'system',
          content: `[User profile — follow these preferences]\n${userFile.content.slice(0, 1000)}`,
        });
      }
    } catch {
      // non-critical
    }

    // T5.5b — route the stream to whichever adapter the user picked in the
    // Topbar AgentSwitcher. Read the store imperatively (no subscribe)
    // because we only need the value at send-time; any later change should
    // apply to the NEXT send, not retroactively hijack this stream.
    //
    // T6.4 — routing-rule override. If the composed text matches an
    // enabled rule AND its target adapter is registered, prefer that
    // adapter over the active one. Missing targets are silently
    // ignored (the composer pill already warned the user); we never
    // send to a non-existent adapter. For a fresh session (0 prior
    // user messages) the session's pinned adapter_id is also updated
    // so subsequent turns stay with the chosen adapter — mid-session
    // rule matches only override THIS turn so history isn't silently
    // split across adapters.
    // Priority order for the adapter we ship with this turn:
    //   1. Routing-rule match (handled below as `routedAdapterId`)
    //   2. Per-session LLM Profile pin — set when the user picked a
    //      Profile row in the model picker. Must win over the global
    //      AgentSwitcher choice, otherwise "pick profile X" silently
    //      keeps routing through whatever agent is globally active.
    //      NOTE: this does NOT look at session.adapterId — that field
    //      is purely for sidebar grouping and is frozen at creation
    //      (see db.rs :: upsert_session COALESCE).
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
      const handle = await chatStream(
        // Pass the effective model (per-session override, falling back to
        // gateway default). `resolve_turn` in the Rust Hermes adapter
        // honours `turn.model` — an older comment here incorrectly
        // claimed Hermes ignored it, which is why the session-level
        // override existed in the store but never actually took effect.
        {
          messages: historyForIpc,
          adapter_id: activeAdapterId,
          model: effectiveModel ?? undefined,
        },
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
          onReasoning: (chunk) => {
            // Reasoning-content stream (deepseek-reasoner / o1). Same
            // append-style update as `onDelta`; we keep it on a
            // separate field so the main bubble body stays the final
            // answer and the chain-of-thought renders in its own
            // collapsible panel inside MessageBubble.
            const sess = useChatStore.getState().sessions[sessionId];
            const current = sess?.messages.find((m) => m.id === pendingId);
            patchMessage(sessionId, pendingId, {
              reasoning: (current?.reasoning ?? '') + chunk,
              // Clear the pending spinner on the first reasoning
              // token too — reasoning models idle before producing
              // any content delta, and showing the spinner while
              // the chain-of-thought is visibly streaming is
              // confusing.
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
            // Phase E · P0 — self-learning: extract memorable facts
            // from this turn and append to MEMORY.md. Fire-and-forget.
            if (firstAssistant && firstAssistant.length > 0 && trimmed.length > 0) {
              void learningExtract({
                userMessage: trimmed,
                assistantMessage: firstAssistant,
              }).catch(() => {});

              // Phase E · P3 — detect repeated task pattern and auto-create Skill.
              void learningDetectPattern(trimmed)
                .then(async (result) => {
                  if (!result.pattern_found) return;
                  const body = `# Auto-detected Skill: ${result.suggested_skill_name}\n\n`
                    + `Detected from ${result.occurrence_count} similar requests.\n\n`
                    + `## Pattern\n${result.pattern_description}\n\n`
                    + `## Usage\nDescribe your request in natural language.\n`;
                  const path = `auto/${result.suggested_skill_name}.md`;
                  try {
                    await skillSave(path, body, true);
                  } catch {
                    // already exists — skip
                  }
                })
                .catch(() => {});
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
   *     reasoning, drop its tool-call ribbon, flip pending=true. This
   *     keeps its id (and DB row) stable — tokens, feedback, and the
   *     title-generation trigger all key off the same id so reusing
   *     it avoids a cascade of side-effect cleanups.
   *  3. Re-stream into the same id with history[..target), i.e. every
   *     message up to (but not including) the assistant being
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
      .slice(0, messages.length - 1) // exclude target assistant
      .filter((m) => !m.error && !m.pending)
      .map<ChatMessageDto>((m) =>
        m.attachments && m.attachments.length > 0
          ? {
              role: m.role,
              content: m.content,
              attachments: m.attachments.map((a) => ({
                path: a.path,
                mime: a.mime,
                name: a.name,
              })),
            }
          : { role: m.role, content: m.content },
      );

    // Mirror send()'s priority: profile pin wins over the global
    // AgentSwitcher choice, otherwise regenerating a profile reply
    // would silently route through the default gateway.
    const retrySess = useChatStore.getState().sessions[sessionId];
    const retryProfilePin = retrySess?.llmProfileId ?? null;
    const activeAdapterId =
      (retryProfilePin
        ? `hermes:profile:${retryProfilePin}`
        : useAgentsStore.getState().activeId) ?? undefined;

    setSending(true);
    pendingRef.current = targetId;
    try {
      const handle = await chatStream(
        {
          messages: historyForIpc,
          adapter_id: activeAdapterId,
          model: effectiveModel ?? undefined,
        },
        {
          onDelta: (chunk) => {
            const sess = useChatStore.getState().sessions[sessionId];
            const current = sess?.messages.find((m) => m.id === targetId);
            patchMessage(sessionId, targetId, {
              content: (current?.content ?? '') + chunk,
              pending: false,
            });
          },
          onReasoning: (chunk) => {
            const sess = useChatStore.getState().sessions[sessionId];
            const current = sess?.messages.find((m) => m.id === targetId);
            patchMessage(sessionId, targetId, {
              reasoning: (current?.reasoning ?? '') + chunk,
              pending: false,
            });
          },
          onTool: (progress) => {
            appendToolCall(sessionId, targetId, {
              id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              tool: progress.tool,
              emoji: progress.emoji,
              label: progress.label,
              at: Date.now(),
            });
            const sess = useChatStore.getState().sessions[sessionId];
            const current = sess?.messages.find((m) => m.id === targetId);
            if (current?.pending) {
              patchMessage(sessionId, targetId, { pending: false });
            }
          },
          onDone: (summary) => {
            patchMessage(sessionId, targetId, { pending: false });
            setSending(false);
            streamRef.current = null;
            pendingRef.current = null;
            if (
              summary.prompt_tokens !== null ||
              summary.completion_tokens !== null
            ) {
              void dbMessageSetUsage({
                messageId: targetId,
                promptTokens: summary.prompt_tokens,
                completionTokens: summary.completion_tokens,
              }).catch(() => {});
            }
          },
          onError: (err) => {
            patchMessage(sessionId, targetId, {
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

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) {
      void stop();
    } else {
      void send(draft);
    }
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // IME guard. `isComposing` alone is not enough on macOS WKWebView +
    // Chinese pinyin: after a candidate commit, some IMEs fire a
    // trailing Enter keydown with `isComposing === false` but
    // `keyCode === 229` (the "IME still processing" sentinel). Without
    // checking 229 we'd treat that trailing Enter as "send" and split
    // the user's typed CJK across a literal newline (bug: "下午好" → bubble
    // shows "下午\n好"). React's `KeyboardEvent` doesn't expose
    // `keyCode`, so read it off the native event.
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
          {/* Floating-ish search bar: absolutely positioned INSIDE the
              scroll container so it doesn't steal layout height from
              the message list (no "bar pushes list down" jank). Kept
              above the list via z-10. */}
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
          />
        </div>
      )}

      <div className="border-t border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 pt-3">
          <ActiveLLMBadge />
          <RoutingHint draft={draft} />
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
                <span className="font-medium">{t('chat_page.budget_over_cap')}</span>
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
                <Trans
                  i18nKey="chat_page.vision_warning"
                  values={{ model: effectiveModel }}
                  components={{
                    code: <code className="rounded bg-amber-500/10 px-1" />,
                  }}
                />
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
                    aria-label={`${t('chat_page.remove_attachment')} ${a.name}`}
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
              aria-label={t('chat_page.attach_file')}
              title={
                visionCap === 'no'
                  ? `${t('chat_page.attach_file')} ${t('chat_page.attach_text_only', { model: effectiveModel ?? 'current model' })}`
                  : visionCap === 'unknown'
                    ? `${t('chat_page.attach_file')} ${t('chat_page.attach_vision_unverified')}`
                    : t('chat_page.attach_file')
              }
              data-testid="chat-attach-button"
              data-vision-support={visionCap}
            >
              <Icon icon={Paperclip} size="md" />
            </Button>

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                clearPendingDraftIfSet();
              }}
              onKeyDown={onTextareaKeyDown}
              onPaste={onPaste}
              rows={1}
              placeholder={t('chat_page.message_placeholder')}
              disabled={sending}
              className={cn(
                // `min-h` anchors the empty state; JS auto-resize
                // governs everything above that up to the ~132px
                // ceiling enforced in the useLayoutEffect. `max-h`
                // is kept as a CSS safety net in case the JS never
                // runs (SSR, error boundaries).
                'min-h-[44px] max-h-[132px] flex-1 resize-none rounded-xl border border-border',
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
                aria-label={t('chat_page.stop_generating')}
                title={t('chat_page.stop')}
              >
                <Icon icon={Square} size="md" fill="currentColor" />
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                disabled={!draft.trim() && pendingAttachments.length === 0}
                className="h-11 px-4"
                aria-label={t('chat_page.send_message')}
                title={t('chat_page.send')}
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

/**
 * Header action cluster — the export menu + the Save-as-Skill button,
 * side by side. Split out so the top-level `<PageHeader actions>` prop
 * stays a single JSX node and adding future actions (share link,
 * branch session) doesn't require edits to ChatPane's return.
 */
function ChatHeaderActions({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UiMessage[];
}) {
  const title = useChatStore(
    (s) => s.sessions[sessionId]?.title ?? 'chat',
  );
  return (
    <div className="flex items-center gap-2">
      <ExportSessionMenu title={title} messages={messages} />
      <SaveAsSkillHeaderAction messages={messages} />
    </div>
  );
}

/**
 * T7.2 — "Save as Skill" header action. Disabled until the session
 * has at least one completed (non-pending, non-error) assistant reply
 * — otherwise the template has nothing useful to distil. Owns the
 * drawer state so chat/index.tsx stays focused on send/receive.
 */
function SaveAsSkillHeaderAction({ messages }: { messages: UiMessage[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const canSave = messages.some(
    (m) => m.role === 'assistant' && !m.pending && !m.error && m.content.length > 0,
  );
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={!canSave}
        title={canSave ? undefined : t('chat.save_as_skill.disabled_hint')}
        data-testid="chat-save-as-skill"
      >
        <Icon icon={Wand2} size="sm" />
        {t('chat.save_as_skill.button')}
      </Button>
      <SaveAsSkillDrawer
        open={open}
        onClose={() => setOpen(false)}
        messages={messages}
      />
    </>
  );
}

function EmptyHero({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useTranslation();
  const suggestions = [
    t('chat_page.hero_suggestion_1'),
    t('chat_page.hero_suggestion_2'),
    t('chat_page.hero_suggestion_3'),
  ];
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-500">
        <Icon icon={Sparkles} size={24} />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{t('chat_page.hero_title')}</h2>
        <p className="text-sm text-fg-muted">
          {t('chat_page.hero_subtitle_prefix')}
          <code className="font-mono text-xs">:8642</code>
          {t('chat_page.hero_subtitle_suffix')}
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

/**
 * T6.4 — inline hint above the Composer showing which routing rule
 * (if any) will fire on the current draft. When a rule matches but
 * its `target_adapter_id` isn't registered, we show a warning chip so
 * the user knows to either add the adapter or edit the rule.
 */
function RoutingHint({ draft }: { draft: string }) {
  const { t } = useTranslation();
  const rules = useRoutingStore((s) => s.rules);
  const adapters = useAgentsStore((s) => s.adapters);

  if (!rules || rules.length === 0) return null;
  const matched = resolveRoutedRule(rules, draft);
  if (!matched) return null;

  const registered = new Set(adapters?.map((a) => a.id) ?? []);
  const isRegistered = registered.has(matched.target_adapter_id);
  const adapterLabel =
    adapters?.find((a) => a.id === matched.target_adapter_id)?.name ??
    matched.target_adapter_id;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
        isRegistered
          ? 'border border-gold-500/30 bg-gold-500/10 text-gold-600'
          : 'border border-danger/30 bg-danger/5 text-danger',
      )}
      data-testid="chat-routing-hint"
      title={matched.name}
    >
      {isRegistered
        ? t('chat_page.routing_hint', { adapter: adapterLabel, rule: matched.name })
        : t('chat_page.routing_hint_missing', {
            adapter: matched.target_adapter_id,
            rule: matched.name,
          })}
    </span>
  );
}
