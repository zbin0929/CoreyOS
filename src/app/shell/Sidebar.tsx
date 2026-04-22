import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouterState } from '@tanstack/react-router';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV } from '@/app/nav-config';
import { CoreyMark } from '@/components/ui/corey-mark';

export function Sidebar() {
  const { t } = useTranslation();
  const { location } = useRouterState();

  const primary = NAV.filter((n) => n.group === 'primary');
  const ops = NAV.filter((n) => n.group === 'ops');

  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col border-r border-border bg-bg-elev-1">
      {/* Brand — drag region, with left inset to clear macOS traffic lights.
          `pl-20` reserves ~80px for the system-rendered traffic lights
          (Tauri v2 `titleBarStyle: Overlay`); when the window is in
          fullscreen mode macOS hides the lights, so we collapse back to
          `pl-4` to avoid a dead-looking gap. `shrink-0` guards against
          the icon compressing when something pushes from inside. */}
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

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 p-2 mt-2">
        <SectionLabel>{t('nav.chat')} · {t('nav.compare')}</SectionLabel>
        {primary.map((entry) => (
          <NavItem
            key={entry.id}
            to={entry.path}
            icon={entry.icon}
            active={isActive(location.pathname, entry.path)}
          >
            {t(entry.labelKey)}
          </NavItem>
        ))}

        <SectionLabel className="mt-4">Ops</SectionLabel>
        {ops.map((entry) => (
          <NavItem
            key={entry.id}
            to={entry.path}
            icon={entry.icon}
            active={isActive(location.pathname, entry.path)}
          >
            {t(entry.labelKey)}
          </NavItem>
        ))}
      </nav>

      <div className="mt-auto p-3 text-[10px] text-fg-subtle">
        <div>{t('app.name')} dev build</div>
        <div className="mt-0.5 font-mono">Phase 0 · foundation</div>
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

function NavItem({ to, icon: Icon, active, children }: NavItemProps) {
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
      <Icon size={16} strokeWidth={1.5} />
      <span className="flex-1 truncate">{children}</span>
      {active ? <span className="h-4 w-0.5 rounded-sm bg-gold-500" /> : null}
    </Link>
  );
}

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}
