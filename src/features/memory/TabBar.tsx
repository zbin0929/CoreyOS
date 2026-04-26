import { useTranslation } from 'react-i18next';
import { Brain, Search, UserCircle2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

import type { ActiveTab, Tabs } from './utils';

export function TabBar({
  active,
  tabs,
  onSelect,
}: {
  active: ActiveTab;
  tabs: Tabs;
  onSelect: (kind: ActiveTab) => void;
}) {
  const { t } = useTranslation();
  const items: Array<{ kind: ActiveTab; label: string; icon: typeof Brain }> = [
    { kind: 'agent', label: t('memory.tab_agent'), icon: Brain },
    { kind: 'user', label: t('memory.tab_user'), icon: UserCircle2 },
    { kind: 'search', label: t('memory.tab_search'), icon: Search },
  ];
  return (
    <div
      role="tablist"
      aria-label={t('memory.title')}
      className="inline-flex self-start rounded-lg border border-border bg-bg p-0.5"
    >
      {items.map(({ kind, label, icon }) => {
        // Search tab has no file / dirty state; the dirty dot only
        // applies to the two editor tabs.
        const tab = kind !== 'search' ? tabs[kind] : null;
        const dirty =
          tab != null && tab.file != null && tab.dirty !== tab.file.content;
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={active === kind}
            onClick={() => onSelect(kind)}
            data-testid={`memory-tab-${kind}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition',
              active === kind
                ? 'bg-bg-elev-2 text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon icon={icon} size="sm" />
            <span>{label}</span>
            {/* Unsaved-changes dot mirrors the Skills editor convention
                so both pages feel like part of the same "authoring"
                surface. `aria-hidden` because the save button's
                disabled state already conveys dirtiness to ATs. */}
            {dirty && (
              <span
                aria-hidden
                className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent"
                data-testid={`memory-tab-${kind}-dirty`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
