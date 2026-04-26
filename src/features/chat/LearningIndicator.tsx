import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { useChatStore } from '@/stores/chat';

/**
 * Tiny status strip rendered below the composer that flashes
 * "Learning extracted" for 5 s after the learning subsystem indexes
 * a message. Subscribed to a single `lastLearningAt` timestamp on
 * the chat store — every successful extraction bumps the timestamp,
 * which re-triggers the visibility timeout.
 *
 * Lives in its own file because (a) it's a self-contained subscriber
 * with its own `useEffect`, and (b) keeping it out of `index.tsx`
 * keeps `ChatPane` focused on the conversation lifecycle rather than
 * peripheral toasts.
 */
export function LearningIndicator() {
  const { t } = useTranslation();
  const lastLearningAt = useChatStore((s) => s.lastLearningAt);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastLearningAt) return;
    setVisible(true);
    const h = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(h);
  }, [lastLearningAt]);

  if (!visible) return null;

  return (
    <div className="flex items-center justify-center gap-1.5 py-1 text-[10px] text-fg-subtle">
      <Icon icon={Sparkles} size="xs" className="text-gold-500" />
      {t('chat_page.learning_extracted')}
    </div>
  );
}
