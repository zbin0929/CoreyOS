import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import {
  budgetUpsert,
  ipcErrorMessage,
  type BudgetAction,
  type BudgetPeriod,
  type BudgetRow,
  type BudgetScopeKind,
} from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';

export function BudgetEditor({
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
