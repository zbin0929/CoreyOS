import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Loader2, Plug, Terminal, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { mcpServerProbe, type McpProbeResult, type McpServer } from '@/lib/ipc';

import { detectTransport } from './transport';

/**
 * One row per configured MCP server. Surfaces the transport icon, the
 * id + transport label, a truncated command/url summary, and three
 * actions: edit, probe (URL HEAD / stdio `which`), delete.
 *
 * Probe state is row-local — no global cache — because probes are
 * cheap, change frequently, and showing a stale tick on a server that
 * just went offline would be worse than re-probing on demand.
 */
export function ServerRow({
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
      className="group flex flex-col gap-3 rounded-xl border border-border bg-bg-elev-1/70 p-4 shadow-[var(--shadow-1)] transition-all hover:border-gold-500/30 hover:shadow-md"
      data-testid={`mcp-server-row-${server.id}`}
    >
      <div className="flex items-start gap-3">
        <span className={cn(
          'flex h-9 w-9 flex-none items-center justify-center rounded-lg',
          transport === 'stdio' ? 'bg-blue-500/10 text-blue-500' : 'bg-violet-500/10 text-violet-500',
        )}>
          <Icon icon={transport === 'stdio' ? Terminal : Globe} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <code className="font-mono text-sm font-semibold text-fg">{server.id}</code>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
              {transport}
            </span>
            {probeResult && (
              <span className={cn('text-[10px] font-medium', probeResult.reachable ? 'text-emerald-500' : 'text-red-500')}>
                {probeResult.reachable
                  ? probeResult.latency_ms != null ? `${probeResult.latency_ms}ms` : '✓'
                  : probeResult.error ?? 'unreachable'}
              </span>
            )}
          </div>
        </div>
      </div>
      <div
        className="truncate rounded-lg bg-bg-elev-2/60 px-2.5 py-1.5 font-mono text-[11px] text-fg-muted"
        title={summary}
      >
        {summary || t('mcp.no_command')}
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="xs" variant="secondary" onClick={onEdit} data-testid={`mcp-server-edit-${server.id}`}>
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
        <Button
          size="xs"
          variant="ghost"
          onClick={onDelete}
          aria-label={t('mcp.delete')}
          data-testid={`mcp-server-delete-${server.id}`}
          className="ml-auto text-fg-subtle hover:text-danger"
        >
          <Icon icon={Trash2} size="xs" />
        </Button>
      </div>
    </li>
  );
}
