import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Loader2,
  MessageSquare,
  Package,
  Plug,
  Radio,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CoreyMark } from '@/components/ui/corey-mark';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useAppStatusStore } from '@/stores/appStatus';
import { FirstRunModal } from './FirstRunModal';
import { HermesInstallCard } from './HermesInstallCard';
import { PresetCard } from './PresetCard';
import { useDashboard } from './useDashboard';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function HomeRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const refreshGateway = useAppStatusStore((s) => s.refreshGateway);

  const {
    gateway,
    hermes,
    todayMessages,
    todayTokens,
    totalSessions,
    recentSessions,
    activeCronJobs,
    mcpServers,
    loading,
  } = useDashboard();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <FirstRunModal />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
        {/* Header row */}
        <div className="flex items-center gap-4">
          <CoreyMark className="h-10 w-10 shadow-md ring-1 ring-white/10" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-fg">
              CoreyOS
            </h1>
            <p className="text-xs text-fg-muted">{t('home.dashboard_subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshGateway()}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                gateway === 'online'
                  ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500 hover:bg-emerald-500/10'
                  : gateway === 'offline'
                    ? 'border-danger/40 bg-danger/5 text-danger hover:bg-danger/10'
                    : 'border-border bg-bg-elev-1 text-fg-muted hover:bg-bg-elev-2',
              )}
            >
              <Icon icon={gateway === 'online' ? Wifi : WifiOff} size="xs" />
              {gateway === 'online'
                ? t('home.gateway_online')
                : gateway === 'offline'
                  ? t('home.gateway_offline')
                  : t('home.gateway_unknown')}
            </button>
          </div>
        </div>

        {/* Install prompt — only when Hermes not detected */}
        {hermes && !hermes.installed && <HermesInstallCard />}

        {/* Starter content — auto-hides once skills are installed */}
        <PresetCard />

        {loading && (
          <div className="flex items-center justify-center py-12 text-fg-muted">
            <Icon icon={Loader2} size="lg" className="animate-spin" />
          </div>
        )}

        {!loading && (
          <>
            {/* Onboarding quick-start — shown when system is empty */}
            {totalSessions === 0 && gateway !== 'online' && (
              <section className="flex flex-col gap-3 rounded-lg border border-gold-500/30 bg-gold-500/[0.04] p-4">
                <h2 className="text-sm font-semibold text-fg">{t('home.quick_start_title')}</h2>
                <p className="text-xs text-fg-muted">{t('home.quick_start_desc')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => void navigate({ to: '/settings' })}>
                    <Icon icon={Radio} size="xs" />
                    {t('home.quick_start_gateway')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void navigate({ to: '/models' })}>
                    <Icon icon={Cpu} size="xs" />
                    {t('home.quick_start_model')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void navigate({ to: '/chat' })}>
                    <Icon icon={MessageSquare} size="xs" />
                    {t('home.quick_start_chat')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void navigate({ to: '/skills' })}>
                    <Icon icon={Package} size="xs" />
                    {t('home.quick_start_skills')}
                  </Button>
                </div>
              </section>
            )}

            {/* Metrics row */}
            <div className="grid grid-cols-4 gap-3">
              <MetricCard
                icon={MessageSquare}
                label={t('home.metric_messages_today')}
                value={String(todayMessages)}
                accent="blue"
              />
              <MetricCard
                icon={Zap}
                label={t('home.metric_tokens_today')}
                value={formatTokens(todayTokens)}
                accent="amber"
              />
              <MetricCard
                icon={Activity}
                label={t('home.metric_total_sessions')}
                value={String(totalSessions)}
                accent="emerald"
              />
              <MetricCard
                icon={Plug}
                label={t('home.metric_mcp_servers')}
                value={String(mcpServers.length)}
                accent="purple"
              />
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-2 gap-4">
              {/* Recent conversations */}
              <section className="flex flex-col gap-2 rounded-lg border border-border bg-bg-elev-1/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-fg">{t('home.recent_chats')}</h2>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void navigate({ to: '/chat' })}
                  >
                    {t('home.view_all')}
                  </Button>
                </div>
                {recentSessions.length === 0 ? (
                  <p className="py-4 text-center text-xs text-fg-subtle">{t('home.no_chats_yet')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {recentSessions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => void navigate({ to: '/chat', search: { session: s.id } })}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-bg-elev-2"
                        >
                          <Icon icon={MessageSquare} size="xs" className="flex-none text-fg-subtle" />
                          <span className="min-w-0 flex-1 truncate text-xs text-fg">
                            {s.title || t('home.untitled_chat')}
                          </span>
                          <span className="text-[10px] text-fg-subtle">
                            {new Date(s.createdAt).toLocaleDateString()}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Active cron jobs */}
              <section className="flex flex-col gap-2 rounded-lg border border-border bg-bg-elev-1/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-fg">{t('home.active_cron')}</h2>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void navigate({ to: '/scheduler' })}
                  >
                    {t('home.view_all')}
                  </Button>
                </div>
                {activeCronJobs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-fg-subtle">{t('home.no_cron_jobs')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {activeCronJobs.slice(0, 5).map((j) => (
                      <li key={j.id}>
                        <button
                          type="button"
                          onClick={() => void navigate({ to: '/scheduler' })}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-bg-elev-2"
                        >
                          <Icon icon={CalendarClock} size="xs" className="flex-none text-fg-subtle" />
                          <span className="min-w-0 flex-1 truncate text-xs text-fg">{j.name}</span>
                          <span className="font-mono text-[10px] text-fg-subtle">{j.cron_expression}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* System status bar */}
            <section className="flex flex-col gap-2 rounded-lg border border-border bg-bg-elev-1/60 p-4">
              <h2 className="text-sm font-semibold text-fg">{t('home.system_status')}</h2>
              <div className="flex flex-wrap gap-3">
                <StatusChip
                  ok={gateway === 'online'}
                  label={t('home.status_gateway')}
                  icon={Radio}
                />
                <StatusChip
                  ok={hermes?.installed ?? false}
                  label={t('home.status_hermes')}
                  icon={Cpu}
                  detail={hermes?.version_parsed ? hermes.version_parsed.join('.') : undefined}
                />
                <StatusChip
                  ok={mcpServers.length > 0}
                  label={t('home.status_mcp')}
                  icon={Plug}
                  detail={mcpServers.length > 0 ? `${mcpServers.length}` : undefined}
                />
                <StatusChip
                  ok={activeCronJobs.length > 0}
                  label={t('home.status_cron')}
                  icon={CalendarClock}
                  detail={activeCronJobs.length > 0 ? `${activeCronJobs.length}` : undefined}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  icon: Ico,
  label,
  value,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  accent: 'blue' | 'amber' | 'emerald' | 'purple';
}) {
  const colors = {
    blue: 'border-blue-500/30 bg-blue-500/5 text-blue-500',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-500',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500',
    purple: 'border-purple-500/30 bg-purple-500/5 text-purple-500',
  };
  const iconColors = {
    blue: 'text-blue-500',
    amber: 'text-amber-500',
    emerald: 'text-emerald-500',
    purple: 'text-purple-500',
  };
  return (
    <div className={cn('flex flex-col gap-1 rounded-lg border p-3', colors[accent])}>
      <div className="flex items-center gap-1.5">
        <Icon icon={Ico} size="xs" className={iconColors[accent]} />
        <span className="text-[11px] text-fg-subtle">{label}</span>
      </div>
      <span className="text-xl font-bold tracking-tight">{value}</span>
    </div>
  );
}

function StatusChip({
  ok,
  label,
  icon: _Ico,
  detail,
}: {
  ok: boolean;
  label: string;
  icon: typeof Radio;
  detail?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-bg-elev-2 text-fg-subtle',
      )}
    >
      <Icon icon={ok ? CheckCircle2 : AlertCircle} size="xs" />
      <span>{label}</span>
      {detail && <span className="font-mono text-[10px] opacity-70">{detail}</span>}
    </div>
  );
}
