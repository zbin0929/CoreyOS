import { describe, expect, it } from 'vitest';

import { defaultConfig, detectTransport } from './transport';

describe('detectTransport', () => {
  it('classifies configs with a `url` string as URL transport', () => {
    expect(detectTransport({ url: 'https://mcp.example.com' })).toBe('url');
  });

  it('classifies configs without a `url` field as stdio', () => {
    expect(detectTransport({ command: 'npx', args: ['mcp-thing'] })).toBe('stdio');
    expect(detectTransport({})).toBe('stdio');
  });

  it('treats a non-string `url` (e.g. accidentally null) as stdio', () => {
    // Defensive: we don't want a `null` typo silently flipping the form
    // mode and showing URL-only fields with no actual URL.
    expect(detectTransport({ url: null as unknown as string })).toBe('stdio');
    expect(detectTransport({ url: 123 as unknown as string })).toBe('stdio');
  });
});

describe('defaultConfig', () => {
  it('returns a URL skeleton with placeholder url + empty headers', () => {
    const cfg = defaultConfig('url');
    expect(cfg).toEqual({
      url: 'https://mcp.example.com',
      headers: {},
    });
  });

  it('returns a stdio skeleton with command + empty args', () => {
    const cfg = defaultConfig('stdio');
    expect(cfg).toEqual({
      command: 'npx',
      args: [],
    });
  });
});
