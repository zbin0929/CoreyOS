import { describe, expect, it } from 'vitest';

import type { UiAttachment } from '@/stores/chat';

import { toDto } from './useStreamCallbacks';

/**
 * `toDto` is the projection from a stored UiMessage into the
 * outgoing `ChatMessageDto` the Rust adapter expands. Two failure
 * modes we care about:
 *
 *  1. Adding `attachments: []` when none are present — the Rust
 *     adapter forwards that array straight to OpenAI's multimodal
 *     content path, which then errors out on the empty parts list.
 *  2. Stripping fields the adapter expects (path / mime / name).
 *     Loss of any of these silently degrades to an `[attached: …]`
 *     text marker rather than a real image_url part.
 *
 * Both paths used to be implicit — a regression here breaks every
 * multimodal send and is hard to spot in e2e (the adapter swallows
 * the malformed payload as a server error).
 */
describe('toDto', () => {
  it('returns a plain text message when attachments are undefined', () => {
    expect(toDto('user', 'hello', undefined)).toEqual({
      role: 'user',
      content: 'hello',
    });
  });

  it('returns a plain text message when attachments is an empty array', () => {
    // The store can hand us either undefined or [] depending on
    // whether the message went through the snapshot-and-clear path
    // with zero pending chips. Both must collapse to the simple
    // shape — the adapter dispatch keys off `attachments != null`.
    expect(toDto('assistant', 'reply', [])).toEqual({
      role: 'assistant',
      content: 'reply',
    });
  });

  it('projects only path/mime/name from each attachment (drops id/size/createdAt)', () => {
    const att: UiAttachment = {
      id: 'a1',
      name: 'photo.jpg',
      mime: 'image/jpeg',
      size: 91234,
      path: '/tmp/staging/a1',
      createdAt: 1700000000000,
    };
    expect(toDto('user', 'see this', [att])).toEqual({
      role: 'user',
      content: 'see this',
      attachments: [{ path: '/tmp/staging/a1', mime: 'image/jpeg', name: 'photo.jpg' }],
    });
  });

  it('preserves attachment order (multimodal layout matters for some providers)', () => {
    const a: UiAttachment = {
      id: 'a',
      name: 'a.png',
      mime: 'image/png',
      size: 1,
      path: '/tmp/a',
      createdAt: 0,
    };
    const b: UiAttachment = { ...a, id: 'b', name: 'b.png', path: '/tmp/b' };
    const c: UiAttachment = { ...a, id: 'c', name: 'c.png', path: '/tmp/c' };
    const out = toDto('user', '', [a, b, c]);
    expect(out.attachments?.map((x) => x.name)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('handles assistant role with attachments (used when retrying multimodal turns)', () => {
    // The retry path replays history including assistant rows;
    // they should never normally have attachments but the type
    // allows it, and the projection should be symmetric.
    const att: UiAttachment = {
      id: 'a',
      name: 'plot.png',
      mime: 'image/png',
      size: 1,
      path: '/tmp/p',
      createdAt: 0,
    };
    expect(toDto('assistant', 'see plot', [att])).toEqual({
      role: 'assistant',
      content: 'see plot',
      attachments: [{ path: '/tmp/p', mime: 'image/png', name: 'plot.png' }],
    });
  });
});
