import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';
import type { TFunction } from 'i18next';

import {
  chatStream,
  ipcErrorMessage,
  learningIndexMessage,
  voiceRecord,
  voiceRecordStop,
  voiceTranscribe,
  type ChatMessageDto,
  type ChatStreamDone,
  type ChatStreamHandle,
} from '@/lib/ipc';
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

import { describeBreach, evaluateBudgetGate } from './budgetGate';
import { enrichHistoryWithContext } from './enrichHistory';
import { canRetryLastAssistant } from './retryGuard';
import { resolveRoutedRule } from './routing';
import { pickTurnAdapter } from './turnAdapter';
import { buildStreamCallbacks, resolveAdapterId, toDto } from './useStreamCallbacks';
import type { useAttachments } from './useAttachments';

/**
 * Surface the chat orchestration owns. Everything the composer footer
 * needs to render + every imperative entry-point ChatPane wires into
 * shortcuts (Cmd+F, Enter), buttons (Send/Stop, voice), and the empty
 * hero (`onPick`).
 */
export interface UseChatSendResult {
  draft: string;
  sending: boolean;
  voiceRecording: boolean;
  budgetWarnings: string[];
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => Promise<void>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (next: string) => void;
  onTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
}

interface UseChatSendArgs {
  sessionId: string;
  messages: UiMessage[];
  /** The shared attachments adapter — we read `pendingAttachments`
   *  to decide whether to gate empty drafts and call
   *  `takeSnapshotAndClear()` to atomically bake the chips into the
   *  outgoing user message. */
  attachments: ReturnType<typeof useAttachments>;
  effectiveModel: string | null;
  visionCap: 'yes' | 'no' | 'unknown';
  /** Chat-store mutators captured at the call site. Threaded through
   *  rather than re-subscribed inside the hook so subscription
   *  identity matches what `usePostSendEffects` already saw. */
  appendMessage: (sessionId: string, msg: UiMessage) => void;
  patchMessage: (
    sessionId: string,
    msgId: string,
    patch: Partial<UiMessage>,
  ) => void;
  appendToolCall: (sessionId: string, msgId: string, call: UiToolCall) => void;
  /** Ref that `useChatIntentSuggestions` populates with the
   *  most-recent assistant pending id so its in-bubble intent
   *  detector can correlate with the right turn. The hook seeds it
   *  with `''` (never `null`) so the type is the wider mutable ref
   *  rather than RefObject's read-only flavour. */
  intentPendingRef: MutableRefObject<string>;
  /** Callback supplied by `usePostSendEffects` — runs once a stream
   *  completes successfully (sets the title, fires intents, etc). */
  onStreamDone: (
    pendingId: string,
    userText: string,
    summary: ChatStreamDone,
  ) => void;
  /** i18next translator. Passed in (vs imported) so the hook stays
   *  trivially testable without an i18n provider. */
  t: TFunction;
}

/**
 * Owner of the per-session send / retry / stop state machine that used
 * to live inline in `ChatPane`. Everything that mutates `sending`,
 * `streamRef`, `pendingRef`, or `draft` is now in this one place —
 * the page component just renders the result.
 *
 * Why a hook (not a reducer):
 *  · State is small (4 atoms + 2 refs) but transitions are async-
 *    heavy (budget gate IPC, attachment snapshot, history enrichment,
 *    chatStream). A reducer would force every async branch to
 *    dispatch through actions, which is more bookkeeping for no
 *    payoff vs the existing imperative flow.
 *  · The flow is intrinsically tied to a `sessionId` lifetime — the
 *    session-switch effect at the top resets every piece of state in
 *    one place; that's exactly the contract a hook gives us for
 *    free.
 *
 * Behavioral invariants preserved verbatim from the pre-extraction
 * inline version (see PR #1 / commit c8abeb8 for the move):
 *  · IME guard on Enter (keyCode === 229 sentinel for trailing
 *    Enter after a CJK candidate commit on macOS WKWebView).
 *  · Budget gate runs BEFORE we commit the user bubble — a blocked
 *    send leaves the composer exactly as the user typed it.
 *  · Adapter routing priority: routing-rule → profile pin →
 *    AgentSwitcher → backend default. Identical to the pre-
 *    extraction code, with the same `useChatStore.getState()`
 *    imperative reads to scope the verdict to THIS turn.
 *  · `takeSnapshotAndClear()` is atomic vs. a fast follow-up paste.
 *  · Voice transcription appends with a leading space when the
 *    composer already has a draft.
 *  · `setBudgetWarnings` is reset on every send (warnings render
 *    only once, tied to the LAST send attempt).
 */
export function useChatSend(args: UseChatSendArgs): UseChatSendResult {
  const {
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
  } = args;

  // T-polish — composer state. Seeds from the runbook draft (if any)
  // so launching a runbook into a fresh chat session preserves the
  // pre-filled prompt across StrictMode's double-mount.
  const [draft, setDraft] = useState<string>(
    () => useComposerStore.getState().pendingDraft ?? '',
  );
  const [sending, setSending] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);

  // Live handle for the current stream, so Stop can cancel it.
  const streamRef = useRef<ChatStreamHandle | null>(null);
  // Also track the pending id to null-out the spinner on stop.
  const pendingRef = useRef<string | null>(null);

  // T4.4b — breaches flagged by the budget gate on the LAST send
  // attempt. Re-populated (or cleared) every time send() runs so the
  // list reflects the current turn, not stale state.
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([]);

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

    // T5.5b / T6.4 — adapter routing. The priority-chain logic is
    // factored into `pickTurnAdapter` (pure, fully unit-tested);
    // here we just gather the inputs imperatively from the three
    // stores so the verdict is scoped to THIS send (a subsequent
    // switcher change must NOT re-route the in-flight stream).
    const sendSess = useChatStore.getState().sessions[sessionId];
    const matched = resolveRoutedRule(useRoutingStore.getState().rules, trimmed);
    const { activeAdapterId, routedAdapterId } = pickTurnAdapter({
      profilePin: sendSess?.llmProfileId ?? null,
      agentsActiveId: useAgentsStore.getState().activeId,
      registeredAdapterIds: new Set(
        useAgentsStore.getState().adapters?.map((a) => a.id) ?? [],
      ),
      routedRuleTargetId: matched?.target_adapter_id ?? null,
    });
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
    if (!canRetryLastAssistant(messages)) return;
    const last = messages[messages.length - 1]!;
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

  return {
    draft,
    sending,
    voiceRecording,
    budgetWarnings,
    send,
    retry,
    stop,
    onSubmit,
    onDraftChange,
    onTextareaKeyDown,
    onVoiceStart,
    onVoiceStop,
  };
}
