import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BookMarked, Sun, Moon, ArrowRight, type LucideIcon } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { usePaletteStore } from '@/stores/palette';
import { useUIStore } from '@/stores/ui';
import { useComposerStore } from '@/stores/composer';
import { NAV } from '@/app/nav-config';
import { Kbd } from '@/components/ui/kbd';
import { runbookList, type RunbookRow } from '@/lib/ipc';
import { detectParams, renderRunbook, runbookScopeApplies } from '@/features/runbooks';
import { useAppStatusStore } from '@/stores/appStatus';

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const navigate = useNavigate();
  const { t } = useTranslation();
  // T4.6: Runbooks live in SQLite, so we only fetch once per palette open
  // (cheap but not free). Clears on close so a delete/edit elsewhere is
  // picked up next time.
  const [runbooks, setRunbooks] = useState<RunbookRow[]>([]);
  const activeProfile = useAppStatusStore((s) => s.activeProfile);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void runbookList().then((rows) => {
      if (!cancelled) setRunbooks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  // T4.6b — hide runbooks scoped to a different profile. Unlike the
  // Runbooks page there's no "show all" toggle in the palette; we want
  // it tightly scoped to the current profile's workflow.
  const visibleRunbooks = runbooks.filter((rb) =>
    runbookScopeApplies(rb, activeProfile),
  );

  // Global ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        usePaletteStore.getState().toggle();
      }
      if (e.key === 'Escape' && usePaletteStore.getState().open) {
        usePaletteStore.getState().setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[640px] overflow-hidden rounded-lg border border-border-strong bg-bg-elev-2 shadow-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="flex flex-col">
          <Command.Input
            placeholder={t('palette.placeholder')}
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
          <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
            <Command.Empty className="py-8 text-center text-sm text-fg-subtle">
              {t('palette.empty')}
            </Command.Empty>

            <Command.Group
              heading={t('palette.group.goto')}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle"
            >
              {NAV.map((entry) => (
                <PaletteItem
                  key={entry.id}
                  value={`goto ${entry.id} ${t(entry.labelKey)}`}
                  onSelect={() => run(() => navigate({ to: entry.path }))}
                  icon={entry.icon}
                  label={t(entry.labelKey)}
                  hint={entry.shortcut}
                />
              ))}
            </Command.Group>

            {visibleRunbooks.length > 0 && (
              <Command.Group
                heading={t('palette.group.runbooks')}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle"
              >
                {visibleRunbooks.map((rb) => (
                  <PaletteItem
                    key={rb.id}
                    value={`run ${rb.name} ${rb.description ?? ''}`}
                    onSelect={() =>
                      run(() => {
                        // If the runbook has params, take the user to
                        // /runbooks where the fill-form lives; otherwise
                        // substitute (no-op) and drop straight into chat.
                        if (detectParams(rb.template).length > 0) {
                          void navigate({ to: '/runbooks' });
                        } else {
                          useComposerStore
                            .getState()
                            .setPendingDraft(renderRunbook(rb.template, {}));
                          void navigate({ to: '/chat' });
                        }
                      })
                    }
                    icon={BookMarked}
                    label={rb.name}
                  />
                ))}
              </Command.Group>
            )}

            <Command.Group
              heading={t('palette.group.preferences')}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle"
            >
              <PaletteItem
                value="toggle theme"
                onSelect={() => run(toggleTheme)}
                icon={useUIStore.getState().theme === 'dark' ? Sun : Moon}
                label={t('palette.theme.toggle')}
                hint={['mod', 'shift', 'l']}
              />
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

interface PaletteItemProps {
  value: string;
  onSelect: () => void;
  icon: LucideIcon;
  label: string;
  hint?: string[] | undefined;
}

function PaletteItem({ value, onSelect, icon: IconCmp, label, hint }: PaletteItemProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center gap-2.5 rounded px-2 text-sm text-fg-muted data-[selected=true]:bg-bg-elev-3 data-[selected=true]:text-fg"
    >
      <Icon icon={IconCmp} size="md" />
      <span className="flex-1 truncate">{label}</span>
      {hint ? <Kbd keys={hint} /> : <Icon icon={ArrowRight} size="xs" className="opacity-0 group-data-[selected=true]:opacity-100" />}
    </Command.Item>
  );
}
