import { useTranslation } from 'react-i18next';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { learningReadLearnings, learningWriteLearnings } from '@/lib/ipc';
import { useChatStore, type UiMessage } from '@/stores/chat';

import { TtsButton } from './TtsButton';

/**
 * T6.1 — 👍/👎 per assistant reply. Click once to stamp, click the
 * same button again to clear. Persisted via `setMessageFeedback` in
 * the chat store (fire-and-forget DB write). The rating survives
 * reloads and rolls up into Analytics totals.
 *
 * Side effect: a positive/negative rating is also appended to the
 * user's `learnings.md` so future agent turns can read the user's
 * preferred / avoided patterns. Failures are swallowed —
 * learnings.md is best-effort context, not critical state.
 */
export function FeedbackButtons({ msg }: { msg: UiMessage }) {
  const { t } = useTranslation();
  const sessionId = useChatStore((s) => s.currentId);
  const setFeedback = useChatStore((s) => s.setMessageFeedback);

  function toggle(value: 'up' | 'down') {
    if (!sessionId) return;
    const next = msg.feedback === value ? null : value;
    setFeedback(sessionId, msg.id, next);
    if (next) void appendLearning(next, msg.content);
  }

  async function appendLearning(kind: 'up' | 'down', content: string) {
    try {
      const existing = await learningReadLearnings();
      const section = kind === 'up' ? '## preferred (👍 patterns)' : '## avoided (👎 patterns)';
      const summary = content.slice(0, 100).replace(/\n/g, ' ');
      const entry = `- ${summary}`;
      let lines = existing || '';
      if (!lines.includes('## preferred')) lines += '\n## preferred (👍 patterns)\n';
      if (!lines.includes('## avoided')) lines += '\n## avoided (👎 patterns)\n';
      const updated = lines.replace(section, `${section}\n${entry}`);
      await learningWriteLearnings(updated);
    } catch {
      // fire-and-forget
    }
  }

  // Keep action buttons keyboard-reachable: `visibility:hidden`
  // removes them from the tab order in several engines, so we hide via
  // opacity + pointer-events instead and reveal on hover OR focus.
  const revealable =
    'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto';
  const baseBtn =
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition';
  const idleBtn = cn('text-fg-subtle hover:bg-bg-elev-2 hover:text-fg', revealable);
  const activeUp = 'opacity-100 pointer-events-auto text-emerald-500';
  const activeDown = 'opacity-100 pointer-events-auto text-danger';

  return (
    <>
      <button
        type="button"
        onClick={() => toggle('up')}
        className={cn(baseBtn, msg.feedback === 'up' ? activeUp : idleBtn)}
        aria-label={t('chat_page.feedback_up')}
        aria-pressed={msg.feedback === 'up'}
        title={t('chat_page.feedback_up')}
        data-testid={`bubble-feedback-up-${msg.id}`}
      >
        <Icon icon={ThumbsUp} size="xs" />
      </button>
      <button
        type="button"
        onClick={() => toggle('down')}
        className={cn(baseBtn, msg.feedback === 'down' ? activeDown : idleBtn)}
        aria-label={t('chat_page.feedback_down')}
        aria-pressed={msg.feedback === 'down'}
        title={t('chat_page.feedback_down')}
        data-testid={`bubble-feedback-down-${msg.id}`}
      >
        <Icon icon={ThumbsDown} size="xs" />
      </button>
      {msg.role === 'assistant' && msg.content.trim().length > 0 && (
        <TtsButton content={msg.content} />
      )}
    </>
  );
}
