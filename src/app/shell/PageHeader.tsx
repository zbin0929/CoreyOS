import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-center justify-between gap-4 border-b border-border/60 bg-bg/80 px-6 py-3 backdrop-blur-xl',
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle ? <p className="text-xs text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
