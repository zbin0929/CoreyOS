import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2, Terminal as TerminalIcon, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  hermesConfigRead,
  hermesGatewayRestart,
  ipcErrorMessage,
  type HermesConfigView,
} from '@/lib/ipc';

/**
 * Surfaces after a successful save: nudges the user to bounce the
 * Hermes gateway so the new model picks up. The bounce itself is
 * best-effort — Hermes might not be running, in which case
 * `hermes gateway restart` errors and we surface that inline. After a
 * successful restart we re-read the config so any side-effects (like
 * Hermes rewriting fields it normalises on boot) show up.
 */
export function RestartBanner({
  onDismiss,
  onRestarted,
}: {
  onDismiss: () => void;
  onRestarted: (view: HermesConfigView | null) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'done'; output: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });

  async function doRestart() {
    if (status.kind === 'running') return;
    setStatus({ kind: 'running' });
    try {
      const output = await hermesGatewayRestart();
      setStatus({ kind: 'done', output });
      // Give Hermes a moment to finish binding port 8642, then refresh.
      window.setTimeout(async () => {
        try {
          const view = await hermesConfigRead();
          onRestarted(view);
        } catch {
          onRestarted(null);
        }
      }, 1200);
    } catch (e) {
      setStatus({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-gold-500/40 bg-gold-500/5 p-3 text-sm">
      <Icon icon={TerminalIcon} size="md" className="mt-0.5 flex-none text-gold-500" />
      <div className="flex-1">
        <div className="font-medium text-fg">{t('models_page.restart_title')}</div>
        <div className="mt-1 text-xs text-fg-muted">
          {t('models_page.restart_desc')}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={doRestart}
            disabled={status.kind === 'running'}
          >
            {status.kind === 'running' ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Zap} size="sm" />
            )}
            {t('models_page.restart_now')}
          </Button>
          {status.kind === 'done' && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <Icon icon={CheckCircle2} size="sm" />
              {t('models_page.restart_done')}
            </span>
          )}
          {status.kind === 'err' && (
            <span className="inline-flex items-start gap-1 text-xs text-danger">
              <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
              <span className="break-all">{status.message}</span>
            </span>
          )}
        </div>

        {status.kind === 'done' && status.output.trim() && (
          <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-[#0d1117] px-3 py-2 font-mono text-[11px] text-[#e6edf3]">
            {status.output.trim()}
          </pre>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="rounded p-1 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
        aria-label={t('models_page.dismiss')}
      >
        ×
      </button>
    </div>
  );
}
