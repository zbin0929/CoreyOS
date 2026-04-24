import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouterState } from '@tanstack/react-router';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV, type NavEntry } from '@/app/nav-config';
import { CoreyMark } from '@/components/ui/corey-mark';
import { Icon } from '@/components/ui/icon';
import { useAgentsStore } from '@/stores/agents';
import type { AdapterCapabilities, AdapterListEntry } from '@/lib/ipc';

/** T5.5b — resolve whether a nav entry is allowed under the active
 *  adapter's capabilities. Entries with no `requires` field are always
 *  visible. Before the registry's first probe lands, nothing is hidden
 *  (we default to the full nav set so first paint doesn't flash shrink).
 *  `channels` is the only capability backed by an array — empty counts
 *  as "not supported". */
function entryVisible(entry: NavEntry, caps: AdapterCapabilities | null): boolean {
  if (!entry.requires || !caps) return true;
  if (entry.requires === 'channels') return caps.channels.length > 0;
  return Boolean(caps[entry.requires]);
}

export function Sidebar() {
  const { t } = useTranslation();
  const { location } = useRouterState();

  // T5.5b — capability-gated navigation. Derive the effective active
  // adapter reactively: persisted selection wins, fallback to registry
  // default, fallback to the first row. Using the raw array comparison
  // below avoids a store-selector function that would re-subscribe on
  // every render.
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
  const primary = visible.filter((n) => n.group === 'primary');
  const ops = visible.filter((n) => n.group === 'ops');

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

      {/* Primary nav — scrollable so the footer below always stays
          visible even on short viewports. Without overflow here the
          footer would be clipped off the bottom. */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 mt-2">
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

      {/* Sidebar footer intentionally minimal — just the product name +
          version. Previous "Phase 0 · foundation" marker was a dev
          artifact from the initial scaffold; it outlived its purpose
          once shipped phases went into CHANGELOG.md. */}
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
