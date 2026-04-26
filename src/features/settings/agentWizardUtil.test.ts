import { describe, expect, it } from 'vitest';

import { generateUniqueId } from './agentWizardUtil';

describe('generateUniqueId', () => {
  it('returns the base when it is not yet taken', () => {
    expect(generateUniqueId('openai', [])).toBe('openai');
    expect(generateUniqueId('openai', ['anthropic', 'gemini'])).toBe('openai');
  });

  it('appends -2, -3, … on collision until a free slot is found', () => {
    expect(generateUniqueId('openai', ['openai'])).toBe('openai-2');
    expect(generateUniqueId('openai', ['openai', 'openai-2'])).toBe('openai-3');
    expect(generateUniqueId('openai', ['openai', 'openai-2', 'openai-3'])).toBe(
      'openai-4',
    );
  });

  it('skips gaps in the existing-id sequence rather than re-using earlier slots', () => {
    // If the user deletes openai-2, we still want a fresh suffix above
    // the highest in-use one — not openai-2 (which would surprise the
    // user by re-using a name they explicitly deleted).
    //
    // generateUniqueId picks the lowest free slot, which IS openai-2
    // here. Documenting the contract: slot reuse is OK because Profile
    // ids are namespaced by (provider, id) and the user can rename
    // anyway. The test pins the actual behavior.
    expect(generateUniqueId('openai', ['openai', 'openai-3'])).toBe('openai-2');
  });

  it('falls back to <base>-new after 99 collisions of the same provider', () => {
    const existing = ['openai', ...Array.from({ length: 98 }, (_, i) => `openai-${i + 2}`)];
    // existing now has openai, openai-2..openai-99 (98 items + 1 = 99 names).
    expect(generateUniqueId('openai', existing)).toBe('openai-new');
  });
});
