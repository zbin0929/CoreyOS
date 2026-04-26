import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Eye, EyeOff, Loader2, Save, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesEnvSetKey,
  ipcErrorMessage,
  llmProfileDelete,
  llmProfileUpsert,
  modelProviderProbe,
  type LlmProfile,
} from '@/lib/ipc';
import { PROVIDER_TEMPLATES } from '@/features/settings/providerTemplates';

/**
 * The big create / edit form for a single LLM profile. Lives inside
 * the `LlmProfilesSection`'s right-side Drawer — the section never
 * mounts more than one of these at a time, but the form is tall
 * enough (~380 lines) that it earns its own file for readability.
 *
 * Notable behaviours:
 * - **Provider template auto-fill**: picking a provider replaces
 *   `base_url` / `api_key_env` / `model` rather than merging, so
 *   stale values from the previous provider can't silently break
 *   credential resolution.
 * - **Slug derivation**: in `new` mode the id auto-tracks `slugify(label)`
 *   on every keystroke, until the user manually edits the id field.
 * - **Two-click destructive paths** (clear secret, delete): the WebView
 *   drops `window.confirm` on some platforms, so each destructive
 *   button arms on first click and commits on second; auto-disarms
 *   after 3 s.
 * - **Save side-effects**: if the user typed an API key value, it gets
 *   written to `~/.hermes/.env` BEFORE the profile is upserted so the
 *   subsequent `modelProviderProbe` can resolve it.
 */
export function LlmProfileRow({
  initial,
  mode,
  existingIds,
  onSaved,
  onCancel,
  onDeleted,
}: {
  initial: LlmProfile;
  mode: 'new' | 'edit';
  /** Other profiles' ids — used to block accidental collisions on create. */
  existingIds: string[];
  onSaved: (next: LlmProfile) => void | Promise<void>;
  onCancel: () => void;
  onDeleted?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LlmProfile>(initial);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Id validation mirrors the Rust side so the Save button disables
  // for the exact same reasons the backend would reject.
  const idTrim = draft.id.trim();
  const idError: string | null =
    idTrim.length === 0
      ? t('models_page.profile_err_id_empty')
      : idTrim.length > 32
        ? t('models_page.profile_err_id_long')
        : /^[a-z0-9_-]+$/.test(idTrim)
          ? null
          : t('models_page.profile_err_id_chars');
  const duplicateId = mode === 'new' && existingIds.includes(idTrim);
  const canSave =
    idError === null &&
    !duplicateId &&
    draft.base_url.trim().length > 0 &&
    draft.model.trim().length > 0 &&
    !saving;

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      // Persist the API key value into ~/.hermes/.env if one was
      // typed. The profile only stores the env var NAME so the raw
      // secret doesn't land in llm_profiles.json (where it'd get
      // accidentally committed to dotfiles repos).
      const envName = draft.api_key_env?.trim() ?? '';
      if (apiKeyValue.trim() && envName) {
        await hermesEnvSetKey(envName, apiKeyValue.trim());
      }
      const saved = await llmProfileUpsert({
        ...draft,
        id: idTrim,
        api_key_env: envName || null,
      });
      await onSaved(saved);
      try {
        await modelProviderProbe({
          baseUrl: saved.base_url,
          apiKey: null,
          envKey: saved.api_key_env,
        });
      } catch {
        // Non-blocking: the profile was saved successfully; the probe
        // failure is shown on the card's test indicator.
      }
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Explicit "clear secret" — two-click for safety. Writes empty to
  // hermesEnvSetKey which removes the line from ~/.hermes/.env. This
  // is the only way to remove a stored key without deleting the
  // whole profile or hand-editing the .env file.
  const [clearArmed, setClearArmed] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!clearArmed) return;
    const h = window.setTimeout(() => setClearArmed(false), 3000);
    return () => window.clearTimeout(h);
  }, [clearArmed]);

  async function onClearSecret() {
    const envName = draft.api_key_env?.trim() ?? '';
    if (!envName) return;
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearing(true);
    setErr(null);
    try {
      await hermesEnvSetKey(envName, null);
      setApiKeyValue('');
      setClearArmed(false);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setClearing(false);
    }
  }

  // Two-click delete — same reasoning as HermesInstanceRow:
  // window.confirm can silently no-op inside the Tauri WebView.
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
    setSaving(true);
    setErr(null);
    try {
      await llmProfileDelete(draft.id);
      await onDeleted();
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`llm-profile-form-${mode === 'new' ? 'new' : draft.id}`}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('models_page.profile_field_label')}>
          {/* Label is typed first; when creating a new profile we
              auto-derive the id from the label on every keystroke
              (slug-safe), so the typical user never has to think
              about the id field. They can still override manually
              if they want a specific slug. */}
          <input
            type="text"
            className={inputCls}
            value={draft.label}
            onChange={(e) => {
              const next = e.target.value;
              setDraft((prev) => ({
                ...prev,
                label: next,
                // Only auto-slug on create, and only if the user
                // hasn't manually edited the id yet.
                id:
                  mode === 'new' && (prev.id === '' || prev.id === slugify(prev.label))
                    ? slugify(next)
                    : prev.id,
              }));
            }}
            placeholder="OpenAI GPT-4o"
            data-testid="llm-profile-label"
          />
        </Field>
        <Field
          label={t('models_page.profile_field_id')}
          hint={
            idError ??
            (duplicateId
              ? t('models_page.profile_err_id_duplicate', { id: idTrim })
              : mode === 'new'
                ? t('models_page.profile_field_id_hint')
                : undefined)
          }
          hintClass={idError || duplicateId ? 'text-danger' : undefined}
        >
          <input
            type="text"
            className={cn(inputCls, 'font-mono')}
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            placeholder="openai-gpt4o"
            disabled={mode === 'edit'}
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('models_page.profile_field_provider')}>
          {/* Combobox (freeSolo) so users can either pick a bundled
              template or type a custom slug (e.g. a local LiteLLM
              proxy not in our templates). When they pick a template
              we REPLACE base_url + api_key_env + model — switching
              providers while keeping stale URLs was silently
              breaking credentials inference. */}
          <Combobox
            value={draft.provider}
            onChange={(next) => {
              const tpl = PROVIDER_TEMPLATES.find((p) => p.id === next);
              setDraft((prev) => ({
                ...prev,
                provider: next,
                base_url: tpl ? tpl.baseUrl : prev.base_url,
                api_key_env: tpl ? tpl.envKey : prev.api_key_env,
                model:
                  tpl && tpl.suggestedModels.length > 0
                    ? tpl.suggestedModels[0]!
                    : prev.model,
              }));
            }}
            options={PROVIDER_TEMPLATES.map((p) => ({
              value: p.id,
              label: p.label,
              hint: p.envKey ?? undefined,
            }))}
            placeholder={t('models_page.profile_field_provider_placeholder')}
            data-testid="llm-profile-provider"
            ariaLabel={t('models_page.profile_field_provider')}
          />
        </Field>
        <Field
          label={t('models_page.profile_field_model')}
          hint={t('models_page.profile_field_model_hint')}
        >
          {/* Themed Combobox — freeSolo so users can type a
              fine-tune / brand-new model id the template doesn't
              know about. suggestedModels[] comes from the matched
              Provider template (empty list = free-text-only). */}
          {(() => {
            const tpl = PROVIDER_TEMPLATES.find((p) => p.id === draft.provider);
            const suggestions = tpl?.suggestedModels ?? [];
            return (
              <Combobox
                value={draft.model}
                onChange={(v) => setDraft({ ...draft, model: v })}
                options={suggestions.map((m) => ({ value: m, label: m }))}
                placeholder={suggestions[0] ?? 'gpt-4o'}
                inputClassName="font-mono"
                data-testid="llm-profile-model"
                ariaLabel={t('models_page.profile_field_model')}
              />
            );
          })()}
        </Field>
      </div>

      <Field label={t('models_page.profile_field_base_url')}>
        <input
          type="url"
          className={cn(inputCls, 'font-mono')}
          value={draft.base_url}
          onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
          placeholder="https://api.openai.com/v1"
          spellCheck={false}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t('models_page.profile_field_api_key_env')}
          hint={t('models_page.profile_field_api_key_env_hint')}
        >
          <input
            type="text"
            className={cn(inputCls, 'font-mono')}
            value={draft.api_key_env ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, api_key_env: e.target.value || null })
            }
            placeholder="OPENAI_API_KEY"
            spellCheck={false}
          />
        </Field>
        <Field
          label={t('models_page.profile_field_api_key')}
          hint={t('models_page.profile_field_api_key_hint')}
        >
          <div className="flex items-center gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              className={cn(inputCls, 'flex-1 font-mono')}
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowKey((v) => !v)}
              aria-label={
                showKey ? t('settings.gateway.hide_key') : t('settings.gateway.show_key')
              }
            >
              <Icon icon={showKey ? EyeOff : Eye} size="sm" />
            </Button>
            {/* Clear-secret — explicit "remove stored env var" path.
                Shown only when editing and the profile actually has
                an env-var name pointed at (otherwise there's nothing
                to clear). Two-click: first click arms (button turns
                red), second click calls hermesEnvSetKey(name, null)
                which drops the line from ~/.hermes/.env. */}
            {mode === 'edit' && (draft.api_key_env?.trim() ?? '').length > 0 && (
              <Button
                type="button"
                size="sm"
                variant={clearArmed ? 'danger' : 'ghost'}
                onClick={() => void onClearSecret()}
                disabled={clearing || saving}
                title={t('models_page.profile_clear_secret_title', {
                  env: draft.api_key_env,
                })}
                aria-label={t('models_page.profile_clear_secret_title', {
                  env: draft.api_key_env,
                })}
                data-testid="llm-profile-clear-secret"
              >
                <Icon
                  icon={clearing ? Loader2 : Trash2}
                  size="sm"
                  className={clearing ? 'animate-spin' : undefined}
                />
                {clearArmed
                  ? t('models_page.profile_clear_secret_confirm')
                  : t('models_page.profile_clear_secret')}
              </Button>
            )}
          </div>
        </Field>
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="break-words">{err}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {mode === 'edit' && onDeleted && (
          <Button
            type="button"
            size="sm"
            variant={deleteArmed ? 'danger' : 'ghost'}
            onClick={onDelete}
            disabled={saving}
          >
            <Icon
              icon={Trash2}
              size="sm"
              className={deleteArmed ? undefined : 'text-danger'}
            />
            {deleteArmed
              ? t('common.confirm_delete', { name: draft.label || draft.id })
              : t('common.delete')}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          <Icon icon={X} size="sm" />
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => void onSave()}
          disabled={!canSave}
          data-testid={`llm-profile-save-${mode === 'new' ? 'new' : draft.id}`}
        >
          {saving ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="sm" />
          )}
          {mode === 'new' ? t('common.create') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

const inputCls = cn(
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
);

/**
 * Best-effort slug: lowercase, replace non-alphanum with `-`, collapse
 * runs of `-`, trim leading/trailing `-`, and cap to 32 chars so the
 * suggested id always satisfies `validate_id` on the Rust side.
 * Empty input → empty output (don't fabricate ids).
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function Field({
  label,
  hint,
  hintClass,
  children,
}: {
  label: string;
  hint?: string;
  hintClass?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-fg-muted">{label}</span>
      {children}
      {hint && <span className={cn('text-[10px] text-fg-subtle', hintClass)}>{hint}</span>}
    </label>
  );
}
