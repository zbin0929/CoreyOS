import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Circle } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

import { useDashboard } from '../useDashboard';
import { WidgetCard } from './shared';

export function SystemStatusWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gateway, hermes, mcpServers, activeCronJobs } = useDashboard();
  const isOnline = gateway === 'online';

  const items = [
    {
      key: 'gateway',
      ok: isOnline,
      title: 'Gateway',
      detail: isOnline ? t('home.status_online') : t('home.status_offline'),
      to: '/settings' as const,
    },
    {
      key: 'hermes',
      ok: hermes?.installed ?? false,
      title: 'Hermes',
      detail: hermes?.installed
        ? hermes?.version_parsed
          ? `v${hermes.version_parsed.join('.')}`
          : t('home.status_online')
        : t('home.status_offline'),
      to: '/settings' as const,
    },
    {
      key: 'mcp',
      ok: mcpServers.length > 0,
      title: 'MCP',
      detail:
        mcpServers.length > 0
          ? `${mcpServers.length} ${t('home.status_connected')}`
          : t('home.status_offline'),
      to: '/mcp' as const,
    },
    {
      key: 'cron',
      ok: activeCronJobs.length > 0,
      title: 'Cron',
      detail:
        activeCronJobs.length > 0
          ? `${activeCronJobs.length} ${t('home.status_active')}`
          : t('home.status_offline'),
      to: '/scheduler' as const,
    },
  ];
  const activeRisks = items.filter((i) => !i.ok);

  return (
    <WidgetCard id="system_status" title={t('home.system_overview')}>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => void navigate({ to: item.to })}
            className="flex items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left transition-all duration-200 hover:bg-[var(--glass-bg-hover)]"
          >
            <span
              className={cn(
                'relative flex h-5 w-5 items-center justify-center',
                item.ok && 'drop-shadow-[0_0_4px_hsl(155_80%_50%/0.5)]',
              )}
            >
              <Icon
                icon={item.ok ? CheckCircle2 : Circle}
                size="xs"
                className={item.ok ? 'text-emerald-500' : 'text-fg-subtle'}
              />
              {item.ok && (
                <span
                  className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20"
                  style={{ animationDuration: '3s' }}
                />
              )}
            </span>
            <span className="text-sm text-fg">{item.title}</span>
            <span className="ml-auto font-mono text-[11px] text-fg-muted">
              {item.detail}
            </span>
          </button>
        ))}
      </div>
      {activeRisks.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning">
          {activeRisks.length} {t('home.status_offline')}
        </div>
      )}
    </WidgetCard>
  );
}
