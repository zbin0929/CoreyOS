import { describe, expect, it } from 'vitest';

import { pickTurnAdapter } from './turnAdapter';

const REGISTERED = new Set(['hermes', 'claude-code', 'aider', 'hermes:profile:custom']);

describe('pickTurnAdapter', () => {
  describe('tier 4 — backend default', () => {
    it('returns undefined when no signal is present at all', () => {
      const r = pickTurnAdapter({
        profilePin: null,
        agentsActiveId: null,
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: null,
      });
      expect(r).toEqual({ activeAdapterId: undefined, routedAdapterId: null });
    });
  });

  describe('tier 3 — global AgentSwitcher', () => {
    it('returns the active agent id when no profile pin and no rule', () => {
      const r = pickTurnAdapter({
        profilePin: null,
        agentsActiveId: 'aider',
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: null,
      });
      expect(r).toEqual({ activeAdapterId: 'aider', routedAdapterId: null });
    });
  });

  describe('tier 2 — per-session profile pin', () => {
    it('synthesises hermes:profile:<id> from a profile pin', () => {
      const r = pickTurnAdapter({
        profilePin: 'gpt-4o',
        agentsActiveId: null,
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: null,
      });
      expect(r.activeAdapterId).toBe('hermes:profile:gpt-4o');
      expect(r.routedAdapterId).toBeNull();
    });

    it('profile pin wins over the global AgentSwitcher choice', () => {
      // The whole point of pinning a profile to a session is that
      // it overrides whatever agent is globally active.
      const r = pickTurnAdapter({
        profilePin: 'gpt-4o',
        agentsActiveId: 'aider',
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: null,
      });
      expect(r.activeAdapterId).toBe('hermes:profile:gpt-4o');
    });
  });

  describe('tier 1 — routing rule', () => {
    it('beats the profile pin when the matched target is registered', () => {
      const r = pickTurnAdapter({
        profilePin: 'gpt-4o',
        agentsActiveId: 'aider',
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: 'claude-code',
      });
      expect(r).toEqual({
        activeAdapterId: 'claude-code',
        routedAdapterId: 'claude-code',
      });
    });

    it('beats the global active when there is no profile pin', () => {
      const r = pickTurnAdapter({
        profilePin: null,
        agentsActiveId: 'aider',
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: 'hermes',
      });
      expect(r.activeAdapterId).toBe('hermes');
      expect(r.routedAdapterId).toBe('hermes');
    });

    it('falls through to the lower-tier fallback when the matched target is NOT registered', () => {
      // A stale rule pointing at a deleted adapter must NOT raise
      // "unknown adapter" mid-stream — silently fall through to
      // whatever the user has actively configured.
      const r = pickTurnAdapter({
        profilePin: 'gpt-4o',
        agentsActiveId: 'aider',
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: 'long-deleted-adapter',
      });
      expect(r.activeAdapterId).toBe('hermes:profile:gpt-4o');
      expect(r.routedAdapterId).toBeNull();
    });

    it('falls through all the way to backend-default when no fallback exists either', () => {
      const r = pickTurnAdapter({
        profilePin: null,
        agentsActiveId: null,
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: 'long-deleted-adapter',
      });
      expect(r.activeAdapterId).toBeUndefined();
      expect(r.routedAdapterId).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('treats an empty registry as "no rule can win"', () => {
      const r = pickTurnAdapter({
        profilePin: null,
        agentsActiveId: 'aider',
        registeredAdapterIds: new Set(),
        routedRuleTargetId: 'hermes',
      });
      expect(r.activeAdapterId).toBe('aider');
      expect(r.routedAdapterId).toBeNull();
    });

    it('keeps `routedAdapterId` and `activeAdapterId` in sync when both are derived from the rule', () => {
      // Caller uses `routedAdapterId` to flip session.adapterId on
      // first-turn rule matches; if these two ever diverge, the
      // session badge would render the wrong agent.
      const r = pickTurnAdapter({
        profilePin: null,
        agentsActiveId: null,
        registeredAdapterIds: REGISTERED,
        routedRuleTargetId: 'hermes:profile:custom',
      });
      expect(r.activeAdapterId).toBe(r.routedAdapterId);
      expect(r.activeAdapterId).toBe('hermes:profile:custom');
    });
  });
});
