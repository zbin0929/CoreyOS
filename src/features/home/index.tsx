import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  BookOpen,
  Check,
  Circle,
  MessageSquare,
  Plug,
  Radio,
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
import { HermesInstallCard } from './HermesInstallCard';
import { PresetCard } from './PresetCard';

/**
 * Home is the post-install landing page. Users who just opened the
 * `.dmg` / `.exe` for the first time land here. The goal is a
 * completed onboarding checklist, not a marketing hero: we detect
 * what's configured and what isn't, and point at the right settings
 * page for each unchecked item.
 *
 * Detection signals (all live, not cached):
 *   - `useAppStatusStore.gateway` → Hermes gateway reachable?
 *   - `useAppStatusStore.currentModel` → a model selected?
 *   - `useChatStore.orderedIds.length` → at least one session on disk?
 *   - `memoryRead('user')` → USER.md has content?
 */
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

  // USER.md populated? Cheap one-shot read on mount; doesn't poll.
  const [userMemoryFilled, setUserMemoryFilled] = useState(false);
  useEffect(() => {
    memoryRead('user')
      .then((m) => setUserMemoryFilled(m.content.trim().length > 0))
      .catch(() => setUserMemoryFilled(false));
  }, []);

  const steps: OnboardingStep[] = [
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
    {
      id: 'channel',
      labelKey: 'home.step_channel',
      descKey: 'home.step_channel_desc',
      done: false, // never auto-ticks; user decides if they want a channel at all
      path: '/channels',
      icon: Radio,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const allDone = completed >= 4; // 4/5 is "onboarded"; channel is optional

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Ambient gold glow */}
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
          {/* Gateway chip — the one piece of state that tells the user
              whether the app is actually going to work. Clickable:
              takes them to Settings where they can reconfigure. */}
          <button
            type="button"
            onClick={() => void navigate({ to: '/settings' })}
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

        {/* Hermes-binary install / gateway-start CTA. Hidden once both
            the binary is on PATH AND the gateway is reachable — at
            which point the onboarding-checklist's green check is the
            single source of truth. */}
        <HermesInstallCard />

        {/* First-run / activation CTA. Renders a prominent "Install
            starter content" card when ~/.hermes/skills/ is empty;
            collapses to a success confirmation right after install,
            then stays hidden on subsequent visits. */}
        <PresetCard />

        {/* Onboarding checklist */}
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
            {steps.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 py-2.5"
                data-testid={`home-step-${s.id}`}
                data-done={s.done ? 'true' : 'false'}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 flex-none items-center justify-center rounded-full border',
                    s.done
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
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
                  </div>
                  <div className="text-xs text-fg-subtle">{t(s.descKey)}</div>
                </div>
                <Button
                  size="xs"
                  variant={s.done ? 'ghost' : 'secondary'}
                  onClick={() => void navigate({ to: s.path })}
                  data-testid={`home-step-${s.id}-open`}
                >
                  <Icon icon={s.icon} size="xs" />
                  {t('home.step_open')}
                </Button>
              </li>
            ))}
          </ul>
        </section>

        {/* Secondary CTA: documentation */}
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
