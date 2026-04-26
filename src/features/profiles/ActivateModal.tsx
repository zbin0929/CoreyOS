import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, Play, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import type { ActivateMode } from './types';

/**
 * Confirm dialog for switching the active profile. Walks through three
 * visible states: `confirm` (the default — shows from → to + the
 * restart-gateway toggle), `busy` (spinner while IPCs run), and
 * `error` (when either the pointer write or the subsequent gateway
 * bounce fails). `idle` is filtered out at the call site so we never
 * see it here.
 */
export function ActivateModal({
  mode,
  onCancel,
  onToggleRestart,
  onConfirm,
}: {
  mode: ActivateMode;
  onCancel: () => void;
  onToggleRestart: (v: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (mode.kind === 'idle') return null;
  const busy = mode.kind === 'busy';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      data-testid="profiles-activate-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elev-1 p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon icon={Play} size="sm" className="text-gold-500" />
            {t('profiles.activate')}
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            aria-label={t('profiles.cancel')}
          >
            <Icon icon={X} size="xs" />
          </Button>
        </div>

        {(mode.kind === 'confirm' || mode.kind === 'busy') && (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <p className="text-fg-muted">
              {mode.kind === 'confirm' && mode.previous
                ? t('profiles.activate_confirm_from_to', {
                    from: mode.previous,
                    to: mode.target,
                  })
                : t('profiles.activate_confirm_fresh', { to: mode.target })}
            </p>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={mode.restartGateway}
                disabled={busy}
                onChange={(e) => onToggleRestart(e.target.checked)}
                data-testid="profiles-activate-restart-toggle"
              />
              <span>{t('profiles.activate_restart_gateway')}</span>
            </label>
          </div>
        )}

        {mode.kind === 'error' && (
          <div className="mt-4 flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span className="break-all">{mode.message}</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            data-testid="profiles-activate-cancel"
          >
            {t('profiles.cancel')}
          </Button>
          {mode.kind === 'confirm' && (
            <Button
              size="sm"
              variant="primary"
              onClick={onConfirm}
              data-testid="profiles-activate-confirm"
            >
              <Icon icon={Check} size="sm" />
              {t('profiles.activate_confirm')}
            </Button>
          )}
          {mode.kind === 'busy' && (
            <Button size="sm" variant="primary" disabled>
              <Icon icon={Loader2} size="sm" className="animate-spin" />
              {t('profiles.activate_busy')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
