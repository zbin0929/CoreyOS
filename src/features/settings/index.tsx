import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Monitor,
  Moon,
  RotateCcw,
  Save,
  Sun,
  Wifi,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { cn } from '@/lib/cn';
import { useUIStore, type Theme } from '@/stores/ui';
import { supportedLngs, type Lang } from '@/lib/i18n';
import {
  appPaths,
  configGet,
  configSet,
  configTest,
  ipcErrorMessage,
  type AppPaths,
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
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
          {/* Appearance is independent of gateway config — render first and
              always, even while the gateway config is still loading. */}
          <AppearanceSection />

          {loaded === null ? (
            <div className="flex items-center gap-2 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('settings.loading')}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-6">
              <Section
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
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
              </Section>

              <Section
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
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('settings.gateway.reset')}
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
                    {t('settings.gateway.save')}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* Read-only storage info. Lives below the gateway form — it's the
              least-frequently-needed section but important for backup /
              debugging. Hides itself if the IPC fails. */}
          {paths && <StorageSection paths={paths} />}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Appearance ─────────────────────────

/**
 * Theme + language controls. Both persist independently of the Rust
 * backend: theme in zustand (localStorage `caduceus.ui`), language in
 * i18next's LanguageDetector cache (`caduceus.lang`). No IPC, no dirty
 * tracking — changes are applied immediately and visible on the same
 * render.
 */
function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  // Narrow i18next's `language` (could be `zh-CN`, `en-US`, etc.) to our
  // supported set. LanguageDetector returns the first match but at runtime
  // we still want a clean 2-letter value for the <select>.
  const currentLang: Lang = (supportedLngs as readonly string[]).includes(i18n.language)
    ? (i18n.language as Lang)
    : 'en';

  const themes: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: 'dark', label: t('settings.appearance.theme_dark'), icon: Moon },
    { value: 'light', label: t('settings.appearance.theme_light'), icon: Sun },
    { value: 'system', label: t('settings.appearance.theme_system'), icon: Monitor },
  ];

  return (
    <Section
      title={t('settings.appearance.title')}
      description={t('settings.appearance.desc')}
    >
      <Field label={t('settings.appearance.theme')}>
        <div
          role="radiogroup"
          aria-label={t('settings.appearance.theme')}
          className="inline-flex rounded-md border border-border bg-bg-elev-1 p-0.5"
        >
          {themes.map(({ value, label, icon: Icon }) => {
            const active = theme === value;
            return (
              <button
                type="button"
                key={value}
                role="radio"
                aria-checked={active}
                data-testid={`settings-theme-${value}`}
                onClick={() => setTheme(value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition',
                  active
                    ? 'bg-gold-500/20 text-fg'
                    : 'text-fg-subtle hover:bg-bg-elev-2 hover:text-fg',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t('settings.appearance.language')}>
        <select
          value={currentLang}
          data-testid="settings-lang"
          onChange={(e) => {
            void i18n.changeLanguage(e.target.value);
          }}
          className={cn(inputCls, 'max-w-[200px] appearance-none pr-8')}
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </Field>
    </Section>
  );
}

// ───────────────────────── Storage ─────────────────────────

function StorageSection({ paths }: { paths: AppPaths }) {
  const { t } = useTranslation();
  const rows: Array<{ key: keyof AppPaths; label: string }> = [
    { key: 'config_dir', label: t('settings.storage.config_dir') },
    { key: 'data_dir', label: t('settings.storage.data_dir') },
    { key: 'db_path', label: t('settings.storage.db_path') },
    { key: 'changelog_path', label: t('settings.storage.changelog_path') },
  ];

  return (
    <Section
      title={t('settings.storage.title')}
      description={t('settings.storage.desc')}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <PathRow key={row.key} label={row.label} value={paths[row.key]} />
        ))}
      </ul>
    </Section>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard access can fail under strict permissions — silently
         ignore. Users can still select + copy the path manually. */
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs">
      <span className="min-w-[110px] flex-none text-fg-subtle">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-fg" title={value}>
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex flex-none items-center gap-1 rounded p-1 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
        aria-label={t('settings.storage.copy')}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-emerald-500">{t('settings.storage.copied')}</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span>{t('settings.storage.copy')}</span>
          </>
        )}
      </button>
    </li>
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
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wifi className="h-3.5 w-3.5" />
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
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('settings.gateway.test_ok', { ms: status.latencyMs })}
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
  const { t } = useTranslation();
  if (status.kind === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t('settings.gateway.saved')}
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
    return <span className="text-xs text-fg-muted">{t('settings.gateway.dirty')}</span>;
  }
  return <span className="text-xs text-fg-subtle">{t('settings.gateway.clean')}</span>;
}
