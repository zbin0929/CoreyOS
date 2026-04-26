/**
 * Pure resolver for "which adapter handles THIS turn?".
 *
 * The original inline logic in `useChatSend` reads three Zustand
 * stores + the routing rule list, runs them through a four-tier
 * priority chain, and returns the adapter id to pass to
 * `chatStream({ adapter_id })`. The Zustand reads are imperative
 * (`useStore.getState()`) — by design, since the verdict must
 * scope to THIS send and not a subsequent switcher change — so the
 * decision logic itself is trivially extractable into a pure
 * function. That's `pickTurnAdapter` below.
 *
 * Priority chain (verbatim from `useChatSend.send()`):
 *   1. Routing-rule match — but ONLY when the matched target is in
 *      the live registered-adapters set. A stale rule pointing at
 *      a deleted adapter falls through silently rather than raising
 *      "unknown adapter" mid-stream.
 *   2. Per-session LLM profile pin — `hermes:profile:<id>` synthetic
 *      adapter. Wins over the global AgentSwitcher choice; that's
 *      the whole point of pinning a profile.
 *   3. Global AgentSwitcher choice (`useAgentsStore.activeId`).
 *   4. `undefined` → backend picks the default registry entry.
 *
 * NOTE: this does NOT consult `session.adapterId` — that field is
 * purely for sidebar grouping and is frozen at session creation
 * (see `db.rs::upsert_session COALESCE`).
 */
export interface TurnAdapterDecision {
  /** Final adapter id to pass to `chatStream`. `undefined` lets the
   *  backend pick its default registry entry. */
  activeAdapterId: string | undefined;
  /** The routing-rule winner, if any. Surfaced separately so the
   *  caller can flip session.adapterId on first-turn rule matches
   *  (so the adapter badge above the bubble renders correctly).
   *  `null` when no rule matched OR the matched rule pointed at a
   *  deleted adapter. */
  routedAdapterId: string | null;
}

export function pickTurnAdapter(args: {
  /** Per-session llm-profile pin from `chat-store.sessions[id].llmProfileId`.
   *  `null` when the user hasn't pinned a profile for this session. */
  profilePin: string | null;
  /** Global AgentSwitcher selection from `agents-store.activeId`. */
  agentsActiveId: string | null;
  /** Live set of registered adapter ids — guards against stale
   *  routing rules pointing at deleted adapters. */
  registeredAdapterIds: ReadonlySet<string>;
  /** Target id from the matched routing rule, or `null` if no rule
   *  matched the user's text. The match itself is run via
   *  `routing.ts::resolveRoutedRule` — this function only handles
   *  the gate-and-fallback logic that follows. */
  routedRuleTargetId: string | null;
}): TurnAdapterDecision {
  const { profilePin, agentsActiveId, registeredAdapterIds, routedRuleTargetId } = args;
  // Tier 1 — routing rule, gated on registry membership.
  const routedAdapterId =
    routedRuleTargetId && registeredAdapterIds.has(routedRuleTargetId)
      ? routedRuleTargetId
      : null;
  // Tiers 2 + 3 collapsed: profile pin synthesises a virtual adapter id;
  // otherwise fall through to whichever agent is globally active.
  const fallbackAdapterId =
    (profilePin ? `hermes:profile:${profilePin}` : agentsActiveId) ?? undefined;
  // Tier 1 wins over 2 / 3; tier 4 (undefined) is just `fallbackAdapterId`
  // being absent.
  return {
    activeAdapterId: routedAdapterId ?? fallbackAdapterId,
    routedAdapterId,
  };
}
