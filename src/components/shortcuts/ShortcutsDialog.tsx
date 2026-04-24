import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { NAV } from '@/app/nav-config';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/cn';
import { useShortcutsStore } from './useShortcuts';

/**
 * T-polish — global keyboard-shortcut cheat sheet.
 *
 * Triggered by pressing `?` anywhere outside a text input. Renders a
 * centered modal listing every discoverable shortcut grouped into
 * Navigation (the ⌘1..⌘9 nav links + ⌘, for Settings) and Actions
 * (palette, theme toggle, and this dialog itself).
 *
 * Deliberately NOT in the command palette: the palette is action-
 * oriented ("go do a thing"), while this is reference ("what can I
 * press"). Two different intents.
 */

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const open = useShortcutsStore((s) => s.open);
  const setOpen = useShortcutsStore((s) => s.setOpen);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  // Navigation shortcuts — pulled straight from nav-config so adding a
  // new route with a `shortcut:` entry surfaces here automatically.
  const navShortcuts = NAV.filter((n) => n.shortcut && n.shortcut.length >= 2).map(
    (n) => ({
      label: t(n.labelKey),
      keys: n.shortcut as [string, string],
    }),
  );

  // Hand-curated action shortcuts — these aren't route jumps, so they
  // don't live in nav-config. Kept inline; if the list grows past ~6
  // we'll factor out into its own config.
  const actionShortcuts: Array<{ labelKey: string; keys: string[] }> = [
    { labelKey: 'shortcuts.palette', keys: ['mod', 'k'] },
    { labelKey: 'shortcuts.theme', keys: ['mod', 'shift', 'l'] },
    { labelKey: 'shortcuts.help', keys: ['?'] },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24"
      onClick={() => setOpen(false)}
      data-testid="shortcuts-dialog-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden',
          'rounded-lg border border-border bg-bg-elev-1 shadow-2',
          'animate-[drawerUp_180ms_cubic-bezier(0.2,0.8,0.2,1)]',
        )}
        data-testid="shortcuts-dialog"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">{t('shortcuts.title')}</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            aria-label={t('widgets.close')}
            data-testid="shortcuts-dialog-close"
          >
            <Icon icon={X} size="sm" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <Section title={t('shortcuts.group_navigation')}>
            {navShortcuts.map(({ label, keys }) => (
              <Row key={label} label={label} keys={keys} />
            ))}
          </Section>

          <Section title={t('shortcuts.group_actions')}>
            {actionShortcuts.map(({ labelKey, keys }) => (
              <Row key={labelKey} label={t(labelKey)} keys={keys} />
            ))}
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {title}
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function Row({ label, keys }: { label: string; keys: string[] }) {
  return (
    <li className="flex items-center justify-between py-1.5 text-xs text-fg">
      <span>{label}</span>
      <Kbd keys={keys} />
    </li>
  );
}
