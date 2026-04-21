import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'xs' | 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-gold-500 text-bg hover:bg-gold-600 active:bg-gold-700 disabled:bg-gold-500/40 disabled:text-bg/60',
  secondary:
    'bg-bg-elev-2 text-fg border border-border hover:bg-bg-elev-3 hover:border-border-strong disabled:opacity-50',
  ghost:
    'bg-transparent text-fg-muted hover:bg-bg-elev-2 hover:text-fg disabled:opacity-40',
  danger:
    'bg-danger text-fg hover:brightness-110 active:brightness-95 disabled:opacity-50',
};

const sizeClasses: Record<Size, string> = {
  xs: 'h-[22px] px-2 text-xs rounded-sm gap-1',
  sm: 'h-7 px-2.5 text-xs rounded gap-1.5',
  md: 'h-8 px-3 text-sm rounded-md gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap font-medium',
          'transition-colors duration-fast ease-enter',
          'focus-visible:outline-2 focus-visible:outline-gold-500 focus-visible:outline-offset-2',
          'disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
