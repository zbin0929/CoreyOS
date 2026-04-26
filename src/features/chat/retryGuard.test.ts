import { describe, expect, it } from 'vitest';

import type { UiMessage } from '@/stores/chat';

import { canRetryLastAssistant } from './retryGuard';

function mk(over: Partial<UiMessage> & Pick<UiMessage, 'role'>): UiMessage {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    role: over.role,
    content: over.content ?? '',
    createdAt: over.createdAt ?? Date.now(),
    pending: over.pending,
    error: over.error,
    reasoning: over.reasoning,
    toolCalls: over.toolCalls,
    attachments: over.attachments,
    suggestions: over.suggestions,
  };
}

describe('canRetryLastAssistant', () => {
  it('rejects an empty session', () => {
    expect(canRetryLastAssistant([])).toBe(false);
  });

  it('rejects when the trailing message is a user turn', () => {
    expect(
      canRetryLastAssistant([mk({ role: 'user', content: 'hi' })]),
    ).toBe(false);
    expect(
      canRetryLastAssistant([
        mk({ role: 'user', content: 'one' }),
        mk({ role: 'assistant', content: 'two' }),
        mk({ role: 'user', content: 'three' }),
      ]),
    ).toBe(false);
  });

  it('rejects a still-streaming assistant', () => {
    expect(
      canRetryLastAssistant([
        mk({ role: 'user', content: 'hi' }),
        mk({ role: 'assistant', content: 'partial', pending: true }),
      ]),
    ).toBe(false);
  });

  it('rejects an errored assistant', () => {
    expect(
      canRetryLastAssistant([
        mk({ role: 'user', content: 'hi' }),
        mk({ role: 'assistant', content: '', error: 'transport closed' }),
      ]),
    ).toBe(false);
  });

  it('rejects when no preceding user turn exists (malformed session)', () => {
    // Assistant-first session — should never happen in practice but
    // we guard against it so a corrupted DB row can't trigger a
    // chatStream call with an empty / user-less history.
    expect(
      canRetryLastAssistant([mk({ role: 'assistant', content: 'orphan' })]),
    ).toBe(false);
  });

  it('accepts a completed assistant after a user turn', () => {
    expect(
      canRetryLastAssistant([
        mk({ role: 'user', content: 'hi' }),
        mk({ role: 'assistant', content: 'hello!' }),
      ]),
    ).toBe(true);
  });

  it('accepts when the user turn is several messages back (tool-only assistants between)', () => {
    // Defensive case: the immediately-preceding message could in
    // theory be another assistant turn (e.g. a tool-running ribbon
    // committed as its own row). The guard walks back until it
    // finds the nearest user turn rather than insisting on
    // adjacency.
    expect(
      canRetryLastAssistant([
        mk({ role: 'user', content: 'do thing' }),
        mk({ role: 'assistant', content: 'ran a tool' }),
        mk({ role: 'assistant', content: 'final answer' }),
      ]),
    ).toBe(true);
  });
});
