import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Check,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Wand2,
  Wifi,
  X,
} from 'lucide-react';
import { useSandboxStore } from '@/stores/sandbox';
import { type SandboxAccessMode, ipcErrorMessage as ipcErrorMessageFn } from '@/lib/ipc';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  appPaths,
  configGet,
  configSet,
  configTest,
  ipcErrorMessage,
  browserConfigGet,
  browserConfigSet,
  browserDiagnose,
  type BrowserLLMConfig,
  learningSuggestRouting,
  routingRuleDelete,
  routingRuleUpsert,
  sandboxScopeDelete,
  sandboxScopeList,
  sandboxScopeUpsert,
  type AppPaths,
  type GatewayConfigDto,
  type RoutingMatch,
  type RoutingRule,
  type RoutingSuggestion,
  type SandboxScope,
} from '@/lib/ipc';
import { AppearanceSection } from './AppearanceSection';
import { HermesInstancesSection } from './HermesInstancesSection';
export { HermesInstancesSection };
import { Section, Field } from './shared';
import { useAgentsStore } from '@/stores/agents';
import { useRoutingStore } from '@/stores/routing';

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
  { id: 'settings-routing', labelKey: 'settings.routing_rules.title' },
  { id: 'settings-sandbox', labelKey: 'settings.sandbox.title' },
  { id: 'settings-scopes', labelKey: 'settings.sandbox_scopes.title' },
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

          <BrowserLLMSection />

          {/* Read-only storage info. Lives below the gateway form — it's the
              least-frequently-needed section but important for backup /
              debugging. Hides itself if the IPC fails. */}
          {paths && <StorageSection paths={paths} />}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Workspace (sandbox) ─────────────────────────

/**
 * Manage the PathAuthority's workspace roots + mode. Every mutation here
 * calls back to Rust and triggers an atomic write of `sandbox.json`.
 *
 * Adding the first root flips the mode from `dev_allow` to `enforced`
 * automatically; there's also an explicit "Enforce without adding a
 * root" button for users who want to lock everything down while they
 * decide which paths to whitelist.
 */
function WorkspaceSection() {
  const { t } = useTranslation();
  const hydrated = useSandboxStore((s) => s.hydrated);
  const mode = useSandboxStore((s) => s.mode);
  const roots = useSandboxStore((s) => s.roots);
  const sessionGrants = useSandboxStore((s) => s.sessionGrants);
  const configPath = useSandboxStore((s) => s.configPath);
  const addRoot = useSandboxStore((s) => s.addRoot);
  const removeRoot = useSandboxStore((s) => s.removeRoot);
  const setEnforced = useSandboxStore((s) => s.setEnforced);
  const clearSessionGrants = useSandboxStore((s) => s.clearSessionGrants);

  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMode, setNewMode] = useState<SandboxAccessMode>('read_write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newPath.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addRoot({
        path: newPath.trim(),
        label: newLabel.trim() || newPath.trim().split(/[\\/]/).filter(Boolean).pop() || 'Root',
        mode: newMode,
      });
      setNewPath('');
      setNewLabel('');
    } catch (err) {
      setError(ipcErrorMessageFn(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(path: string) {
    if (busy) return;
    setBusy(true);
    try {
      await removeRoot(path);
    } catch (err) {
      setError(ipcErrorMessageFn(err));
    } finally {
      setBusy(false);
    }
  }

  // Native folder picker via tauri-plugin-dialog. Fails soft on non-Tauri
  // contexts (Storybook, Playwright mock) so the text input stays usable.
  async function onBrowse() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string' && picked) {
        setNewPath(picked);
        // Auto-fill label from the last path segment when empty so the
        // common case ("add ~/Projects/foo") is a one-click flow.
        if (!newLabel.trim()) {
          const seg = picked.split(/[\\/]/).filter(Boolean).pop();
          if (seg) setNewLabel(seg);
        }
      }
    } catch (err) {
      setError(ipcErrorMessageFn(err));
    }
  }

  return (
    <Section
      id="settings-sandbox"
      title={t('settings.sandbox.title')}
      description={t('settings.sandbox.desc')}
    >
      {!hydrated ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('settings.loading')}
        </div>
      ) : (
        <>
          {/* Mode pill + enforce toggle */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs">
            <Icon
              icon={mode === 'enforced' ? ShieldCheck : Lock}
              size="sm"
              className={mode === 'enforced' ? 'text-emerald-500' : 'text-gold-500'}
            />
            <span className="font-medium text-fg">
              {t(`settings.sandbox.mode_${mode}`)}
            </span>
            <span className="flex-1 text-fg-subtle">
              {t(`settings.sandbox.mode_${mode}_hint`)}
            </span>
            {mode === 'dev_allow' && (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  void setEnforced();
                }}
              >
                {t('settings.sandbox.enforce_now')}
              </Button>
            )}
          </div>

          {/* Status indicator + test guide */}
          {mode === 'enforced' && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
              <Icon icon={ShieldCheck} size="sm" className="mt-0.5 flex-none" />
              <div>
                <span className="font-medium">{t('settings.sandbox.active_title')}</span>
                <p className="mt-0.5 text-[11px] opacity-80">{t('settings.sandbox.test_guide')}</p>
              </div>
            </div>
          )}
          {mode === 'dev_allow' && (
            <div className="flex items-start gap-2 rounded-md border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-xs text-gold-600 dark:text-gold-400">
              <Icon icon={Lock} size="sm" className="mt-0.5 flex-none" />
              <span>{t('settings.sandbox.dev_hint')}</span>
            </div>
          )}

          {/* Existing roots */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-fg">
              {t('settings.sandbox.roots_title')}
            </div>
            {roots.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-fg-subtle">
                {t('settings.sandbox.no_roots')}
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {roots.map((r) => (
                  <li
                    key={r.path}
                    className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-fg">{r.label}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono text-[10px]',
                            r.mode === 'read_write'
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : 'bg-bg-elev-3 text-fg-subtle',
                          )}
                        >
                          {t(`settings.sandbox.mode_${r.mode}_short`)}
                        </span>
                      </div>
                      <code
                        className="truncate font-mono text-[11px] text-fg-muted"
                        title={r.path}
                      >
                        {r.path}
                      </code>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        void onRemove(r.path);
                      }}
                      aria-label={t('settings.sandbox.remove')}
                    >
                      <Icon icon={Trash2} size="sm" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add-root form */}
          <form onSubmit={onAdd} className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="text-xs font-medium text-fg">
              {t('settings.sandbox.add_title')}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder={t('settings.sandbox.path_placeholder')}
                className={cn(inputCls, 'flex-1')}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void onBrowse();
                }}
              >
                <Icon icon={FolderOpen} size="sm" />
                {t('settings.sandbox.browse')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('settings.sandbox.label_placeholder')}
                className={cn(inputCls, 'flex-1 min-w-[160px]')}
                spellCheck={false}
                autoComplete="off"
              />
              <div
                role="radiogroup"
                aria-label={t('settings.sandbox.mode_label')}
                className="inline-flex rounded-md border border-border bg-bg-elev-1 p-0.5"
              >
                {(['read', 'read_write'] as SandboxAccessMode[]).map((m) => {
                  const active = newMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setNewMode(m)}
                      className={cn(
                        'rounded px-2 py-1 text-xs transition',
                        active
                          ? 'bg-gold-500/20 text-fg'
                          : 'text-fg-subtle hover:bg-bg-elev-2 hover:text-fg',
                      )}
                    >
                      {t(`settings.sandbox.mode_${m}_short`)}
                    </button>
                  );
                })}
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={!newPath.trim() || busy}>
                <Icon icon={FolderPlus} size="sm" />
                {t('settings.sandbox.add')}
              </Button>
            </div>
          </form>

          {/* Session grants */}
          {sessionGrants.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-fg">
                  {t('settings.sandbox.session_grants_title')}
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    void clearSessionGrants();
                  }}
                >
                  <Icon icon={X} size="xs" />
                  {t('settings.sandbox.clear_grants')}
                </Button>
              </div>
              <ul className="flex flex-col gap-1">
                {sessionGrants.map((g) => (
                  <li
                    key={g}
                    className="truncate rounded border border-border bg-bg-elev-2 px-2 py-1 font-mono text-[11px] text-fg-muted"
                    title={g}
                  >
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
              <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {configPath && (
            <div className="text-[11px] text-fg-subtle">
              {t('settings.sandbox.config_path')}{' '}
              <code className="font-mono">{configPath}</code>
            </div>
          )}
        </>
      )}
    </Section>
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
// ───────────────────────── Hermes instances (T6.2) ─────────────────────────

/**
 * T6.2 — CRUD for extra Hermes gateways beyond the primary one managed
 * by the Gateway section above. Each entry is persisted in
 * `<app_config_dir>/hermes_instances.json` and registered at boot (and
 * on upsert) under `adapter_id = "hermes:<id>"`, so they flow through
 * the same AgentSwitcher / session / analytics paths as the built-in
 * `hermes` adapter.
 *
 * Not a form with a global save button (unlike Gateway) — each row is
 * edited inline and saved independently, so adding a second instance
 * never risks overwriting the first.
 */
function RoutingRulesSection() {
  const { t } = useTranslation();
  const rules = useRoutingStore((s) => s.rules);
  const setRules = useRoutingStore((s) => s.setRules);
  const hydrate = useRoutingStore((s) => s.hydrate);
  const adapters = useAgentsStore((s) => s.adapters);
  const [adding, setAdding] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<RoutingSuggestion[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (rules === null) void hydrate();
  }, [rules, hydrate]);

  const adapterOptions = (adapters ?? []).map((a) => ({
    value: a.id,
    label: a.name ? `${a.name} (${a.id})` : a.id,
  }));

  return (
    <Section
      id="settings-routing"
      title={t('settings.routing_rules.title')}
      description={t('settings.routing_rules.desc')}
    >
      {rules === null ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="routing-rules-list">
          {rules.map((r) => (
            <RoutingRuleRow
              key={r.id}
              initial={r}
              adapterOptions={adapterOptions}
              onSaved={(next) => {
                setRules((rules ?? []).map((p) => (p.id === next.id ? next : p)));
              }}
              onDeleted={() => {
                setRules((rules ?? []).filter((p) => p.id !== r.id));
              }}
            />
          ))}
          {rules.length === 0 && !adding && (
            <div className="rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-4 text-center text-xs text-fg-subtle">
              {t('settings.routing_rules.empty')}
            </div>
          )}
        </ul>
      )}

      {adding ? (
        <RoutingRuleRow
          isNew
          adapterOptions={adapterOptions}
          initial={{
            id: '',
            name: '',
            enabled: true,
            match: { kind: 'prefix', value: '/code ', case_sensitive: false },
            target_adapter_id: adapterOptions[0]?.value ?? 'hermes',
          }}
          onSaved={(next) => {
            setRules([...(rules ?? []), next]);
            setAdding(false);
          }}
          onCancelNew={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setAdding(true)}
            data-testid="routing-rules-add"
          >
            <Icon icon={Plus} size="sm" />
            {t('settings.routing_rules.add')}
          </Button>
        </div>
      )}

      {/* Phase E · P4 — AI routing suggestions */}
      <div className="mt-4 rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={aiLoading}
            onClick={() => {
              setAiLoading(true);
              void learningSuggestRouting()
                .then(setAiSuggestions)
                .catch(() => setAiSuggestions([]))
                .finally(() => setAiLoading(false));
            }}
            data-testid="routing-ai-suggest"
          >
            <Icon icon={Wand2} size="sm" />
            {t('settings.routing_rules.ai_suggest')}
          </Button>
          {aiLoading && (
            <Icon icon={Loader2} size="sm" className="animate-spin text-fg-subtle" />
          )}
        </div>
        {aiSuggestions !== null && aiSuggestions.length === 0 && (
          <p className="mt-2 text-xs text-fg-subtle">
            {t('settings.routing_rules.ai_empty')}
          </p>
        )}
        {aiSuggestions && aiSuggestions.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {aiSuggestions.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded border border-border bg-bg-elev-2 px-3 py-2 text-xs"
              >
                <Icon icon={Brain} size="xs" className="mt-0.5 flex-none text-gold-500" />
                <div className="flex-1">
                  <p className="font-medium text-fg">{s.pattern}</p>
                  <p className="text-fg-subtle">{s.reason}</p>
                  <p className="mt-1 text-fg-muted">
                    {t('settings.routing_rules.ai_confidence')}: {Math.round(s.confidence * 100)}%
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function RoutingRuleRow({
  initial,
  isNew = false,
  adapterOptions,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  initial: RoutingRule;
  isNew?: boolean;
  adapterOptions: Array<{ value: string; label: string }>;
  onSaved: (next: RoutingRule) => void;
  onDeleted?: () => void;
  onCancelNew?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RoutingRule>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await routingRuleUpsert(draft);
      setDraft(saved);
      onSaved(saved);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!onDeleted) return;
    if (!window.confirm(t('settings.routing_rules.confirm_delete', { name: draft.name })))
      return;
    setSaving(true);
    try {
      await routingRuleDelete(draft.id);
      onDeleted();
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Helper: update a single field on the match predicate while
  // preserving the discriminant + case toggle.
  function setMatch(next: Partial<RoutingMatch>): void {
    setDraft({
      ...draft,
      match: { ...draft.match, ...next } as RoutingMatch,
    });
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border p-3',
        draft.enabled
          ? 'border-border bg-bg-elev-1'
          : 'border-border/50 bg-bg-elev-1/50',
      )}
      data-testid={`routing-rule-row-${initial.id || 'new'}`}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t('settings.routing_rules.field_id')}
          hint={t('settings.routing_rules.field_id_hint')}
        >
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none disabled:opacity-50"
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            placeholder="code-prefix"
            disabled={!isNew}
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.routing_rules.field_name')}>
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t('settings.routing_rules.field_name_placeholder')}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('settings.routing_rules.field_kind')}>
          <Select<RoutingMatch['kind']>
            value={draft.match.kind}
            onChange={(kind) => {
              setDraft({
                ...draft,
                match: {
                  kind,
                  value: draft.match.value,
                  case_sensitive: draft.match.case_sensitive,
                } as RoutingMatch,
              });
            }}
            options={[
              { value: 'prefix', label: t('settings.routing_rules.kind_prefix') },
              { value: 'contains', label: t('settings.routing_rules.kind_contains') },
              { value: 'regex', label: t('settings.routing_rules.kind_regex') },
            ]}
          />
        </Field>
        <Field label={t('settings.routing_rules.field_value')}>
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
            value={draft.match.value}
            onChange={(e) => setMatch({ value: e.target.value })}
            placeholder={
              draft.match.kind === 'regex' ? '^\\d{4}' : '/code '
            }
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.routing_rules.field_adapter')}>
          <Select
            value={draft.target_adapter_id}
            onChange={(v) => setDraft({ ...draft, target_adapter_id: v })}
            options={
              adapterOptions.length === 0
                ? [{ value: draft.target_adapter_id, label: draft.target_adapter_id }]
                : adapterOptions
            }
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          {t('settings.routing_rules.enabled')}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.match.case_sensitive === true}
            onChange={(e) => setMatch({ case_sensitive: e.target.checked })}
          />
          {t('settings.routing_rules.case_sensitive')}
        </label>
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isNew ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onCancelNew?.()}>
            {t('common.cancel')}
          </Button>
        ) : (
          onDeleted && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={saving}
            >
              <Icon icon={Trash2} size="sm" className="text-danger" />
              {t('common.delete')}
            </Button>
          )
        )}
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={onSave}
          disabled={
            saving ||
            !draft.id.trim() ||
            !draft.match.value.trim() ||
            !draft.target_adapter_id.trim()
          }
          data-testid={`routing-rule-save-${initial.id || 'new'}`}
        >
          {saving ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="sm" />
          )}
          {isNew ? t('settings.routing_rules.create') : t('settings.routing_rules.save')}
        </Button>
      </div>
    </li>
  );
}

// ───────────────────────── T6.5 — Sandbox scopes ─────────────────────────

/**
 * Manage named sandbox scopes. The `default` scope is always
 * present and can't be deleted, but other scopes can be
 * created/renamed/deleted. Roots per scope are not editable HERE —
 * the existing Workspace section still edits the default scope's
 * roots, and non-default scope roots are edited by clicking a scope
 * row which expands inline.
 *
 * Deliberately kept list-only with an inline create form; no modal
 * so the flow matches the Hermes instances section.
 */
function SandboxScopesSection() {
  const { t } = useTranslation();
  const [scopes, setScopes] = useState<SandboxScope[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const rows = await sandboxScopeList();
      setScopes(rows);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setScopes([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = newId.trim();
    const label = newLabel.trim() || id;
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sandboxScopeUpsert({ id, label, roots: [] });
      setNewId('');
      setNewLabel('');
      await refresh();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (busy) return;
    if (!window.confirm(t('settings.sandbox_scopes.confirm_delete', { id }))) return;
    setBusy(true);
    setError(null);
    try {
      await sandboxScopeDelete(id);
      await refresh();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      id="settings-scopes"
      title={t('settings.sandbox_scopes.title')}
      description={t('settings.sandbox_scopes.desc')}
    >
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {scopes === null ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          data-testid="sandbox-scopes-list"
        >
          {scopes.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs"
              data-testid={`sandbox-scope-row-${s.id}`}
            >
              <code className="rounded bg-bg-elev-3 px-1 py-0.5 font-mono text-[11px] text-fg">
                {s.id}
              </code>
              <span className="text-fg">{s.label}</span>
              <span className="ml-2 text-fg-subtle">
                {t('settings.sandbox_scopes.root_count', { count: s.roots.length })}
              </span>
              <div className="ml-auto">
                {s.id === 'default' ? (
                  <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    {t('settings.sandbox_scopes.default_locked')}
                  </span>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void onDelete(s.id)}
                    disabled={busy}
                    data-testid={`sandbox-scope-delete-${s.id}`}
                    aria-label={t('settings.sandbox_scopes.delete')}
                  >
                    <Icon icon={Trash2} size="xs" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create form — a simple inline flow to avoid yet another
          modal. New scopes start with an empty root list; users edit
          roots later (C3 / follow-up adds per-scope root editing). */}
      <form
        onSubmit={onCreate}
        className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
        data-testid="sandbox-scope-create-form"
      >
        <Field label={t('settings.sandbox_scopes.new_id')}>
          <input
            type="text"
            value={newId}
            onChange={(e) => setNewId(e.target.value.toLowerCase())}
            placeholder="worker"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
            spellCheck={false}
            data-testid="sandbox-scope-new-id"
          />
        </Field>
        <Field label={t('settings.sandbox_scopes.new_label')}>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('settings.sandbox_scopes.new_label_placeholder')}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            data-testid="sandbox-scope-new-label"
          />
        </Field>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={!newId.trim() || busy}
          data-testid="sandbox-scope-create"
        >
          <Icon icon={Plus} size="sm" />
          {t('settings.sandbox_scopes.add')}
        </Button>
      </form>
    </Section>
  );
}

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
      id="settings-storage"
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
            <Icon icon={Check} size="sm" className="text-emerald-500" />
            <span className="text-emerald-500">{t('settings.storage.copied')}</span>
          </>
        ) : (
          <>
            <Icon icon={Copy} size="sm" />
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

function BrowserLLMSection() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<BrowserLLMConfig>({ model: 'openai/gpt-4o-mini', api_key: '', base_url: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<Awaited<ReturnType<typeof browserDiagnose>> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  useEffect(() => {
    void browserConfigGet().then(setCfg).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await browserConfigSet(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={t('settings.browser_llm_title')}
      description={t('settings.browser_llm_desc')}
    >
      <div className="flex max-w-lg flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('settings.browser_llm_model')}</span>
          <Combobox
            value={cfg.model}
            onChange={(v) => setCfg({ ...cfg, model: v })}
            options={[
              { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
              { value: 'openai/gpt-4o', label: 'GPT-4o' },
              { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
              { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
              { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
              { value: 'ollama/llama3', label: 'Ollama Llama 3 (本地)' },
            ]}
            placeholder="选择模型或输入自定义名称"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('settings.browser_llm_api_key')}</span>
          <input
            type="password"
            className="flex h-8 w-full rounded-md border border-border bg-bg-elev-1 px-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-gold-500"
            value={cfg.api_key}
            onChange={(e) => setCfg({ ...cfg, api_key: e.target.value })}
            placeholder="sk-..."
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('settings.browser_llm_base_url')}</span>
          <input
            className="flex h-8 w-full rounded-md border border-border bg-bg-elev-1 px-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-gold-500"
            value={cfg.base_url}
            onChange={(e) => setCfg({ ...cfg, base_url: e.target.value })}
            placeholder="https://api.openai.com/v1（留空用默认）"
          />
        </label>

        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Icon icon={Loader2} size="xs" className="animate-spin" /> : <Icon icon={Save} size="xs" />}
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
          <Button
            variant="ghost"
            disabled={diagLoading}
            onClick={async () => {
              setDiagLoading(true);
              try { setDiag(await browserDiagnose()); } catch { setDiag(null); }
              setDiagLoading(false);
            }}
          >
            {diagLoading ? <Icon icon={Loader2} size="xs" className="animate-spin" /> : <Icon icon={Stethoscope} size="xs" />}
            {t('settings.browser_diag')}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <Icon icon={Check} size="xs" /> {t('settings.saved')}
            </span>
          )}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
        {diag && (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-elev-2 p-3 text-xs">
            <div className={diag.node_available ? 'text-green-500' : 'text-red-500'}>
              Node.js: {diag.node_available ? `✓ ${diag.node_version}` : '✗ 未找到'}
            </div>
            <div className={diag.runner_found ? 'text-green-500' : 'text-red-500'}>
              Browser Runner: {diag.runner_found ? '✓ 已找到' : '✗ 未找到'}
            </div>
            <div className={diag.browser_config_set ? 'text-green-500' : 'text-yellow-500'}>
              LLM 配置: {diag.browser_config_set ? '✓ 已设置' : '⚠ 未设置'}
            </div>
          </div>
        )}
      </div>
    </Section>
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
