import { useCallback, useEffect, useState } from 'react';

import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Edit3,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Combobox } from '@/components/ui/combobox';
import { cn } from '@/lib/cn';
import {
  hermesEnvSetKey,
  ipcErrorMessage,
  llmProfileDelete,
  llmProfileList,
  llmProfileUpsert,
  type LlmProfile,
} from '@/lib/ipc';
import { PROVIDER_TEMPLATES } from '@/features/settings/providerTemplates';

/**
 * List-and-edit UI for reusable LLM profiles.
 *
 * One profile = one `{provider, base_url, model, api_key_env}` tuple
 * persisted to `<config_dir>/llm_profiles.json`. Multiple agents can
 * reference the same profile by id — edit the profile once, every
 * agent using it picks up the change on next registration.
 *
 * Layout: list of rows on top, inline "New LLM" form on the bottom
 * (hidden until the user clicks the primary button). Editing an
 * existing row opens an in-place form replacing the display row —
 * the same pattern as HermesInstancesSection for consistency.
 */
export function LlmProfilesSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LlmProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { profiles } = await llmProfileList();
      setRows(profiles);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Focused edit mode: when the user clicks a card or "+ New LLM",
  // we take over the whole section with the edit form — the grid
  // collapses away so the form has full width and isn't competing
  // with other cards for visual attention. Closing (cancel/save/
  // delete) returns to the grid.
  const editingProfile = editingId
    ? (rows ?? []).find((r) => r.id === editingId) ?? null
    : null;

  if (adding) {
    return (
      <section className="flex flex-col gap-3" data-testid="llm-profiles-section">
        <SectionHeader
          title={t('models_page.profiles_add')}
          desc={t('models_page.profiles_desc')}
        />
        <LlmProfileRow
          mode="new"
          existingIds={(rows ?? []).map((r) => r.id)}
          initial={{
            id: '',
            label: '',
            provider: '',
            base_url: '',
            model: '',
            api_key_env: null,
          }}
          onSaved={async (next) => {
            setRows((prev) => [...(prev ?? []), next]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      </section>
    );
  }

  if (editingProfile) {
    return (
      <section className="flex flex-col gap-3" data-testid="llm-profiles-section">
        <SectionHeader
          title={editingProfile.label || editingProfile.id}
          desc={t('models_page.profiles_desc')}
        />
        <LlmProfileRow
          initial={editingProfile}
          mode="edit"
          existingIds={(rows ?? [])
            .map((r) => r.id)
            .filter((id) => id !== editingProfile.id)}
          onSaved={async (next) => {
            setRows(
              (prev) => prev?.map((r) => (r.id === next.id ? next : r)) ?? [next],
            );
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
          onDeleted={async () => {
            setRows((prev) => prev?.filter((r) => r.id !== editingProfile.id) ?? []);
            setEditingId(null);
          }}
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="llm-profiles-section">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            {t('models_page.profiles_title')}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {t('models_page.profiles_desc')}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => setAdding(true)}
          data-testid="llm-profiles-add"
        >
          <Icon icon={Plus} size="sm" />
          {t('models_page.profiles_add')}
        </Button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-8 text-center text-xs text-fg-subtle"
          data-testid="llm-profiles-empty"
        >
          {t('models_page.profiles_empty')}
        </div>
      ) : (
        // Responsive card grid: 1 col on mobile, 2 on tablet, 3 on
        // desktop. Whole card is clickable — tapping jumps straight
        // to the focused edit view.
        <ul
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="llm-profiles-list"
        >
          {rows.map((p) => (
            <LlmProfileCard
              key={p.id}
              profile={p}
              onOpen={() => setEditingId(p.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <header className="flex flex-col">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className="mt-0.5 text-xs text-fg-muted">{desc}</p>
    </header>
  );
}

// ───────────────────────── Card (grid item) ─────────────────────────

/**
 * Compact card for the profile grid. The entire card is a button —
 * clicking anywhere jumps to the focused edit view. Layout is vertical
 * so it survives a 1-column (mobile) / 2-column / 3-column grid without
 * re-wrapping. The two-letter provider chip in the corner gives users a
 * visual anchor even when labels are long or the grid is dense.
 */
function LlmProfileCard({
  profile,
  onOpen,
}: {
  profile: LlmProfile;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex w-full flex-col items-start gap-2 rounded-md border border-border bg-bg-elev-1 p-3 text-left',
          'transition-colors hover:border-gold-500/40 hover:bg-bg-elev-2',
          'focus:outline-none focus-visible:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/30',
        )}
        data-testid={`llm-profile-row-${profile.id}`}
      >
        <div className="flex w-full items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border bg-bg-elev-2 text-xs font-semibold uppercase text-fg-muted">
            {profile.provider.slice(0, 2) || '?'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-fg">
              {profile.label || profile.id}
            </div>
            <code className="truncate text-[10px] text-fg-subtle">
              {profile.id}
            </code>
          </div>
          <Icon
            icon={Edit3}
            size="sm"
            className="flex-none text-fg-subtle transition-colors group-hover:text-fg"
          />
        </div>
        <div className="flex w-full flex-col gap-0.5 text-[11px] text-fg-muted">
          <span className="truncate font-mono">{profile.model}</span>
          <code className="truncate font-mono text-fg-subtle">
            {profile.base_url}
          </code>
          {profile.api_key_env && (
            <span className="inline-flex items-center gap-1 text-fg-subtle">
              <Icon icon={Key} size="xs" />
              <code>{profile.api_key_env}</code>
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

// ───────────────────────── Edit / create row ─────────────────────────

function LlmProfileRow({
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
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
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
    <li
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-3"
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
    </li>
  );
}

// ───────────────────────── Shared ─────────────────────────

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
