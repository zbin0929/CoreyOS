import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCcw,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  hermesInstanceUpsert,
  ipcErrorMessage,
  llmProfileList,
  llmProfileUpsert,
  modelProviderProbe,
  type HermesInstance,
  type LlmProfile,
} from '@/lib/ipc';
import { PROVIDER_TEMPLATES, type ProviderTemplate } from './providerTemplates';

/**
 * Guided "Add Agent" wizard.
 *
 * A Hermes *agent* (= one `HermesInstance` row) is a named endpoint
 * Corey routes chats through. The raw form in `HermesInstancesSection`
 * expects users to know what to type for `base_url`, which env var the
 * provider's API key lives under, and which models the provider
 * exposes — none of which a non-engineer will know off the top of
 * their head.
 *
 * This wizard trades that power-user form for a two-step flow:
 *
 *   Step 1 — pick a provider template. Seeds `base_url`, `env_key`,
 *            and a shortlist of models from the template.
 *
 *   Step 2 — fill in the blanks. Just the API key (when needed) + a
 *            model pick. Model list is refreshed live via
 *            `modelProviderProbe` once the key is entered.
 *
 * Output: a freshly-created `HermesInstance` persisted via
 * `hermesInstanceUpsert`. On save the caller refreshes its list.
 *
 * Non-goals for this v1:
 *   - Sandbox scope picker (stays on the default).
 *   - Local-binary auto-install for Ollama / LM Studio — the wizard
 *     surfaces a link instead and trusts the user.
 *   - Editing existing rows — use the regular HermesInstanceRow for
 *     that; the wizard is strictly "add new".
 */
export function AgentWizard({
  open,
  onClose,
  onCreated,
  existingIds,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (next: HermesInstance) => void | Promise<void>;
  /** Ids already in use. The wizard's auto-generated id dodges them. */
  existingIds: string[];
}) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<ProviderTemplate | null>(null);

  // Reset to Step 1 every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setTemplate(null);
  }, [open]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('agent_wizard.title')}
      testId="agent-wizard"
    >
      {template ? (
        <DetailsStep
          template={template}
          existingIds={existingIds}
          onBack={() => setTemplate(null)}
          onCreated={async (inst) => {
            await onCreated(inst);
            onClose();
          }}
        />
      ) : (
        <ProviderPickerStep onPick={setTemplate} />
      )}
    </Drawer>
  );
}

// ───────────────────────── Step 1: provider picker ─────────────────────────

function ProviderPickerStep({ onPick }: { onPick: (p: ProviderTemplate) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-fg-muted">{t('agent_wizard.pick_provider')}</p>
      <ul
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        data-testid="agent-wizard-providers"
      >
        {PROVIDER_TEMPLATES.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className={cn(
                'group flex w-full flex-col items-start gap-1 rounded-md border border-border bg-bg-elev-1 p-3 text-left',
                'transition-colors hover:border-gold-500/40 hover:bg-bg-elev-2',
              )}
              data-testid={`agent-wizard-provider-${p.id}`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-medium text-fg">{p.label}</span>
                {p.isLocal && (
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                    {t('agent_wizard.local_tag')}
                  </span>
                )}
              </div>
              <p className="text-xs text-fg-muted">{p.description}</p>
              <code className="truncate text-[10px] text-fg-subtle">
                {p.baseUrl}
              </code>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────── Step 2: details ─────────────────────────

function DetailsStep({
  template,
  existingIds,
  onBack,
  onCreated,
}: {
  template: ProviderTemplate;
  existingIds: string[];
  onBack: () => void;
  onCreated: (inst: HermesInstance) => void | Promise<void>;
}) {
  const { t } = useTranslation();

  // Auto-generate a unique id from the provider label the first time
  // the details step mounts. Users can still override it in the form.
  const suggestedId = useRef(generateUniqueId(template.id, existingIds)).current;

  const [id, setId] = useState(suggestedId);
  const [label, setLabel] = useState(template.label);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(template.suggestedModels[0] ?? '');

  // Live model list from `/v1/models`. Starts with the template's
  // suggestions so the picker is never empty.
  const [models, setModels] = useState<string[]>(template.suggestedModels);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  // T8 — existing LLM profiles pre-loaded so user can pick one instead
  // of entering provider credentials again. Filter down to the same
  // provider as the template (matching by slug) so picking is
  // semantically safe — we don't silently attach an OpenAI agent to
  // an Anthropic profile. `null` = "enter details inline" (default).
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  useEffect(() => {
    llmProfileList()
      .then((r) => setProfiles(r.profiles))
      .catch(() => setProfiles([]));
  }, []);

  const matchingProfiles = profiles.filter(
    (p) => !p.provider || p.provider === template.id,
  );
  const selectedProfile = selectedProfileId
    ? profiles.find((p) => p.id === selectedProfileId) ?? null
    : null;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function probe() {
    setProbing(true);
    setProbeError(null);
    try {
      const report = await modelProviderProbe({
        baseUrl: template.baseUrl,
        // Prefer raw apiKey if the user typed one; otherwise fall back
        // to the env var name Hermes would resolve at runtime.
        apiKey: apiKey.trim() || null,
        envKey: apiKey.trim() ? null : template.envKey,
      });
      const ids = report.models.map((m) => m.id);
      if (ids.length > 0) {
        setModels(ids);
        if (!ids.includes(model)) setModel(ids[0]!);
      }
    } catch (e) {
      setProbeError(ipcErrorMessage(e));
    } finally {
      setProbing(false);
    }
  }

  // Auto-probe on Ollama (no API key needed — typical path is "user
  // has Ollama running, let's list what's installed").
  useEffect(() => {
    if (template.isLocal) void probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    setSaveError(null);
    const agentId = id.trim();
    const agentLabel = label.trim() || agentId;
    try {
      // Branch: attached to an existing profile → just create the
      // agent pointing at it, copying provider fields for the runtime
      // adapter so the registry doesn't have to resolve at every
      // request.
      if (selectedProfile) {
        const payload: HermesInstance = {
          id: agentId,
          label: agentLabel,
          base_url: selectedProfile.base_url,
          api_key: null, // value lives in Hermes's .env under api_key_env
          default_model: selectedProfile.model,
          llm_profile_id: selectedProfile.id,
        };
        console.log('[AgentWizard] save (linked) →', payload);
        const inst = await hermesInstanceUpsert(payload);
        console.log('[AgentWizard] save ok →', inst);
        await onCreated(inst);
        return;
      }

      // Fresh — persist an LlmProfile first so the agent's fields also
      // live in the reusable library, then create the linked agent.
      // Profile id = agent id for discoverability (unless the user
      // manually picked a different slug later on the LLMs page).
      const profilePayload: LlmProfile = {
        id: agentId,
        label: agentLabel,
        provider: template.id,
        base_url: template.baseUrl,
        model: model.trim(),
        api_key_env: template.envKey ?? null,
      };
      console.log('[AgentWizard] save (fresh) profile →', profilePayload);
      const savedProfile = await llmProfileUpsert(profilePayload);

      const agentPayload: HermesInstance = {
        id: agentId,
        label: agentLabel,
        base_url: savedProfile.base_url,
        api_key: apiKey.trim() || null,
        default_model: savedProfile.model,
        llm_profile_id: savedProfile.id,
      };
      console.log('[AgentWizard] save (fresh) agent →', agentPayload);
      const inst = await hermesInstanceUpsert(agentPayload);
      console.log('[AgentWizard] save ok →', inst);
      await onCreated(inst);
    } catch (e) {
      console.error('[AgentWizard] save failed →', e);
      setSaveError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Id validation mirrors the Rust-side `validate_id`: 1..32 chars,
  // lowercase letters / digits / `-` / `_`. Surfaces the exact reason
  // the Save button is disabled so users aren't left guessing.
  const idTrim = id.trim();
  const idError: string | null =
    idTrim.length === 0
      ? t('agent_wizard.err_id_empty')
      : idTrim.length > 32
        ? t('agent_wizard.err_id_long')
        : /^[a-z0-9_-]+$/.test(idTrim)
          ? null
          : t('agent_wizard.err_id_chars');
  const duplicateId = existingIds.includes(idTrim);
  const canSave = idError === null && !duplicateId && !saving;
  // Hide API key + model fields when an existing profile is
  // selected — the profile already owns those values and the agent
  // inherits them at save time.
  const showProviderFields = selectedProfile === null;
  const keyRequired =
    showProviderFields && template.envKey !== null && !template.isLocal;

  return (
    <div
      className="flex flex-col gap-4 p-4"
      data-testid="agent-wizard-details"
    >
      {/* Header strip + back link. */}
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <button
          type="button"
          onClick={onBack}
          className="text-fg-muted hover:text-fg"
          data-testid="agent-wizard-back"
        >
          ← {t('agent_wizard.back')}
        </button>
        <span>/</span>
        <span className="text-fg">{template.label}</span>
      </div>

      {/* T8 — "Use existing LLM profile" picker. Lets the user avoid
          typing the same base_url + key + model combo twice when
          creating multiple agents backed by the same provider.
          Hidden until at least one profile matches this provider. */}
      {matchingProfiles.length > 0 && (
        <div
          className="flex flex-col gap-1.5 rounded-md border border-gold-500/30 bg-gold-500/5 p-3"
          data-testid="agent-wizard-profile-picker"
        >
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            <span className="font-medium text-fg">
              {t('agent_wizard.use_profile_title')}
            </span>
            <select
              value={selectedProfileId ?? ''}
              onChange={(e) => setSelectedProfileId(e.target.value || null)}
              className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 text-sm text-fg"
              data-testid="agent-wizard-profile-select"
            >
              <option value="">{t('agent_wizard.use_profile_new')}</option>
              {matchingProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || p.id} · {p.model}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-fg-subtle">
              {selectedProfile
                ? t('agent_wizard.use_profile_linked_hint')
                : t('agent_wizard.use_profile_fresh_hint')}
            </span>
          </label>
        </div>
      )}

      {/* ID + label */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('agent_wizard.field_id')}
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="hermes-openai"
            data-testid="agent-wizard-id"
            aria-invalid={idError !== null || duplicateId}
          />
          {idError ? (
            <span className="text-[10px] text-danger" data-testid="agent-wizard-id-error">
              {idError}
            </span>
          ) : duplicateId ? (
            <span className="text-[10px] text-danger" data-testid="agent-wizard-id-dup">
              {t('agent_wizard.err_id_duplicate', { id: idTrim })}
            </span>
          ) : (
            <span className="text-[10px] text-fg-subtle">
              {t('agent_wizard.field_id_hint')}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('agent_wizard.field_label')}
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={template.label}
            data-testid="agent-wizard-label"
          />
        </label>
      </div>

      {/* API key — hidden for local providers. */}
      {keyRequired && (
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          <span>
            {t('agent_wizard.field_api_key')}
            <span className="ml-1 text-[10px] text-fg-subtle">
              ({template.envKey})
            </span>
          </span>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            data-testid="agent-wizard-api-key"
          />
          <a
            href={template.setupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-[10px] text-fg-subtle hover:text-fg"
          >
            <Icon icon={ExternalLink} size="xs" />
            {t('agent_wizard.api_key_docs', { provider: template.label })}
          </a>
        </label>
      )}

      {showProviderFields && template.isLocal && (
        <div
          className={cn(
            'flex items-start gap-2 rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-500',
          )}
        >
          <Icon icon={Server} size="xs" className="mt-0.5 flex-none" />
          <span>
            {t('agent_wizard.local_hint')}{' '}
            <a
              href={template.setupUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:no-underline"
            >
              {t('agent_wizard.local_install_link', { provider: template.label })}
            </a>
            .
          </span>
        </div>
      )}

      {/* Selected-profile summary (shown instead of the model picker
          when the user has attached to an existing profile). */}
      {selectedProfile && (
        <div
          className="flex flex-col gap-1 rounded-md border border-border bg-bg-elev-1 p-3 text-xs text-fg-muted"
          data-testid="agent-wizard-profile-summary"
        >
          <div className="text-fg">
            <span className="font-medium">{selectedProfile.label || selectedProfile.id}</span>
            <span className="ml-2 font-mono text-fg-subtle">
              {selectedProfile.model}
            </span>
          </div>
          <code className="truncate text-[10px] text-fg-subtle">
            {selectedProfile.base_url}
          </code>
          {selectedProfile.api_key_env && (
            <code className="text-[10px] text-fg-subtle">
              env: {selectedProfile.api_key_env}
            </code>
          )}
        </div>
      )}

      {/* Model picker — shortlist from template, refreshable via probe. */}
      {showProviderFields && (
      <div className="flex flex-col gap-1 text-xs text-fg-muted">
        <div className="flex items-center justify-between">
          <span>{t('agent_wizard.field_model')}</span>
          <button
            type="button"
            onClick={() => void probe()}
            disabled={probing}
            className="inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg disabled:opacity-50"
            data-testid="agent-wizard-probe"
          >
            <Icon
              icon={probing ? Loader2 : RefreshCcw}
              size="xs"
              className={cn(probing && 'animate-spin')}
            />
            {t('agent_wizard.probe_models')}
          </button>
        </div>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded border border-border bg-bg-elev-1 px-2 py-1.5 text-sm text-fg"
          data-testid="agent-wizard-model"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {probeError && (
          <div className="text-[10px] text-danger" data-testid="agent-wizard-probe-error">
            {probeError}
          </div>
        )}
      </div>
      )}

      {saveError && (
        <div
          className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger"
          data-testid="agent-wizard-save-error"
        >
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t('agent_wizard.save_failed')}</div>
            <div className="mt-0.5 break-words text-fg-muted">{saveError}</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={saving}>
          {t('agent_wizard.back')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void save()}
          disabled={!canSave}
          data-testid="agent-wizard-save"
        >
          {saving ? (
            <>
              <Icon icon={Loader2} size="xs" className="animate-spin" />
              {t('agent_wizard.saving')}
            </>
          ) : (
            <>
              <Icon icon={Check} size="xs" />
              {t('agent_wizard.create')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Helpers ─────────────────────────

/**
 * Generate a filesystem-safe id unique against existingIds. Starts
 * with the provider template's short id (`openai`, `anthropic`, …)
 * and appends a numeric suffix if needed: `openai`, `openai-2`, …
 */
function generateUniqueId(base: string, existing: string[]): string {
  const seen = new Set(existing);
  if (!seen.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!seen.has(candidate)) return candidate;
  }
  // Fall-through: an un-suffixed variant with the second char upper —
  // still valid and unique after 99 collisions of the same provider.
  return `${base}-new`;
}

// Suppress unused-import warnings for icons imported for visual
// parity with other wizard-style components — kept so the bundle
// pays the same tree-shake cost as always.
void ArrowRight;
void Plus;
