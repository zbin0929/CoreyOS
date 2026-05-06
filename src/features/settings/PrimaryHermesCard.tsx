import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Save, Server } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  configGet,
  configSet,
  ipcErrorMessage,
  type GatewayConfigDto,
} from '@/lib/ipc';

import { Field } from './shared';

/**
 * Editable settings panel for the **default** Hermes adapter
 * (id `"hermes"`).
 *
 * The default adapter is built from `~/.../gateway.json` at app start
 * and never appears in `hermes_instance_list` (that IPC only returns
 * "additional" instances). Without this card, users had no way to
 * rename the AgentSwitcher pill from the literal "Hermes" — the only
 * recourse was hand-editing JSON.
 *
 * Lives at the top of the Hermes Instances section so it's the first
 * row users see, mirroring the AgentSwitcher's "Hermes is your
 * default" framing. Saves through `configSet` which hot-swaps the
 * adapter without an app restart (registry re-registers under the
 * stable `"hermes"` id with the new label).
 */
export function PrimaryHermesCard() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<GatewayConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await configGet();
        if (!cancelled) setDraft(cfg);
      } catch (e) {
        if (!cancelled) setError(ipcErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await configSet({
        base_url: draft.base_url.trim(),
        api_key: draft.api_key?.trim() || null,
        default_model: draft.default_model?.trim() || null,
        label: draft.label?.trim() || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !draft) {
    return (
      <div className="rounded-lg border border-border bg-bg-elev-1 p-3 text-xs text-fg-muted">
        <Icon icon={Loader2} size="sm" className="animate-spin" />
        {' '}
        {t('common.loading')}
      </div>
    );
  }

  const labelDisplay = (draft.label || '').trim() || 'Hermes';

  return (
    <div className="rounded-lg border border-gold-500/30 bg-gold-500/5 p-4">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-gold-500/40 bg-bg-elev-2 text-gold-500">
          <Icon icon={Server} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg">{labelDisplay}</span>
            <span className="rounded-full border border-gold-500/40 bg-bg-elev-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold-500">
              {t('settings.hermes_instances.primary_badge', { defaultValue: '主实例' })}
            </span>
          </div>
          <code className="text-[10px] text-fg-subtle">hermes</code>
        </div>
      </header>

      <p className="mb-3 text-[11px] text-fg-muted">
        {t('settings.hermes_instances.primary_desc', {
          defaultValue: '默认 Hermes 实例。修改这些字段会立即生效，不用重启。',
        })}
      </p>

      <div className="flex flex-col gap-3">
        <Field
          label={t('settings.hermes_instances.field_label', { defaultValue: '显示名' })}
          hint={t('settings.hermes_instances.primary_label_hint', {
            defaultValue: '留空恢复成 "Hermes"。',
          })}
        >
          <input
            type="text"
            value={draft.label ?? ''}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Hermes"
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 text-xs text-fg outline-none focus:border-gold-500"
            data-testid="primary-hermes-label"
          />
        </Field>
        <Field label={t('settings.hermes_instances.field_base_url', { defaultValue: 'Base URL' })}>
          <input
            type="text"
            value={draft.base_url}
            onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
            placeholder="http://127.0.0.1:8642"
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
        <Field label={t('settings.hermes_instances.field_api_key', { defaultValue: 'API Key' })}>
          <input
            type="password"
            value={draft.api_key ?? ''}
            onChange={(e) => setDraft({ ...draft, api_key: e.target.value })}
            placeholder={t('settings.hermes_instances.field_api_key_placeholder', {
              defaultValue: '（未鉴权网关可留空）',
            })}
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
        <Field
          label={t('settings.hermes_instances.field_default_model', { defaultValue: '默认模型' })}
          hint={t('settings.hermes_instances.field_default_model_placeholder', {
            defaultValue: '（可选，留空则使用网关自带默认模型）',
          })}
        >
          <input
            type="text"
            value={draft.default_model ?? ''}
            onChange={(e) => setDraft({ ...draft, default_model: e.target.value })}
            placeholder="deepseek-chat"
            className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-gold-500"
          />
        </Field>
      </div>

      {error && (
        <div className="mt-2 rounded border border-danger/40 bg-danger/5 px-2 py-1 text-[11px] text-danger">
          {error}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => void onSave()}
          disabled={saving}
          data-testid="primary-hermes-save"
        >
          <Icon icon={saving ? Loader2 : Save} size={12} className={saving ? 'animate-spin' : ''} />
          {saved
            ? t('common.saved', { defaultValue: '已保存' })
            : t('common.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </div>
  );
}
