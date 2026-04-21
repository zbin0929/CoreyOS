import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn()', () => {
  it('joins truthy classes', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy entries', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('dedupes tailwind classes with twMerge semantics', () => {
    // Later utilities beat earlier ones in the same group.
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-red-500', 'text-blue-500')).toBe('text-sm text-blue-500');
  });

  it('accepts arrays and objects (clsx passthrough)', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });
});
