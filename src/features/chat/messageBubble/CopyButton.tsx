import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/**
 * Shown below each non-empty bubble. Hidden by default; revealed on hover of
 * the parent `.group` (or when pressed, to give the 'copied' feedback a beat
 * to be seen on touch).
 */
export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in some webview contexts — fall back silently.
      setCopied(false);
    }
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition',
        'text-fg-subtle hover:bg-bg-elev-2 hover:text-fg',
        copied
          ? 'opacity-100 pointer-events-auto text-gold-500'
          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto',
      )}
      aria-label={copied ? t('chat_page.copied') : t('chat_page.copy')}
      title={copied ? t('chat_page.copied') : t('chat_page.copy')}
    >
      {copied ? (
        <>
          <Icon icon={Check} size="xs" />
          {t('chat_page.copied')}
        </>
      ) : (
        <>
          <Icon icon={Copy} size="xs" />
        </>
      )}
    </button>
  );
}
