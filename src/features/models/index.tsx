import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Info,
  Key,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Terminal as TerminalIcon,
  Zap,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { cn } from '@/lib/cn';
import {
  hermesConfigRead,
  hermesConfigWriteModel,
  hermesEnvSetKey,
  hermesGatewayRestart,
  ipcErrorMessage,
  modelProviderProbe,
  type DiscoveredModel,
  type HermesConfigView,
  type HermesModelSection,
} from '@/lib/ipc';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; view: HermesConfigView }
  | { kind: 'error'; message: string };

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'err'; message: string };

/**
 * Known providers with the env var convention Hermes expects. Used to suggest
 * which API key the user needs and to populate the provider dropdown. This is
 * a starter list — user can type any custom slug.
 */
const PROVIDER_CATALOG: Array<{
  slug: string;
  label: string;
  envKey: string;
  baseUrl?: string;
  sampleModels: string[];
}> = [
  {
    slug: 'deepseek',
    label: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    sampleModels: ['deepseek-reasoner', 'deepseek-chat'],
  },
  {
    slug: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    sampleModels: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
  },
  {
    slug: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    sampleModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  },
  {
    slug: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    sampleModels: ['anthropic/claude-sonnet-4', 'google/gemini-2.0-flash-thinking-exp'],
  },
  {
    slug: 'zai',
    label: 'Z.AI (GLM)',
    envKey: 'ZAI_API_KEY',
    sampleModels: ['glm-4.6', 'glm-4.5'],
  },
  {
    slug: 'kimi-coding',
    label: 'Kimi / Moonshot',
    envKey: 'KIMI_API_KEY',
    sampleModels: ['kimi-k2-0905-preview', 'moonshot-v1-auto'],
  },
  {
    slug: 'minimax',
    label: 'MiniMax',
    envKey: 'MINIMAX_API_KEY',
    sampleModels: ['MiniMax-M1', 'abab6.5s-chat'],
  },
];

export function ModelsRoute() {
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
  const [probeState, setProbeState] = useState<
    | { kind: 'idle' }
    | { kind: 'probing' }
    | { kind: 'ok'; count: number; latencyMs: number; endpoint: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });

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
        title="Language models"
        subtitle="The LLM backing the Hermes agent — configured in ~/.hermes/config.yaml"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={load}
            disabled={state.kind === 'loading'}
            title="Re-read ~/.hermes/config.yaml"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', state.kind === 'loading' && 'animate-spin')}
            />
            Reload
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading Hermes config…
            </div>
          )}

          {state.kind === 'error' && <ErrorBanner message={state.message} onRetry={load} />}

          {loaded && !loaded.present && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 flex-none text-amber-500" />
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

              <CurrentCard view={loaded} />

              <form onSubmit={onSubmit} className="flex flex-col gap-5">
                <Section
                  title="Change model"
                  description="Pick a provider, set the model id, and save. The gateway must be restarted for changes to take effect."
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
                        Custom provider slug. Make sure Hermes recognizes it.
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
                        title="GET /v1/models against this endpoint"
                      >
                        {probeState.kind === 'probing' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                        Discover
                      </Button>
                    </div>
                    <ProbeStatus state={probeState} />
                  </Field>

                  <Field
                    label="Model id"
                    hint={
                      discovered
                        ? `${discovered.length} model${discovered.length === 1 ? '' : 's'} from ${probeState.kind === 'ok' ? probeState.endpoint : 'upstream'}.`
                        : 'The exact id the provider accepts.'
                    }
                  >
                    <Combobox
                      value={model}
                      onChange={setModel}
                      placeholder={
                        discovered?.[0]?.id ??
                        providerMeta?.sampleModels[0] ??
                        'e.g. deepseek-reasoner'
                      }
                      options={(discovered
                        ? discovered.map((m) => ({
                            value: m.id,
                            hint: m.owned_by ?? undefined,
                          }))
                        : (providerMeta?.sampleModels ?? []).map((m) => ({ value: m }))
                      )}
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
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset
                      </Button>
                    )}
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!dirty || save.kind === 'saving'}
                    >
                      {save.kind === 'saving' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save to config.yaml
                    </Button>
                  </div>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Pieces ─────────────────────────

const inputCls = cn(
  'w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
);

function CurrentCard({ view }: { view: HermesConfigView }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <FileText className="h-3.5 w-3.5" />
        <code className="font-mono">{view.config_path}</code>
      </div>
      <div className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <Label>Provider</Label>
        <Value value={view.model.provider} />
        <Label>Model</Label>
        <Value value={view.model.default} mono />
        <Label>Base URL</Label>
        <Value value={view.model.base_url} mono />
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-fg-muted">{children}</span>;
}

function Value({ value, mono }: { value?: string | null; mono?: boolean }) {
  if (!value) return <span className="text-xs text-fg-subtle">—</span>;
  return (
    <span className={cn('truncate text-sm text-fg', mono && 'font-mono text-xs')}>
      {value}
    </span>
  );
}

function RestartBanner({
  onDismiss,
  onRestarted,
}: {
  onDismiss: () => void;
  onRestarted: (view: HermesConfigView | null) => void;
}) {
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'done'; output: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });

  async function doRestart() {
    if (status.kind === 'running') return;
    setStatus({ kind: 'running' });
    try {
      const output = await hermesGatewayRestart();
      setStatus({ kind: 'done', output });
      // Give Hermes a moment to finish binding port 8642, then refresh.
      window.setTimeout(async () => {
        try {
          const view = await hermesConfigRead();
          onRestarted(view);
        } catch {
          onRestarted(null);
        }
      }, 1200);
    } catch (e) {
      setStatus({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-gold-500/40 bg-gold-500/5 p-3 text-sm">
      <TerminalIcon className="mt-0.5 h-4 w-4 flex-none text-gold-500" />
      <div className="flex-1">
        <div className="font-medium text-fg">Restart the gateway to apply</div>
        <div className="mt-1 text-xs text-fg-muted">
          Hermes doesn't hot-reload <code className="font-mono">config.yaml</code>. Click below,
          or run <code className="font-mono">hermes gateway restart</code> manually.
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={doRestart}
            disabled={status.kind === 'running'}
          >
            {status.kind === 'running' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Restart now
          </Button>
          {status.kind === 'done' && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Gateway restarted.
            </span>
          )}
          {status.kind === 'err' && (
            <span className="inline-flex items-start gap-1 text-xs text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span className="break-all">{status.message}</span>
            </span>
          )}
        </div>

        {status.kind === 'done' && status.output.trim() && (
          <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-[#0d1117] px-3 py-2 font-mono text-[11px] text-[#e6edf3]">
            {status.output.trim()}
          </pre>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="rounded p-1 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Inline API-key form shown below the provider dropdown. Collapsed when the
 * key is already present; expandable for rotation. The value never leaves
 * this component as state — it's sent straight to `hermesEnvSetKey` which
 * writes to `~/.hermes/.env` (mode 0600) and then cleared.
 */
function ApiKeyPanel({
  envKey,
  present,
  onSaved,
}: {
  envKey: string;
  present: boolean;
  onSaved: (view: HermesConfigView) => void;
}) {
  const [expanded, setExpanded] = useState(!present);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the prop flips (e.g. after a save), collapse + clear.
  useEffect(() => {
    if (present && !saving) {
      setExpanded(false);
      setValue('');
    }
  }, [present, saving]);

  async function save() {
    if (!value.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const view = await hermesEnvSetKey(envKey, value.trim());
      setValue('');
      onSaved(view);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-2 text-xs">
        <Key className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-500" />
        <div className="flex-1">
          <span className="text-emerald-600">
            <code className="font-mono">{envKey}</code> is set
          </span>{' '}
          <span className="text-fg-muted">in ~/.hermes/.env</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-fg-subtle transition hover:text-fg"
        >
          Rotate
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2.5 text-xs',
        present
          ? 'border-border bg-bg-elev-2'
          : 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex items-start gap-2">
        <Key
          className={cn(
            'mt-0.5 h-3.5 w-3.5 flex-none',
            present ? 'text-emerald-500' : 'text-amber-500',
          )}
        />
        <div className="flex-1">
          {present ? (
            <>
              <span className="font-medium text-fg">Rotate API key</span>
              <span className="ml-1 text-fg-muted">
                — new value replaces the current <code className="font-mono">{envKey}</code>.
              </span>
            </>
          ) : (
            <>
              <span className="font-medium text-amber-600">
                Missing <code className="font-mono">{envKey}</code>
              </span>
              <span className="ml-1 text-fg-muted">
                — add it so Hermes can talk to this provider.
              </span>
            </>
          )}
        </div>
        {present && (
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setValue('');
              setError(null);
            }}
            className="text-xs text-fg-subtle transition hover:text-fg"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          className={cn(inputCls, 'pr-9 font-mono text-xs')}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle transition hover:bg-bg-elev-1 hover:text-fg"
          aria-label={show ? 'Hide' : 'Show'}
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-subtle">
          Stored only in <code className="font-mono">~/.hermes/.env</code> (mode 0600).
        </span>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={save}
          disabled={!value.trim() || saving}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          Save key
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-1 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </div>
  );
}

/** Inline status line under the Discover button. */
function ProbeStatus({
  state,
}: {
  state:
    | { kind: 'idle' }
    | { kind: 'probing' }
    | { kind: 'ok'; count: number; latencyMs: number; endpoint: string }
    | { kind: 'err'; message: string };
}) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'probing') {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-fg-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        Probing…
      </span>
    );
  }
  if (state.kind === 'ok') {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-500">
        <CheckCircle2 className="h-3 w-3" />
        {state.count} model{state.count === 1 ? '' : 's'} from{' '}
        <code className="font-mono text-[11px]">{state.endpoint}</code> ({state.latencyMs} ms)
      </span>
    );
  }
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-danger">
      <AlertCircle className="h-3 w-3" />
      {state.message}
    </span>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
      <div className="flex-1">
        <div className="font-medium">Unable to read Hermes config</div>
        <div className="mt-1 break-all text-xs opacity-80">{message}</div>
        <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
        )}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

function StatusMsg({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  if (status.kind === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Saved to config.yaml.
      </span>
    );
  }
  if (status.kind === 'err') {
    return (
      <span className="inline-flex items-start gap-1 text-xs text-danger">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
        <span className="break-all">{status.message}</span>
      </span>
    );
  }
  if (dirty) return <span className="text-xs text-fg-muted">Unsaved changes.</span>;
  return <span className="text-xs text-fg-subtle">No changes.</span>;
}
