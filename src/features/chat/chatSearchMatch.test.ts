import { describe, expect, it } from 'vitest';

import type { UiMessage } from '@/stores/chat';

import {
  computeActiveMatchIndex,
  computeMatchIndices,
} from './chatSearchMatch';

// Minimal `UiMessage` factory — `computeMatchIndices` only reads
// `content`, so we don't bother filling in the other fields. The cast
// keeps the test focused on the function under test rather than on
// keeping the entire UiMessage shape in sync.
function msg(content: string): UiMessage {
  return { content } as unknown as UiMessage;
}

describe('computeMatchIndices', () => {
  it('returns empty for empty / whitespace queries', () => {
    const messages = [msg('hello'), msg('world')];
    expect(computeMatchIndices(messages, '')).toEqual([]);
    expect(computeMatchIndices(messages, '   ')).toEqual([]);
  });

  it('returns indices of matching messages, in order', () => {
    const messages = [
      msg('Welcome'),
      msg('hello world'),
      msg('Goodbye'),
      msg('Hello again'),
    ];
    expect(computeMatchIndices(messages, 'hello')).toEqual([1, 3]);
  });

  it('is case-insensitive', () => {
    expect(computeMatchIndices([msg('FooBar')], 'foobar')).toEqual([0]);
    expect(computeMatchIndices([msg('FooBar')], 'FOOBAR')).toEqual([0]);
  });

  it('trims surrounding whitespace from the query', () => {
    expect(computeMatchIndices([msg('hello world')], '  hello  ')).toEqual([0]);
  });

  it('returns empty when nothing matches', () => {
    expect(computeMatchIndices([msg('a'), msg('b')], 'z')).toEqual([]);
  });
});

describe('computeActiveMatchIndex', () => {
  const messages = [msg('apple'), msg('banana'), msg('apricot'), msg('cherry')];

  it('returns -1 when there are no matches', () => {
    expect(computeActiveMatchIndex(messages, 'zzz', 0)).toBe(-1);
  });

  it('returns -1 for an empty query', () => {
    expect(computeActiveMatchIndex(messages, '', 0)).toBe(-1);
  });

  it('returns the matching message-array index for a valid match index', () => {
    // Two matches: indices 0 and 2.
    expect(computeActiveMatchIndex(messages, 'ap', 0)).toBe(0);
    expect(computeActiveMatchIndex(messages, 'ap', 1)).toBe(2);
  });

  it('clamps active match index into [0, matches-1]', () => {
    expect(computeActiveMatchIndex(messages, 'ap', -5)).toBe(0);
    expect(computeActiveMatchIndex(messages, 'ap', 99)).toBe(2);
  });
});
