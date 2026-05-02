import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Plus, Plug, RefreshCw } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import {
  hermesGatewayRestart,
  ipcErrorMessage,
  mcpServerDelete,
  mcpServerList,
  mcpServerUpsert,
  type McpServer,
} from '@/lib/ipc';

import { ServerForm } from './ServerForm';
import { ServerRow } from './ServerRow';
import { RECOMMENDED_MCPS } from './templates';

/**
 * Phase 7 · T7.1 — MCP server manager.
 *
 * GUI over the `mcp_servers:` section of `~/.hermes/config.yaml`.
 * Hermes forks each server (stdio) or connects over HTTP itself; we
 * ONLY edit the config. No sidecar process, no reachability probe at
 * the page level — per-row probe is offered for users who want to
 * sanity-check a single server, and the existing Trajectory pane shows
 * tool invocations once Hermes reloads.
 *
 * Schema is intentionally pass-through: `config` is the full opaque
 * JSON blob under `mcp_servers.<id>`. The form (in `ServerForm.tsx`)
 * surfaces the common fields (transport selector + command/args/env OR
 * url/headers, plus optional tools.include/exclude filters), and
 * stashes anything non-standard under a "raw JSON" textarea so
 * rare/new upstream fields aren't lost on round-trip.
 *
 * 2026-04-26 — extracted ServerRow / ServerForm / templates / transport
 * out of the original 868-line file. The route below keeps only list
 * orchestration (load/save/delete/restart) + the recommended-quick-add
 * affordance.
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
        <div className="m-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {servers === null ? (
          <div className="flex flex-1 items-center justify-center text-fg-subtle">
            <Icon icon={Loader2} size="md" className="animate-spin" />
          </div>
        ) : servers.length === 0 && editing?.mode !== 'new' ? (
          <div className="p-6">
            <EmptyState
              icon={Plug}
              title={t('mcp.empty_title')}
              description={t('mcp.empty_desc')}
            />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                  <Icon icon={Plug} size="md" />
                </span>
                <div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-500">{servers.length}</div>
                  <div className="text-[11px] text-fg-muted">{t('mcp.stat_total')}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-blue-500/25 bg-blue-500/[0.06] p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                  <Icon icon={Plug} size="md" />
                </span>
                <div>
                  <div className="text-2xl font-bold tabular-nums text-blue-500">{servers.filter((s) => s.config?.transport === 'stdio' || s.config?.command).length}</div>
                  <div className="text-[11px] text-fg-muted">Stdio</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                  <Icon icon={Plug} size="md" />
                </span>
                <div>
                  <div className="text-2xl font-bold tabular-nums text-violet-500">{servers.filter((s) => s.config?.transport === 'sse' || s.config?.url).length}</div>
                  <div className="text-[11px] text-fg-muted">SSE / HTTP</div>
                </div>
              </div>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="mcp-server-list">
              {servers.map((s) =>
                editing?.mode === 'edit' && editing.id === s.id ? (
                  <li key={s.id} className="sm:col-span-2 lg:col-span-3">
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
          </div>
        )}

        {editing?.mode === 'new' && (
          <div className="mx-auto w-full max-w-5xl px-6">
            <ServerForm
              initial={null}
              onSave={(next) => onSave(next, true)}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        {servers !== null && !editing && servers.length > 0 && (
          <div className="mx-auto w-full max-w-5xl px-6 pb-6">
            <div className="rounded-xl border border-dashed border-border/80 bg-bg-elev-1/40 p-4">
              <p className="mb-3 text-xs font-semibold tracking-wide text-fg">{t('mcp.recommended_title')}</p>
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
          </div>
        )}
      </div>
    </div>
  );
}

type Editing =
  | { mode: 'new' }
  | { mode: 'edit'; id: string };
