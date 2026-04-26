import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  sandboxScopeDelete,
  sandboxScopeList,
  sandboxScopeUpsert,
  type SandboxScope,
} from '@/lib/ipc';

import { Field, Section } from '../shared';

/**
 * T6.5 — manage named sandbox scopes. The `default` scope is always
 * present and can't be deleted, but other scopes can be
 * created/renamed/deleted. Roots per scope are not editable HERE —
 * the existing Workspace section still edits the default scope's
 * roots, and non-default scope roots are edited by clicking a scope
 * row which expands inline.
 *
 * Deliberately kept list-only with an inline create form; no modal
 * so the flow matches the Hermes instances section.
 */
export function SandboxScopesSection() {
  const { t } = useTranslation();
  const [scopes, setScopes] = useState<SandboxScope[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const rows = await sandboxScopeList();
      setScopes(rows);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setScopes([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = newId.trim();
    const label = newLabel.trim() || id;
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sandboxScopeUpsert({ id, label, roots: [] });
      setNewId('');
      setNewLabel('');
      await refresh();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (busy) return;
    if (!window.confirm(t('settings.sandbox_scopes.confirm_delete', { id }))) return;
    setBusy(true);
    setError(null);
    try {
      await sandboxScopeDelete(id);
      await refresh();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      id="settings-scopes"
      title={t('settings.sandbox_scopes.title')}
      description={t('settings.sandbox_scopes.desc')}
    >
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {scopes === null ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          data-testid="sandbox-scopes-list"
        >
          {scopes.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs"
              data-testid={`sandbox-scope-row-${s.id}`}
            >
              <code className="rounded bg-bg-elev-3 px-1 py-0.5 font-mono text-[11px] text-fg">
                {s.id}
              </code>
              <span className="text-fg">{s.label}</span>
              <span className="ml-2 text-fg-subtle">
                {t('settings.sandbox_scopes.root_count', { count: s.roots.length })}
              </span>
              <div className="ml-auto">
                {s.id === 'default' ? (
                  <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    {t('settings.sandbox_scopes.default_locked')}
                  </span>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void onDelete(s.id)}
                    disabled={busy}
                    data-testid={`sandbox-scope-delete-${s.id}`}
                    aria-label={t('settings.sandbox_scopes.delete')}
                  >
                    <Icon icon={Trash2} size="xs" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create form — a simple inline flow to avoid yet another
          modal. New scopes start with an empty root list; users edit
          roots later (C3 / follow-up adds per-scope root editing). */}
      <form
        onSubmit={onCreate}
        className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
        data-testid="sandbox-scope-create-form"
      >
        <Field label={t('settings.sandbox_scopes.new_id')}>
          <input
            type="text"
            value={newId}
            onChange={(e) => setNewId(e.target.value.toLowerCase())}
            placeholder="worker"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
            spellCheck={false}
            data-testid="sandbox-scope-new-id"
          />
        </Field>
        <Field label={t('settings.sandbox_scopes.new_label')}>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('settings.sandbox_scopes.new_label_placeholder')}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            data-testid="sandbox-scope-new-label"
          />
        </Field>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={!newId.trim() || busy}
          data-testid="sandbox-scope-create"
        >
          <Icon icon={Plus} size="sm" />
          {t('settings.sandbox_scopes.add')}
        </Button>
      </form>
    </Section>
  );
}
