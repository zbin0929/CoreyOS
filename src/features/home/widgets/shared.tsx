import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, EyeOff } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';
import { useHomeLayoutStore } from '@/stores/homeLayout';

/**
 * Visual chrome shared by every Home widget. Renders the gradient
 * card, the title row, optional `action` slot (e.g. "查看全部"),
 * and an edit-mode "hide" affordance that lets users dismiss the
 * widget without leaving the page.
 */
export function WidgetCard({
  id,
  title,
  action,
  children,
  className,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const editing = useHomeLayoutStore((s) => s.editing);
  const hide = useHomeLayoutStore((s) => s.hide);
  return (
    <section
      className={cn(
        'relative rounded-2xl border border-[var(--glass-border)] p-4 shadow-[var(--shadow-1)]',
        'transition-all duration-200 hover:border-[var(--glass-border-hover)]',
        editing && 'ring-2 ring-gold-500/30',
        className,
      )}
      style={{ background: 'var(--gradient-card)' }}
      data-widget-id={id}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        <div className="flex items-center gap-1">
          {action}
          {editing && (
            <button
              type="button"
              onClick={() => hide(id)}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-2 text-[10px] text-fg-subtle transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
              data-testid={`widget-hide-${id}`}
            >
              <Icon icon={EyeOff} size="xs" />
              <span>隐藏</span>
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function EmptyHint({
  icon,
  text,
}: {
  icon: LucideIcon;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-fg-subtle">
      <Icon icon={icon} size="lg" className="opacity-20" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

export function MetricChip({
  icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  color: 'blue' | 'amber' | 'emerald' | 'violet';
}) {
  const glow = {
    blue: '0 0 20px hsl(212 92% 60% / 0.15)',
    amber: '0 0 20px hsl(38 90% 56% / 0.15)',
    emerald: '0 0 20px hsl(155 80% 50% / 0.15)',
    violet: '0 0 20px hsl(270 70% 60% / 0.15)',
  };
  const text = {
    blue: 'text-blue-600 dark:text-blue-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    violet: 'text-violet-600 dark:text-violet-400',
  };
  const iconGlow = {
    blue: 'drop-shadow-[0_0_6px_hsl(212_92%_60%/0.5)]',
    amber: 'drop-shadow-[0_0_6px_hsl(38_90%_56%/0.5)]',
    emerald: 'drop-shadow-[0_0_6px_hsl(155_80%_50%/0.5)]',
    violet: 'drop-shadow-[0_0_6px_hsl(270_70%_60%/0.5)]',
  };
  return (
    <div
      className="animate-slide-up group flex items-center gap-3 rounded-xl border border-[var(--glass-border)] p-4 transition-all duration-200 hover:border-[var(--glass-border-hover)]"
      style={{ background: 'var(--gradient-card)', boxShadow: glow[color] }}
    >
      <span
        className={cn(
          'flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-[var(--glass-bg)]',
          text[color],
        )}
      >
        <Icon icon={icon} size="md" className={iconGlow[color]} />
      </span>
      <div className="min-w-0">
        <div
          className={cn(
            'text-2xl font-bold tracking-tight tabular-nums',
            text[color],
          )}
        >
          {value}
        </div>
        <div className="text-[11px] font-medium text-fg-subtle">{label}</div>
      </div>
    </div>
  );
}

export function SideAction({
  icon,
  label,
  color,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  color: 'blue' | 'purple' | 'emerald' | 'gray';
  onClick: () => void;
}) {
  const iconColor = {
    blue: 'text-blue-600 dark:text-blue-400 drop-shadow-[0_0_4px_hsl(212_92%_60%/0.4)]',
    purple: 'text-purple-600 dark:text-purple-400 drop-shadow-[0_0_4px_hsl(270_70%_60%/0.4)]',
    emerald:
      'text-emerald-600 dark:text-emerald-400 drop-shadow-[0_0_4px_hsl(155_80%_50%/0.4)]',
    gray: 'text-fg-subtle',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 hover:bg-[var(--glass-bg-hover)]"
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[var(--glass-bg)]">
        <Icon icon={icon} size="sm" className={iconColor[color]} />
      </span>
      <span className="text-sm font-medium text-fg">{label}</span>
      <Icon
        icon={ArrowRight}
        size="xs"
        className="ml-auto text-fg-subtle opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
      />
    </button>
  );
}
