import type { TFunction } from 'i18next';

import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';

import { describeBreach, evaluateBudgetGate } from './budgetGate';

/**
 * T4.4b — budget gate. Factored out of `useChatSend.send` so the hook
 * stays at manageable size and so this block is easier to test + reuse
 * for retry if we ever want to gate that too.
 *
 * Scopes the verdict to THIS send: imperative reads off the chat /
 * agents stores so a subsequent switcher change can't re-route the
 * decision. Fails-safe on IPC errors — `evaluateBudgetGate` returns
 * an empty verdict, so a transient db/analytics hiccup never locks
 * the user out of chatting.
 *
 * Returns:
 *  · `proceed` — true when either no hard-block was raised, or the
 *    user accepted the confirm dialog.
 *  · `warnings` — humanized descriptions of the soft breaches to
 *    surface in the chip row (caller decides whether to clear /
 *    replace its own state).
 */
export async function runBudgetGate({
  sessionId,
  effectiveModel,
  t,
}: {
  sessionId: string;
  effectiveModel: string | null;
  t: TFunction;
}): Promise<{ proceed: boolean; warnings: string[] }> {
  const gateSess = useChatStore.getState().sessions[sessionId];
  const gateProfilePin = gateSess?.llmProfileId ?? null;
  // Scope to whichever adapter this turn will actually land on; mirrors
  // the send-side priority order: profile pin > global active > null.
  const activeAdapterIdForGate =
    (gateProfilePin
      ? `hermes:profile:${gateProfilePin}`
      : useAgentsStore.getState().activeId) ?? null;
  const verdict = await evaluateBudgetGate({
    effectiveModel,
    activeAdapterId: activeAdapterIdForGate,
  });
  if (verdict.blocks.length > 0) {
    const lines = verdict.blocks.map((b) => '  · ' + describeBreach(b)).join('\n');
    const ok = window.confirm(t('chat_page.budget_over_cap_confirm', { lines }));
    if (!ok) return { proceed: false, warnings: [] };
  }
  return {
    proceed: true,
    warnings: verdict.warns.map(describeBreach),
  };
}
