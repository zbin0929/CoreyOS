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
  Plug,
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg">
      <FirstRunModal />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-0 px-6 py-5">
        {/* ── Header ─────────────────────────────────── */}
        <div className="mb-5 flex items-center gap-4">
          <CoreyMark className="h-10 w-10 shadow-md ring-1 ring-white/10" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold tracking-tight text-fg">CoreyOS</h1>
            <p className="text-xs text-fg-muted">{t('home.dashboard_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshGateway()}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition',
              isOnline
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15'
                : gateway === 'offline'
                  ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15'
                  : 'border-border bg-bg-elev-2 text-fg-muted hover:bg-bg-elev-3',
            )}
          >
            <Icon icon={isOnline ? Wifi : WifiOff} size="sm" />
            {isOnline ? t('home.gateway_online') : gateway === 'offline' ? t('home.gateway_offline') : t('home.gateway_unknown')}
          </button>
        </div>

        {/* ── Alerts: install / preset ────────────── */}
        <div className="mb-4"><HermesInstallCard /></div>
        <div className="mb-4"><PresetCard /></div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-fg-muted">
            <Icon icon={Loader2} size="lg" className="animate-spin" />
          </div>
        ) : (
          /* ── Two-column master layout ─────────── */
          <div className="grid grid-cols-[1fr_320px] gap-5">
            {/* ════ LEFT COLUMN ════ */}
            <div className="flex flex-col gap-4">
              {/* Metrics 2×2 */}
              <div className="grid grid-cols-2 gap-3">
                <Metric icon={MessageSquare} label={t('home.metric_messages_today')} value={String(todayMessages)} color="blue" />
                <Metric icon={Zap} label={t('home.metric_tokens_today')} value={fmtTokens(todayTokens)} color="amber" />
                <Metric icon={Activity} label={t('home.metric_total_sessions')} value={String(totalSessions)} color="emerald" />
                <Metric icon={Plug} label={t('home.metric_mcp_servers')} value={String(mcpServers.length)} color="violet" />
              </div>

              {/* Recent chats */}
              <Card
                title={t('home.recent_chats')}
                action={<Button size="xs" variant="ghost" onClick={() => void navigate({ to: '/chat' })}>{t('home.view_all')} <Icon icon={ArrowRight} size="xs" /></Button>}
              >
                {recentSessions.length === 0 ? (
                  <Empty icon={MessageSquare} text={t('home.no_chats_yet')} />
                ) : (
                  <ul className="flex flex-col">
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

              {/* Cron jobs */}
              <Card
                title={t('home.active_cron')}
                action={<Button size="xs" variant="ghost" onClick={() => void navigate({ to: '/scheduler' })}>{t('home.view_all')} <Icon icon={ArrowRight} size="xs" /></Button>}
              >
                {activeCronJobs.length === 0 ? (
                  <Empty icon={CalendarClock} text={t('home.no_cron_jobs')} />
                ) : (
                  <ul className="flex flex-col">
                    {activeCronJobs.slice(0, 5).map((j) => (
                      <li key={j.id}>
                        <button
                          type="button"
                          onClick={() => void navigate({ to: '/scheduler' })}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-bg-elev-2"
                        >
                          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
                            <Icon icon={CalendarClock} size="xs" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-fg">{j.name}</span>
                          <span className="font-mono text-[11px] text-fg-subtle">{j.cron_expression}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* ════ RIGHT SIDEBAR ════ */}
            <div className="flex flex-col gap-4">
              {/* Quick actions */}
              <Card title={t('home.action_title')}>
                <div className="flex flex-col gap-1">
                  <SideAction icon={Play} label={t('home.action_new_chat')} color="blue" onClick={() => void navigate({ to: '/chat' })} />
                  <SideAction icon={FlaskConical} label={t('home.action_run_skill')} color="purple" onClick={() => void navigate({ to: '/skills' })} />
                  <SideAction icon={Globe} label={t('home.action_mcp')} color="emerald" onClick={() => void navigate({ to: '/mcp' })} />
                  <SideAction icon={Settings} label={t('home.action_settings')} color="gray" onClick={() => void navigate({ to: '/settings' })} />
                </div>
              </Card>

              <Card title={t('home.system_overview')}>
                <div className="flex flex-col gap-0.5">
                  <OverviewRow ok={isOnline} label="Gateway" detail={isOnline ? t('home.status_online') : t('home.status_offline')} />
                  <OverviewRow ok={hermes?.installed ?? false} label="Hermes" detail={hermes?.version_parsed ? `v${hermes.version_parsed.join('.')}` : undefined} />
                  <OverviewRow ok={mcpServers.length > 0} label="MCP" detail={mcpServers.length > 0 ? `${mcpServers.length} ${t('home.status_connected')}` : undefined} />
                  <OverviewRow ok={activeCronJobs.length > 0} label="Cron" detail={activeCronJobs.length > 0 ? `${activeCronJobs.length} ${t('home.status_active')}` : undefined} />
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-bg-elev-1/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
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
  const bg = { blue: 'bg-blue-500/[0.06]', amber: 'bg-amber-500/[0.06]', emerald: 'bg-emerald-500/[0.06]', violet: 'bg-violet-500/[0.06]' };
  const border = { blue: 'border-blue-500/20', amber: 'border-amber-500/20', emerald: 'border-emerald-500/20', violet: 'border-violet-500/20' };
  const text = { blue: 'text-blue-500', amber: 'text-amber-500', emerald: 'text-emerald-500', violet: 'text-violet-500' };
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border p-4', bg[color], border[color])}>
      <span className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-lg', bg[color], text[color])}>
        <Icon icon={Ico} size="md" />
      </span>
      <div className="min-w-0">
        <div className={cn('text-2xl font-bold tracking-tight', text[color])}>{value}</div>
        <div className="text-[11px] font-medium text-fg-subtle">{label}</div>
      </div>
    </div>
  );
}

function SideAction({ icon: Ico, label, color, onClick }: {
  icon: typeof Play; label: string; color: 'blue' | 'purple' | 'emerald' | 'gray'; onClick: () => void;
}) {
  const iconBg = { blue: 'bg-blue-500/10 text-blue-500', purple: 'bg-purple-500/10 text-purple-500', emerald: 'bg-emerald-500/10 text-emerald-500', gray: 'bg-fg-subtle/10 text-fg-subtle' };
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-bg-elev-2"
    >
      <span className={cn('flex h-8 w-8 flex-none items-center justify-center rounded-lg', iconBg[color])}>
        <Icon icon={Ico} size="sm" />
      </span>
      <span className="text-sm font-medium text-fg">{label}</span>
      <Icon icon={ArrowRight} size="xs" className="ml-auto text-fg-subtle opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}

function OverviewRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
      <Icon icon={ok ? CheckCircle2 : Circle} size="xs" className={ok ? 'text-emerald-500' : 'text-fg-subtle/40'} />
      <span className="text-sm text-fg">{label}</span>
      {detail && <span className="ml-auto font-mono text-[11px] text-fg-muted">{detail}</span>}
      {!detail && <span className="ml-auto text-[11px] text-fg-subtle">—</span>}
    </div>
  );
}
