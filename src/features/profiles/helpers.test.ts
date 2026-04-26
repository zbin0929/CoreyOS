import { describe, expect, it } from 'vitest';

import { base64FromArrayBuffer, formatBytes } from './helpers';

describe('base64FromArrayBuffer', () => {
  it('encodes the empty buffer to an empty string', () => {
    expect(base64FromArrayBuffer(new ArrayBuffer(0))).toBe('');
  });

  it('round-trips ASCII text via atob', () => {
    const text = 'Hello, world!';
    const bytes = new TextEncoder().encode(text);
    const out = base64FromArrayBuffer(bytes.buffer);
    expect(atob(out)).toBe(text);
  });

  it('round-trips a buffer larger than the 32 KB chunk size', () => {
    // 80 KB of incrementing bytes — guarantees the chunking loop runs
    // multiple times and that no chunk boundary corrupts the encoding.
    const size = 80 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
    const encoded = base64FromArrayBuffer(bytes.buffer);
    const decoded = atob(encoded);
    expect(decoded.length).toBe(size);
    for (let i = 0; i < size; i++) {
      expect(decoded.charCodeAt(i)).toBe(i & 0xff);
    }
  });
});

describe('formatBytes (profiles variant)', () => {
  it('renders dash for non-finite or negative inputs', () => {
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('renders bytes / KB / MB at the right boundaries', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/KB$/);
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
