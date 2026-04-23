import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  isWechatQrTerminal,
  wechatQrCancel,
  wechatQrPoll,
  wechatQrStart,
  type WechatQrStart,
  type WechatQrStatus,
} from '@/lib/ipc';

/**
 * WeChat QR-login panel (Phase 3 · T3.3).
 *
 * Mounted inline inside the WeChat channel card instead of the
 * generic env input. Flow the component drives:
 *
 *   1. `wechatQrStart()` → inline SVG + session id.
 *   2. `wechatQrPoll(id)` every 2 s until the status is terminal.
 *   3. On `scanned`: notify parent so the card re-reads
 *      `ChannelState` (the backend already wrote `WECHAT_SESSION`
 *      into `.env`, so the env_present map flips to `true` on the
 *      next `hermes_channel_list`).
 *   4. On `expired` / `failed`: show a restart button; on
 *      `cancelled`: collapse back to the idle CTA.
 *
 * Design choices worth calling out:
 *
 *   - Polling cadence is 2 s. iLink's real API typically wants ≥ 1 s
 *     so 2 s is conservative for the real provider too. The stub
 *     reaches `scanned` in ~8 s of wall time (4 polls × 2 s).
 *   - We never store the session token client-side — the backend
 *     writes it straight to `~/.hermes/.env`. This keeps secrets off
 *     the render tree, so the component stays screenshot-safe.
 *   - Cancel fires on unmount too, so navigating away mid-scan
 *     doesn't leak an in-flight session that keeps polling Tencent
 *     forever.
 */
export function WeChatQr({ onScanned }: { onScanned: () => void }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<WechatQrStart | null>(null);
  const [status, setStatus] = useState<WechatQrStatus>({ kind: 'pending' });
  const [error, setError] = useState<string | null>(null);
  const [elapsedS, setElapsedS] = useState(0);

  // Latest-qr-id ref: the polling loop checks this against the id
  // it started with so a user-initiated "Start over" (which creates
  // a new session synchronously) can't race with a still-resolving
  // poll against the stale id.
  const activeIdRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setStatus({ kind: 'pending' });
    setElapsedS(0);
    try {
      const s = await wechatQrStart();
      activeIdRef.current = s.qr_id;
      setSession(s);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  // Poll loop. We use setTimeout rather than setInterval so each
  // tick waits for the previous response — slow networks never
  // stack polls on top of each other.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await wechatQrPoll(session.qr_id);
        if (cancelled) return;
        if (activeIdRef.current !== session.qr_id) return; // user restarted
        setStatus(r.status);
        setElapsedS(r.elapsed_s);
        if (r.status.kind === 'scanned') {
          onScanned();
          return;
        }
        if (isWechatQrTerminal(r.status)) return;
      } catch (e) {
        if (cancelled) return;
        setError(ipcErrorMessage(e));
        return;
      }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
    return () => {
      cancelled = true;
    };
  }, [session, onScanned]);

  // Best-effort cancel on unmount so a closed form doesn't leave an
  // orphan session hammering iLink.
  useEffect(() => {
    return () => {
      const id = activeIdRef.current;
      if (id) {
        void wechatQrCancel(id).catch(() => {
          /* ignore — unmount path, nothing to surface */
        });
      }
    };
  }, []);

  const handleCancel = useCallback(async () => {
    const id = activeIdRef.current;
    activeIdRef.current = null;
    setSession(null);
    if (id) {
      try {
        await wechatQrCancel(id);
      } catch {
        /* ignore cancel errors — user intent already acted on */
      }
    }
  }, []);

  // ── Idle state: no session yet, show a prominent Start button. ──
  if (!session) {
    return (
      <div
        className="flex flex-col gap-2 rounded border border-gold-500/30 bg-gold-500/5 p-3 text-[11px]"
        data-testid="wechat-qr-idle"
      >
        <div className="flex items-start gap-2">
          <Icon icon={QrCode} size="md" className="mt-0.5 flex-none text-gold-500" />
          <span className="text-fg-muted">{t('channels.wechat.qr_intro')}</span>
        </div>
        {error && (
          <div className="flex items-start gap-1 text-danger">
            <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
            <span className="flex-1">{error}</span>
          </div>
        )}
        <Button
          size="sm"
          variant="primary"
          onClick={start}
          data-testid="wechat-qr-start"
        >
          <Icon icon={QrCode} size="sm" />
          {t('channels.wechat.start')}
        </Button>
      </div>
    );
  }

  // ── Active session: render the QR + status. ──
  const terminal = isWechatQrTerminal(status);
  return (
    <div
      className="flex flex-col items-stretch gap-2 rounded border border-gold-500/30 bg-gold-500/5 p-3 text-[11px]"
      data-testid="wechat-qr-active"
    >
      {/* The QR itself. We inline the backend's SVG via
          dangerouslySetInnerHTML — the markup never came off the
          wire and the backend strictly emits a subset of SVG, but
          this is still the right place to keep an eye on if the
          real iLink provider ever returns raw HTML. */}
      <div
        className="mx-auto w-[180px] rounded bg-white p-2"
        data-testid="wechat-qr-svg"
        dangerouslySetInnerHTML={{ __html: session.svg }}
      />

      <StatusLine status={status} elapsedS={elapsedS} expiresInS={session.expires_in_s} />

      <div className="flex items-center justify-end gap-2">
        {terminal ? (
          <Button
            size="sm"
            variant="primary"
            onClick={start}
            data-testid="wechat-qr-restart"
          >
            <Icon icon={RefreshCw} size="xs" />
            {t('channels.wechat.restart')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCancel}
            data-testid="wechat-qr-cancel"
          >
            <Icon icon={X} size="xs" />
            {t('channels.wechat.cancel')}
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-1 text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="flex-1">{error}</span>
        </div>
      )}
    </div>
  );
}

/** Single-line status indicator under the QR. Keeps the main
 *  component's return small + easier to visually scan. */
function StatusLine({
  status,
  elapsedS,
  expiresInS,
}: {
  status: WechatQrStatus;
  elapsedS: number;
  expiresInS: number;
}) {
  const { t } = useTranslation();
  const remaining = Math.max(0, expiresInS - elapsedS);
  switch (status.kind) {
    case 'pending':
      return (
        <div className="flex items-center gap-1.5 text-fg-muted" data-testid="wechat-qr-status-pending">
          <Icon icon={Loader2} size="xs" className="animate-spin" />
          <span>{t('channels.wechat.status.pending')}</span>
          <span className="ml-auto text-fg-subtle">
            {t('channels.wechat.expires_in_s', { s: remaining })}
          </span>
        </div>
      );
    case 'scanning':
      return (
        <div className="flex items-center gap-1.5 text-accent" data-testid="wechat-qr-status-scanning">
          <Icon icon={Smartphone} size="xs" />
          <span>{t('channels.wechat.status.scanning')}</span>
        </div>
      );
    case 'scanned':
      return (
        <div className="flex items-center gap-1.5 text-emerald-500" data-testid="wechat-qr-status-scanned">
          <Icon icon={CheckCircle2} size="xs" />
          <span>{t('channels.wechat.status.scanned')}</span>
        </div>
      );
    case 'expired':
      return (
        <div className="flex items-center gap-1.5 text-amber-500" data-testid="wechat-qr-status-expired">
          <Icon icon={AlertCircle} size="xs" />
          <span>{t('channels.wechat.status.expired')}</span>
        </div>
      );
    case 'cancelled':
      return (
        <div className="flex items-center gap-1.5 text-fg-subtle" data-testid="wechat-qr-status-cancelled">
          <Icon icon={X} size="xs" />
          <span>{t('channels.wechat.status.cancelled')}</span>
        </div>
      );
    case 'failed':
      return (
        <div className="flex items-start gap-1.5 text-danger" data-testid="wechat-qr-status-failed">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{t('channels.wechat.status.failed', { detail: status.detail })}</span>
        </div>
      );
  }
}
