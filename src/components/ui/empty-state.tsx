import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: IconCmp, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg',
        'border border-dashed border-border bg-bg-elev-1/40 p-10 text-center',
        className,
      )}
    >
      {IconCmp ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-elev-2 text-fg-muted">
          <Icon icon={IconCmp} size="lg" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <h3 className="text-md font-semibold text-fg">{title}</h3>
        {description ? (
          <p className="max-w-sm text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
