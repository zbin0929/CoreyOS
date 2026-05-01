import { type ReactNode, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouterState } from '@tanstack/react-router';
import { convertFileSrc } from '@tauri-apps/api/core';
import { type LucideIcon, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV, type NavEntry } from '@/app/nav-config';
import { CoreyMark } from '@/components/ui/corey-mark';
import { Icon } from '@/components/ui/icon';
import { useAgentsStore } from '@/stores/agents';
import { useBrandAppName, useBrandLogoUrl, useHiddenRoutes } from '@/stores/customer';
import { usePackStore } from '@/lib/usePackStore';
import { lucideByName } from '@/lib/lucide-map';
import type { AdapterCapabilities, AdapterListEntry } from '@/lib/ipc';
import type { PackView } from '@/lib/ipc/pack';

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
  const [moreExpanded, setMoreExpanded] = useState<boolean>(
    () => localStorage.getItem('corey:sidebar:more-expanded') === 'true',
  );
  const [moreUserCollapsed, setMoreUserCollapsed] = useState(false);

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

  useEffect(() => {
    void packRefresh();
  }, [packRefresh]);

  const visible = NAV.filter(
    (n) => entryVisible(n, caps) && !hiddenRoutes.has(n.id),
  );
  const primary = visible.filter((n) => n.group === 'primary');
  const tools = visible.filter((n) => n.group === 'tools');
  const more = visible.filter((n) => n.group === 'more');
  const settingsEntries = visible.filter((n) => n.group === 'settings');

  const packPrimary = packViews.filter((v) => v.navSection === 'primary');
  const packTools = packViews.filter((v) => v.navSection === 'tools');
  const packMore = packViews.filter((v) => v.navSection === 'more');
  const packDefault = packViews.filter(
    (v) => !['primary', 'tools', 'more'].includes(v.navSection),
  );

  const moreHasActive = more.some(
    (entry) => isActive(location.pathname, entry.path),
  );
  const effectiveMoreExpanded = (moreExpanded || moreHasActive) && !moreUserCollapsed;

  useEffect(() => {
    if (moreHasActive) setMoreUserCollapsed(false);
  }, [moreHasActive]);

  const toggleMore = useCallback(() => {
    setMoreExpanded((v) => {
      const next = !v;
      localStorage.setItem('corey:sidebar:more-expanded', String(next));
      setMoreUserCollapsed(!next ? true : false);
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
        <span className="truncate text-md font-semibold text-fg tracking-tight">
          {brandAppName}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 mt-2">
        <SectionLabel>{t('nav.section_primary')}</SectionLabel>
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
        {packPrimary.map((v) => (
          <PackNavItem key={`pack-${v.packId}-${v.viewId}`} view={v} pathname={location.pathname} />
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
        {packTools.map((v) => (
          <PackNavItem key={`pack-${v.packId}-${v.viewId}`} view={v} pathname={location.pathname} />
        ))}

        {more.length > 0 && (
          <>
            <button
              type="button"
              onClick={toggleMore}
              aria-expanded={effectiveMoreExpanded}
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
                  effectiveMoreExpanded && 'rotate-90',
                )}
              />
              {t('nav.section_more')}
            </button>

            {effectiveMoreExpanded && more.map((entry) => (
              <NavItem
                key={entry.id}
                to={entry.path}
                icon={entry.icon}
                active={isActive(location.pathname, entry.path)}
              >
                {t(entry.labelKey)}
              </NavItem>
            ))}
            {effectiveMoreExpanded && packMore.map((v) => (
              <PackNavItem key={`pack-${v.packId}-${v.viewId}`} view={v} pathname={location.pathname} />
            ))}
          </>
        )}

        {packDefault.length > 0 && (
          <>
            <SectionLabel className="mt-4">{t('nav.section_packs')}</SectionLabel>
            {packDefault.map((v) => (
              <PackNavItem key={`pack-${v.packId}-${v.viewId}`} view={v} pathname={location.pathname} />
            ))}
          </>
        )}
      </nav>

      {settingsEntries.map((entry) => (
        <Link
          key={entry.id}
          to={entry.path}
          className={cn(
            'group flex h-10 items-center gap-2.5 border-t border-border px-4 text-sm',
            'transition-colors duration-fast ease-enter',
            isActive(location.pathname, entry.path)
              ? 'text-fg'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          <Icon icon={entry.icon} size="md" />
          <span className="flex-1 truncate">{t(entry.labelKey)}</span>
        </Link>
      ))}
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

function PackNavItem({ view, pathname }: { view: PackView; pathname: string }) {
  const to = `/pack/${view.packId}/${view.viewId}`;
  const active = isActive(pathname, to);
  const icon = lucideByName(view.icon);
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
      <Icon icon={icon} size="md" />
      <span className="flex-1 truncate">{view.title || view.viewId}</span>
      {active ? <span className="h-4 w-0.5 rounded-sm bg-gold-500" /> : null}
    </Link>
  );
}

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}
