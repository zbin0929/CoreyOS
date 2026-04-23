/**
 * T4.4b — chat-send budget interceptor.
 *
 * Runs before every outbound chat turn. Reads the current budget list
 * and the analytics rollup, computes projected spend against each
 * budget's cap for its period window, and returns a verdict the
 * composer can either silently accept, warn about inline, or surface
 * as a hard-confirm dialog (depending on each budget's
 * `action_on_breach`).
 *
 * ### Behaviour
 *
 * - **Thresholds**: every budget trips at **80% (warn)** and again at
 *   **100% (breach)**. Warn-only budgets fire only the notify path
 *   at both thresholds; block budgets stay silent until breach (by
 *   design — a strict block shouldn't leak a pre-breach signal);
 *   `notify_block` fires notify at 80% and both notify+block at 100%.
 * - **Windowing** (T4.4b-r2): `day` / `week` / `month` sum the
 *   relevant tail of `analytics.tokens_per_day` (UTC days). `day` =
 *   today, `week` = trailing 7 days incl. today, `month` = trailing
 *   30 days. `global` (no period constraint per se — still respects
 *   its `period` field, so a "global monthly cap" works). Per-day
 *   tokens are `prompt + completion` (the DTO doesn't split), so we
 *   use a **blended** per-token rate for windowed projections; the
 *   lifetime path keeps the split (input vs. output) cheap and
 *   accurate. Blended rate = (input + output) / 2.
 * - **Scope matching**: `global` always matches. `model` matches when
 *   the current effective model id equals `scope_value`. `adapter`
 *   (T4.4b-r2) matches when the active adapter in the AgentSwitcher
 *   equals `scope_value` — wired through from `send()`. `profile` /
 *   `channel` are still storage-only: we have no runtime signal to
 *   attribute them from a chat turn (channels attribute server-side
 *   at gateway ingress; profile scoping needs a profile selector we
 *   haven't built). They remain editable so the data model doesn't
 *   rot; the gate just ignores them.
 *
 * The gate fails **safe**: on any IPC error it returns an empty
 *  verdict so chat is never locked out by a flaky DB read.
 */

import {
  analyticsSummary,
  budgetList,
  type AnalyticsSummaryDto,
  type BudgetPeriod,
  type BudgetRow,
} from '@/lib/ipc';

/** Per-1M-token rough prices in USD cents. Mirrors the table on the
 *  Budgets page — intentionally duplicated to keep `budgetGate` free
 *  of a React-component import cycle. Update both sites together when
 *  the real pricing source ships. */
export const FALLBACK_PRICE = { input: 100, output: 300 };

/** Blended per-million-token rate in cents, used when we only have a
 *  combined (prompt+completion) token count per day and can't split it
 *  (`tokens_per_day` in the analytics DTO). */
const BLENDED_PRICE_PER_M = (FALLBACK_PRICE.input + FALLBACK_PRICE.output) / 2;

/** Warn threshold: 0.8 = 80% of cap. Applies to `notify` and
 *  `notify_block` budgets; strict `block` budgets stay silent until
 *  the 100% breach so they don't leak a pre-breach nag. */
const WARN_FRACTION = 0.8;

/**
 * Outcome of one breached budget. The composer uses `action` to decide
 * whether to warn inline, block with a confirm dialog, or both.
 */
export interface BudgetBreach {
  budget: BudgetRow;
  spentCents: number;
  /** Fraction of the cap this breach represents; 0.8 = 80% (warn),
   *  ≥1 = hard breach. Comparisons against `WARN_FRACTION` / `1` stay
   *  local to this module — consumers just format the number. */
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

export interface BudgetGateInput {
  /** Effective model id for the outgoing turn. `null` means we
   *  couldn't resolve one (rare — model-scoped budgets simply won't
   *  match). */
  effectiveModel: string | null;
  /** Active adapter id from the Topbar AgentSwitcher. Feeds the
   *  `adapter` scope match. `null` / `undefined` disables adapter
   *  matching for this turn. */
  activeAdapterId?: string | null;
  /** Clock override for tests. Defaults to `Date.now()`. */
  nowMs?: number;
}

/**
 * Compute the interceptor verdict for the next outgoing chat turn.
 * Fails safe: if either IPC errors out we return an empty verdict so
 * chat always stays functional, and log to the console so devs can
 * still notice in development.
 */
export async function evaluateBudgetGate(
  args: BudgetGateInput,
): Promise<BudgetVerdict> {
  let budgets: BudgetRow[] = [];
  let summary: AnalyticsSummaryDto | null = null;
  try {
    const [b, s] = await Promise.all([budgetList(), analyticsSummary()]);
    budgets = b;
    summary = s;
  } catch (e) {
    console.warn('[budgetGate] failed to evaluate; letting send proceed:', e);
    return { blocks: [], warns: [] };
  }

  return classifyBudgets(budgets, summary, {
    effectiveModel: args.effectiveModel,
    activeAdapterId: args.activeAdapterId ?? null,
    nowMs: args.nowMs ?? Date.now(),
  });
}

/**
 * Pure classifier — exported for unit tests. Given a snapshot of
 * budgets, analytics, and the turn context, returns the verdict
 * without touching the IPC layer.
 */
export function classifyBudgets(
  budgets: BudgetRow[],
  summary: AnalyticsSummaryDto,
  ctx: { effectiveModel: string | null; activeAdapterId: string | null; nowMs: number },
): BudgetVerdict {
  const blocks: BudgetBreach[] = [];
  const warns: BudgetBreach[] = [];

  const lifetimeCents = lifetimeSpendCents(summary);

  for (const budget of budgets) {
    if (!budgetAppliesToTurn(budget, ctx)) continue;
    if (budget.amount_cents <= 0) continue; // guard against div-by-zero

    const spentCents = periodSpendCents(budget.period, summary, ctx.nowMs, lifetimeCents);
    const fraction = spentCents / budget.amount_cents;
    if (fraction < WARN_FRACTION) continue;

    const breach: BudgetBreach = { budget, spentCents, fraction };
    const action = budget.action_on_breach;
    const breached = fraction >= 1;

    // Block only trips at ≥100% — pre-breach we never hard-block.
    if (breached && (action === 'block' || action === 'notify_block')) {
      blocks.push(breach);
    }
    // Notify fires at both thresholds for notify/notify_block.
    // Strict `block`-only budgets stay silent pre-breach (see module
    // docblock); at breach we still surface them via `blocks` so the
    // confirm dialog describes them.
    if (action === 'notify' || action === 'notify_block') {
      warns.push(breach);
    }
  }

  return { blocks, warns };
}

/** Total prompt+completion cost over the DB lifetime, in cents.
 *  Uses the split input/output rate (more accurate than the
 *  blended rate we have to fall back to for windowed totals). */
function lifetimeSpendCents(summary: AnalyticsSummaryDto): number {
  const { prompt_tokens, completion_tokens } = summary.totals;
  const inputC = (prompt_tokens / 1_000_000) * FALLBACK_PRICE.input;
  const outputC = (completion_tokens / 1_000_000) * FALLBACK_PRICE.output;
  return Math.round(inputC + outputC);
}

/**
 * Sum `tokens_per_day` entries inside the budget's window and convert
 * to cents via the blended rate. Windows are UTC-anchored to match the
 * `date(created_at/1000, 'unixepoch')` bucketing SQLite does in
 * `analytics_summary`. `day` counts today's bucket; `week` counts 7
 * buckets incl. today; `month` falls back to `lifetimeCents` because
 * our `tokens_per_day` series is exactly the trailing 30 days — so
 * summing the series == projected monthly spend (close enough; the
 * difference only matters when the DB has <30 days of history, in
 * which case it's conservative).
 */
function periodSpendCents(
  period: BudgetPeriod,
  summary: AnalyticsSummaryDto,
  nowMs: number,
  lifetimeCents: number,
): number {
  if (period === 'month') {
    // `tokens_per_day` already covers the trailing 30 days. Sum the
    // whole series — same as the Budgets page's current projection
    // modulo rounding, but windowed rather than lifetime.
    const tokens = summary.tokens_per_day.reduce((acc, d) => acc + d.count, 0);
    return tokensToCentsBlended(tokens);
  }

  const windowDays = period === 'day' ? 1 : 7;
  const cutoff = isoDateUtc(nowMs - (windowDays - 1) * 86_400_000);
  const tokens = summary.tokens_per_day
    .filter((d) => d.date >= cutoff)
    .reduce((acc, d) => acc + d.count, 0);

  // Degrade gracefully: if the series is empty (pre-T2.4 rows had
  // NULL usage, and seed DBs often do too), fall back to the
  // lifetime estimate so the user at least gets a conservative
  // breach read-out.
  if (tokens === 0 && summary.tokens_per_day.length === 0) {
    return lifetimeCents;
  }
  return tokensToCentsBlended(tokens);
}

function tokensToCentsBlended(tokens: number): number {
  return Math.round((tokens / 1_000_000) * BLENDED_PRICE_PER_M);
}

/** UTC-anchored `YYYY-MM-DD` formatter matching SQLite's
 *  `date(created_at/1000, 'unixepoch')`. */
function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Does this budget's scope cover the next turn? */
function budgetAppliesToTurn(
  b: BudgetRow,
  ctx: { effectiveModel: string | null; activeAdapterId: string | null },
): boolean {
  switch (b.scope_kind) {
    case 'global':
      return true;
    case 'model':
      return (
        !!b.scope_value &&
        !!ctx.effectiveModel &&
        b.scope_value === ctx.effectiveModel
      );
    case 'adapter':
      // T4.4b-r2 — ties T5.6's adapter-scope dropdown to runtime.
      return (
        !!b.scope_value &&
        !!ctx.activeAdapterId &&
        b.scope_value === ctx.activeAdapterId
      );
    case 'profile':
    case 'channel':
      // No runtime attribution yet — see module docblock.
      return false;
  }
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
