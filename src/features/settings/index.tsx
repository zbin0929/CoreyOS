import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
  Save,
  Wifi,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  configGet,
  configSet,
  configTest,
  ipcErrorMessage,
  type GatewayConfigDto,
} from '@/lib/ipc';

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'err'; message: string };

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'err'; message: string };

const MODEL_SUGGESTIONS = [
  'deepseek-reasoner',
  'deepseek-chat',
  'gpt-4o-mini',
  'claude-3-5-sonnet-20241022',
];

export function SettingsRoute() {
  // Loaded snapshot from the backend; used for the Reset button.
  const [loaded, setLoaded] = useState<GatewayConfigDto | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [test, setTest] = useState<TestStatus>({ kind: 'idle' });
  const [save, setSave] = useState<SaveStatus>({ kind: 'idle' });

  // Load current config on mount.
  useEffect(() => {
    let alive = true;
    configGet()
      .then((cfg) => {
        if (!alive) return;
        setLoaded(cfg);
        setBaseUrl(cfg.base_url ?? '');
        setApiKey(cfg.api_key ?? '');
        setDefaultModel(cfg.default_model ?? '');
      })
      .catch((e) => {
        if (!alive) return;
        setSave({ kind: 'err', message: ipcErrorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const draft: GatewayConfigDto = {
    base_url: baseUrl.trim(),
    api_key: apiKey.trim() || null,
    default_model: defaultModel.trim() || null,
  };

  const dirty =
    loaded !== null &&
    (draft.base_url !== loaded.base_url ||
      (draft.api_key ?? '') !== (loaded.api_key ?? '') ||
      (draft.default_model ?? '') !== (loaded.default_model ?? ''));

  async function onTest() {
    if (test.kind === 'probing') return;
    setTest({ kind: 'probing' });
    try {
      const probe = await configTest(draft);
      setTest({ kind: 'ok', latencyMs: probe.latency_ms });
    } catch (e) {
      setTest({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === 'saving') return;
    setSave({ kind: 'saving' });
    try {
      await configSet(draft);
      setLoaded(draft);
      setSave({ kind: 'saved' });
      window.setTimeout(() => {
        setSave((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2000);
    } catch (err) {
      setSave({ kind: 'err', message: ipcErrorMessage(err) });
    }
  }

  function onReset() {
    if (!loaded) return;
    setBaseUrl(loaded.base_url ?? '');
    setApiKey(loaded.api_key ?? '');
    setDefaultModel(loaded.default_model ?? '');
    setTest({ kind: 'idle' });
    setSave({ kind: 'idle' });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Settings"
        subtitle="Gateway · runtime configuration"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-8">
          {loaded === null ? (
            <div className="flex items-center gap-2 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading current configuration…
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-6">
              <Section
                title="Gateway"
                description="Where Caduceus sends chat requests. Changes take effect immediately — no restart needed."
              >
                <Field label="Base URL" hint="Example: http://127.0.0.1:8642">
                  <input
                    type="url"
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      setTest({ kind: 'idle' });
                    }}
                    placeholder="http://127.0.0.1:8642"
                    className={inputCls}
                    required
                  />
                </Field>

                <Field
                  label="API key"
                  hint="Optional. Matches the gateway's API_SERVER_KEY. Stored locally in plaintext."
                >
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setTest({ kind: 'idle' });
                      }}
                      placeholder="(leave empty if the gateway is unauthenticated)"
                      className={cn(inputCls, 'pr-10')}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
                      aria-label={showKey ? 'Hide API key' : 'Show API key'}
                      tabIndex={-1}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
              </Section>

              <Section
                title="Default language model"
                description="Which LLM the Hermes agent uses when a chat doesn't specify one. Individual chats can override this from the composer."
              >
                <Field label="Model id">
                  <input
                    type="text"
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    placeholder="deepseek-reasoner"
                    list="model-suggestions"
                    className={inputCls}
                  />
                  <datalist id="model-suggestions">
                    {MODEL_SUGGESTIONS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
              </Section>

              <TestRow status={test} onTest={onTest} />

              <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                <SaveStatusMsg status={save} dirty={dirty} />
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
                    disabled={!dirty || save.kind === 'saving' || !baseUrl.trim()}
                  >
                    {save.kind === 'saving' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            </form>
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

function TestRow({ status, onTest }: { status: TestStatus; onTest: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 px-3 py-2.5">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onTest}
        disabled={status.kind === 'probing'}
      >
        {status.kind === 'probing' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wifi className="h-3.5 w-3.5" />
        )}
        Test connection
      </Button>
      <div className="min-w-0 flex-1 text-xs">
        {status.kind === 'idle' && (
          <span className="text-fg-subtle">Hits <code className="font-mono">/health</code> without saving.</span>
        )}
        {status.kind === 'probing' && <span className="text-fg-muted">Probing…</span>}
        {status.kind === 'ok' && (
          <span className="inline-flex items-center gap-1 text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Healthy · {status.latencyMs} ms
          </span>
        )}
        {status.kind === 'err' && (
          <span className="inline-flex items-start gap-1 text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span className="break-all">{status.message}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function SaveStatusMsg({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  if (status.kind === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Saved. Adapter reloaded.
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
  if (dirty) {
    return <span className="text-xs text-fg-muted">Unsaved changes.</span>;
  }
  return <span className="text-xs text-fg-subtle">No changes.</span>;
}
