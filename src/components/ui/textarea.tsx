import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded-md border border-border bg-bg-elev-1 px-2.5 py-1.5 text-sm',
        'text-fg placeholder:text-fg-subtle',
        'transition-colors duration-fast ease-enter',
        'focus-visible:outline-2 focus-visible:outline-gold-500 focus-visible:outline-offset-[-1px]',
        'focus-visible:border-gold-500/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-y',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
