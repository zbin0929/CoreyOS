import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Cpu, ScrollText } from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { HermesLogKind } from '@/lib/ipc';
import { ChangelogPanel } from './ChangelogPanel';
import { HermesLogPanel } from './HermesLogPanel';

/**
 * Logs route. A tabbed surface unifying:
 *
 *   - Agent  — `~/.hermes/logs/agent.log`  (agent reasoning / tool calls)
 *   - Gateway — `~/.hermes/logs/gateway.log` (chat completions traffic)
 *   - Error  — `~/.hermes/logs/error.log`  (promoted errors, all sources)
 *   - Changelog — Caduceus's own mutation journal (pre-T2.6 was the
 *     entire /logs route; kept as the right-most tab so muscle memory
 *     still works).
 *
 * Tab state lives in local component state only — deep-linking (e.g.
 * `/logs?tab=agent`) would be nice but isn't critical. Each panel
 * manages its own fetch/loading/error.
 */
type TabKey = HermesLogKind | 'changelog';

export function LogsRoute() {
  const { t } = useTranslation();
  const [active, setActive] = useState<TabKey>('agent');

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: typeof ScrollText;
  }> = [
    { key: 'agent', label: t('hermes_logs.tab.agent'), icon: Cpu },
    { key: 'gateway', label: t('hermes_logs.tab.gateway'), icon: Activity },
    { key: 'error', label: t('hermes_logs.tab.error'), icon: AlertTriangle },
    { key: 'changelog', label: t('hermes_logs.tab.changelog'), icon: ScrollText },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('logs.title')}
        subtitle={t('hermes_logs.page_subtitle')}
        actions={
          <InfoHint
            title={t('logs.title')}
            content={t('logs.help_page')}
            testId="logs-help"
          />
        }
      />

      {/* Tab strip. Renders just below the header, above the panel body
          so each panel scrolls independently without scrolling the tabs. */}
      <div
        role="tablist"
        aria-label={t('logs.title')}
        className="flex items-center gap-1 border-b border-border/60 bg-bg-elev-1/80 px-6 py-2 backdrop-blur-sm"
      >
        <div className="inline-flex rounded-lg border border-border bg-bg-elev-2/60 p-0.5">
          {tabs.map(({ key, label, icon: IconCmp }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`logs-tab-${key}`}
                onClick={() => setActive(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                  isActive
                    ? 'bg-bg-elev-1 text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                <Icon icon={IconCmp} size="sm" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {active === 'changelog' ? (
          <ChangelogPanel />
        ) : (
          <HermesLogPanel kind={active} />
        )}
      </div>
    </div>
  );
}
