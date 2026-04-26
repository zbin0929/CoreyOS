import type { UiMessage } from '@/stores/chat';

/**
 * Pure guard for `useChatSend.retry()` — returns `true` only when
 * regenerating the last assistant response is well-defined.
 *
 * Mid-history retry is deliberately rejected: re-streaming an
 * earlier turn would orphan every subsequent message that was
 * conditioned on the OLD reply, which is confusing and hard to
 * undo. We also bail on malformed sessions (assistant-first or no
 * preceding user turn) so the constructed history never contains a
 * dangling user-less assistant reply.
 *
 * Extracted as a pure function so the branch matrix can be
 * exhaustively asserted without standing up the full hook +
 * store + IPC mock surface — see `retryGuard.test.ts`.
 */
export function canRetryLastAssistant(messages: readonly UiMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || last.pending || last.error) {
    return false;
  }
  // Walk back for the turn this assistant replied to. We don't need
  // the index — only its existence — so the loop short-circuits on
  // first hit.
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i]!.role === 'user') return true;
  }
  return false;
}
