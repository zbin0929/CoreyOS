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
        {probing ? (
          <Icon icon={Loader2} size="xs" className="animate-spin" />
        ) : (
          <Icon icon={Plug} size="xs" />
        )}
      </Button>
      {probeResult && (
        <span
          className={cn('text-[10px]', probeResult.reachable ? 'text-green-500' : 'text-red-500')}
        >
          {probeResult.reachable
            ? probeResult.latency_ms != null
              ? `${probeResult.latency_ms}ms`
              : '✓'
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
