import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/cn';
import {
  hermesConfigRead,
  ipcErrorMessage,
  type HermesConfigView,
} from '@/lib/ipc';

import { LlmProfilesSection } from './LlmProfilesSection';
import { ErrorBanner } from './shared';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; view: HermesConfigView }
  | { kind: 'error'; message: string };

export function ModelsRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const view = await hermesConfigRead();
      setState({ kind: 'loaded', view });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loaded = state.kind === 'loaded' ? state.view : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('models_page.title')}
        subtitle={t('models_page.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('models_page.title')}
              content={t('models_page.help_page')}
              testId="models-help"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={load}
              disabled={state.kind === 'loading'}
              title={t('models_page.reload_config')}
            >
              <Icon
                icon={RefreshCw}
                size="sm"
                className={cn(state.kind === 'loading' && 'animate-spin')}
              />
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              Reading Hermes config…
            </div>
          )}

          {state.kind === 'error' && <ErrorBanner message={state.message} onRetry={load} />}

          {loaded && !loaded.present && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm shadow-sm">
              <Icon icon={Info} size="md" className="mt-0.5 flex-none text-amber-500" />
              <div className="flex-1">
                <div className="font-medium text-amber-600">
                  Hermes config not found
                </div>
                <div className="mt-1 text-xs text-fg-muted">
                  Expected at <code className="font-mono">{loaded.config_path}</code>. Run{' '}
                  <code className="font-mono">hermes init</code> or install Hermes first.
                </div>
              </div>
            </div>
          )}

          <LlmProfilesSection />
        </div>
      </div>
    </div>
  );
}
