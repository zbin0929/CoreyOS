import type { BudgetRow } from '@/lib/ipc';

export function scopeLabel(b: BudgetRow, t: (k: string) => string): string {
  if (b.scope_kind === 'global') return t('budgets.scope.global');
  return `${t(`budgets.scope.${b.scope_kind}`)}: ${b.scope_value ?? '—'}`;
}

export function formatCents(cents: number): string {
  // Defensive: a malformed row (undefined / null / NaN) should not render
  // "$NaN" to the user. Clamp to 0 so the bad row is visible but doesn't
  // look like a Corey bug.
  const v = Number.isFinite(cents) ? cents : 0;
  return `$${(v / 100).toFixed(2)}`;
}
