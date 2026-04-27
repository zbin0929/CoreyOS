import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useAppStatusStore } from '@/stores/appStatus';

/**
 * Cold-start / disconnected banner for the chat surface.
 *
 * Three states the chat surface cares about:
 *
 *   1. **Hermes never reachable since boot** (`bootedReadyAt === null`,
 *      `bootStartedAt > 600 ms ago`):
 *      - Show "正在连接 Hermes…" with a spinner.
 *      - This is the cold-start case: gateway is `unknown` because no
 *        probe has succeeded yet, but we suppress the banner for the
 *        first ~600 ms of boot so an instant-warm Hermes never causes
 *        a 50 ms text flash.
 *
 *   2. **Hermes was reachable, now offline** (`bootedReadyAt !== null`,
 *      `gateway === 'offline'`):
 *      - Show "Hermes 暂时断开" with a manual retry affordance.
 *      - User keeps typing — the next probe will recover, and they're
 *        not blocked from drafting messages.
 *
 *   3. **Online and steady** (or first 600 ms of boot):
 *      - Render nothing. No flicker, no chrome.
 *
 * Why this lives here (and not in Topbar): the topbar pill is a
 * passive status indicator the user doesn't read at the moment they
 * want to send. The composer is what they're staring at, so a
 * banner directly above it is what actually catches the eye when
 * the click-to-send won't work yet.
 */
export function GatewayStatusBanner() {
  const { t } = useTranslation();
  const gateway = useAppStatusStore((s) => s.gateway);
  const bootedReadyAt = useAppStatusStore((s) => s.bootedReadyAt);
  const bootStartedAt = useAppStatusStore((s) => s.bootStartedAt);
  const refreshGateway = useAppStatusStore((s) => s.refreshGateway);

  // The cold-start banner suppresses itself for the first 600 ms so
  // the common "Hermes is already running on localhost, /health
  // returns in 5 ms" path never shows a flash of "正在连接…".
  // useEffect + state lets the suppression expire on a real timer
  // rather than relying on Date.now() at every render (which would
  // cause the banner to mount/unmount as the second hand ticks).
  const [softBootDone, setSoftBootDone] = useState(false);
  useEffect(() => {
    const elapsed = bootStartedAt !== null ? Date.now() - bootStartedAt : 0;
    if (elapsed >= 600) {
      setSoftBootDone(true);
      return;
    }
    const remaining = 600 - elapsed;
    const tid = window.setTimeout(() => setSoftBootDone(true), remaining);
    return () => window.clearTimeout(tid);
  }, [bootStartedAt]);

  // Cold-start: still waiting on the first successful probe.
  if (bootedReadyAt === null) {
    if (!softBootDone) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'mx-auto flex max-w-3xl items-center gap-2 px-6 pt-2',
          'text-xs text-fg-muted',
        )}
        data-testid="gateway-banner-warming"
      >
        <Icon icon={Loader2} size="xs" className="animate-spin text-gold-500" />
        <span>{t('chat_page.gateway_warming')}</span>
      </div>
    );
  }

  // Reachable once, then dropped — surface a quiet warning + retry.
  // Note we don't disable the composer; Hermes' health check can
  // false-negative under heavy load while a real chat would still
  // succeed, and blocking the user's typing on a probe blip is
  // worse UX than letting them try.
  if (gateway === 'offline') {
    return (
      <div
        role="alert"
        className={cn(
          'mx-auto flex max-w-3xl items-center justify-between gap-2 px-6 pt-2',
          'text-xs text-amber-600 dark:text-amber-400',
        )}
        data-testid="gateway-banner-offline"
      >
        <div className="flex items-center gap-2">
          <Icon icon={AlertTriangle} size="xs" />
          <span>{t('chat_page.gateway_offline')}</span>
        </div>
        <button
          type="button"
          onClick={() => void refreshGateway()}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
            'hover:bg-amber-500/10 transition-colors',
          )}
          aria-label={t('chat_page.gateway_retry')}
        >
          <Icon icon={RefreshCw} size="xs" />
          <span>{t('chat_page.gateway_retry')}</span>
        </button>
      </div>
    );
  }

  // gateway === 'online' (or 'unknown' after we've already been
  // online once, which means the most recent probe is in flight) —
  // render nothing.
  return null;
}
