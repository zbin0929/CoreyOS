import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { BudgetRow } from '@/lib/ipc';

import { formatCents, scopeLabel } from './helpers';

export function BudgetCard({
  budget,
  spentCents,
  onEdit,
  onDelete,
}: {
  budget: BudgetRow;
  spentCents: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  // Guard against malformed rows (e.g. cap_cents === 0 from a migration
  // bug, or an upstream schema drift) — we'd otherwise render $NaN and
  // NaN% which looks broken. Falls through as "0%" + safe totals.
  const cap = budget.amount_cents || 0;
  const rawPct = cap > 0 ? (spentCents / cap) * 100 : 0;
  const pct = Math.min(100, Math.max(0, Math.round(Number.isFinite(rawPct) ? rawPct : 0)));
  const breached = cap > 0 && spentCents >= cap;
  const warn = !breached && pct >= 80;
  const colorClass = breached
    ? 'bg-danger'
    : warn
    ? 'bg-amber-500'
    : 'bg-emerald-500';

  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3"
      data-testid={`budget-row-${budget.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-fg">
              {scopeLabel(budget, t)}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
              · {t(`budgets.period.${budget.period}`)}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
              · {t(`budgets.action.${budget.action_on_breach}`)}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {formatCents(spentCents)} / {formatCents(budget.amount_cents)} ({pct}%)
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} data-testid={`budget-edit-${budget.id}`}>
            {t('budgets.edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} data-testid={`budget-delete-${budget.id}`}>
            <Icon icon={Trash2} size="xs" className="text-danger" />
          </Button>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elev-3">
        <div
          className={cn('h-full transition-all', colorClass)}
          style={{ width: `${pct}%` }}
          data-testid={`budget-progress-${budget.id}`}
          data-pct={pct}
        />
      </div>
      {breached && (
        <div className="flex items-center gap-1 text-[11px] text-danger" data-testid={`budget-breached-${budget.id}`}>
          <Icon icon={AlertTriangle} size="xs" />
          {t('budgets.breached')}
        </div>
      )}
      {warn && !breached && (
        <div className="flex items-center gap-1 text-[11px] text-amber-500" data-testid={`budget-warning-${budget.id}`}>
          <Icon icon={AlertTriangle} size="xs" />
          {t('budgets.warning_80')}
        </div>
      )}
    </li>
  );
}
