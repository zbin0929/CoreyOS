import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Section } from '../shared';
import { useHermesUpdateCheck } from '../useHermesUpdateCheck';

export function HermesUpdateSection() {
  const { t } = useTranslation();
  const { result, checking, recheck } = useHermesUpdateCheck();

  return (
    <Section
      id="settings-hermes-update"
      title={t('settings.hermes_update.title')}
      description={t('settings.hermes_update.desc')}
    >
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
    </Section>
  );
}
