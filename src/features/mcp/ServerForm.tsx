import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { ipcErrorMessage, type McpServer } from '@/lib/ipc';

import { TEMPLATES } from './templates';
import { defaultConfig, detectTransport, type Transport } from './transport';

/**
 * Edit form for a single MCP server. Beginners pick a template +
 * transport, advanced users edit the JSON directly. Validation is
 * synchronous and inline:
 * - id must be non-empty and not contain `.` (`mcp_servers.foo.bar`
 *   would mean nested keys to YAML, which is a different shape).
 * - config must `JSON.parse` to a non-array object.
 *
 * Nothing here writes to disk — `onSave` does the upsert; the form
 * just gathers + validates.
 */
export function ServerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: McpServer | null;
  onSave: (server: McpServer) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isNew = initial === null;
  const [id, setId] = useState(initial?.id ?? '');
  const [transport, setTransport] = useState<Transport>(
    initial ? detectTransport(initial.config) : 'stdio',
  );
  // Serialise the config as prettified JSON for a free-form edit
  // surface. Advanced users get precise control; beginners pick the
  // transport and only fill in the two or three obvious fields.
  const [raw, setRaw] = useState<string>(
    initial
      ? JSON.stringify(initial.config, null, 2)
      : JSON.stringify(defaultConfig(transport), null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the user toggles transport on a NEW entry, swap the starter
  // JSON. On an EDIT we keep whatever the user was editing — toggling
  // transport shouldn't silently destroy field values they'd typed.
  const onTransportChange = (next: Transport) => {
    setTransport(next);
    if (isNew) setRaw(JSON.stringify(defaultConfig(next), null, 2));
  };

  // "Start from a common server" quick-fill. Only shown on NEW so
  // users don't accidentally wipe an edit-in-progress. Picking a
  // template sets both the transport AND the body; the id field is
  // left for the user to customise.
  const [pickedTemplateKey, setPickedTemplateKey] = useState<string>('');
  const pickedTemplate = useMemo(
    () => TEMPLATES.find((tpl) => tpl.key === pickedTemplateKey) ?? null,
    [pickedTemplateKey],
  );
  const onTemplatePick = (key: string) => {
    setPickedTemplateKey(key);
    const tpl = TEMPLATES.find((entry) => entry.key === key);
    if (!tpl) return;
    setTransport(tpl.transport);
    setRaw(JSON.stringify(tpl.config, null, 2));
    if (!id.trim()) setId(tpl.suggestedId);
  };

  const parseError = useMemo(() => {
    try {
      const v = JSON.parse(raw);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return t('mcp.form_error_must_be_object');
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [raw, t]);

  const idError = useMemo(() => {
    const trimmed = id.trim();
    if (!trimmed) return t('mcp.form_error_id_required');
    if (trimmed.includes('.')) return t('mcp.form_error_id_dots');
    return null;
  }, [id, t]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (parseError || idError || saving) return;
    setSaving(true);
    setError(null);
    try {
      const config = JSON.parse(raw) as Record<string, unknown>;
      await onSave({ id: id.trim(), config });
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4"
      data-testid="mcp-server-form"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">
          {isNew ? t('mcp.form_title_new') : t('mcp.form_title_edit', { id: initial!.id })}
        </h3>
        <Button
          size="xs"
          variant="ghost"
          type="button"
          onClick={onCancel}
          aria-label={t('common.cancel')}
        >
          <Icon icon={X} size="xs" />
        </Button>
      </div>

      {/* Template quick-fill — only offered for NEW servers so an
          accidental click on an edit form can't wipe the user's
          in-progress JSON. "—" is the no-op placeholder. When a
          template with a description/setupUrl is picked, surface
          those inline so users know what they just selected. */}
      {isNew && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">{t('mcp.form_template')}</span>
          <Select<string>
            value={pickedTemplateKey}
            onChange={(v) => v && onTemplatePick(v)}
            options={[
              { value: '', label: t('mcp.form_template_placeholder') },
              ...TEMPLATES.map((tpl) => ({ value: tpl.key, label: tpl.label })),
            ]}
            ariaLabel={t('mcp.form_template')}
            data-testid="mcp-form-template"
          />
          {pickedTemplate?.description ? (
            <span
              className="text-[11px] text-fg-subtle"
              data-testid="mcp-form-template-description"
            >
              {pickedTemplate.description}
              {pickedTemplate.setupUrl && (
                <>
                  {' '}
                  <a
                    href={pickedTemplate.setupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                    data-testid="mcp-form-template-docs"
                  >
                    ↗ docs
                  </a>
                </>
              )}
            </span>
          ) : (
            <span className="text-[11px] text-fg-subtle">
              {t('mcp.form_template_hint')}
            </span>
          )}
          {pickedTemplate?.nousBundledHint && (
            <span
              className="mt-1 inline-flex items-start gap-1 rounded border border-accent/30 bg-accent/5 px-2 py-1 text-[11px] text-accent"
              data-testid="mcp-form-nous-hint"
            >
              <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
              <span>{t('mcp.form_nous_bundled_hint')}</span>
            </span>
          )}
        </label>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="flex flex-col gap-1 text-xs">
          <span className="inline-flex items-center gap-1 text-fg-muted">
            {t('mcp.form_id')}
            <InfoHint
              title={t('mcp.form_id')}
              content={t('mcp.help_id')}
              testId="mcp-help-id"
            />
          </span>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="project_fs"
            readOnly={!isNew}
            className={cn(
              'rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none',
              !isNew && 'cursor-not-allowed opacity-60',
            )}
            spellCheck={false}
            data-testid="mcp-form-id"
          />
          {isNew ? (
            idError && <span className="text-[11px] text-danger">{idError}</span>
          ) : (
            <span className="text-[11px] text-fg-subtle">{t('mcp.form_id_locked')}</span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="inline-flex items-center gap-1 text-fg-muted">
            {t('mcp.form_transport')}
            <InfoHint
              title={t('mcp.form_transport')}
              content={t('mcp.help_transport')}
              testId="mcp-help-transport"
            />
          </span>
          <Select<Transport>
            value={transport}
            onChange={onTransportChange}
            options={[
              { value: 'stdio', label: t('mcp.transport_stdio') },
              { value: 'url', label: t('mcp.transport_url') },
            ]}
            ariaLabel={t('mcp.form_transport')}
            data-testid="mcp-form-transport"
          />
          <span className="text-[11px] text-fg-subtle">
            {transport === 'stdio'
              ? t('mcp.transport_stdio_hint')
              : t('mcp.transport_url_hint')}
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">{t('mcp.form_config')}</span>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={12}
          spellCheck={false}
          className="resize-y rounded-md border border-border bg-bg p-2 font-mono text-[11px] text-fg focus:border-accent focus:outline-none"
          data-testid="mcp-form-config"
        />
        {parseError && (
          <span className="text-[11px] text-danger">{parseError}</span>
        )}
      </label>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={!!parseError || !!idError || saving}
          data-testid="mcp-form-save"
        >
          {saving ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="sm" />
          )}
          {t('mcp.save')}
        </Button>
      </div>
    </form>
  );
}
