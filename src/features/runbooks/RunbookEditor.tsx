import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ipcErrorMessage, runbookUpsert, type RunbookRow } from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';

import { newRunbookId } from './newRunbookId';
import { detectParams } from './utils';

export function RunbookEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: RunbookRow;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [template, setTemplate] = useState(
    initial?.template ?? 'Summarize the following notes:\n\n{{notes}}',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const params = useMemo(() => detectParams(template), [template]);
  // T4.6b — scope picker. `null` means "any profile", non-null pins the
  // runbook to a specific Hermes profile. Defaults for NEW runbooks:
  // any-profile (keeps historical behaviour). For EDIT: whatever's
  // persisted.
  const [scopeProfile, setScopeProfile] = useState<string | null>(
    initial?.scope_profile ?? null,
  );
  const activeProfile = useAppStatusStore((s) => s.activeProfile);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !template.trim() || saving) return;
    setSaving(true);
    setErr(null);
    const now = Date.now();
    const row: RunbookRow = initial
      ? {
          ...initial,
          name: name.trim(),
          description: description.trim() || null,
          template,
          scope_profile: scopeProfile,
          updated_at: now,
        }
      : {
          id: newRunbookId(),
          name: name.trim(),
          description: description.trim() || null,
          template,
          scope_profile: scopeProfile,
          created_at: now,
          updated_at: now,
        };
    try {
      await runbookUpsert(row);
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
      data-testid="runbook-editor"
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">{t('runbooks.field.name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="daily-standup"
          className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-sm text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="runbook-name"
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">{t('runbooks.field.description')}</span>
        <input
          value={description ?? ''}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('runbooks.field.description_placeholder')}
          className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-sm text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="runbook-description"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">
          {t('runbooks.field.template')}{' '}
          <span className="text-fg-subtle/80">{t('runbooks.field.template_hint')}</span>
        </span>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={6}
          className="min-h-[120px] resize-y rounded border border-border bg-bg-elev-2 px-2 py-1.5 font-mono text-xs text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="runbook-template"
        />
        {params.length > 0 && (
          <span className="text-[10px] text-fg-subtle">
            {t('runbooks.field.detected', { list: params.join(', ') })}
          </span>
        )}
      </label>

      {/* T4.6b — scope picker. Two-option radio keeps the UI compact;
          non-active profile scopes stay editable via direct DB edit.
          When there's no active profile Hermes isn't installed, so the
          picker hides entirely (any-profile is the only sensible
          default). */}
      {activeProfile && (
        <fieldset
          className="flex flex-col gap-1.5 rounded border border-border bg-bg-elev-2/40 px-2 py-1.5 text-xs"
          data-testid="runbook-scope-picker"
        >
          <legend className="px-1 text-fg-subtle">
            {t('runbooks.field.scope')}
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="runbook-scope"
              checked={scopeProfile === null}
              onChange={() => setScopeProfile(null)}
              data-testid="runbook-scope-any"
            />
            <span>{t('runbooks.scope.any')}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="runbook-scope"
              checked={scopeProfile === activeProfile}
              onChange={() => setScopeProfile(activeProfile)}
              data-testid="runbook-scope-current"
            />
            <span>
              {t('runbooks.scope.this_profile', { profile: activeProfile })}
            </span>
          </label>
        </fieldset>
      )}

      {err && (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/5 px-2 py-1 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          <Icon icon={X} size="sm" />
          {t('runbooks.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={saving || !name.trim() || !template.trim()}
          data-testid="runbook-save"
        >
          {saving ? <Icon icon={Loader2} size="sm" className="animate-spin" /> : <Icon icon={Check} size="sm" />}
          {t('runbooks.save')}
        </Button>
      </div>
    </form>
  );
}
