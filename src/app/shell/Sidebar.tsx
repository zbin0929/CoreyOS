import { type ReactNode, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouterState } from '@tanstack/react-router';
import { type LucideIcon, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV, type NavEntry } from '@/app/nav-config';
import { CoreyMark } from '@/components/ui/corey-mark';
import { Icon } from '@/components/ui/icon';
import { useAgentsStore } from '@/stores/agents';
import type { AdapterCapabilities, AdapterListEntry } from '@/lib/ipc';

function entryVisible(entry: NavEntry, caps: AdapterCapabilities | null): boolean {
  if (!entry.requires || !caps) return true;
  if (entry.requires === 'channels') return caps.channels.length > 0;
  return Boolean(caps[entry.requires]);
}

export function Sidebar() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const [manageExpanded, setManageExpanded] = useState<boolean>(
    () => localStorage.getItem('corey:sidebar:manage-expanded') === 'true',
  );
  const [manageUserCollapsed, setManageUserCollapsed] = useState(false);

  const adapters = useAgentsStore((s) => s.adapters);
  const activeId = useAgentsStore((s) => s.activeId);
  const activeEntry: AdapterListEntry | null = (() => {
    if (!adapters || adapters.length === 0) return null;
    if (activeId) {
      const hit = adapters.find((a) => a.id === activeId);
      if (hit) return hit;
    }
    return adapters.find((a) => a.is_default) ?? adapters[0] ?? null;
  })();
  const caps = activeEntry?.capabilities ?? null;

  const visible = NAV.filter((n) => entryVisible(n, caps));
  const core = visible.filter((n) => n.group === 'core');
  const tools = visible.filter((n) => n.group === 'tools');
  const manage = visible.filter((n) => n.group === 'manage');

  const manageHasActive = manage.some(
    (entry) => isActive(location.pathname, entry.path),
  );
  const effectiveManageExpanded = (manageExpanded || manageHasActive) && !manageUserCollapsed;

  useEffect(() => {
    if (manageHasActive) setManageUserCollapsed(false);
  }, [manageHasActive]);

  const toggleManage = useCallback(() => {
    setManageExpanded((v) => {
      const next = !v;
      localStorage.setItem('corey:sidebar:manage-expanded', String(next));
      setManageUserCollapsed(!next ? true : false);
      return next;
    });
  }, []);

  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col border-r border-border bg-bg-elev-1">
      <div
        data-tauri-drag-region
        className={cn(
          'flex h-12 shrink-0 items-center gap-2 border-b border-border pr-4 select-none',
          'pl-20 [@media(display-mode:fullscreen)]:pl-4',
        )}
      >
        <CoreyMark className="h-5 w-5 shrink-0" />
        <span className="truncate text-md font-semibold text-fg tracking-tight">
          {t('app.name')}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 mt-2">
        <SectionLabel>{t('nav.section_core')}</SectionLabel>
        {core.map((entry) => (
          <NavItem
            key={entry.id}
            to={entry.path}
            icon={entry.icon}
            active={isActive(location.pathname, entry.path)}
          >
            {t(entry.labelKey)}
          </NavItem>
        ))}

        <SectionLabel className="mt-4">{t('nav.section_tools')}</SectionLabel>
        {tools.map((entry) => (
          <NavItem
            key={entry.id}
            to={entry.path}
            icon={entry.icon}
            active={isActive(location.pathname, entry.path)}
          >
            {t(entry.labelKey)}
          </NavItem>
        ))}

        {manage.length > 0 && (
          <>
            <button
              type="button"
              onClick={toggleManage}
              aria-expanded={effectiveManageExpanded}
              className={cn(
                'mt-4 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle',
                'hover:text-fg-muted transition-colors duration-fast',
              )}
            >
              <Icon
                icon={ChevronRight}
                size="xs"
                className={cn(
                  'transition-transform duration-fast',
                  effectiveManageExpanded && 'rotate-90',
                )}
              />
              {t('nav.section_manage')}
            </button>

            {effectiveManageExpanded && manage.map((entry) => (
              <NavItem
                key={entry.id}
                to={entry.path}
                icon={entry.icon}
                active={isActive(location.pathname, entry.path)}
              >
                {t(entry.labelKey)}
              </NavItem>
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-border p-3 text-[10px] text-fg-subtle">
        <div className="font-mono">{t('app.name')} v{__APP_VERSION__}</div>
      </div>
    </aside>
  );
}

function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  active: boolean;
  children: ReactNode;
}

function NavItem({ to, icon: IconCmp, active, children }: NavItemProps) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm',
        'transition-colors duration-fast ease-enter',
        active
          ? 'bg-bg-elev-2 text-fg'
          : 'text-fg-muted hover:bg-bg-elev-2/60 hover:text-fg',
      )}
    >
      <Icon icon={IconCmp} size="md" />
      <span className="flex-1 truncate">{children}</span>
      {active ? <span className="h-4 w-0.5 rounded-sm bg-gold-500" /> : null}
    </Link>
  );
}

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}
