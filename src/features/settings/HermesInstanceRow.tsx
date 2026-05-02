import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, Server, Trash2, Wand2, Wifi } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores/chat';
import {
  hermesInstanceDelete,
  hermesInstanceTest,
  hermesInstanceUpsert,
  ipcErrorMessage,
  type HermesInstance,
  type HermesInstanceProbeResult,
  type SandboxScope,
} from '@/lib/ipc';

import { PROVIDER_TEMPLATES } from './providerTemplates';
import { Field } from './shared';

export function HermesInstanceRow({
  initial,
  isNew = false,
  scopes,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  initial: HermesInstance;
  isNew?: boolean;
  scopes: SandboxScope[];
  onSaved: (next: HermesInstance) => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onCancelNew?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<HermesInstance>(initial);
  const [showKey, setShowKey] = useState(false);
  const [probe, setProbe] = useState<HermesInstanceProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onTest() {
    setProbing(true);
    setErr(null);
    try {
      const r = await hermesInstanceTest(draft);
      setProbe(r);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setProbing(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await hermesInstanceUpsert(draft);
      setDraft(saved);
      await onSaved(saved);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const h = window.setTimeout(() => setDeleteArmed(false), 3000);
    return () => window.clearTimeout(h);
  }, [deleteArmed]);

  async function onDelete() {
    if (!onDeleted) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const store = useChatStore.getState();
    const affected = Object.values(store.sessions).filter(
      (s) => s && s.adapterId === draft.id,
    );
    if (affected.length > 0) {
      const ok = window.confirm(
        t('settings.hermes_instances.delete_confirm_sessions', {
          count: affected.length,
          name: draft.label || draft.id,
        }),
      );
      if (!ok) {
        setDeleteArmed(false);
        return;
      }
    }
    setSaving(true);
    setErr(null);
    try {
      await hermesInstanceDelete(draft.id);
      await onDeleted();
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elev-1 p-3"
      data-testid={`hermes-instance-row-${initial.id || 'new'}`}
    >
      <div className="flex items-center gap-2">
        <Icon icon={Server} size="sm" className="text-fg-subtle" />
        <span className="text-sm font-medium text-fg">
          {draft.label.trim() || draft.id || t('settings.hermes_instances.new_row')}
        </span>
        {!isNew && (
          <code className="rounded bg-bg-elev-3 px-1 py-0.5 text-[10px] text-fg-muted">
            hermes:{initial.id}
          </code>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t('settings.hermes_instances.field_id')}
          hint={t('settings.hermes_instances.field_id_hint')}
        >
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none disabled:opacity-50"
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            placeholder="work"
            disabled={!isNew}
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.hermes_instances.field_label')}>
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder={t('settings.hermes_instances.field_label_placeholder')}
          />
        </Field>
      </div>

      <Field label={t('settings.hermes_instances.field_base_url')}>
        <input
          type="url"
          className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
          value={draft.base_url}
          onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
          placeholder="http://127.0.0.1:8642"
          spellCheck={false}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('settings.hermes_instances.field_api_key')}>
          <div className="flex items-center gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
              value={draft.api_key ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, api_key: e.target.value || null })
              }
              placeholder={t('settings.hermes_instances.field_api_key_placeholder')}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowKey((v) => !v)}
              aria-label={
                showKey
                  ? t('settings.gateway.hide_key')
                  : t('settings.gateway.show_key')
              }
            >
              <Icon icon={showKey ? EyeOff : Eye} size="sm" />
            </Button>
          </div>
        </Field>
        <Field
          label={t('settings.hermes_instances.field_default_model')}
          hint={t('settings.hermes_instances.field_default_model_hint')}
        >
          {(() => {
            const tpl = PROVIDER_TEMPLATES.find((p) =>
              draft.base_url
                ? draft.base_url.startsWith(p.baseUrl.replace(/\/v1\/?$/, ''))
                : false,
            );
            const suggestions = tpl?.suggestedModels ?? [];
            return (
              <Combobox
                value={draft.default_model ?? ''}
                onChange={(v) =>
                  setDraft({ ...draft, default_model: v || null })
                }
                options={suggestions.map((m) => ({ value: m, label: m }))}
                placeholder={
                  suggestions[0] ??
                  t('settings.hermes_instances.field_default_model_placeholder')
                }
                inputClassName="font-mono"
                data-testid={`hermes-instance-model-${initial.id || 'new'}`}
                ariaLabel={t('settings.hermes_instances.field_default_model')}
              />
            );
          })()}
        </Field>
      </div>

      <Field
        label={t('settings.hermes_instances.field_sandbox_scope')}
        hint={t('settings.hermes_instances.field_sandbox_scope_hint')}
      >
        <select
          data-testid="hermes-instance-scope-new"
          className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          value={draft.sandbox_scope_id ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, sandbox_scope_id: e.target.value || null })
          }
        >
          <option value="">{t('settings.hermes_instances.scope_default')}</option>
          {scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.id})
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onTest()}
          disabled={probing}
        >
          <Icon icon={probing ? Loader2 : Wifi} size="sm" className={probing ? 'animate-spin' : undefined} />
          {t('settings.hermes_instances.test')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void onSave()}
          disabled={saving}
        >
          <Icon icon={Wand2} size="sm" />
          {t('settings.hermes_instances.save')}
        </Button>
        {isNew ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancelNew}
          >
            {t('common.cancel')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onDelete()}
            disabled={saving}
            className={deleteArmed ? 'text-danger hover:bg-danger/10' : ''}
          >
            <Icon icon={Trash2} size="sm" />
            {deleteArmed ? t('settings.hermes_instances.confirm_delete') : t('common.delete')}
          </Button>
        )}
      </div>

      {probe && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-xs',
            probe.ok
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600'
              : 'border-danger/30 bg-danger/5 text-danger',
          )}
        >
          {probe.ok ? t('settings.hermes_instances.probe_ok') : t('settings.hermes_instances.probe_err')}
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}
    </li>
  );
}
