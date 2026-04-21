import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-8 w-full rounded-md border border-border bg-bg-elev-1 px-2.5 text-sm',
        'text-fg placeholder:text-fg-subtle',
        'transition-colors duration-fast ease-enter',
        'focus-visible:outline-2 focus-visible:outline-gold-500 focus-visible:outline-offset-[-1px]',
        'focus-visible:border-gold-500/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
