import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/cn';
import {
  appPaths,
  configGet,
  configSet,
  configTest,
  ipcErrorMessage,
  type AppPaths,
  type GatewayConfigDto,
} from '@/lib/ipc';

import { AppearanceSection } from './AppearanceSection';
import { HermesInstancesSection } from './HermesInstancesSection';
import { BrowserLLMSection } from './sections/BrowserLLMSection';
import { ContextSection } from './sections/ContextSection';
import { LicenseSection } from './sections/LicenseSection';
import { MemorySection } from './sections/MemorySection';
import { RoutingRulesSection } from './sections/RoutingRulesSection';
import { HermesToolPermissionsSection } from './sections/HermesToolPermissionsSection';
import { SandboxScopesSection } from './sections/SandboxScopesSection';
import { StorageSection } from './sections/StorageSection';
import { WorkspaceSection } from './sections/WorkspaceSection';
import { Field, Section } from './shared';
import { inputCls } from './styles';

// Re-exported here so the rest of the app's imports
// (`features/agents` etc.) keep resolving without churn.
export { HermesInstancesSection };

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

const SETTINGS_ANCHORS = [
  { id: 'settings-appearance', labelKey: 'settings.appearance.title' },
  { id: 'settings-gateway', labelKey: 'settings.gateway.title' },
  { id: 'settings-model', labelKey: 'settings.model.title' },
  { id: 'settings-context', labelKey: 'settings.context.title' },
  { id: 'settings-memory', labelKey: 'settings.memory.title' },
  { id: 'settings-routing', labelKey: 'settings.routing_rules.title' },
  { id: 'settings-sandbox', labelKey: 'settings.sandbox.title' },
  { id: 'settings-scopes', labelKey: 'settings.sandbox_scopes.title' },
  { id: 'settings-hermes-tools', labelKey: 'settings.hermes_security.title' },
  { id: 'settings-storage', labelKey: 'settings.storage.title' },
] as const;

export function SettingsRoute() {
  const { t } = useTranslation();

  // Loaded snapshot from the backend; used for the Reset button.
  const [loaded, setLoaded] = useState<GatewayConfigDto | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [test, setTest] = useState<TestStatus>({ kind: 'idle' });
  const [save, setSave] = useState<SaveStatus>({ kind: 'idle' });

  // Storage section — paths resolved once at app startup, cached on
  // AppState. Load in parallel with the gateway config.
  const [paths, setPaths] = useState<AppPaths | null>(null);

  // Load current config + paths on mount.
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
    appPaths()
      .then((p) => {
        if (alive) setPaths(p);
      })
      .catch(() => {
        /* Storage section just hides on failure — not blocking. */
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
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        actions={
          <InfoHint
            title={t('settings.title')}
            content={t('settings.help_page')}
            testId="settings-help"
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto" id="settings-scroll-container">
        <nav className="sticky top-0 z-10 border-b border-border bg-bg-elev-1/95 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-2xl gap-1 overflow-x-auto px-6 py-2">
            {SETTINGS_ANCHORS.map((a) => (
              <a
                key={a.id}
                href={`#${a.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(a.id);
                  const container = document.getElementById('settings-scroll-container');
                  if (el && container) {
                    let offset = 0;
                    let node: HTMLElement | null = el;
                    while (node && node !== container) {
                      offset += node.offsetTop;
                      node = node.offsetParent as HTMLElement | null;
                    }
                    container.scrollTo({ top: offset - 48, behavior: 'smooth' });
                  }
                }}
                className="shrink-0 rounded-md px-2.5 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-elev-2 hover:text-fg"
              >
                {t(a.labelKey)}
              </a>
            ))}
          </div>
        </nav>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
          {/* Appearance is independent of gateway config — render first and
              always, even while the gateway config is still loading. */}
          <AppearanceSection />

          {loaded === null ? (
            <div className="flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              {t('settings.loading')}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-6">
              <Section
                id="settings-gateway"
                title={t('settings.gateway.title')}
                description={t('settings.gateway.desc')}
              >
                <Field
                  label={t('settings.gateway.base_url')}
                  hint={t('settings.gateway.base_url_hint')}
                >
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
                  label={t('settings.gateway.api_key')}
                  hint={t('settings.gateway.api_key_hint')}
                >
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setTest({ kind: 'idle' });
                      }}
                      placeholder={t('settings.gateway.api_key_placeholder')}
                      className={cn(inputCls, 'pr-10')}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
                      aria-label={
                        showKey
                          ? t('settings.gateway.hide_key')
                          : t('settings.gateway.show_key')
                      }
                      tabIndex={-1}
                    >
                      <Icon icon={showKey ? EyeOff : Eye} size="md" />
                    </button>
                  </div>
                </Field>
              </Section>

              <Section
                id="settings-model"
                title={t('settings.model.title')}
                description={t('settings.model.desc')}
              >
                <Field label={t('settings.model.label')}>
                  <Combobox
                    value={defaultModel}
                    onChange={setDefaultModel}
                    placeholder="deepseek-reasoner"
                    options={MODEL_SUGGESTIONS.map((m) => ({ value: m }))}
                  />
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
                      <Icon icon={RotateCcw} size="sm" />
                      {t('settings.gateway.reset')}
                    </Button>
                  )}
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!dirty || save.kind === 'saving' || !baseUrl.trim()}
                  >
                    {save.kind === 'saving' ? (
                      <Icon icon={Loader2} size="md" className="animate-spin" />
                    ) : (
                      <Icon icon={Save} size="md" />
                    )}
                    {t('settings.gateway.save')}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* T8 — Hermes instances moved to a top-level /agents tab.
              Settings keeps the primary gateway only; the Agents page
              lists additional instances and opens the wizard. */}

          {/* v9 — Auto-context-compression knobs. Lives between gateway
              and routing because it's a Hermes-config concern (same
              YAML file as the model section) and the next thing a
              user wants to tune after picking a model is "how does the
              context get managed". */}
          <ContextSection />

          {/* v9 — Memory provider status + USER.md editor. Sits next to
              ContextSection because they're conceptually a pair: one
              shrinks the active context, the other persists the
              long-term memory across sessions. Both are powered by
              Hermes infrastructure that Corey doesn't own. */}
          <MemorySection />

          {/* T6.4 — routing rules. Sits next to Hermes instances since
              routing most commonly picks between them. */}
          <RoutingRulesSection />

          {/* Sandbox workspace roots — lives between gateway and storage so
              the control-plane order roughly matches "what agents can reach". */}
          <WorkspaceSection />

          {/* T6.5 — named sandbox scopes. Sits directly under the
              default-scope workspace section so users see the "global
              roots" and "named scopes" as adjacent affordances. */}
          <SandboxScopesSection />

          {/* The OTHER half of the permission story: Hermes' own
              command-pattern + approval gate. Lives next to the
              path-based sandbox so users see "Corey path policy"
              and "Hermes command policy" as siblings, not as one
              vs the other. Killed the "I locked sandbox but Hermes
              still ran ls ~/Desktop" confusion the v9 audit logged. */}
          <HermesToolPermissionsSection />

          <BrowserLLMSection />

          {/* Read-only storage info. Lives below the gateway form — it's the
              least-frequently-needed section but important for backup /
              debugging. Hides itself if the IPC fails. */}
          {paths && <StorageSection paths={paths} onPathsChange={setPaths} />}

          {/* License management — visible only when there's a real
              activated key. Lets users see who the license belongs
              to + remove it (re-shows the gate on next launch). */}
          <LicenseSection />
        </div>
      </div>
    </div>
  );
}

function TestRow({ status, onTest }: { status: TestStatus; onTest: () => void }) {
  const { t } = useTranslation();
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
          <Icon icon={Loader2} size="sm" className="animate-spin" />
        ) : (
          <Icon icon={Wifi} size="sm" />
        )}
        {t('settings.gateway.test')}
      </Button>
      <div className="min-w-0 flex-1 text-xs">
        {status.kind === 'idle' && (
          <span className="text-fg-subtle">{t('settings.gateway.test_hint')}</span>
        )}
        {status.kind === 'probing' && (
          <span className="text-fg-muted">{t('settings.gateway.testing')}</span>
        )}
        {status.kind === 'ok' && (
          <span className="inline-flex items-center gap-1 text-emerald-500">
            <Icon icon={CheckCircle2} size="sm" />
            {t('settings.gateway.test_ok', { ms: status.latencyMs })}
          </span>
        )}
        {status.kind === 'err' && (
          <span className="inline-flex items-start gap-1 text-danger">
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span className="break-all">{status.message}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function SaveStatusMsg({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  const { t } = useTranslation();
  if (status.kind === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <Icon icon={CheckCircle2} size="sm" />
        {t('settings.gateway.saved')}
      </span>
    );
  }
  if (status.kind === 'err') {
    return (
      <span className="inline-flex items-start gap-1 text-xs text-danger">
        <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
        <span className="break-all">{status.message}</span>
      </span>
    );
  }
  if (dirty) {
    return <span className="text-xs text-fg-muted">{t('settings.gateway.dirty')}</span>;
  }
  return <span className="text-xs text-fg-subtle">{t('settings.gateway.clean')}</span>;
}
