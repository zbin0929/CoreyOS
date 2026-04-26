import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/**
 * Regenerate-the-last-response affordance. Hover-revealed on the same
 * action row as `CopyButton` so users who already know the pattern
 * discover this automatically. Kept as a simple click (no confirm) —
 * the current assistant body is gone the moment the new stream
 * starts, which matches user expectation for "retry".
 */
export function RetryButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]',
        'text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg',
        'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto',
      )}
      aria-label={t('chat_page.retry')}
      title={t('chat_page.retry_title')}
      data-testid="message-retry"
    >
      <Icon icon={RefreshCw} size="xs" />
    </button>
  );
}
