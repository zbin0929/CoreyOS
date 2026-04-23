import { describe, it, expect } from 'vitest';
import {
  classifyBudgets,
  describeBreach,
  type BudgetVerdict,
} from './budgetGate';
import type {
  AnalyticsSummaryDto,
  BudgetRow,
  BudgetAction,
  BudgetPeriod,
  BudgetScopeKind,
} from '@/lib/ipc';

// ───────────────────────── Fixtures ─────────────────────────

function mkBudget(over: Partial<BudgetRow>): BudgetRow {
  return {
    id: over.id ?? 'b1',
    scope_kind: over.scope_kind ?? 'global',
    scope_value: over.scope_value ?? null,
    amount_cents: over.amount_cents ?? 500,
    period: over.period ?? 'day',
    action_on_breach: over.action_on_breach ?? 'notify',
    created_at: 0,
    updated_at: 0,
  };
}

function mkSummary(over: Partial<AnalyticsSummaryDto> = {}): AnalyticsSummaryDto {
  return {
    totals: {
      sessions: 0,
      messages: 0,
      tool_calls: 0,
      active_days: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      ...(over.totals ?? {}),
    },
    messages_per_day: over.messages_per_day ?? [],
    tokens_per_day: over.tokens_per_day ?? [],
    model_usage: over.model_usage ?? [],
    tool_usage: over.tool_usage ?? [],
    adapter_usage: over.adapter_usage ?? [],
    generated_at: over.generated_at ?? 0,
  };
}

// Fixed `now` in UTC so `tokens_per_day` date cutoffs are deterministic.
const NOW_MS = Date.UTC(2026, 3, 23, 12, 0, 0); // 2026-04-23T12:00:00Z
const CTX = { effectiveModel: null, activeAdapterId: null, nowMs: NOW_MS };

// ───────────────────────── Thresholds ─────────────────────────

describe('classifyBudgets — 80% warn threshold', () => {
  it('does not surface budgets under 80%', () => {
    // 400k prompt tokens * 100¢/M = 40¢ spent vs 500¢ cap = 8%
    const v = classifyBudgets(
      [mkBudget({ amount_cents: 500, period: 'month', action_on_breach: 'notify' })],
      mkSummary({ totals: { prompt_tokens: 400_000 } as never }),
      CTX,
    );
    expect(v.warns).toHaveLength(0);
    expect(v.blocks).toHaveLength(0);
  });

  it('surfaces notify budgets at 80% as warns only (not blocks)', () => {
    // Monthly budget looks at tokens_per_day sum: 2M tokens @ 200¢/M blended = 400¢ vs 500¢ cap = 80%
    const v = classifyBudgets(
      [mkBudget({ amount_cents: 500, period: 'month', action_on_breach: 'notify' })],
      mkSummary({ tokens_per_day: [{ date: '2026-04-23', count: 2_000_000 }] }),
      CTX,
    );
    expect(v.warns).toHaveLength(1);
    expect(v.blocks).toHaveLength(0);
    expect(v.warns[0]!.fraction).toBeCloseTo(0.8);
  });

  it('strict block budgets stay silent pre-breach (below 100%)', () => {
    // 80% of cap with a `block` action → no warn AND no block leaked.
    const v = classifyBudgets(
      [mkBudget({ amount_cents: 500, period: 'month', action_on_breach: 'block' })],
      mkSummary({ tokens_per_day: [{ date: '2026-04-23', count: 2_000_000 }] }),
      CTX,
    );
    expect(v.warns).toHaveLength(0);
    expect(v.blocks).toHaveLength(0);
  });

  it('notify_block pre-breach fires warn only, not block', () => {
    const v = classifyBudgets(
      [mkBudget({ amount_cents: 500, period: 'month', action_on_breach: 'notify_block' })],
      mkSummary({ tokens_per_day: [{ date: '2026-04-23', count: 2_000_000 }] }),
      CTX,
    );
    expect(v.warns).toHaveLength(1);
    expect(v.blocks).toHaveLength(0);
  });
});

describe('classifyBudgets — 100% breach', () => {
  it('block budgets trip the block path at ≥100%', () => {
    // 3M tokens @ 200¢/M = 600¢ vs 500¢ cap = 120%
    const v = classifyBudgets(
      [mkBudget({ amount_cents: 500, period: 'month', action_on_breach: 'block' })],
      mkSummary({ tokens_per_day: [{ date: '2026-04-23', count: 3_000_000 }] }),
      CTX,
    );
    expect(v.blocks).toHaveLength(1);
    expect(v.blocks[0]!.fraction).toBeGreaterThanOrEqual(1);
  });

  it('notify_block fires both warn and block at breach', () => {
    const v = classifyBudgets(
      [mkBudget({ amount_cents: 500, period: 'month', action_on_breach: 'notify_block' })],
      mkSummary({ tokens_per_day: [{ date: '2026-04-23', count: 3_000_000 }] }),
      CTX,
    );
    expect(v.warns).toHaveLength(1);
    expect(v.blocks).toHaveLength(1);
  });
});

// ───────────────────────── Scope matching ─────────────────────────

describe('classifyBudgets — scope matching', () => {
  const overCapSummary = mkSummary({
    tokens_per_day: [{ date: '2026-04-23', count: 3_000_000 }],
  });

  it('global budgets match every turn', () => {
    const v = classifyBudgets(
      [mkBudget({ scope_kind: 'global', amount_cents: 500, period: 'month' })],
      overCapSummary,
      CTX,
    );
    expect(v.warns).toHaveLength(1);
  });

  it('model budget matches only when effective model equals scope_value', () => {
    const budgets = [
      mkBudget({ scope_kind: 'model', scope_value: 'gpt-4o', amount_cents: 500, period: 'month' }),
    ];
    const miss = classifyBudgets(budgets, overCapSummary, {
      ...CTX,
      effectiveModel: 'deepseek-chat',
    });
    const hit = classifyBudgets(budgets, overCapSummary, {
      ...CTX,
      effectiveModel: 'gpt-4o',
    });
    expect(miss.warns).toHaveLength(0);
    expect(hit.warns).toHaveLength(1);
  });

  it('adapter budget matches only when active adapter equals scope_value', () => {
    const budgets = [
      mkBudget({
        scope_kind: 'adapter',
        scope_value: 'claude_code',
        amount_cents: 500,
        period: 'month',
      }),
    ];
    const miss = classifyBudgets(budgets, overCapSummary, { ...CTX, activeAdapterId: 'hermes' });
    const hit = classifyBudgets(budgets, overCapSummary, {
      ...CTX,
      activeAdapterId: 'claude_code',
    });
    expect(miss.warns).toHaveLength(0);
    expect(hit.warns).toHaveLength(1);
  });

  it.each<BudgetScopeKind>(['profile', 'channel'])(
    '%s budgets are silently ignored (no runtime attribution yet)',
    (scope_kind) => {
      const v = classifyBudgets(
        [mkBudget({ scope_kind, scope_value: 'anything', amount_cents: 500, period: 'month' })],
        overCapSummary,
        CTX,
      );
      expect(v.warns).toHaveLength(0);
      expect(v.blocks).toHaveLength(0);
    },
  );
});

// ───────────────────────── Period windowing ─────────────────────────

describe('classifyBudgets — period windowing', () => {
  // 500k tokens/day over 10 days. `day` should pick 500k (= 100¢ blended),
  // `week` should pick 3.5M (= 700¢), `month` should pick 5M (= 1000¢).
  const series = Array.from({ length: 10 }, (_, i) => {
    const ms = NOW_MS - i * 86_400_000;
    return { date: new Date(ms).toISOString().slice(0, 10), count: 500_000 };
  });
  const summary = mkSummary({ tokens_per_day: series });

  it('day window = today only', () => {
    // 500k tokens * 200¢/M = 100¢. Cap 80¢ → 125% (breach).
    const v = classifyBudgets(
      [mkBudget({ period: 'day', amount_cents: 80, action_on_breach: 'notify_block' })],
      summary,
      CTX,
    );
    expect(v.blocks).toHaveLength(1);
    expect(v.warns).toHaveLength(1);
  });

  it('week window = trailing 7 days', () => {
    // 7 days * 500k = 3.5M tokens * 200¢/M = 700¢.
    // Cap 700¢ → 100% breach; cap 1000¢ → 70% (under warn, silent).
    const atCap = classifyBudgets(
      [mkBudget({ period: 'week', amount_cents: 700, action_on_breach: 'notify' })],
      summary,
      CTX,
    );
    const under = classifyBudgets(
      [mkBudget({ period: 'week', amount_cents: 1000, action_on_breach: 'notify' })],
      summary,
      CTX,
    );
    expect(atCap.warns).toHaveLength(1);
    expect(under.warns).toHaveLength(0);
  });

  it('month window = full tokens_per_day series', () => {
    // 10 days * 500k = 5M tokens * 200¢/M = 1000¢.
    const v = classifyBudgets(
      [mkBudget({ period: 'month', amount_cents: 1000, action_on_breach: 'notify' })],
      summary,
      CTX,
    );
    expect(v.warns).toHaveLength(1);
    expect(v.warns[0]!.fraction).toBeCloseTo(1);
  });
});

// ───────────────────────── Safety ─────────────────────────

describe('classifyBudgets — safety', () => {
  it('ignores budgets with non-positive amount_cents', () => {
    const v = classifyBudgets(
      [mkBudget({ amount_cents: 0, period: 'month' })],
      mkSummary({ tokens_per_day: [{ date: '2026-04-23', count: 9_999_999 }] }),
      CTX,
    );
    expect(v.warns).toHaveLength(0);
    expect(v.blocks).toHaveLength(0);
  });
});

// ───────────────────────── Formatting ─────────────────────────

describe('describeBreach', () => {
  it('formats a global breach with $ / $ / %', () => {
    const s = describeBreach({
      budget: mkBudget({ scope_kind: 'global', amount_cents: 500, period: 'month' }),
      spentCents: 600,
      fraction: 1.2,
    });
    expect(s).toContain('global');
    expect(s).toContain('$6.00');
    expect(s).toContain('$5.00');
    expect(s).toContain('120%');
  });
});

// Nudge unused-import guard: these are types, silencing ts-unused-locals via use site.
const _typecheck: BudgetVerdict = { blocks: [], warns: [] };
void _typecheck;
void (null as unknown as BudgetAction);
void (null as unknown as BudgetPeriod);
