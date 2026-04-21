import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Info,
  Key,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  hermesConfigRead,
  hermesConfigWriteModel,
  ipcErrorMessage,
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
    const meta = PROVIDER_CATALOG.find((p) => p.slug === next);
    // Only auto-set base_url if the user hasn't customized (or is switching between known providers).
    if (meta?.baseUrl && (baseUrl === '' || PROVIDER_CATALOG.some((p) => p.baseUrl === baseUrl))) {
      setBaseUrl(meta.baseUrl);
    } else if (!meta?.baseUrl) {
      // Unknown provider — leave base_url alone.
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
                <RestartBanner onDismiss={() => setNeedsRestart(false)} />
              )}

              <CurrentCard view={loaded} />

              <form onSubmit={onSubmit} className="flex flex-col gap-5">
                <Section
                  title="Change model"
                  description="Pick a provider, set the model id, and save. The gateway must be restarted for changes to take effect."
                >
                  <Field label="Provider">
                    <select
                      value={provider}
                      onChange={(e) => onProviderChange(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">(unset — free text below)</option>
                      {PROVIDER_CATALOG.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.label} ({p.slug})
                        </option>
                      ))}
                    </select>
                    {provider && !providerMeta && (
                      <span className="text-xs text-fg-subtle">
                        Custom provider slug. Make sure Hermes recognizes it.
                      </span>
                    )}
                  </Field>

                  {providerMeta && (
                    <div className="flex items-start gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-2 text-xs">
                      <Key
                        className={cn(
                          'mt-0.5 h-3.5 w-3.5 flex-none',
                          envKeyPresent ? 'text-emerald-500' : 'text-amber-500',
                        )}
                      />
                      <div className="flex-1">
                        {envKeyPresent ? (
                          <>
                            <span className="text-emerald-600">
                              <code className="font-mono">{providerMeta.envKey}</code> is set
                            </span>{' '}
                            <span className="text-fg-muted">in ~/.hermes/.env</span>
                          </>
                        ) : (
                          <>
                            <span className="text-amber-600">
                              Missing <code className="font-mono">{providerMeta.envKey}</code>
                            </span>{' '}
                            <span className="text-fg-muted">
                              in ~/.hermes/.env — add it before restarting the gateway.
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <Field label="Model id" hint="The exact id the provider accepts.">
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={providerMeta?.sampleModels[0] ?? 'e.g. deepseek-reasoner'}
                      list="model-suggestions"
                      className={inputCls}
                    />
                    <datalist id="model-suggestions">
                      {providerMeta?.sampleModels.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </Field>

                  <Field
                    label="Base URL"
                    hint="Optional. OpenAI-compatible endpoint override."
                  >
                    <input
                      type="url"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder={providerMeta?.baseUrl ?? ''}
                      className={inputCls}
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

function RestartBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-gold-500/40 bg-gold-500/5 p-3 text-sm">
      <TerminalIcon className="mt-0.5 h-4 w-4 flex-none text-gold-500" />
      <div className="flex-1">
        <div className="font-medium text-fg">Restart the gateway to apply</div>
        <div className="mt-1 text-xs text-fg-muted">
          Hermes doesn't hot-reload <code className="font-mono">config.yaml</code>. Run this in
          a terminal:
        </div>
        <pre className="mt-2 overflow-x-auto rounded bg-[#0d1117] px-3 py-2 font-mono text-xs text-[#e6edf3]">
          hermes gateway restart
        </pre>
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
