import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/**
 * Collapsible "thinking" panel shown above reasoning-model answers.
 *
 * Behavior:
 *   - While streaming the reasoning (no `content` yet), the panel is
 *     OPEN so the user can watch the chain-of-thought arrive in real
 *     time.
 *   - The moment final content starts flowing, we flip to CLOSED so
 *     the chain-of-thought doesn't compete with the answer for reading
 *     focus. The user can still click the summary to re-expand —
 *     `userOpened` pins it open once they do, so the final content
 *     doesn't yank it shut mid-read.
 *   - Uses `<details>` with a controlled `open` attribute so the
 *     open/close transition is browser-native and doesn't re-render
 *     the whole subtree on every delta.
 */
export function ReasoningPanel({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming: boolean;
}) {
  const { t } = useTranslation();
  // Pinned-open state: once the user manually opens the summary, we
  // stop auto-closing it even when `streaming === false`.
  const [userOpened, setUserOpened] = useState(false);
  const open = streaming || userOpened;
  return (
    <details
      className="mb-2 rounded-md border border-border/60 bg-bg-elev-2/50 text-[12px]"
      open={open}
      onToggle={(e) => {
        // `onToggle` fires for both user clicks AND our controlled
        // attribute flips. The attribute flip always leaves
        // `e.currentTarget.open` matching `open`; only a user-click
        // shifts them out of sync.
        const next = e.currentTarget.open;
        if (next !== open) setUserOpened(next);
      }}
      data-testid="reasoning-panel"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-fg-muted select-none">
        <Icon
          icon={streaming ? Loader2 : Sparkles}
          size="xs"
          className={cn(streaming && 'animate-spin')}
        />
        <span>
          {streaming
            ? t('chat.reasoning.thinking', { defaultValue: 'Thinking…' })
            : t('chat.reasoning.thought', { defaultValue: 'Thought process' })}
        </span>
      </summary>
      {/* Reasoning is plain prose without markdown structure in
          practice (deepseek-reasoner emits free-form analysis).
          `whitespace-pre-wrap` preserves newlines without forcing
          us through ReactMarkdown, which would re-parse tokens on
          every delta and tank perf during long reasoning streams. */}
      <div className="border-t border-border/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg-subtle whitespace-pre-wrap">
        {reasoning}
      </div>
    </details>
  );
}
