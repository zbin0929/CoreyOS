import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  BookOpen,
  Check,
  Circle,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoreyMark } from '@/components/ui/corey-mark';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { memoryRead } from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';
import { useChatStore } from '@/stores/chat';
import { FirstRunModal } from './FirstRunModal';
import { HermesInstallCard } from './HermesInstallCard';
import { PresetCard } from './PresetCard';

interface OnboardingStep {
  id: string;
  labelKey: string;
  descKey: string;
  done: boolean;
  path: string;
  icon: typeof Plug;
}

export function HomeRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const gateway = useAppStatusStore((s) => s.gateway);
  const currentModel = useAppStatusStore((s) => s.currentModel);
  const sessionCount = useChatStore((s) => s.orderedIds.length);

  const [userMemoryFilled, setUserMemoryFilled] = useState(false);
  useEffect(() => {
    memoryRead('user')
      .then((m) => setUserMemoryFilled(m.content.trim().length > 0))
      .catch(() => setUserMemoryFilled(false));
  }, []);

  const steps: OnboardingStep[] = useMemo(() => [
    {
      id: 'gateway',
      labelKey: 'home.step_gateway',
      descKey: 'home.step_gateway_desc',
      done: gateway === 'online',
      path: '/settings',
      icon: Plug,
    },
    {
      id: 'model',
      labelKey: 'home.step_model',
      descKey: 'home.step_model_desc',
      done: currentModel !== null,
      path: '/models',
      icon: Settings,
    },
    {
      id: 'chat',
      labelKey: 'home.step_chat',
      descKey: 'home.step_chat_desc',
      done: sessionCount > 0,
      path: '/chat',
      icon: MessageSquare,
    },
    {
      id: 'profile',
      labelKey: 'home.step_profile',
      descKey: 'home.step_profile_desc',
      done: userMemoryFilled,
      path: '/memory',
      icon: Sparkles,
    },
  ], [gateway, currentModel, sessionCount, userMemoryFilled]);

  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;
  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* First-run welcome overlay. Self-gates on a localStorage flag
          + the absence of any LLM profile, so returning users never
          see it. */}
      <FirstRunModal />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 10%, hsl(var(--gold-500) / 0.14), transparent 70%)',
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
        {/* Hero */}
        <div className="flex flex-col items-center gap-4 text-center">
          <CoreyMark className="h-16 w-16 shadow-lg ring-1 ring-white/10" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-fg">
              {t('home.title')}
            </h1>
            <p className="text-sm text-fg-muted">{t('home.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              // Two intents behind this chip:
              //  - Online → user is curious about the gateway; jump to
              //    Settings → LLMs where they can edit the upstream
              //    config.
              //  - Offline → "click to configure" actually means "show
              //    me how to start it". The HermesInstallCard right
              //    below the hero has the install command + recheck
              //    button — scroll there instead of dropping the user
              //    on the Settings page (which has no install help).
              if (gateway === 'offline') {
                document
                  .querySelector(
                    '[data-testid="home-hermes-install-card"], [data-testid="home-hermes-start-card"]',
                  )
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
              }
              void navigate({ to: '/settings' });
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
              gateway === 'online'
                ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500 hover:bg-emerald-500/10'
                : gateway === 'offline'
                  ? 'border-danger/40 bg-danger/5 text-danger hover:bg-danger/10'
                  : 'border-border bg-bg-elev-1 text-fg-muted hover:bg-bg-elev-2',
            )}
            data-testid="home-gateway-chip"
          >
            <Icon
              icon={gateway === 'online' ? Wifi : WifiOff}
              size="xs"
            />
            {gateway === 'online'
              ? t('home.gateway_online')
              : gateway === 'offline'
                ? t('home.gateway_offline')
                : t('home.gateway_unknown')}
          </button>
        </div>

        <HermesInstallCard />
        <PresetCard />

        {/* Onboarding checklist — progressive style. The "next step"
            is visually prominent; completed steps are muted. */}
        <section
          className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elev-1/60 p-4"
          data-testid="home-onboarding"
        >
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">
              {allDone
                ? t('home.onboarding_done_title')
                : t('home.onboarding_title')}
            </h2>
            <span className="text-xs text-fg-subtle">
              {t('home.onboarding_progress', {
                done: completed,
                total: steps.length,
              })}
            </span>
          </header>

          <ul className="flex flex-col divide-y divide-border/40">
            {steps.map((s) => {
              const isNext = nextStep?.id === s.id;
              return (
                <li
                  key={s.id}
                  className={cn(
                    'flex items-center gap-3 py-2.5',
                    isNext && !s.done && 'rounded-md bg-gold-500/[0.04] -mx-2 px-2 border border-gold-500/15',
                  )}
                  data-testid={`home-step-${s.id}`}
                  data-done={s.done ? 'true' : 'false'}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 flex-none items-center justify-center rounded-full border',
                      s.done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                        : isNext
                          ? 'border-gold-500/40 bg-gold-500/10 text-gold-500'
                          : 'border-border bg-bg-elev-2 text-fg-subtle',
                    )}
                  >
                    <Icon icon={s.done ? Check : Circle} size="xs" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'text-sm font-medium',
                        s.done ? 'text-fg-muted line-through' : 'text-fg',
                      )}
                    >
                      {t(s.labelKey)}
                      {isNext && !s.done && (
                        <span className="ml-2 rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-500">
                          {t('home.step_next')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-fg-subtle">{t(s.descKey)}</div>
                  </div>
                  <Button
                    size="xs"
                    variant={s.done ? 'ghost' : isNext ? 'primary' : 'secondary'}
                    onClick={() => void navigate({ to: s.path })}
                    data-testid={`home-step-${s.id}-open`}
                  >
                    <Icon icon={s.icon} size="xs" />
                    {t('home.step_open')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Feature guide — shown after onboarding is complete */}
        {allDone && (
          <section
            className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elev-1/60 p-4"
            data-testid="home-features"
          >
            <h2 className="text-sm font-semibold text-fg">{t('home.features_title')}</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: t('nav.runbooks'), desc: t('home.feature_runbooks'), path: '/runbooks' },
                { label: t('nav.compare'), desc: t('home.feature_compare'), path: '/compare' },
                { label: t('nav.trajectory'), desc: t('home.feature_trajectory'), path: '/trajectory' },
                { label: t('nav.budgets'), desc: t('home.feature_budgets'), path: '/budgets' },
              ].map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => void navigate({ to: f.path })}
                  className="flex flex-col items-start gap-0.5 rounded-md border border-border bg-bg-elev-2 px-3 py-2 text-left transition hover:border-border-strong hover:bg-bg-elev-3"
                >
                  <span className="text-xs font-medium text-fg">{f.label}</span>
                  <span className="text-[11px] text-fg-subtle">{f.desc}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="flex justify-center">
          <a
            href="https://github.com/zbin0929/CoreyOS#readme"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg"
          >
            <Icon icon={BookOpen} size="xs" />
            {t('home.cta_docs')}
          </a>
        </div>
      </div>
    </div>
  );
}
