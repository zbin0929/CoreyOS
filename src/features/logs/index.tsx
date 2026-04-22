import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Cpu, ScrollText } from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
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
      <PageHeader title={t('logs.title')} subtitle={t('hermes_logs.page_subtitle')} />

      {/* Tab strip. Renders just below the header, above the panel body
          so each panel scrolls independently without scrolling the tabs. */}
      <div
        role="tablist"
        aria-label={t('logs.title')}
        className="flex items-center gap-1 border-b border-border bg-bg-elev-1 px-6"
      >
        {tabs.map(({ key, label, icon: Icon }) => {
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
                'relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition',
                isActive
                  ? 'border-gold-500 text-fg'
                  : 'border-transparent text-fg-subtle hover:text-fg',
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              {label}
            </button>
          );
        })}
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
