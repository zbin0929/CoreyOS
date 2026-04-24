import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Loader2,
  PiggyBank,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  analyticsSummary,
  budgetDelete,
  budgetList,
  budgetUpsert,
  ipcErrorMessage,
  type AnalyticsSummaryDto,
  type BudgetAction,
  type BudgetPeriod,
  type BudgetRow,
  type BudgetScopeKind,
} from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';

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
 */

// Fallback per-1M-token price in USD cents. Used for cost-progress
// estimation when the server doesn't return an accounted cost yet.
// Intentionally a single flat rate: the richer per-model price table
// was dead code as of T4.4b (when the real cost projection moved to
// the server) and was removed to stop it going stale silently.
const FALLBACK_PRICE = { input: 100, output: 300 };

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
            ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Card ─────────────────────────

function BudgetCard({
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
  const pct = Math.min(100, Math.round((spentCents / budget.amount_cents) * 100));
  const breached = spentCents >= budget.amount_cents;
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

// ───────────────────────── Editor ─────────────────────────

function BudgetEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: BudgetRow;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [scopeKind, setScopeKind] = useState<BudgetScopeKind>(initial?.scope_kind ?? 'global');
  const [scopeValue, setScopeValue] = useState(initial?.scope_value ?? '');
  const [amountDollars, setAmountDollars] = useState(
    initial ? (initial.amount_cents / 100).toFixed(2) : '5.00',
  );
  const [period, setPeriod] = useState<BudgetPeriod>(initial?.period ?? 'month');
  const [action, setAction] = useState<BudgetAction>(initial?.action_on_breach ?? 'notify');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsScopeValue = scopeKind !== 'global';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amountDollars) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || saving) return;
    if (needsScopeValue && !scopeValue.trim()) return;

    setSaving(true);
    setErr(null);
    const now = Date.now();
    const row: BudgetRow = initial
      ? {
          ...initial,
          scope_kind: scopeKind,
          scope_value: needsScopeValue ? scopeValue.trim() : null,
          amount_cents: cents,
          period,
          action_on_breach: action,
          updated_at: now,
        }
      : {
          id: `bg-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          scope_kind: scopeKind,
          scope_value: needsScopeValue ? scopeValue.trim() : null,
          amount_cents: cents,
          period,
          action_on_breach: action,
          created_at: now,
          updated_at: now,
        };
    try {
      await budgetUpsert(row);
      await onSaved();
    } catch (e) {
      setErr(ipcErrorMessage(e));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="budget-editor"
    >
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          <span className="text-fg-subtle">{t('budgets.field.scope_kind')}</span>
          <Select<BudgetScopeKind>
            value={scopeKind}
            onChange={setScopeKind}
            data-testid="budget-scope-kind"
            ariaLabel={t('budgets.field.scope_kind')}
            options={[
              { value: 'global', label: t('budgets.scope.global') },
              { value: 'model', label: t('budgets.scope.model') },
              { value: 'profile', label: t('budgets.scope.profile') },
              { value: 'adapter', label: t('budgets.scope.adapter') },
              { value: 'channel', label: t('budgets.scope.channel') },
            ]}
          />
        </label>
        {needsScopeValue && (
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            <span className="text-fg-subtle">{t('budgets.field.scope_value')}</span>
            <ScopeValueInput
              scopeKind={scopeKind}
              value={scopeValue}
              onChange={setScopeValue}
            />
          </label>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          <span className="text-fg-subtle">{t('budgets.field.amount_usd')}</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-sm text-fg focus:border-gold-500/40 focus:outline-none"
            data-testid="budget-amount"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          <span className="text-fg-subtle">{t('budgets.field.period')}</span>
          <Select<BudgetPeriod>
            value={period}
            onChange={setPeriod}
            data-testid="budget-period"
            ariaLabel={t('budgets.field.period')}
            options={[
              { value: 'day', label: t('budgets.period.day') },
              { value: 'week', label: t('budgets.period.week') },
              { value: 'month', label: t('budgets.period.month') },
            ]}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          <span className="text-fg-subtle">{t('budgets.field.action')}</span>
          <Select<BudgetAction>
            value={action}
            onChange={setAction}
            data-testid="budget-action"
            ariaLabel={t('budgets.field.action')}
            options={[
              { value: 'notify', label: t('budgets.action.notify') },
              { value: 'block', label: t('budgets.action.block') },
              { value: 'notify_block', label: t('budgets.action.notify_block') },
            ]}
          />
        </label>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/5 px-2 py-1 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          <Icon icon={X} size="sm" />
          {t('budgets.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={saving}
          data-testid="budget-save"
        >
          {saving ? <Icon icon={Loader2} size="sm" className="animate-spin" /> : <Icon icon={Check} size="sm" />}
          {t('budgets.save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Input for `scope_value`. For `scope_kind === 'adapter'`, T5.6 replaces
 * the free-form text box with a `<Select>` populated from the live agent
 * registry — the persisted value is the adapter `id` (stable across
 * display-name changes), the dropdown shows the human-readable `name`.
 * Other scopes still need free-form text (model ids / profile names /
 * channel slugs are user-typed or copy-pasted).
 *
 * Graceful degradation: if the registry snapshot hasn't loaded yet OR is
 * empty (unusual — Hermes always registers), we fall back to the text
 * input so the form never wedges.
 */
function ScopeValueInput({
  scopeKind,
  value,
  onChange,
}: {
  scopeKind: BudgetScopeKind;
  value: string;
  onChange: (v: string) => void;
}) {
  const adapters = useAgentsStore((s) => s.adapters);
  if (scopeKind === 'adapter' && adapters && adapters.length > 0) {
    return (
      <Select<string>
        value={value || adapters[0]?.id || ''}
        onChange={onChange}
        data-testid="budget-scope-value"
        ariaLabel="Adapter"
        options={adapters.map((a) => ({ value: a.id, label: a.name }))}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="e.g. gpt-4o"
      className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-sm text-fg focus:border-gold-500/40 focus:outline-none"
      data-testid="budget-scope-value"
    />
  );
}

// ───────────────────────── Helpers ─────────────────────────

function scopeLabel(b: BudgetRow, t: (k: string) => string): string {
  if (b.scope_kind === 'global') return t('budgets.scope.global');
  return `${t(`budgets.scope.${b.scope_kind}`)}: ${b.scope_value ?? '—'}`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
