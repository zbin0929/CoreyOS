import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, PiggyBank, Plus } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { FALLBACK_PRICE } from '@/features/chat/budgetGate';
import {
  analyticsSummary,
  budgetDelete,
  budgetList,
  ipcErrorMessage,
  type AnalyticsSummaryDto,
  type BudgetRow,
} from '@/lib/ipc';

import { BudgetCard } from './BudgetCard';
import { BudgetEditor } from './BudgetEditor';

/**
 * Phase 4 · T4.4 — Budgets.
 *
 * Storage-only budgets so the user can pre-commit to a $-cap per scope,
 * period, and breach action. The cost-projection + 80%/100% notifications
 * + hard-block plumbing are deferred (they need a chat-send interceptor
 * that hooks every stream's `done` summary). What ships today:
 *
 * - Full CRUD UI — add / edit / delete.
 * - Live progress bar per budget: we snapshot the local usage totals from
 *   `analyticsSummary()` and project lifetime spend against the cap using
 *   a single flat token-price table. When the projection crosses 80% the
 *   bar turns amber; ≥100% turns danger red.
 * - `action_on_breach` is captured but UI is read-only on the
 *   notify/block/notify_block distinction — the interceptor lands with
 *   T4.4b.
 *
 * Pricing table is hard-coded here (not user-editable) because we want
 * the feature to demo cleanly without requiring the user to guess
 * numbers. The moment we ship a real "model catalog" this table migrates
 * to settings.
 *
 * Subcomponents live in siblings: `BudgetCard.tsx`, `BudgetEditor.tsx`;
 * pure formatters in `helpers.ts`.
 */

type Mode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; budget: BudgetRow };

export function BudgetsRoute() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BudgetRow[] | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [budgets, sum] = await Promise.all([budgetList(), analyticsSummary()]);
      setRows(budgets);
      setSummary(sum);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Estimated total spent (cents) derived from the lifetime token totals.
  // We don't yet break out per-model usage, so all budgets project against
  // the same lifetime pool with an average price. T4.4b refines this.
  const lifetimeCents = useMemo(() => {
    if (!summary) return 0;
    const { prompt_tokens, completion_tokens } = summary.totals;
    const price = FALLBACK_PRICE;
    const input = (prompt_tokens / 1_000_000) * price.input;
    const output = (completion_tokens / 1_000_000) * price.output;
    return Math.round(input + output);
  }, [summary]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('budgets.title')}
        subtitle={t('budgets.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('budgets.title')}
              content={t('budgets.help_page')}
              testId="budgets-help"
            />
            {mode.kind === 'list' && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => setMode({ kind: 'new' })}
                data-testid="budgets-new"
              >
                <Icon icon={Plus} size="sm" />
                {t('budgets.new')}
              </Button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <span>{error}</span>
            </div>
          )}

          {(mode.kind === 'new' || mode.kind === 'edit') && (
            <BudgetEditor
              initial={mode.kind === 'edit' ? mode.budget : undefined}
              onCancel={() => setMode({ kind: 'list' })}
              onSaved={async () => {
                setMode({ kind: 'list' });
                await load();
              }}
            />
          )}

          {mode.kind === 'list' &&
            (rows === null ? (
              <div className="flex items-center gap-2 text-fg-muted">
                <Icon icon={Loader2} size="md" className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={PiggyBank}
                title={t('budgets.empty_title')}
                description={t('budgets.empty_desc')}
              />
            ) : (
              <>
                {summary && (
                  <div className="mb-4 grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-border bg-bg-elev-1 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                        {t('budgets.total_prompt')}
                      </div>
                      <div className="text-lg font-semibold text-fg">
                        {(summary.totals.prompt_tokens / 1_000_000).toFixed(2)}M
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-bg-elev-1 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                        {t('budgets.total_completion')}
                      </div>
                      <div className="text-lg font-semibold text-fg">
                        {(summary.totals.completion_tokens / 1_000_000).toFixed(2)}M
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-bg-elev-1 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                        {t('budgets.estimated_cost')}
                      </div>
                      <div className="text-lg font-semibold text-fg">
                        ${(lifetimeCents / 100).toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
                <ul className="flex flex-col gap-2" data-testid="budgets-list">
                  {rows.map((b) => (
                    <BudgetCard
                      key={b.id}
                      budget={b}
                      spentCents={lifetimeCents}
                      onEdit={() => setMode({ kind: 'edit', budget: b })}
                      onDelete={async () => {
                        try {
                          await budgetDelete(b.id);
                          await load();
                        } catch (e) {
                          setError(ipcErrorMessage(e));
                        }
                      }}
                    />
                  ))}
                </ul>
              </>
            ))}
        </div>
      </div>
    </div>
  );
}
