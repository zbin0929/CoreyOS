import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Check,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  Sun,
  Trash2,
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
import { useUIStore, type Theme } from '@/stores/ui';
import { supportedLngs, type Lang } from '@/lib/i18n';
import {
  appPaths,
  configGet,
  configSet,
  configTest,
  hermesInstanceDelete,
  hermesInstanceList,
  hermesInstanceTest,
  hermesInstanceUpsert,
  ipcErrorMessage,
  routingRuleDelete,
  routingRuleUpsert,
  sandboxScopeDelete,
  sandboxScopeList,
  sandboxScopeUpsert,
  type AppPaths,
  type GatewayConfigDto,
  type HermesInstance,
  type HermesInstanceProbeResult,
  type RoutingMatch,
  type RoutingRule,
  type SandboxScope,
} from '@/lib/ipc';
import { AgentWizard } from './AgentWizard';
import { useAgentsStore } from '@/stores/agents';
import { useRoutingStore } from '@/stores/routing';
import { PROVIDER_TEMPLATES } from '@/features/settings/providerTemplates';

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

      <div className="min-h-0 flex-1 overflow-y-auto">
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
// T8 — exported so the new top-level /agents route can render the
// exact same list without duplicating logic. Note: this still uses the
// Settings-style `Section` header so page visuals stay consistent when
// wrapped in either context.
export function HermesInstancesSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HermesInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // T8 — guided wizard. Opens a drawer with provider templates
  // (OpenAI / Anthropic / DeepSeek / Ollama / …) pre-filling base_url
  // + API-key env var so non-engineer users don't have to know any
  // of those by heart. The "Add instance" button below still works
  // as the power-user escape hatch.
  const [wizardOpen, setWizardOpen] = useState(false);
  // T6.5 — scopes are loaded here so every row's dropdown sees the
  // same snapshot. Section-scoped rather than route-scoped so the
  // scope section can refresh independently.
  const [scopes, setScopes] = useState<SandboxScope[]>([]);

  async function refresh() {
    setError(null);
    try {
      const [instResp, scopeResp] = await Promise.all([
        hermesInstanceList(),
        sandboxScopeList().catch(() => [] as SandboxScope[]),
      ]);
      setRows(instResp.instances);
      setScopes(scopeResp);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setRows([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Section
      title={t('settings.hermes_instances.title')}
      description={t('settings.hermes_instances.desc')}
    >
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
      ) : (
        <ul className="flex flex-col gap-2" data-testid="hermes-instances-list">
          {rows.map((r) => (
            <HermesInstanceRow
              key={r.id}
              initial={r}
              scopes={scopes}
              onSaved={async (next) => {
                setRows((prev) =>
                  (prev ?? []).map((p) => (p.id === next.id ? next : p)),
                );
              }}
              onDeleted={async () => {
                setRows((prev) => (prev ?? []).filter((p) => p.id !== r.id));
              }}
            />
          ))}
          {rows.length === 0 && !adding && (
            <div className="rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-4 text-center text-xs text-fg-subtle">
              {t('settings.hermes_instances.empty')}
            </div>
          )}
        </ul>
      )}

      {adding ? (
        <HermesInstanceRow
          initial={{
            id: '',
            label: '',
            base_url: 'http://127.0.0.1:8642',
            api_key: null,
            default_model: null,
            sandbox_scope_id: null,
          }}
          isNew
          scopes={scopes}
          onSaved={async (next) => {
            setRows((prev) => [...(prev ?? []), next]);
            setAdding(false);
          }}
          onCancelNew={() => setAdding(false)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => setWizardOpen(true)}
            data-testid="hermes-instances-quick-add"
          >
            <Icon icon={Plus} size="sm" />
            {t('settings.hermes_instances.quick_add')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            // Refetch the scope list on each "Add instance" click so
            // a scope created just now in `SandboxScopesSection` is
            // visible in the new row's dropdown without needing a
            // full page reload.
            onClick={() => {
              void sandboxScopeList()
                .then((next) => setScopes(next))
                .catch(() => {
                  /* leave the cached snapshot in place */
                });
              setAdding(true);
            }}
            data-testid="hermes-instances-add"
          >
            {t('settings.hermes_instances.add_advanced')}
          </Button>
        </div>
      )}

      <AgentWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        existingIds={(rows ?? []).map((r) => r.id)}
        onCreated={async (next) => {
          setRows((prev) => [...(prev ?? []), next]);
        }}
      />
    </Section>
  );
}

/**
 * One editable row. Maintains local draft state + probe/save status.
 * `isNew` switches the action buttons so an empty, never-saved row
 * offers "Save" + "Cancel" rather than "Save" + "Delete".
 */
function HermesInstanceRow({
  initial,
  isNew = false,
  scopes,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  initial: HermesInstance;
  isNew?: boolean;
  /** T6.5 — snapshot of all known sandbox scopes. Kept a prop
   *  (not a hook call) so the parent section controls refresh
   *  timing and every row sees the same list. */
  scopes: SandboxScope[];
  onSaved: (next: HermesInstance) => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onCancelNew?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<HermesInstance>(initial);
  const [showKey, setShowKey] = useState(false);
  const [probe, setProbe] = useState<HermesInstanceProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onTest() {
    setProbing(true);
    setErr(null);
    try {
      const r = await hermesInstanceTest(draft);
      setProbe(r);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setProbing(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await hermesInstanceUpsert(draft);
      setDraft(saved);
      await onSaved(saved);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Two-click delete: `window.confirm` is unreliable inside the Tauri
  // WebView on some platforms (user reports the dialog never appears
  // and the row is gone), so we arm-then-fire in the UI instead. The
  // armed state auto-expires after 3s so a stray click doesn't leave
  // the button in a destructive mode.
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
      await hermesInstanceDelete(draft.id);
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
      data-testid={`hermes-instance-row-${initial.id || 'new'}`}
    >
      <div className="flex items-center gap-2">
        <Icon icon={Server} size="sm" className="text-fg-subtle" />
        <span className="text-sm font-medium text-fg">
          {draft.label.trim() || draft.id || t('settings.hermes_instances.new_row')}
        </span>
        {!isNew && (
          <code className="rounded bg-bg-elev-3 px-1 py-0.5 text-[10px] text-fg-muted">
            hermes:{initial.id}
          </code>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t('settings.hermes_instances.field_id')}
          hint={t('settings.hermes_instances.field_id_hint')}
        >
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none disabled:opacity-50"
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            placeholder="work"
            disabled={!isNew}
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.hermes_instances.field_label')}>
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder={t('settings.hermes_instances.field_label_placeholder')}
          />
        </Field>
      </div>

      <Field label={t('settings.hermes_instances.field_base_url')}>
        <input
          type="url"
          className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
          value={draft.base_url}
          onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
          placeholder="http://127.0.0.1:8642"
          spellCheck={false}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('settings.hermes_instances.field_api_key')}>
          <div className="flex items-center gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
              value={draft.api_key ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, api_key: e.target.value || null })
              }
              placeholder={t('settings.hermes_instances.field_api_key_placeholder')}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowKey((v) => !v)}
              aria-label={
                showKey
                  ? t('settings.gateway.hide_key')
                  : t('settings.gateway.show_key')
              }
            >
              <Icon icon={showKey ? EyeOff : Eye} size="sm" />
            </Button>
          </div>
        </Field>
        <Field
          label={t('settings.hermes_instances.field_default_model')}
          hint={t('settings.hermes_instances.field_default_model_hint')}
        >
          {/* datalist-backed input: user gets dropdown suggestions
              from the matched provider template but can still type a
              fine-tune / brand-new model id. We match by base_url
              prefix (strip trailing /v1) so e.g. `https://api.openai
              .com/v1` → the OpenAI template's suggestedModels. */}
          {(() => {
            const tpl = PROVIDER_TEMPLATES.find((p) =>
              draft.base_url
                ? draft.base_url.startsWith(p.baseUrl.replace(/\/v1\/?$/, ''))
                : false,
            );
            const suggestions = tpl?.suggestedModels ?? [];
            const listId = `hermes-instance-model-${initial.id || 'new'}-list`;
            return (
              <>
                <input
                  type="text"
                  list={listId}
                  className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
                  value={draft.default_model ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      default_model: e.target.value || null,
                    })
                  }
                  placeholder={
                    suggestions[0] ??
                    t('settings.hermes_instances.field_default_model_placeholder')
                  }
                  spellCheck={false}
                  data-testid={`hermes-instance-model-${initial.id || 'new'}`}
                />
                {suggestions.length > 0 && (
                  <datalist id={listId}>
                    {suggestions.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                )}
              </>
            );
          })()}
        </Field>
      </div>

      {/* T6.5 — sandbox scope picker. `null` value on the wire means
          "use the default scope", which matches how legacy instances
          (pre-T6.5) resolved; the row stores `null` in draft for
          that option so save() round-trips cleanly. */}
      <Field
        label={t('settings.hermes_instances.field_sandbox_scope')}
        hint={t('settings.hermes_instances.field_sandbox_scope_hint')}
      >
        {/* appearance-none kills the macOS native bevel so the
            select matches our other inputs; the chevron is painted
            via a background SVG so keyboard + screen-reader
            semantics stay on the <select>. */}
        <select
          className={cn(
            'appearance-none rounded-md border border-border bg-bg bg-no-repeat py-1.5 pl-2 pr-7 text-sm text-fg',
            'focus:border-accent focus:outline-none focus:ring-2 focus:ring-gold-500/40',
            "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 20 20%22 stroke=%22currentColor%22><path stroke-linecap=%22round%22 stroke-linejoin=%22round%22 stroke-width=%222%22 d=%22M6 8l4 4 4-4%22/></svg>')] bg-[length:16px_16px] bg-[right_6px_center]",
          )}
          value={draft.sandbox_scope_id ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            setDraft({
              ...draft,
              sandbox_scope_id: val === '' ? null : val,
            });
          }}
          data-testid={`hermes-instance-scope-${initial.id || 'new'}`}
        >
          <option value="">
            {t('settings.hermes_instances.scope_default')}
          </option>
          {scopes
            .filter((s) => s.id !== 'default')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.id})
              </option>
            ))}
        </select>
      </Field>

      {/* Probe result */}
      {probe && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border p-2 text-xs',
            probe.ok
              ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500'
              : 'border-danger/40 bg-danger/5 text-danger',
          )}
        >
          <Icon
            icon={probe.ok ? CheckCircle2 : AlertCircle}
            size="xs"
            className="mt-0.5 flex-none"
          />
          <span className="break-all">
            {probe.ok
              ? t('settings.hermes_instances.test_ok', { ms: probe.latency_ms })
              : probe.body}
          </span>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onTest}
          disabled={probing || !draft.base_url.trim()}
        >
          {probing ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Wifi} size="sm" />
          )}
          {t('settings.hermes_instances.test')}
        </Button>
        {isNew ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onCancelNew?.()}
          >
            {t('common.cancel')}
          </Button>
        ) : (
          onDeleted && (
            <Button
              type="button"
              size="sm"
              variant={deleteArmed ? 'danger' : 'ghost'}
              onClick={onDelete}
              disabled={saving}
              title={deleteArmed ? undefined : draft.label || draft.id}
            >
              <Icon icon={Trash2} size="sm" className={deleteArmed ? undefined : 'text-danger'} />
              {deleteArmed
                ? t('common.confirm_delete', { name: draft.label || draft.id })
                : t('common.delete')}
            </Button>
          )
        )}
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={onSave}
          disabled={saving || !draft.id.trim() || !draft.base_url.trim()}
          data-testid={`hermes-instance-save-${initial.id || 'new'}`}
        >
          {saving ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="sm" />
          )}
          {isNew
            ? t('settings.hermes_instances.create')
            : t('settings.hermes_instances.save')}
        </Button>
      </div>
    </li>
  );
}

// ───────────────────────── Routing rules (T6.4) ─────────────────────────

/**
 * T6.4 — rules-based routing. Each rule maps a predicate on the
 * composed message text to an `adapter_id`. Evaluated at send time in
 * file order; first enabled match wins. See `src/features/chat/routing.ts`
 * for the pure resolver.
 *
 * This panel is the ONLY write path — the Composer + AgentSwitcher are
 * read-only consumers via the zustand store hydrated in `providers.tsx`.
 * Every upsert/delete pushes the new list into the store so the
 * composer pill updates without a page reload.
 */
function RoutingRulesSection() {
  const { t } = useTranslation();
  const rules = useRoutingStore((s) => s.rules);
  const setRules = useRoutingStore((s) => s.setRules);
  const hydrate = useRoutingStore((s) => s.hydrate);
  const adapters = useAgentsStore((s) => s.adapters);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (rules === null) void hydrate();
  }, [rules, hydrate]);

  const adapterOptions = (adapters ?? []).map((a) => ({
    value: a.id,
    label: a.name ? `${a.name} (${a.id})` : a.id,
  }));

  return (
    <Section
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
          {themes.map(({ value, label, icon: IconCmp }) => {
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
                <Icon icon={IconCmp} size="sm" />
                {label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t('settings.appearance.language')}>
        <div className="max-w-[200px]">
          <Select<Lang>
            value={currentLang}
            onChange={(v) => void i18n.changeLanguage(v)}
            data-testid="settings-lang"
            ariaLabel={t('settings.appearance.language')}
            options={[
              { value: 'en', label: t('settings.appearance.lang_en') },
              { value: 'zh', label: t('settings.appearance.lang_zh') },
            ]}
          />
        </div>
      </Field>
    </Section>
  );
}

// ───────────────────────── Storage ─────────────────────────

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
