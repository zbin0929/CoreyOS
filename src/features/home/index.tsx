import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Globe,
  Loader2,
  MessageSquare,
  Package,
  Plug,
  Play,
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

  const isOnline = gateway === 'online';
  const isEmpty = totalSessions === 0 && !isOnline;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <FirstRunModal />

      {/* Hero banner */}
      <div
        className="relative overflow-hidden border-b border-border"
        style={{
          background: isOnline
            ? 'linear-gradient(135deg, hsl(var(--emerald-500) / 0.15) 0%, hsl(var(--bg-elev-1)) 70%)'
            : 'linear-gradient(135deg, hsl(var(--gold-500) / 0.12) 0%, hsl(var(--bg-elev-1)) 70%)',
        }}
      >
        <div className="mx-auto flex w-full max-w-4xl items-center gap-5 px-6 py-6">
          <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-white/10 bg-bg-elev-2 shadow-lg">
            <CoreyMark className="h-9 w-9" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-fg">CoreyOS</h1>
            <p className="mt-0.5 text-sm text-fg-muted">{t('home.dashboard_subtitle')}</p>
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
            <span>{isOnline ? t('home.gateway_online') : gateway === 'offline' ? t('home.gateway_offline') : t('home.gateway_unknown')}</span>
          </button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-5">
        {/* Install + preset — only for new users */}
        {hermes && !hermes.installed && <HermesInstallCard />}
        <PresetCard />

        {loading && (
          <div className="flex items-center justify-center py-16 text-fg-muted">
            <Icon icon={Loader2} size="lg" className="animate-spin" />
          </div>
        )}

        {!loading && (
          <>
            {/* Quick-start onboarding — only when empty */}
            {isEmpty && (
              <section className="rounded-xl border border-gold-500/25 bg-gradient-to-br from-gold-500/[0.06] to-transparent p-5">
                <h2 className="text-base font-semibold text-fg">{t('home.quick_start_title')}</h2>
                <p className="mt-1 text-sm text-fg-muted">{t('home.quick_start_desc')}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <QuickAction icon={Radio} label={t('home.quick_start_gateway')} path="/settings" primary />
                  <QuickAction icon={Cpu} label={t('home.quick_start_model')} path="/models" />
                  <QuickAction icon={MessageSquare} label={t('home.quick_start_chat')} path="/chat" />
                  <QuickAction icon={Package} label={t('home.quick_start_skills')} path="/skills" />
                </div>
              </section>
            )}

            {/* Metrics — 2x2 grid, more compact */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard icon={MessageSquare} label={t('home.metric_messages_today')} value={String(todayMessages)} accent="blue" />
              <MetricCard icon={Zap} label={t('home.metric_tokens_today')} value={formatTokens(todayTokens)} accent="amber" />
              <MetricCard icon={Activity} label={t('home.metric_total_sessions')} value={String(totalSessions)} accent="emerald" />
              <MetricCard icon={Plug} label={t('home.metric_mcp_servers')} value={String(mcpServers.length)} accent="purple" />
            </div>

            {/* Quick actions — always visible, gives the page substance */}
            <section className="grid grid-cols-3 gap-3">
              <ActionCard
                icon={Play}
                title={t('home.action_new_chat')}
                desc={t('home.action_new_chat_desc')}
                onClick={() => void navigate({ to: '/chat' })}
                accent="blue"
              />
              <ActionCard
                icon={FlaskConical}
                title={t('home.action_run_skill')}
                desc={t('home.action_run_skill_desc')}
                onClick={() => void navigate({ to: '/skills' })}
                accent="purple"
              />
              <ActionCard
                icon={Globe}
                title={t('home.action_mcp')}
                desc={t('home.action_mcp_desc')}
                onClick={() => void navigate({ to: '/mcp' })}
                accent="emerald"
              />
            </section>

            {/* Two-column: recent chats + cron */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <section className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elev-1/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-fg">{t('home.recent_chats')}</h2>
                  <Button size="xs" variant="ghost" onClick={() => void navigate({ to: '/chat' })}>
                    {t('home.view_all')} <Icon icon={ArrowRight} size="xs" />
                  </Button>
                </div>
                {recentSessions.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-fg-subtle">
                    <Icon icon={MessageSquare} size="lg" className="opacity-30" />
                    <p className="text-xs">{t('home.no_chats_yet')}</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {recentSessions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => void navigate({ to: '/chat', search: { session: s.id } })}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-bg-elev-2"
                        >
                          <Icon icon={MessageSquare} size="xs" className="flex-none text-fg-subtle" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
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

              <section className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elev-1/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-fg">{t('home.active_cron')}</h2>
                  <Button size="xs" variant="ghost" onClick={() => void navigate({ to: '/scheduler' })}>
                    {t('home.view_all')} <Icon icon={ArrowRight} size="xs" />
                  </Button>
                </div>
                {activeCronJobs.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-fg-subtle">
                    <Icon icon={CalendarClock} size="lg" className="opacity-30" />
                    <p className="text-xs">{t('home.no_cron_jobs')}</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {activeCronJobs.slice(0, 5).map((j) => (
                      <li key={j.id}>
                        <button
                          type="button"
                          onClick={() => void navigate({ to: '/scheduler' })}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-bg-elev-2"
                        >
                          <Icon icon={CalendarClock} size="xs" className="flex-none text-fg-subtle" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{j.name}</span>
                          <span className="font-mono text-[10px] text-fg-subtle">{j.cron_expression}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* System status — compact inline bar */}
            <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-bg-elev-1/40 px-4 py-3">
              <span className="text-xs font-medium text-fg-subtle">{t('home.system_status')}</span>
              <div className="h-3 w-px bg-border" />
              <StatusChip ok={isOnline} label={t('home.status_gateway')} detail={isOnline ? '8642' : undefined} />
              <StatusChip ok={hermes?.installed ?? false} label={t('home.status_hermes')} detail={hermes?.version_parsed ? hermes.version_parsed.join('.') : undefined} />
              <StatusChip ok={mcpServers.length > 0} label={t('home.status_mcp')} detail={mcpServers.length > 0 ? `${mcpServers.length}` : undefined} />
              <StatusChip ok={activeCronJobs.length > 0} label={t('home.status_cron')} detail={activeCronJobs.length > 0 ? `${activeCronJobs.length}` : undefined} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function QuickAction({ icon: Ico, label, path, primary }: { icon: typeof Radio; label: string; path: string; primary?: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => void navigate({ to: path })}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition',
        primary
          ? 'border-gold-500/30 bg-gold-500/10 text-gold-600 dark:text-gold-400 hover:bg-gold-500/15'
          : 'border-border bg-bg-elev-2 text-fg hover:bg-bg-elev-3',
      )}
    >
      <Icon icon={Ico} size="sm" />
      <span>{label}</span>
    </button>
  );
}

function ActionCard({ icon: Ico, title, desc, onClick, accent }: {
  icon: typeof Play; title: string; desc: string; onClick: () => void; accent: 'blue' | 'purple' | 'emerald';
}) {
  const accents = {
    blue: 'group-hover:border-blue-500/40 group-hover:bg-blue-500/[0.04]',
    purple: 'group-hover:border-purple-500/40 group-hover:bg-purple-500/[0.04]',
    emerald: 'group-hover:border-emerald-500/40 group-hover:bg-emerald-500/[0.04]',
  };
  const iconAccents = {
    blue: 'text-blue-500 bg-blue-500/10',
    purple: 'text-purple-500 bg-purple-500/10',
    emerald: 'text-emerald-500 bg-emerald-500/10',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('group flex items-start gap-3 rounded-xl border border-border bg-bg-elev-1/60 p-4 text-left transition hover:border-border-strong hover:shadow-sm', accents[accent])}
    >
      <span className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-lg', iconAccents[accent])}>
        <Icon icon={Ico} size="sm" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">{title}</div>
        <div className="mt-0.5 text-xs text-fg-muted">{desc}</div>
      </div>
    </button>
  );
}

function MetricCard({ icon: Ico, label, value, accent }: {
  icon: typeof Activity; label: string; value: string; accent: 'blue' | 'amber' | 'emerald' | 'purple';
}) {
  const colors = {
    blue: 'border-blue-500/25 bg-blue-500/[0.06]',
    amber: 'border-amber-500/25 bg-amber-500/[0.06]',
    emerald: 'border-emerald-500/25 bg-emerald-500/[0.06]',
    purple: 'border-purple-500/25 bg-purple-500/[0.06]',
  };
  const iconColors = { blue: 'text-blue-500', amber: 'text-amber-500', emerald: 'text-emerald-500', purple: 'text-purple-500' };
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-xl border p-3.5', colors[accent])}>
      <div className="flex items-center gap-1.5">
        <Icon icon={Ico} size="xs" className={iconColors[accent]} />
        <span className="text-[11px] font-medium text-fg-subtle">{label}</span>
      </div>
      <span className={cn('text-2xl font-bold tracking-tight', iconColors[accent])}>{value}</span>
    </div>
  );
}

function StatusChip({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
      ok ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400' : 'border-border bg-bg-elev-2 text-fg-subtle',
    )}>
      <Icon icon={ok ? CheckCircle2 : AlertCircle} size="xs" />
      <span>{label}</span>
      {detail && <span className="font-mono opacity-60">{detail}</span>}
    </div>
  );
}
