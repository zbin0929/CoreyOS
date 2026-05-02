import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  FlaskConical,
  Globe,
  Loader2,
  MessageSquare,
  Play,
  Settings,
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

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function FocusItem({ ok, title, detail, onClick }: { ok: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left transition-all duration-200 hover:bg-[var(--glass-bg-hover)]"
    >
      <span className={cn('relative flex h-5 w-5 items-center justify-center', ok && 'drop-shadow-[0_0_4px_hsl(155_80%_50%/0.5)]')}>
        <Icon icon={ok ? CheckCircle2 : Circle} size="xs" className={ok ? 'text-emerald-500' : 'text-fg-subtle'} />
        {ok && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" style={{ animationDuration: '3s' }} />}
      </span>
      <span className="text-sm text-fg">{title}</span>
      <span className="ml-auto font-mono text-[11px] text-fg-muted">{detail}</span>
    </button>
  );
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

  const isOnline = gateway === 'online';
  const focusItems = [
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
      detail: mcpServers.length > 0 ? `${mcpServers.length} ${t('home.status_connected')}` : t('home.status_offline'),
      to: '/mcp' as const,
    },
    {
      key: 'cron',
      ok: activeCronJobs.length > 0,
      title: 'Cron',
      detail: activeCronJobs.length > 0 ? `${activeCronJobs.length} ${t('home.status_active')}` : t('home.status_offline'),
      to: '/scheduler' as const,
    },
  ];
  const activeRisks = focusItems.filter((i) => !i.ok);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ background: 'var(--gradient-page)' }}>
      <FirstRunModal />

      <div className="mx-auto flex w-full max-w-6xl flex-col px-6 py-6">
        <div className="animate-fade-in mb-8 flex items-center gap-4">
          <div className="relative">
            <CoreyMark className="h-12 w-12 shadow-lg ring-1 ring-border/60" />
            {isOnline && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[var(--online-dot-ring)] bg-emerald-500 shadow-[0_0_8px_hsl(155_80%_50%/0.6)]" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-fg">CoreyOS</h1>
            <p className="text-xs text-fg-muted">{t('home.dashboard_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshGateway()}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-200',
              isOnline
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-[0_0_12px_hsl(155_80%_50%/0.15)] hover:shadow-[0_0_20px_hsl(155_80%_50%/0.25)]'
                : gateway === 'offline'
                  ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15'
                  : 'border-border bg-bg-elev-2 text-fg-muted hover:bg-bg-elev-3',
            )}
          >
            <Icon icon={isOnline ? Wifi : WifiOff} size="sm" />
            {isOnline ? t('home.gateway_online') : gateway === 'offline' ? t('home.gateway_offline') : t('home.gateway_unknown')}
          </button>
        </div>

        <div className="mb-4"><HermesInstallCard /></div>
        <div className="mb-4"><PresetCard /></div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-fg-muted">
            <Icon icon={Loader2} size="lg" className="animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric icon={MessageSquare} label={t('home.metric_messages_today')} value={String(todayMessages)} color="blue" />
              <Metric icon={Zap} label={t('home.metric_tokens_today')} value={fmtTokens(todayTokens)} color="amber" />
              <Metric icon={Activity} label={t('home.metric_total_sessions')} value={String(totalSessions)} color="emerald" />
              <Metric icon={CalendarClock} label={t('home.metric_cron_jobs')} value={String(activeCronJobs.length)} color="violet" />
            </div>

            <div className="animate-slide-up grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]" style={{ animationDelay: '0.1s' }}>
              <div className="flex min-w-0 flex-col gap-4">
                <Card title={t('home.system_overview')}>
                  <div className="flex flex-col gap-1.5">
                    {focusItems.map((item) => (
                      <FocusItem
                        key={item.key}
                        ok={item.ok}
                        title={item.title}
                        detail={item.detail}
                        onClick={() => void navigate({ to: item.to })}
                      />
                    ))}
                  </div>
                  {activeRisks.length > 0 && (
                    <div className="mt-3 rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning">
                      {activeRisks.length} {t('home.status_offline')}
                    </div>
                  )}
                </Card>

                <Card
                  title={t('home.recent_chats')}
                  action={<Button size="xs" variant="ghost" onClick={() => void navigate({ to: '/chat' })}>{t('home.view_all')} <Icon icon={ArrowRight} size="xs" /></Button>}
                >
                  {recentSessions.length === 0 ? (
                    <Empty icon={MessageSquare} text={t('home.no_chats_yet')} />
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {recentSessions.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => void navigate({ to: '/chat', search: { session: s.id } })}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-bg-elev-2"
                          >
                            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                              <Icon icon={MessageSquare} size="xs" />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.title || t('home.untitled_chat')}</span>
                            <span className="text-[11px] text-fg-subtle">{new Date(s.createdAt).toLocaleDateString()}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <div className="flex flex-col gap-4">
                <Card title={t('home.action_title')}>
                  <div className="flex flex-col gap-1">
                    <SideAction icon={Play} label={t('home.action_new_chat')} color="blue" onClick={() => void navigate({ to: '/chat' })} />
                    <SideAction icon={FlaskConical} label={t('home.action_run_skill')} color="purple" onClick={() => void navigate({ to: '/skills' })} />
                    <SideAction icon={Globe} label={t('home.action_mcp')} color="emerald" onClick={() => void navigate({ to: '/mcp' })} />
                    <SideAction icon={Settings} label={t('home.action_settings')} color="gray" onClick={() => void navigate({ to: '/settings' })} />
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--glass-border)] p-4 shadow-[var(--shadow-1)] transition-all duration-200 hover:border-[var(--glass-border-hover)]" style={{ background: 'var(--gradient-card)' }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ icon: Ico, text }: { icon: typeof MessageSquare; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-fg-subtle">
      <Icon icon={Ico} size="lg" className="opacity-20" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

function Metric({ icon: Ico, label, value, color }: {
  icon: typeof Activity; label: string; value: string; color: 'blue' | 'amber' | 'emerald' | 'violet';
}) {
  const glow = { blue: '0 0 20px hsl(212 92% 60% / 0.15)', amber: '0 0 20px hsl(38 90% 56% / 0.15)', emerald: '0 0 20px hsl(155 80% 50% / 0.15)', violet: '0 0 20px hsl(270 70% 60% / 0.15)' };
  const text = { blue: 'text-blue-600 dark:text-blue-400', amber: 'text-amber-600 dark:text-amber-400', emerald: 'text-emerald-600 dark:text-emerald-400', violet: 'text-violet-600 dark:text-violet-400' };
  const iconGlow = { blue: 'drop-shadow-[0_0_6px_hsl(212_92%_60%/0.5)]', amber: 'drop-shadow-[0_0_6px_hsl(38_90%_56%/0.5)]', emerald: 'drop-shadow-[0_0_6px_hsl(155_80%_50%/0.5)]', violet: 'drop-shadow-[0_0_6px_hsl(270_70%_60%/0.5)]' };
  return (
    <div
      className={cn('animate-slide-up group flex items-center gap-3 rounded-xl border border-[var(--glass-border)] p-4 transition-all duration-200 hover:border-[var(--glass-border-hover)]')}
      style={{ background: 'var(--gradient-card)', boxShadow: glow[color] }}
    >
      <span className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-[var(--glass-bg)]', text[color])}>
        <Icon icon={Ico} size="md" className={iconGlow[color]} />
      </span>
      <div className="min-w-0">
        <div className={cn('text-2xl font-bold tracking-tight tabular-nums', text[color])}>{value}</div>
        <div className="text-[11px] font-medium text-fg-subtle">{label}</div>
      </div>
    </div>
  );
}

function SideAction({ icon: Ico, label, color, onClick }: {
  icon: typeof Play; label: string; color: 'blue' | 'purple' | 'emerald' | 'gray'; onClick: () => void;
}) {
  const iconColor = { blue: 'text-blue-600 dark:text-blue-400 drop-shadow-[0_0_4px_hsl(212_92%_60%/0.4)]', purple: 'text-purple-600 dark:text-purple-400 drop-shadow-[0_0_4px_hsl(270_70%_60%/0.4)]', emerald: 'text-emerald-600 dark:text-emerald-400 drop-shadow-[0_0_4px_hsl(155_80%_50%/0.4)]', gray: 'text-fg-subtle' };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 hover:bg-[var(--glass-bg-hover)]"
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[var(--glass-bg)]">
        <Icon icon={Ico} size="sm" className={iconColor[color]} />
      </span>
      <span className="text-sm font-medium text-fg">{label}</span>
      <Icon icon={ArrowRight} size="xs" className="ml-auto text-fg-subtle opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
    </button>
  );
}

