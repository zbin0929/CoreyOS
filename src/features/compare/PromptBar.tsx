import type { FormEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

export function PromptBar({
  value,
  onChange,
  onRun,
  onStop,
  running,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (running) onStop();
    else onRun();
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl+Enter → run. Plain Enter inserts a newline (unlike chat) —
    // compare prompts are often multi-line, so this matches user intuition.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!running && !disabled) onRun();
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        placeholder={t('compare.prompt_placeholder')}
        className="min-h-[72px] max-h-[200px] flex-1 resize-none rounded-lg border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-gold-500/40 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
        data-testid="compare-prompt-input"
      />
      {running ? (
        <Button
          type="submit"
          variant="secondary"
          className="h-11 px-4"
          data-testid="compare-stop"
          title={t('compare.stop_all')}
        >
          <Icon icon={Square} size="md" fill="currentColor" />
          {t('compare.stop_all')}
        </Button>
      ) : (
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || !value.trim()}
          className="h-11 px-4"
          data-testid="compare-run"
          title={t('compare.run')}
        >
          <Icon icon={Play} size="md" />
          {t('compare.run')}
        </Button>
      )}
    </form>
  );
}
