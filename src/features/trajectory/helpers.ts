import type { DbMessageWithTools, DbSessionWithMessages } from '@/lib/ipc';

export interface Row {
  msg: DbMessageWithTools;
  /** Time from this message to the next, in ms. `null` for the last message. */
  durationMs: number | null;
  tokens: number;
}

export function computeRows(session: DbSessionWithMessages): Row[] {
  const msgs = session.messages;
  return msgs.map((m, i) => {
    const next = msgs[i + 1];
    const durationMs = next ? Math.max(0, next.created_at - m.created_at) : null;
    const tokens = (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0);
    return { msg: m, durationMs, tokens };
  });
}

export function computeTotals(session: DbSessionWithMessages) {
  let tokens = 0;
  let toolCalls = 0;
  for (const m of session.messages) {
    tokens += (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0);
    toolCalls += m.tool_calls.length;
  }
  const first = session.messages[0];
  const last = session.messages[session.messages.length - 1];
  const durationMs = first && last ? Math.max(0, last.created_at - first.created_at) : 0;
  return { messages: session.messages.length, toolCalls, tokens, durationMs };
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}
