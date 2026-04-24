import type { UiMessage } from '@/stores/chat';

/**
 * Returns the 0-indexed positions in `messages` whose content
 * matches the query (case-insensitive substring). Empty query → empty
 * array. Only `content` is searched — tool-call payloads and
 * reasoning text are excluded; they're rarely what users are hunting
 * for and add false positives.
 *
 * Lives in its own plain-TS module (no React imports) so:
 *  - `ChatSearch.tsx` can stay a pure-component file (Fast Refresh
 *    complains if a component module also exports non-component
 *    helpers).
 *  - `ChatPane` can reuse it to resolve `activeMatchIdx → message.id`
 *    without duplicating the predicate.
 */
export function computeMatchIndices(
  messages: UiMessage[],
  query: string,
): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.content.toLowerCase().includes(q)) out.push(i);
  }
  return out;
}

/**
 * Resolves an `activeMatchIdx` (position within the match list) to
 * the message-array index it points to, clamped. Returns `-1` when
 * there are no matches so the caller renders "no active match" cleanly
 * (instead of lighting up message[0] on an empty result).
 */
export function computeActiveMatchIndex(
  messages: UiMessage[],
  query: string,
  activeMatchIdx: number,
): number {
  const matches = computeMatchIndices(messages, query);
  if (matches.length === 0) return -1;
  const clamped = Math.min(Math.max(0, activeMatchIdx), matches.length - 1);
  return matches[clamped] ?? -1;
}
