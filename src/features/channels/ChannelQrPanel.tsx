import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, QrCode, RefreshCcw, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesChannelSetupQr,
  ipcErrorMessage,
  type ChannelQrSetupResult,
} from '@/lib/ipc';

type QrState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; result: ChannelQrSetupResult }
  | { kind: 'error'; message: string };

export function ChannelQrPanel({
  channelId,
  onClose,
  onDone,
}: {
  channelId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<QrState>({ kind: 'idle' });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startSetup() {
    setState({ kind: 'loading' });
    try {
      const result = await hermesChannelSetupQr(channelId);
      setState({ kind: 'loaded', result });
      if (result.status === 'pending') {
        startPolling();
      }
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }

  function startPolling() {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const result = await hermesChannelSetupQr(channelId);
        if (result.status === 'confirmed' || result.status === 'done') {
          stopPolling();
          setState({ kind: 'loaded', result });
          if (onDone) {
            setTimeout(onDone, 1500);
          }
        } else if (result.status === 'error') {
          stopPolling();
          setState({ kind: 'error', message: result.message });
        } else {
          setState({ kind: 'loaded', result });
        }
      } catch {
        stopPolling();
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  useEffect(() => {
    void startSetup();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const isPending =
    state.kind === 'loaded' && (state.result.status === 'pending' || state.result.status === 'output');
  const isDone =
    state.kind === 'loaded' && (state.result.status === 'confirmed' || state.result.status === 'done');

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-border bg-bg-elev-1 p-4"
      data-testid="channel-qr-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon icon={QrCode} size="sm" className="text-fg-muted" />
          <span className="text-sm font-medium text-fg">
            {t('channels.qr_setup_title', { defaultValue: '扫码配置' })}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-muted hover:bg-bg-elev-2 hover:text-fg"
        >
          <Icon icon={X} size="xs" />
        </button>
      </div>

      {state.kind === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Icon icon={Loader2} size="lg" className="animate-spin text-fg-muted" />
          <span className="text-xs text-fg-muted">
            {t('channels.qr_loading', { defaultValue: '正在生成二维码…' })}
          </span>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <Icon icon={AlertTriangle} size="md" className="text-danger" />
          <span className="text-xs text-danger">{state.message}</span>
          <Button size="sm" variant="secondary" onClick={() => void startSetup()}>
            <Icon icon={RefreshCcw} size="xs" />
            {t('common.retry')}
          </Button>
        </div>
      )}

      {state.kind === 'loaded' && (
        <div className="flex flex-col items-center gap-4">
          {state.result.qr_url ? (
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG
                value={state.result.qr_url}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
          ) : state.result.qr_data ? (
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG
                value={state.result.qr_data}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
          ) : (
            <div className="rounded-md border border-border bg-bg-elev-2 px-4 py-3">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg">
                {state.result.message || t('channels.qr_no_data', { defaultValue: '未获取到二维码数据' })}
              </pre>
            </div>
          )}

          <div
            className={cn(
              'flex items-center gap-2 text-xs',
              isDone ? 'text-emerald-500' : isPending ? 'text-gold-500' : 'text-fg-muted',
            )}
          >
            <Icon
              icon={isDone ? Check : isPending ? Loader2 : AlertTriangle}
              size="xs"
              className={cn(isPending && 'animate-spin')}
            />
            {isDone
              ? t('channels.qr_confirmed', { defaultValue: '扫码成功！配置已保存。' })
              : isPending
                ? t('channels.qr_waiting', { defaultValue: '等待扫码确认…' })
                : state.result.message}
          </div>

          {isDone && (
            <Button size="sm" variant="primary" onClick={onDone ?? onClose}>
              {t('common.done')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
