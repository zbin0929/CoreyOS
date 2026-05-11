import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { hermesGatewayRestart, hermesInstall, ipcErrorMessage } from '@/lib/ipc';
import { Section } from '../shared';
import { useHermesUpdateCheck } from '../useHermesUpdateCheck';

type ActionStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; message?: string }
  | { kind: 'error'; message: string };

export function HermesUpdateSection() {
  const { t } = useTranslation();
  const { result, checking, recheck } = useHermesUpdateCheck();
  const [restart, setRestart] = useState<ActionStatus>({ kind: 'idle' });
  const [upgrade, setUpgrade] = useState<ActionStatus>({ kind: 'idle' });

  async function doRestart() {
    if (restart.kind === 'running') return;
    setRestart({ kind: 'running' });
    try {
      await hermesGatewayRestart();
      setRestart({ kind: 'done' });
    } catch (e) {
      setRestart({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }

  async function doUpgrade() {
    if (upgrade.kind === 'running') return;
    setUpgrade({ kind: 'running' });
    try {
      // hermes_install dispatches to bootstrap-macos.sh on macOS or
      // bootstrap-windows.ps1 on Windows. Both are idempotent and
      // perform `git pull` + `uv pip install -e .` style refresh
      // when the existing repo is already cloned, which IS the
      // upgrade path. The script opens its own terminal window for
      // progress + may need elevation on Windows. We just kick it
      // off and surface the message.
      const out = await hermesInstall();
      setUpgrade({ kind: 'done', message: out.slice(0, 200) });
      // Re-probe version after upgrade so the badge refreshes.
      recheck();
    } catch (e) {
      setUpgrade({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }

  return (
    <Section
      id="settings-hermes-update"
      title={t('settings.hermes_update.title')}
      description={t('settings.hermes_update.desc')}
    >
      <div className="flex flex-col gap-3">
        {/* Row 1: version probe */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={recheck}
            disabled={checking}
          >
            {checking ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={RefreshCw} size="sm" />
            )}
            {t('settings.hermes_update.check')}
          </Button>
          <div className="min-w-0 flex-1 text-xs">
            {!result && !checking && (
              <span className="text-fg-subtle">{t('settings.hermes_update.idle')}</span>
            )}
            {checking && (
              <span className="text-fg-muted">{t('settings.hermes_update.checking')}</span>
            )}
            {result && !result.cli_available && (
              <span className="inline-flex items-center gap-1 text-fg-muted">
                <Icon icon={AlertCircle} size="sm" />
                {t('settings.hermes_update.not_installed')}
              </span>
            )}
            {result && result.cli_available && !result.update_available && (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <Icon icon={CheckCircle2} size="sm" />
                {t('settings.hermes_update.up_to_date', {
                  version: result.current_version ?? '?',
                })}
              </span>
            )}
            {result && result.update_available && (
              <span className="inline-flex items-start gap-1 text-amber-500">
                <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
                <span>
                  {result.latest_version
                    ? t('settings.hermes_update.available', {
                        current: result.current_version ?? '?',
                        latest: result.latest_version,
                      })
                    : t('settings.hermes_update.available_unknown_latest', {
                        current: result.current_version ?? '?',
                      })}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Row 2: gateway restart */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={doRestart}
            disabled={restart.kind === 'running'}
          >
            {restart.kind === 'running' ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={RotateCw} size="sm" />
            )}
            {t('settings.hermes_update.restart')}
          </Button>
          <div className="min-w-0 flex-1 text-xs">
            {restart.kind === 'idle' && (
              <span className="text-fg-subtle">{t('settings.hermes_update.restart_hint')}</span>
            )}
            {restart.kind === 'running' && (
              <span className="text-fg-muted">{t('settings.hermes_update.restart_running')}</span>
            )}
            {restart.kind === 'done' && (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <Icon icon={CheckCircle2} size="sm" />
                {t('settings.hermes_update.restart_done')}
              </span>
            )}
            {restart.kind === 'error' && (
              <span className="inline-flex items-start gap-1 text-rose-500">
                <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
                <span>{restart.message}</span>
              </span>
            )}
          </div>
        </div>

        {/* Row 3: in-app upgrade (re-runs bootstrap, idempotent) */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={doUpgrade}
            disabled={upgrade.kind === 'running'}
          >
            {upgrade.kind === 'running' ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Download} size="sm" />
            )}
            {t('settings.hermes_update.upgrade')}
          </Button>
          <div className="min-w-0 flex-1 text-xs">
            {upgrade.kind === 'idle' && (
              <span className="text-fg-subtle">{t('settings.hermes_update.upgrade_hint')}</span>
            )}
            {upgrade.kind === 'running' && (
              <span className="text-fg-muted">{t('settings.hermes_update.upgrade_running')}</span>
            )}
            {upgrade.kind === 'done' && (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <Icon icon={CheckCircle2} size="sm" />
                {t('settings.hermes_update.upgrade_done')}
              </span>
            )}
            {upgrade.kind === 'error' && (
              <span className="inline-flex items-start gap-1 text-rose-500">
                <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
                <span>{upgrade.message}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
