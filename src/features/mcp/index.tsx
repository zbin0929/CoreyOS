import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Globe,
  Loader2,
  Plus,
  Plug,
  RefreshCw,
  Save,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  hermesGatewayRestart,
  ipcErrorMessage,
  mcpServerDelete,
  mcpServerList,
  mcpServerProbe,
  mcpServerUpsert,
  type McpServer,
  type McpProbeResult,
} from '@/lib/ipc';

/**
 * Phase 7 · T7.1 — MCP server manager.
 *
 * GUI over the `mcp_servers:` section of `~/.hermes/config.yaml`.
 * Hermes forks each server (stdio) or connects over HTTP itself; we
 * ONLY edit the config. No sidecar process, no reachability probe
 * (doing it well means speaking the MCP handshake; doing it poorly
 * is worse than nothing). Users verify via the existing Trajectory
 * pane once Hermes reloads.
 *
 * Schema is intentionally pass-through: `config` is the full opaque
 * JSON blob under `mcp_servers.<id>`. The form surfaces the common
 * fields (transport selector + command/args/env OR url/headers, plus
 * optional tools.include/exclude filters), and stashes anything
 * non-standard under a "raw JSON" textarea so rare/new upstream
 * fields aren't lost on round-trip.
 */
export function McpRoute() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setServers(await mcpServerList());
    } catch (e) {
      setError(ipcErrorMessage(e));
      setServers([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onSave = useCallback(
    async (server: McpServer, wasNew: boolean) => {
      // Let the form keep the exception — it renders the error
      // inline next to the save button. The page-level banner is
      // reserved for list/delete/restart errors where the form
      // isn't mounted. `wasNew` is threaded through so future
      // telemetry can differ between create and update; today
      // both paths behave identically.
      void wasNew;
      await mcpServerUpsert(server);
      setEditing(null);
      setRestartHint(true);
      await reload();
    },
    [reload],
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t('mcp.confirm_delete', { id }))) return;
      try {
        await mcpServerDelete(id);
        setRestartHint(true);
        await reload();
      } catch (e) {
        setError(ipcErrorMessage(e));
      }
    },
    [reload, t],
  );

  const onRestart = useCallback(async () => {
    setRestarting(true);
    try {
      await hermesGatewayRestart();
      setRestartHint(false);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setRestarting(false);
    }
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('mcp.title')}
        subtitle={t('mcp.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void reload()}
              data-testid="mcp-refresh"
            >
              <Icon icon={RefreshCw} size="sm" />
              {t('common.refresh')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setEditing({ mode: 'new' })}
              data-testid="mcp-add"
              disabled={editing?.mode === 'new'}
            >
              <Icon icon={Plus} size="sm" />
              {t('mcp.add')}
            </Button>
          </div>
        }
      />

      {/* Restart-nudge banner. Appears after a save/delete until the
          user hits "Restart now" — identical visual vocabulary to the
          Channels page so users don't learn two different patterns. */}
      {restartHint && (
        <div
          className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/5 px-4 py-2 text-xs text-amber-500"
          data-testid="mcp-restart-hint"
        >
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <div className="flex-1">{t('mcp.restart_hint')}</div>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => void onRestart()}
            disabled={restarting}
            data-testid="mcp-restart-now"
          >
            {restarting ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={RefreshCw} size="xs" />
            )}
            {t('mcp.restart_now')}
          </Button>
        </div>
      )}

      {error && (
        <div className="m-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {servers === null ? (
          <div className="flex flex-1 items-center justify-center text-fg-subtle">
            <Icon icon={Loader2} size="md" className="animate-spin" />
          </div>
        ) : servers.length === 0 && editing?.mode !== 'new' ? (
          <EmptyState
            icon={Plug}
            title={t('mcp.empty_title')}
            description={t('mcp.empty_desc')}
          />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="mcp-server-list">
            {servers.map((s) =>
              editing?.mode === 'edit' && editing.id === s.id ? (
                <li key={s.id}>
                  <ServerForm
                    initial={s}
                    onSave={(next) => onSave(next, false)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <ServerRow
                  key={s.id}
                  server={s}
                  onEdit={() => setEditing({ mode: 'edit', id: s.id })}
                  onDelete={() => void onDelete(s.id)}
                />
              ),
            )}
          </ul>
        )}

        {editing?.mode === 'new' && (
          <ServerForm
            initial={null}
            onSave={(next) => onSave(next, true)}
            onCancel={() => setEditing(null)}
          />
        )}

        {/* Recommended MCP quick-add */}
        {servers !== null && !editing && (
          <div className="rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-3">
            <p className="mb-2 text-xs font-medium text-fg">{t('mcp.recommended_title')}</p>
            <div className="flex flex-wrap gap-2">
              {RECOMMENDED_MCPS.map((rec) => {
                const exists = servers.some((s) => s.id === rec.id);
                return (
                  <Button
                    key={rec.id}
                    type="button"
                    size="xs"
                    variant={exists ? 'ghost' : 'secondary'}
                    disabled={exists}
                    onClick={() => {
                      void mcpServerUpsert(rec.config).then(() => {
                        setRestartHint(true);
                        void reload();
                      });
                    }}
                  >
                    <Icon icon={Plug} size="xs" />
                    {rec.label}
                    {exists && ` ✓`}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type Editing =
  | { mode: 'new' }
  | { mode: 'edit'; id: string };

function ServerRow({
  server,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<McpProbeResult | null>(null);
  const transport = detectTransport(server.config);
  const summary =
    transport === 'stdio'
      ? [server.config.command, ...(Array.isArray(server.config.args) ? server.config.args : [])]
          .filter(Boolean)
          .join(' ')
      : String(server.config.url ?? '');
  return (
    <li
      className="flex items-center gap-3 rounded-lg border border-border bg-bg-elev-1 p-3"
      data-testid={`mcp-server-row-${server.id}`}
    >
      <Icon
        icon={transport === 'stdio' ? Terminal : Globe}
        size="sm"
        className="flex-none text-fg-muted"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="rounded bg-bg-elev-2 px-1.5 py-0.5 font-mono text-xs text-fg">
            {server.id}
          </code>
          <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
            {transport}
          </span>
        </div>
        <div
          className="mt-1 truncate font-mono text-[11px] text-fg-muted"
          title={summary}
        >
          {summary || t('mcp.no_command')}
        </div>
      </div>
      <Button
        size="xs"
        variant="ghost"
        onClick={onEdit}
        data-testid={`mcp-server-edit-${server.id}`}
      >
        {t('mcp.edit')}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={probing}
        onClick={() => {
          setProbing(true);
          setProbeResult(null);
          void mcpServerProbe(server.id)
            .then((r) => setProbeResult(r))
            .catch(() => setProbeResult(null))
            .finally(() => setProbing(false));
        }}
        aria-label={t('mcp.probe')}
        data-testid={`mcp-server-probe-${server.id}`}
      >
        {probing ? <Icon icon={Loader2} size="xs" className="animate-spin" /> : <Icon icon={Plug} size="xs" />}
      </Button>
      {probeResult && (
        <span className={cn('text-[10px]', probeResult.reachable ? 'text-green-500' : 'text-red-500')}>
          {probeResult.reachable
            ? probeResult.latency_ms != null ? `${probeResult.latency_ms}ms` : '✓'
            : probeResult.error ?? 'unreachable'}
        </span>
      )}
      <Button
        size="xs"
        variant="ghost"
        onClick={onDelete}
        aria-label={t('mcp.delete')}
        data-testid={`mcp-server-delete-${server.id}`}
      >
        <Icon icon={Trash2} size="xs" />
      </Button>
    </li>
  );
}

type Transport = 'stdio' | 'url';

function detectTransport(config: Record<string, unknown>): Transport {
  if (typeof config.url === 'string') return 'url';
  return 'stdio';
}

function ServerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: McpServer | null;
  onSave: (server: McpServer) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isNew = initial === null;
  const [id, setId] = useState(initial?.id ?? '');
  const [transport, setTransport] = useState<Transport>(
    initial ? detectTransport(initial.config) : 'stdio',
  );
  // Serialise the config as prettified JSON for a free-form edit
  // surface. Advanced users get precise control; beginners pick the
  // transport and only fill in the two or three obvious fields.
  const [raw, setRaw] = useState<string>(
    initial
      ? JSON.stringify(initial.config, null, 2)
      : JSON.stringify(defaultConfig(transport), null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the user toggles transport on a NEW entry, swap the starter
  // JSON. On an EDIT we keep whatever the user was editing — toggling
  // transport shouldn't silently destroy field values they'd typed.
  const onTransportChange = (next: Transport) => {
    setTransport(next);
    if (isNew) setRaw(JSON.stringify(defaultConfig(next), null, 2));
  };

  // "Start from a common server" quick-fill. Only shown on NEW so
  // users don't accidentally wipe an edit-in-progress. Picking a
  // template sets both the transport AND the body; the id field is
  // left for the user to customise.
  const [pickedTemplateKey, setPickedTemplateKey] = useState<string>('');
  const pickedTemplate = useMemo(
    () => TEMPLATES.find((t) => t.key === pickedTemplateKey) ?? null,
    [pickedTemplateKey],
  );
  const onTemplatePick = (key: string) => {
    setPickedTemplateKey(key);
    const tpl = TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    setTransport(tpl.transport);
    setRaw(JSON.stringify(tpl.config, null, 2));
    if (!id.trim()) setId(tpl.suggestedId);
  };

  const parseError = useMemo(() => {
    try {
      const v = JSON.parse(raw);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return t('mcp.form_error_must_be_object');
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [raw, t]);

  const idError = useMemo(() => {
    const trimmed = id.trim();
    if (!trimmed) return t('mcp.form_error_id_required');
    if (trimmed.includes('.')) return t('mcp.form_error_id_dots');
    return null;
  }, [id, t]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (parseError || idError || saving) return;
    setSaving(true);
    setError(null);
    try {
      const config = JSON.parse(raw) as Record<string, unknown>;
      await onSave({ id: id.trim(), config });
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4"
      data-testid="mcp-server-form"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">
          {isNew ? t('mcp.form_title_new') : t('mcp.form_title_edit', { id: initial!.id })}
        </h3>
        <Button
          size="xs"
          variant="ghost"
          type="button"
          onClick={onCancel}
          aria-label={t('common.cancel')}
        >
          <Icon icon={X} size="xs" />
        </Button>
      </div>

      {/* Template quick-fill — only offered for NEW servers so an
          accidental click on an edit form can't wipe the user's
          in-progress JSON. "—" is the no-op placeholder. When a
          template with a description/setupUrl is picked, surface
          those inline so users know what they just selected. */}
      {isNew && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">{t('mcp.form_template')}</span>
          <Select<string>
            value={pickedTemplateKey}
            onChange={(v) => v && onTemplatePick(v)}
            options={[
              { value: '', label: t('mcp.form_template_placeholder') },
              ...TEMPLATES.map((tpl) => ({ value: tpl.key, label: tpl.label })),
            ]}
            ariaLabel={t('mcp.form_template')}
            data-testid="mcp-form-template"
          />
          {pickedTemplate?.description ? (
            <span
              className="text-[11px] text-fg-subtle"
              data-testid="mcp-form-template-description"
            >
              {pickedTemplate.description}
              {pickedTemplate.setupUrl && (
                <>
                  {' '}
                  <a
                    href={pickedTemplate.setupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                    data-testid="mcp-form-template-docs"
                  >
                    ↗ docs
                  </a>
                </>
              )}
            </span>
          ) : (
            <span className="text-[11px] text-fg-subtle">
              {t('mcp.form_template_hint')}
            </span>
          )}
          {pickedTemplate?.nousBundledHint && (
            <span
              className="mt-1 inline-flex items-start gap-1 rounded border border-accent/30 bg-accent/5 px-2 py-1 text-[11px] text-accent"
              data-testid="mcp-form-nous-hint"
            >
              <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
              <span>{t('mcp.form_nous_bundled_hint')}</span>
            </span>
          )}
        </label>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="flex flex-col gap-1 text-xs">
          <span className="inline-flex items-center gap-1 text-fg-muted">
            {t('mcp.form_id')}
            <InfoHint
              title={t('mcp.form_id')}
              content={t('mcp.help_id')}
              testId="mcp-help-id"
            />
          </span>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="project_fs"
            readOnly={!isNew}
            className={cn(
              'rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none',
              !isNew && 'cursor-not-allowed opacity-60',
            )}
            spellCheck={false}
            data-testid="mcp-form-id"
          />
          {isNew ? (
            idError && <span className="text-[11px] text-danger">{idError}</span>
          ) : (
            <span className="text-[11px] text-fg-subtle">{t('mcp.form_id_locked')}</span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="inline-flex items-center gap-1 text-fg-muted">
            {t('mcp.form_transport')}
            <InfoHint
              title={t('mcp.form_transport')}
              content={t('mcp.help_transport')}
              testId="mcp-help-transport"
            />
          </span>
          <Select<Transport>
            value={transport}
            onChange={onTransportChange}
            options={[
              { value: 'stdio', label: t('mcp.transport_stdio') },
              { value: 'url', label: t('mcp.transport_url') },
            ]}
            ariaLabel={t('mcp.form_transport')}
            data-testid="mcp-form-transport"
          />
          <span className="text-[11px] text-fg-subtle">
            {transport === 'stdio'
              ? t('mcp.transport_stdio_hint')
              : t('mcp.transport_url_hint')}
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">{t('mcp.form_config')}</span>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={12}
          spellCheck={false}
          className="resize-y rounded-md border border-border bg-bg p-2 font-mono text-[11px] text-fg focus:border-accent focus:outline-none"
          data-testid="mcp-form-config"
        />
        {parseError && (
          <span className="text-[11px] text-danger">{parseError}</span>
        )}
      </label>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={!!parseError || !!idError || saving}
          data-testid="mcp-form-save"
        >
          {saving ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="sm" />
          )}
          {t('mcp.save')}
        </Button>
      </div>
    </form>
  );
}

/** Starter JSON for a fresh server. Kept intentionally skeletal so
 *  the user sees an obvious "fill me in" shape rather than a long
 *  commented template. Real examples live in the upstream Hermes MCP
 *  docs the subtitle links to. */
function defaultConfig(transport: Transport): Record<string, unknown> {
  if (transport === 'url') {
    return {
      url: 'https://mcp.example.com',
      headers: {},
    };
  }
  return {
    command: 'npx',
    args: [],
  };
}

/**
 * Ready-to-tweak templates for common MCP servers. Picking one fills
 * transport + config + (if the id field is empty) suggests an id;
 * the user still has to fill in tokens / paths before saving.
 * Sources are the ones documented at
 * hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes.
 */
interface Template {
  key: string;
  label: string;
  transport: Transport;
  suggestedId: string;
  config: Record<string, unknown>;
  /** Optional one-liner shown under the picker when this template
   *  is selected. Used to explain vendor-specific quirks (API key
   *  quota, setup steps) without bloating the main copy. */
  description?: string;
  /** Vendor console / docs URL. Rendered as a small "↗ docs" link
   *  next to the description so users can land on the API-key page
   *  in one click. */
  setupUrl?: string;
  /** Hermes v0.10.0+ bundles web search (Firecrawl), image gen, TTS,
   *  and browser automation for Nous Portal subscribers. When set, the
   *  picker shows a small "you may not need this" hint so paying users
   *  don't double-configure. */
  nousBundledHint?: boolean;
}

const TEMPLATES: readonly Template[] = [
  {
    key: 'filesystem',
    label: 'Filesystem (project-local)',
    transport: 'stdio',
    suggestedId: 'project_fs',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/project'],
    },
  },
  {
    key: 'github',
    label: 'GitHub',
    transport: 'stdio',
    suggestedId: 'github',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_…' },
      tools: { include: ['list_issues', 'create_issue', 'search_code'] },
    },
  },
  {
    key: 'stripe',
    label: 'Stripe (URL + read-only)',
    transport: 'url',
    suggestedId: 'stripe',
    config: {
      url: 'https://mcp.stripe.com',
      headers: { Authorization: 'Bearer sk_…' },
      tools: { exclude: ['delete_customer', 'refund_payment'] },
    },
  },
  {
    key: 'puppeteer',
    label: 'Puppeteer (headless browser)',
    transport: 'stdio',
    suggestedId: 'browser',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
  // ─────────── Web search providers (T9 one-click) ───────────
  //
  // Give the agent the ability to search the live web. All five
  // below are first-party or well-maintained community MCP servers
  // exposing one or two tools that return structured search results
  // (title + url + snippet), which Hermes calls transparently when
  // the LLM decides a query needs web context.
  //
  // Cost / free-tier shape is mentioned in the description so users
  // don't sign up blind. Setup URLs point straight at the console's
  // API-key page — no hunting through marketing copy.
  {
    key: 'brave-search',
    label: 'Brave Search (web_search)',
    transport: 'stdio',
    suggestedId: 'brave_search',
    description:
      'Web + local search via Brave. Free tier: 2000 queries/month; API key at brave.com/search/api.',
    setupUrl: 'https://brave.com/search/api/',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: 'BSA…' },
    },
  },
  {
    key: 'tavily-search',
    label: 'Tavily Search (AI-native)',
    transport: 'stdio',
    suggestedId: 'tavily',
    description:
      'AI-optimised search with citations. Free tier: 1000 queries/month; key at app.tavily.com.',
    setupUrl: 'https://app.tavily.com/',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', 'tavily-mcp'],
      env: { TAVILY_API_KEY: 'tvly-…' },
    },
  },
  {
    key: 'duckduckgo-search',
    label: 'DuckDuckGo Search (no key)',
    transport: 'stdio',
    suggestedId: 'ddg',
    description:
      'Free unlimited search via DuckDuckGo — no API key required, but rate-limited on their side.',
    setupUrl: 'https://github.com/nickclyde/duckduckgo-mcp-server',
    nousBundledHint: true,
    config: {
      command: 'uvx',
      args: ['duckduckgo-mcp-server'],
    },
  },
  {
    key: 'perplexity-search',
    label: 'Perplexity Sonar (search + answer)',
    transport: 'stdio',
    suggestedId: 'perplexity',
    description:
      'Ask-and-answer combo — searches and summarises in one call. Paid only; key at perplexity.ai/settings/api.',
    setupUrl: 'https://www.perplexity.ai/settings/api',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', '@chatmcp/server-perplexity-ask'],
      env: { PERPLEXITY_API_KEY: 'pplx-…' },
    },
  },
  {
    key: 'serper-search',
    label: 'Serper (Google results)',
    transport: 'stdio',
    suggestedId: 'serper',
    description:
      'Google search results via Serper. Free tier: 2500 queries trial; key at serper.dev.',
    setupUrl: 'https://serper.dev/',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', 'serper-search-scrape-mcp-server'],
      env: { SERPER_API_KEY: '' },
    },
  },
  // ─────────── Other high-value community MCP servers ───────────
  {
    key: 'fetch',
    label: 'Fetch (URL → text)',
    transport: 'stdio',
    suggestedId: 'fetch',
    description:
      'Download a URL and convert to Markdown. Useful alongside a search server — the agent searches, then fetches the top link.',
    config: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
  },
  {
    key: 'memory',
    label: 'Memory (knowledge graph)',
    transport: 'stdio',
    suggestedId: 'memory',
    description:
      'Persistent knowledge graph the agent can write to and query across sessions — complements Hermes\u2019 MEMORY.md for structured facts.',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
];

const RECOMMENDED_MCPS: { id: string; label: string; config: McpServer }[] = [
  {
    id: 'fetch',
    label: 'Fetch',
    config: {
      id: 'fetch',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
    },
  },
  {
    id: 'filesystem',
    label: 'Filesystem',
    config: {
      id: 'filesystem',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
      },
    },
  },
  {
    id: 'memory',
    label: 'Memory',
    config: {
      id: 'memory',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    },
  },
  {
    id: 'ddg',
    label: 'DuckDuckGo',
    config: {
      id: 'ddg',
      config: { command: 'uvx', args: ['duckduckgo-mcp-server'] },
    },
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    config: {
      id: 'sqlite',
      config: { command: 'uvx', args: ['mcp-server-sqlite', '--db-path', '~/.hermes/state.db'] },
    },
  },
];
