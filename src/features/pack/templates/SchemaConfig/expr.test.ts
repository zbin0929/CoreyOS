import { describe, expect, it } from 'vitest';

import { evalShowIf, fillTemplate, resolvePath } from './expr';

describe('resolvePath', () => {
  it('resolves dotted paths', () => {
    expect(resolvePath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
  });

  it('returns undefined when the path misses', () => {
    expect(resolvePath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(resolvePath({}, 'missing')).toBeUndefined();
  });

  it('does not descend into arrays', () => {
    expect(resolvePath({ list: [{ x: 1 }] }, 'list.x')).toBeUndefined();
  });
});

describe('fillTemplate', () => {
  it('substitutes flat keys', () => {
    expect(fillTemplate('{a} + {b}', { a: 1, b: 2 })).toBe('1 + 2');
  });

  it('substitutes dotted paths', () => {
    expect(fillTemplate('rate={r.value}', { r: { value: 6.95 } })).toBe('rate=6.95');
  });

  it('renders missing values as empty', () => {
    expect(fillTemplate('hello {name}!', {})).toBe('hello !');
  });

  it('passes through non-template strings', () => {
    expect(fillTemplate('plain', { x: 1 })).toBe('plain');
  });

  it('returns empty for empty template', () => {
    expect(fillTemplate('', { x: 1 })).toBe('');
  });
});

describe('evalShowIf', () => {
  it('returns true for empty expressions', () => {
    expect(evalShowIf('', {})).toBe(true);
    expect(evalShowIf('   ', {})).toBe(true);
  });

  it('truthy-tests bare identifiers', () => {
    expect(evalShowIf('enabled', { enabled: true })).toBe(true);
    expect(evalShowIf('enabled', { enabled: false })).toBe(false);
    expect(evalShowIf('enabled', {})).toBe(false);
  });

  it('handles boolean equality', () => {
    expect(evalShowIf('enabled == true', { enabled: true })).toBe(true);
    expect(evalShowIf('enabled == true', { enabled: false })).toBe(false);
    expect(evalShowIf('enabled != true', { enabled: false })).toBe(true);
  });

  it('handles string equality with single-quoted literals', () => {
    expect(evalShowIf("mode == 'weekly'", { mode: 'weekly' })).toBe(true);
    expect(evalShowIf("mode == 'weekly'", { mode: 'monthly' })).toBe(false);
  });

  it('handles number equality', () => {
    expect(evalShowIf('count == 3', { count: 3 })).toBe(true);
    expect(evalShowIf('count != 0', { count: 5 })).toBe(true);
  });

  it('handles && and ||', () => {
    expect(evalShowIf('a && b', { a: true, b: true })).toBe(true);
    expect(evalShowIf('a && b', { a: true, b: false })).toBe(false);
    expect(evalShowIf('a || b', { a: false, b: true })).toBe(true);
    expect(evalShowIf('a || b', { a: false, b: false })).toBe(false);
  });

  it('handles negation', () => {
    expect(evalShowIf('!enabled', { enabled: false })).toBe(true);
    expect(evalShowIf('!enabled', { enabled: true })).toBe(false);
  });

  it('handles parenthesized groups', () => {
    expect(evalShowIf('(a || b) && c', { a: false, b: true, c: true })).toBe(true);
    expect(evalShowIf('(a || b) && c', { a: false, b: true, c: false })).toBe(false);
  });

  it('resolves dotted paths', () => {
    expect(evalShowIf('source.kind == \'http\'', { source: { kind: 'http' } })).toBe(true);
  });

  it('precedence: ! > && > ||', () => {
    expect(evalShowIf('!a || b && c', { a: false, b: true, c: true })).toBe(true);
    expect(evalShowIf('!a || b && c', { a: true, b: true, c: false })).toBe(false);
  });

  it('fails open on malformed expressions', () => {
    expect(evalShowIf('???', { a: 1 })).toBe(true);
    expect(evalShowIf('a ==', { a: 1 })).toBe(true);
  });
});
