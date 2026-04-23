import { describe, expect, it } from 'vitest';
import { resolveRoutedRule } from './routing';
import type { RoutingRule } from '@/lib/ipc';

function rule(partial: Partial<RoutingRule> & Pick<RoutingRule, 'id' | 'match'>): RoutingRule {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    enabled: partial.enabled ?? true,
    match: partial.match,
    target_adapter_id: partial.target_adapter_id ?? 'claude_code',
  };
}

describe('resolveRoutedRule', () => {
  it('returns null on empty / missing lists', () => {
    expect(resolveRoutedRule([], 'hello')).toBeNull();
    expect(resolveRoutedRule(null, 'hello')).toBeNull();
    expect(resolveRoutedRule(undefined, 'hello')).toBeNull();
  });

  it('prefix match honors case-insensitive by default', () => {
    const r = rule({
      id: 'code',
      match: { kind: 'prefix', value: '/CODE ' },
    });
    expect(resolveRoutedRule([r], '/code refactor this')).toBe(r);
    expect(resolveRoutedRule([r], 'code refactor this')).toBeNull();
  });

  it('prefix match strips leading whitespace (but not trailing)', () => {
    const r = rule({
      id: 'code',
      match: { kind: 'prefix', value: '/code' },
    });
    expect(resolveRoutedRule([r], '   /code hi')).toBe(r);
  });

  it('prefix with case_sensitive=true is strict', () => {
    const r = rule({
      id: 'code',
      match: { kind: 'prefix', value: '/Code', case_sensitive: true },
    });
    expect(resolveRoutedRule([r], '/Code x')).toBe(r);
    expect(resolveRoutedRule([r], '/code x')).toBeNull();
  });

  it('contains match searches anywhere', () => {
    const r = rule({
      id: 'kw',
      match: { kind: 'contains', value: 'refactor' },
    });
    expect(resolveRoutedRule([r], 'please refactor foo.ts')).toBe(r);
    expect(resolveRoutedRule([r], 'Refactor that thing')).toBe(r);
  });

  it('regex match honors i flag by default', () => {
    const r = rule({
      id: 're',
      match: { kind: 'regex', value: '^hello\\b' },
    });
    expect(resolveRoutedRule([r], 'Hello world')).toBe(r);
    expect(resolveRoutedRule([r], 'say hello')).toBeNull();
  });

  it('invalid regex is skipped without throwing', () => {
    const r = rule({
      id: 'bad',
      match: { kind: 'regex', value: '([' },
    });
    expect(() => resolveRoutedRule([r], 'anything')).not.toThrow();
    expect(resolveRoutedRule([r], 'anything')).toBeNull();
  });

  it('disabled rules are skipped', () => {
    const disabled = rule({
      id: 'a',
      enabled: false,
      match: { kind: 'prefix', value: '/go' },
    });
    const enabled = rule({
      id: 'b',
      match: { kind: 'prefix', value: '/go' },
      target_adapter_id: 'aider',
    });
    expect(resolveRoutedRule([disabled, enabled], '/go x')).toBe(enabled);
  });

  it('returns the FIRST matching rule when multiple fire', () => {
    const first = rule({
      id: 'first',
      match: { kind: 'contains', value: 'foo' },
      target_adapter_id: 'claude_code',
    });
    const second = rule({
      id: 'second',
      match: { kind: 'contains', value: 'foo' },
      target_adapter_id: 'aider',
    });
    expect(resolveRoutedRule([first, second], 'do foo now')).toBe(first);
  });

  it('empty match value never fires', () => {
    const r = rule({
      id: 'empty',
      match: { kind: 'prefix', value: '' },
    });
    expect(resolveRoutedRule([r], 'anything')).toBeNull();
  });
});
