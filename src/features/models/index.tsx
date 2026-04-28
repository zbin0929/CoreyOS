import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
} from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/cn';
import {
  hermesConfigRead,
  hermesConfigWriteModel,
  ipcErrorMessage,
  modelProviderProbe,
  type DiscoveredModel,
  type HermesModelSection,
} from '@/lib/ipc';

import { ApiKeyPanel } from './ApiKeyPanel';
import { LlmProfilesSection } from './LlmProfilesSection';
import { PROVIDER_CATALOG } from './providerCatalog';
import { RestartBanner } from './RestartBanner';
import {
  CurrentCard,
  ErrorBanner,
  Field,
  ProbeStatus,
  Section,
  StatusMsg,
} from './shared';
import { inputCls } from './styles';
import type { LoadState, ProbeState, SaveStatus } from './types';

/**
 * Models route — manages the Hermes gateway's default model + the
 * reusable LLM profile library (T8). The page is layered so the
 * profiles list (the primary affordance) sits above a collapsed
 * `<details>` containing the legacy single-model form for power users
 * who want to tune `~/.hermes/config.yaml`'s `model:` section directly.
 *
 * 2026-04-26 — extracted ApiKeyPanel / RestartBanner / providerCatalog /
 * shared primitives out of the original 935-line file. The route below
 * keeps the form state machine, the discover/save flow, and the
 * top-level layout.
 */
export function ModelsRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const [save, setSave] = useState<SaveStatus>({ kind: 'idle' });
  /** `true` while the user has saved but the gateway still runs the old config. */
  const [needsRestart, setNeedsRestart] = useState(false);

  /** Result of the most recent "Discover" probe — replaces the hand-curated
   *  sample models in the Combobox when present. `null` = never probed this
   *  session. Cleared on provider change. */
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    setSave({ kind: 'idle' });
    try {
      const view = await hermesConfigRead();
      setState({ kind: 'loaded', view });
      setProvider(view.model.provider ?? '');
      setModel(view.model.default ?? '');
      setBaseUrl(view.model.base_url ?? '');
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loaded = state.kind === 'loaded' ? state.view : null;

  // Auto-fill base_url and switch model suggestions when provider changes.
  const providerMeta = useMemo(
    () => PROVIDER_CATALOG.find((p) => p.slug === provider),
    [provider],
  );

  function onProviderChange(next: string) {
    setProvider(next);
    // Any prior discovery was for a different provider — drop it so the
    // dropdown falls back to hand-curated suggestions until the user probes.
    setDiscovered(null);
    setProbeState({ kind: 'idle' });
    const meta = PROVIDER_CATALOG.find((p) => p.slug === next);
    // Only auto-set base_url if the user hasn't customized (or is switching between known providers).
    if (meta?.baseUrl && (baseUrl === '' || PROVIDER_CATALOG.some((p) => p.baseUrl === baseUrl))) {
      setBaseUrl(meta.baseUrl);
    } else if (!meta?.baseUrl) {
      // Unknown provider — leave base_url alone.
    }
  }

  async function onDiscover() {
    const url = baseUrl.trim();
    if (!url) {
      setProbeState({ kind: 'err', message: 'Set a base URL first.' });
      return;
    }
    setProbeState({ kind: 'probing' });
    try {
      const report = await modelProviderProbe({
        baseUrl: url,
        envKey: providerMeta?.envKey ?? null,
      });
      setDiscovered(report.models);
      setProbeState({
        kind: 'ok',
        count: report.models.length,
        latencyMs: report.latency_ms,
        endpoint: report.endpoint,
      });
    } catch (err) {
      setProbeState({ kind: 'err', message: ipcErrorMessage(err) });
    }
  }

  const dirty =
    loaded !== null &&
    (provider !== (loaded.model.provider ?? '') ||
      model !== (loaded.model.default ?? '') ||
      baseUrl !== (loaded.model.base_url ?? ''));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === 'saving' || !dirty) return;
    setSave({ kind: 'saving' });
    const next: HermesModelSection = {
      default: model.trim() || null,
      provider: provider.trim() || null,
      base_url: baseUrl.trim() || null,
    };
    try {
      const view = await hermesConfigWriteModel(next);
      setState({ kind: 'loaded', view });
      setSave({ kind: 'saved' });
      setNeedsRestart(true);
      window.setTimeout(() => {
        setSave((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2500);
    } catch (err) {
      setSave({ kind: 'err', message: ipcErrorMessage(err) });
    }
  }

  function onReset() {
    if (!loaded) return;
    setProvider(loaded.model.provider ?? '');
    setModel(loaded.model.default ?? '');
    setBaseUrl(loaded.model.base_url ?? '');
    setSave({ kind: 'idle' });
  }

  const envKeyPresent = providerMeta
    ? loaded?.env_keys_present.includes(providerMeta.envKey) ?? false
    : false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('models_page.title')}
        subtitle={t('models_page.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('models_page.title')}
              content={t('models_page.help_page')}
              testId="models-help"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={load}
              disabled={state.kind === 'loading'}
              title={t('models_page.reload_config')}
            >
              <Icon
                icon={RefreshCw}
                size="sm"
                className={cn(state.kind === 'loading' && 'animate-spin')}
              />
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              Reading Hermes config…
            </div>
          )}

          {state.kind === 'error' && <ErrorBanner message={state.message} onRetry={load} />}

          {loaded && !loaded.present && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <Icon icon={Info} size="md" className="mt-0.5 flex-none text-amber-500" />
              <div className="flex-1">
                <div className="font-medium text-amber-600">
                  Hermes config not found
                </div>
                <div className="mt-1 text-xs text-fg-muted">
                  Expected at <code className="font-mono">{loaded.config_path}</code>. Run{' '}
                  <code className="font-mono">hermes init</code> or install Hermes first.
                </div>
              </div>
            </div>
          )}

          {/* T8 — reusable LLM profile library (the list users came
              here for). Lives above the legacy single-model form so
              profiles are the primary affordance on this page. */}
          <LlmProfilesSection />

          {loaded && (
            <>
              {needsRestart && (
                <RestartBanner
                  onDismiss={() => setNeedsRestart(false)}
                  onRestarted={(view) => {
                    if (view) setState({ kind: 'loaded', view });
                    setNeedsRestart(false);
                  }}
                />
              )}

              {/* The legacy single-model editor (writes
                  ~/.hermes/config.yaml's `model:` section) now lives
                  under a collapsed disclosure. LLM profiles above are
                  the primary workflow; this form is for power users
                  tuning the Hermes gateway's default fallback model —
                  keeping it expanded was cluttering the page per
                  user feedback 1a ("展示好多信息，很乱"). */}
              <details className="group rounded-md border border-border bg-bg-elev-1">
                <summary
                  className="flex cursor-pointer items-center justify-between gap-2 p-3 text-sm text-fg-muted hover:text-fg"
                  data-testid="models-legacy-advanced"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">
                      {t('models_page.legacy_title')}
                    </span>
                  </span>
                  <span className="text-xs text-fg-subtle group-open:hidden">
                    {t('models_page.legacy_expand')}
                  </span>
                  <span className="hidden text-xs text-fg-subtle group-open:inline">
                    {t('models_page.legacy_collapse')}
                  </span>
                </summary>
                <div className="flex flex-col gap-4 border-t border-border p-4">
                  <CurrentCard view={loaded} />

                  <form onSubmit={onSubmit} className="flex flex-col gap-5">
                    <Section
                      title={t('models_page.change_model')}
                      description={t('models_page.change_model_desc')}
                    >
                      <Field label="Provider">
                        <Combobox
                          value={provider}
                          onChange={onProviderChange}
                          placeholder="e.g. deepseek"
                          options={PROVIDER_CATALOG.map((p) => ({
                            value: p.slug,
                            label: p.label,
                            hint: p.slug,
                          }))}
                        />
                        {provider && !providerMeta && (
                          <span className="text-xs text-fg-subtle">
                            {t('models_page.custom_provider_warning')}
                          </span>
                        )}
                      </Field>

                      {providerMeta && (
                        <ApiKeyPanel
                          envKey={providerMeta.envKey}
                          present={envKeyPresent}
                          onSaved={(view) => {
                            setState({ kind: 'loaded', view });
                          }}
                        />
                      )}

                      <Field
                        label="Base URL"
                        hint="Optional. OpenAI-compatible endpoint override."
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="url"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder={providerMeta?.baseUrl ?? ''}
                            className={cn(inputCls, 'flex-1')}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={onDiscover}
                            disabled={probeState.kind === 'probing' || !baseUrl.trim()}
                            title={t('models_page.probe_title')}
                          >
                            {probeState.kind === 'probing' ? (
                              <Icon icon={Loader2} size="sm" className="animate-spin" />
                            ) : (
                              <Icon icon={Search} size="sm" />
                            )}
                            {t('models_page.discover')}
                          </Button>
                        </div>
                        <ProbeStatus state={probeState} />
                      </Field>

                      <Field
                        label={t('models_page.field_model_id')}
                        hint={
                          discovered
                            ? t('models_page.model_hint_discovered', {
                                count: discovered.length,
                                endpoint:
                                  probeState.kind === 'ok' ? probeState.endpoint : 'upstream',
                              })
                            : t('models_page.model_hint_default')
                        }
                      >
                        <Combobox
                          value={model}
                          onChange={setModel}
                          placeholder={
                            discovered?.[0]?.id ??
                            providerMeta?.sampleModels[0] ??
                            t('models_page.model_placeholder')
                          }
                          options={
                            discovered
                              ? discovered.map((m) => ({
                                  value: m.id,
                                  hint: m.owned_by ?? undefined,
                                }))
                              : (providerMeta?.sampleModels ?? []).map((m) => ({ value: m }))
                          }
                        />
                      </Field>
                    </Section>

                    <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                      <StatusMsg status={save} dirty={dirty} />
                      <div className="flex items-center gap-2">
                        {dirty && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={onReset}
                            disabled={save.kind === 'saving'}
                          >
                            <Icon icon={RotateCcw} size="sm" />
                            Reset
                          </Button>
                        )}
                        <Button
                          type="submit"
                          variant="primary"
                          disabled={!dirty || save.kind === 'saving'}
                        >
                          {save.kind === 'saving' ? (
                            <Icon icon={Loader2} size="md" className="animate-spin" />
                          ) : (
                            <Icon icon={Save} size="md" />
                          )}
                          {t('models_page.save_to_config')}
                        </Button>
                      </div>
                    </div>
                  </form>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
