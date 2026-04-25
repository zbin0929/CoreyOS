import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Loader2, Play, XCircle, Zap } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { UiSuggestion } from '@/stores/chat';

interface SuggestionCardProps {
  suggestion: UiSuggestion;
  onConfirm: (suggestion: UiSuggestion) => Promise<void>;
  onDismiss: (id: string) => void;
}

export function SuggestionCard({ suggestion, onConfirm, onDismiss }: SuggestionCardProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(suggestion);
    } finally {
      setLoading(false);
    }
  };

  const iconMap = {
    schedule: Clock,
    workflow: Zap,
  };
  const IconComp = iconMap[suggestion.type];

  return (
    <div
      className={cn(
        'my-2 rounded-lg border transition-colors',
        suggestion.status === 'pending' && 'border-gold-500/30 bg-gold-500/5',
        suggestion.status === 'done' && 'border-green-500/30 bg-green-500/5',
        suggestion.status === 'error' && 'border-red-500/30 bg-red-500/5',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Icon
          icon={suggestion.status === 'done' ? CheckCircle2 : suggestion.status === 'error' ? XCircle : IconComp}
          size="sm"
          className={cn(
            suggestion.status === 'pending' && 'text-gold-500',
            suggestion.status === 'done' && 'text-green-500',
            suggestion.status === 'error' && 'text-red-500',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{suggestion.title}</p>
          {suggestion.subtitle && (
            <p className="mt-0.5 text-xs text-fg-subtle">{suggestion.subtitle}</p>
          )}
          {suggestion.status === 'done' && suggestion.resultText && (
            <p className="mt-1 text-xs text-green-600 dark:text-green-400">{suggestion.resultText}</p>
          )}
          {suggestion.status === 'error' && suggestion.resultText && (
            <p className="mt-1 text-xs text-red-500">{suggestion.resultText}</p>
          )}
        </div>
        {suggestion.status === 'pending' && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? <Icon icon={Loader2} size="xs" className="animate-spin" /> : <Icon icon={Play} size="xs" />}
              {t('suggestion.confirm')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDismiss(suggestion.id)}
              disabled={loading}
            >
              {t('suggestion.dismiss')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
