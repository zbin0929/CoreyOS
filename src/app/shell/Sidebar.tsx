import { type ReactNode, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouterState } from '@tanstack/react-router';
import { convertFileSrc } from '@tauri-apps/api/core';
import { type LucideIcon, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isMac } from '@/lib/platform';
import { NAV, type NavEntry } from '@/app/nav-config';
import { CoreyMark } from '@/components/ui/corey-mark';
import { Icon } from '@/components/ui/icon';
import { useAgentsStore } from '@/stores/agents';
import { useTasksStore } from '@/stores/tasks';
import { useBrandAppName, useBrandLogoUrl, useCustomerConfig, useHiddenRoutes } from '@/stores/customer';
import { usePackStore } from '@/lib/usePackStore';
import { lucideByName } from '@/lib/lucide-map';
import type { AdapterCapabilities, AdapterListEntry } from '@/lib/ipc';
import type { PackView } from '@/lib/ipc/pack';
import { ChatHeroBlock } from './ChatHeroBlock';

function entryVisible(entry: NavEntry, caps: AdapterCapabilities | null): boolean {
  if (!entry.requires || !caps) return true;
  if (entry.requires === 'channels') return caps.channels.length > 0;
  return Boolean(caps[entry.requires]);
}

/**
 * Wrap `convertFileSrc` in a try/catch so the white-label brand
 * logo never crashes the sidebar. Outside Tauri (vitest, web-only
 * dev) the call throws — we fall back to the empty string, which
 * the caller treats as "use default brand".
 */
function safeConvertFileSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return '';
  }
}

export function Sidebar() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const [libraryExpanded, setLibraryExpanded] = useState<boolean>(
    () => localStorage.getItem('corey:sidebar:library-expanded') === 'true',
  );
  const [libraryUserCollapsed, setLibraryUserCollapsed] = useState(false);

  const adapters = useAgentsStore((s) => s.adapters);
  const activeId = useAgentsStore((s) => s.activeId);
  const runningTasksCount = useTasksStore((s) => s.runningCount + s.pausedCount);
  const activeEntry: AdapterListEntry | null = (() => {
    if (!adapters || adapters.length === 0) return null;
    if (activeId) {
      const hit = adapters.find((a) => a.id === activeId);
      if (hit) return hit;
    }
    return adapters.find((a) => a.is_default) ?? adapters[0] ?? null;
  })();
  const caps = activeEntry?.capabilities ?? null;

  // White-label overrides loaded once at startup from
  // `~/.hermes/customer.yaml`. Empty / null when no file is
  // present, in which case we fall back to default Corey brand
  // and the full NAV.
  const hiddenRoutes = useHiddenRoutes();
  const brandAppName = useBrandAppName(t('app.name'));
  const brandLogoPath = useBrandLogoUrl();
  const brandLogoSrc = brandLogoPath ? safeConvertFileSrc(brandLogoPath) : '';

  const packViews = usePackStore((s) => s.views);
  const packRefresh = usePackStore((s) => s.refresh);
  const customerCfg = useCustomerConfig();

  useEffect(() => {
    void packRefresh();
  }, [packRefresh]);

  const pinToPrimary = new Set(customerCfg?.packs?.pinToPrimary ?? []);

  const effectivePackViews = packViews.map((v) => {
    const viewKey = `${v.packId}/${v.viewId}`;
    if (pinToPrimary.has(viewKey) || pinToPrimary.has(v.viewId)) {
      return { ...v, navSection: 'primary' };
    }
    return v;
  });

  const visible = NAV.filter(
    (n) => entryVisible(n, caps) && !hiddenRoutes.has(n.id),
  );
  const heroEntry = visible.find((n) => n.group === 'hero') ?? null;
  const workspace = visible.filter((n) => n.group === 'workspace');
  const library = visible.filter((n) => n.group === 'library');
  const utility = visible.filter((n) => n.group === 'utility');
  const settingsEntries = visible.filter((n) => n.group === 'settings');

  const packViewsForSidebar = effectivePackViews;

  const libraryHasActive = library.some(
    (entry) => isActive(location.pathname, entry.path),
  );
  const effectiveLibraryExpanded =
    (libraryExpanded || libraryHasActive) && !libraryUserCollapsed;

  useEffect(() => {
    if (libraryHasActive) setLibraryUserCollapsed(false);
  }, [libraryHasActive]);

  const toggleLibrary = useCallback(() => {
    setLibraryExpanded((v) => {
      const next = !v;
      localStorage.setItem('corey:sidebar:library-expanded', String(next));
      setLibraryUserCollapsed(!next ? true : false);
      return next;
    });
  }, []);

  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col border-r border-border/40" style={{ background: 'var(--gradient-sidebar)' }}>
      <div
        data-tauri-drag-region
        className={cn(
          'flex h-12 shrink-0 items-center gap-2 border-b border-border/80 pr-4 select-none',
          isMac() ? 'pl-20' : 'pl-4',
        )}
      >
        {brandLogoSrc ? (
          <img
            src={brandLogoSrc}
            alt=""
            role="presentation"
            draggable={false}
            className="h-5 w-5 shrink-0 select-none rounded-md object-contain"
          />
        ) : (
          <CoreyMark className="h-5 w-5 shrink-0" />
        )}
        <span className="truncate text-sm font-semibold text-fg tracking-tight">
          {brandAppName}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 mt-2">
        {heroEntry && (
          <ChatHeroBlock
            active={isActive(location.pathname, heroEntry.path)}
            shortcut={heroEntry.shortcut}
          />
        )}

        {workspace.length > 0 && (
          <>
            <SectionLabel>{t('nav.section_workspace')}</SectionLabel>
            {workspace.map((entry) => (
              <NavItem
                key={entry.id}
                to={entry.path}
                icon={entry.icon}
                active={isActive(location.pathname, entry.path)}
                badge={entry.id === 'tasks' ? runningTasksCount : null}
              >
                {t(entry.labelKey)}
              </NavItem>
            ))}
          </>
        )}

        {utility.length > 0 && (
          <>
            <SectionLabel className="mt-4">{t('nav.section_utility')}</SectionLabel>
            {utility.map((entry) => (
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

        {library.length > 0 && (
          <>
            <button
              type="button"
              onClick={toggleLibrary}
              aria-expanded={effectiveLibraryExpanded}
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
                  effectiveLibraryExpanded && 'rotate-90',
                )}
              />
              {t('nav.section_library')}
            </button>

            {effectiveLibraryExpanded && library.map((entry) => (
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

        {packViewsForSidebar.length > 0 && (
          <PackGroupSection views={packViewsForSidebar} pathname={location.pathname} />
        )}
      </nav>

      {settingsEntries.map((entry) => {
        const settingsActive = isActive(location.pathname, entry.path);
        return (
          <Link
            key={entry.id}
            to={entry.path}
            className={cn(
              'group relative flex h-10 items-center gap-2.5 border-t border-border/60 px-4 text-sm',
              'transition-all duration-fast ease-enter',
              settingsActive
                ? 'bg-bg-elev-2/60 text-fg font-medium'
                : 'text-fg-muted hover:bg-bg-elev-2/30 hover:text-fg',
            )}
          >
            {settingsActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold-500" />}
            <Icon icon={entry.icon} size="md" className={settingsActive ? 'text-gold-500' : ''} />
            <span className="flex-1 truncate">{t(entry.labelKey)}</span>
          </Link>
        );
      })}
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
  badge?: number | null;
}

function NavItem({ to, icon: IconCmp, active, children, badge }: NavItemProps) {
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <Link
      to={to}
      className={cn(
        'group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm',
        'transition-all duration-200 ease-enter',
        active
          ? 'bg-gold-500/10 text-fg font-medium'
          : 'text-fg-muted hover:bg-[var(--glass-bg-hover)] hover:text-fg',
      )}
    >
      {active && (
        <>
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold-500 shadow-[0_0_8px_hsl(38_90%_56%/0.6)]" />
          <span className="absolute inset-0 rounded-lg bg-gold-500/5" />
        </>
      )}
      <Icon icon={IconCmp} size="md" className={cn('relative transition-colors', active ? 'text-gold-500 drop-shadow-[0_0_6px_hsl(38_90%_56%/0.5)]' : 'group-hover:text-fg-muted')} />
      <span className="relative flex-1 truncate">{children}</span>
      {showBadge && (
        <span className="relative ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-info/20 px-1.5 text-[10px] font-semibold text-info">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function PackNavItem({ view, pathname }: { view: PackView; pathname: string }) {
  const to = `/pack/${view.packId}/${view.viewId}`;
  const active = isActive(pathname, to);
  const icon = lucideByName(view.icon);
  return (
    <Link
      to={to}
      className={cn(
        'group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm',
        'transition-all duration-200 ease-enter',
        active
          ? 'bg-gold-500/10 text-fg font-medium'
          : 'text-fg-muted hover:bg-[var(--glass-bg-hover)] hover:text-fg',
      )}
    >
      {active && (
        <>
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold-500 shadow-[0_0_8px_hsl(38_90%_56%/0.6)]" />
          <span className="absolute inset-0 rounded-lg bg-gold-500/5" />
        </>
      )}
      <Icon icon={icon} size="md" className={cn('relative transition-colors', active ? 'text-gold-500 drop-shadow-[0_0_6px_hsl(38_90%_56%/0.5)]' : '')} />
      <span className="relative flex-1 truncate">{view.title || view.viewId}</span>
    </Link>
  );
}

function PackGroupSection({ views, pathname }: { views: PackView[]; pathname: string }) {
  const { t } = useTranslation();
  const groups = new Map<string, { title: string; views: PackView[] }>();
  for (const v of views) {
    const existing = groups.get(v.packId);
    if (existing) {
      existing.views.push(v);
    } else {
      groups.set(v.packId, { title: v.packTitle || v.packId, views: [v] });
    }
  }

  const hasActive = views.some((v) => isActive(pathname, `/pack/${v.packId}/${v.viewId}`));
  const [expanded, setExpanded] = useState(hasActive);

  useEffect(() => {
    if (hasActive) setExpanded(true);
  }, [hasActive]);

  if (groups.size === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border/80 bg-bg-elev-1/50 p-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle',
          'hover:text-fg-muted transition-colors duration-fast',
        )}
      >
        <Icon
          icon={ChevronRight}
          size="xs"
          className={cn('transition-transform duration-fast', expanded && 'rotate-90')}
        />
        {t('nav.section_packs')}
      </button>
      {expanded &&
        [...groups.entries()].map(([packId, group]) => (
          <div key={packId} className="mt-1.5">
            <div className="px-2.5 pb-0.5 text-[11px] font-medium text-fg-muted truncate">
              {group.title}
            </div>
            {group.views.map((v) => (
              <PackNavItem
                key={`pack-${v.packId}-${v.viewId}`}
                view={v}
                pathname={pathname}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}
