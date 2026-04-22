/**
 * T4.4b — chat-send budget interceptor.
 *
 * Runs before every outbound chat turn. Reads the current budget list
 * and the lifetime analytics rollup, computes projected spend against
 * each budget's cap, and returns a verdict the composer can either
 * silently accept, warn about inline, or surface as a hard-confirm
 * dialog (depending on each budget's `action_on_breach`).
 *
 * ### Scope (v1)
 *
 * - Lifetime spend only. Per-period windowing (day / week / month)
 *   needs token-per-day breakdowns in `analyticsSummary`; the DTO
 *   currently only carries messages-per-day and tokens-per-day totals
 *   with no per-budget-period filter, so honouring `period` would
 *   lie more than it helps. Documented in the backlog; revisit when
 *   the analytics summary ships a per-period bucket.
 * - Lifetime totals go through the same flat price table the Budgets
 *   page uses (`FALLBACK_PRICE`). Per-model cost breakdown wants
 *   per-model token counts — also not in the current summary. See
 *   backlog.
 * - Scope matching: `global` budgets match every send; `model`
 *   budgets match only when the current effective model id equals
 *   `scope_value`. Other scope kinds (`profile`, `adapter`, `channel`)
 *   never match today — we lack the runtime signal to attribute
 *   spend to them. They're kept in the storage layer so users can
 *   still edit them; the interceptor just ignores until we wire up
 *   attribution.
 *
 * Keeping the gate deliberately conservative means we can ship a
 * useful warn/block today without pretending to be a full cost
 * accounting system.
 */

import {
  analyticsSummary,
  budgetList,
  type BudgetRow,
} from '@/lib/ipc';

/** Per-1M-token rough prices in USD cents. Mirrors the table on the
 *  Budgets page — intentionally duplicated to keep `budgetGate` free
 *  of a React-component import cycle. Update both sites together when
 *  the real pricing source ships. */
const FALLBACK_PRICE = { input: 100, output: 300 };

/**
 * Outcome of one breached budget. The composer uses `action` to decide
 * whether to warn inline, block with a confirm dialog, or both.
 */
export interface BudgetBreach {
  budget: BudgetRow;
  spentCents: number;
  /** 0.8 = 80% of cap — we surface these too so users aren't
   *  surprised the moment they tip over 100%. */
  fraction: number;
}

export interface BudgetVerdict {
  /** Breaches whose `action_on_breach` contains `block`. The composer
   *  MUST confirm with the user before sending. */
  blocks: BudgetBreach[];
  /** Breaches whose `action_on_breach` contains `notify` (including
   *  `notify_block`). The composer SHOULD surface inline — but if a
   *  block breach is already showing, these can fold into that UI. */
  warns: BudgetBreach[];
}

/**
 * Compute the interceptor verdict for the next outgoing chat turn.
 * Fails safe: if either IPC errors out we return an empty verdict so
 * chat always stays functional, and log to the console so devs can
 * still notice in development.
 */
export async function evaluateBudgetGate(args: {
  effectiveModel: string | null;
}): Promise<BudgetVerdict> {
  let budgets: BudgetRow[] = [];
  let spentCents = 0;
  try {
    const [b, summary] = await Promise.all([budgetList(), analyticsSummary()]);
    budgets = b;
    const { prompt_tokens, completion_tokens } = summary.totals;
    const inputC = (prompt_tokens / 1_000_000) * FALLBACK_PRICE.input;
    const outputC = (completion_tokens / 1_000_000) * FALLBACK_PRICE.output;
    spentCents = Math.round(inputC + outputC);
  } catch (e) {
    console.warn('[budgetGate] failed to evaluate; letting send proceed:', e);
    return { blocks: [], warns: [] };
  }

  const blocks: BudgetBreach[] = [];
  const warns: BudgetBreach[] = [];

  for (const budget of budgets) {
    if (!budgetAppliesToTurn(budget, args.effectiveModel)) continue;
    if (budget.amount_cents <= 0) continue; // guard against div-by-zero
    const fraction = spentCents / budget.amount_cents;
    if (fraction < 1) continue; // only breach (>=100%) trips the gate

    const breach: BudgetBreach = {
      budget,
      spentCents,
      fraction,
    };
    const action = budget.action_on_breach;
    if (action === 'block' || action === 'notify_block') {
      blocks.push(breach);
    }
    if (action === 'notify' || action === 'notify_block') {
      warns.push(breach);
    }
  }

  return { blocks, warns };
}

/** Does this budget's scope cover the next turn? */
function budgetAppliesToTurn(
  b: BudgetRow,
  effectiveModel: string | null,
): boolean {
  if (b.scope_kind === 'global') return true;
  if (b.scope_kind === 'model' && b.scope_value && effectiveModel) {
    return b.scope_value === effectiveModel;
  }
  // profile / adapter / channel — no runtime attribution yet. See
  // module docblock.
  return false;
}

/** Short human string for a breach — "deepseek-chat · $3.21 / $2.00
 *  (160%)". Useful in warn banners and the confirm-dialog body. */
export function describeBreach(br: BudgetBreach): string {
  const scope =
    br.budget.scope_kind === 'global'
      ? 'global'
      : br.budget.scope_value ?? br.budget.scope_kind;
  const spent = (br.spentCents / 100).toFixed(2);
  const cap = (br.budget.amount_cents / 100).toFixed(2);
  const pct = Math.round(br.fraction * 100);
  return `${scope} · $${spent} / $${cap} (${pct}%)`;
}
