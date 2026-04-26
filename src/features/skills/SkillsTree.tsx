import { useTranslation } from 'react-i18next';
import { AlertCircle, FileText, FolderClosed, Loader2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { SkillSummary } from '@/lib/ipc';

import type { Selection } from './helpers';

export function SkillsTree({
  list,
  groups,
  listError,
  sel,
  onSelect,
}: {
  list: SkillSummary[] | null;
  groups: Array<{ group: string | null; rows: SkillSummary[] }>;
  listError: string | null;
  sel: Selection;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside
      className="flex w-72 flex-none flex-col overflow-hidden border-r border-border bg-bg-elev-1"
      data-testid="skills-tree"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {listError && (
          <div className="m-2 flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span className="break-all">{listError}</span>
          </div>
        )}
        {list === null ? (
          <div className="flex items-center gap-2 p-3 text-xs text-fg-muted">
            <Icon icon={Loader2} size="sm" className="animate-spin" />
            {t('common.loading')}
          </div>
        ) : list.length === 0 ? (
          <div className="p-3 text-xs text-fg-subtle">
            {t('skills.empty_tree')}
          </div>
        ) : (
          <ul className="flex flex-col">
            {groups.map(({ group, rows }) => (
              <li key={group ?? '__root__'}>
                {group !== null && (
                  <div className="flex items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                    <Icon icon={FolderClosed} size="xs" />
                    <span className="truncate">{group}</span>
                  </div>
                )}
                <ul className="flex flex-col">
                  {rows.map((s) => (
                    <li key={s.path}>
                      <button
                        type="button"
                        onClick={() => onSelect(s.path)}
                        className={cn(
                          'flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors',
                          'hover:bg-bg-elev-2',
                          sel.kind !== 'none' &&
                            'path' in sel &&
                            sel.path === s.path &&
                            'bg-bg-elev-2 text-fg',
                        )}
                        data-testid={`skill-row-${s.path}`}
                      >
                        <Icon icon={FileText} size="xs" className="flex-none text-fg-subtle" />
                        <span className="truncate">{s.name}</span>
                        {s.path.startsWith('auto/') && (
                          <span className="ml-auto flex-none rounded border border-gold-500/40 bg-gold-500/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-gold-500">
                            AI
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
