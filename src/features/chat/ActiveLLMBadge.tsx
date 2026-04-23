import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Cpu, Settings2 } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { hermesConfigRead, type HermesModelSection } from '@/lib/ipc';

/**
 * Compact read-only indicator shown above the composer. Displays the LLM
 * currently configured in `~/.hermes/config.yaml` (provider · model id). Since
 * Hermes is fixed-model (ignores the `model` field on chat requests), this is
 * a *status* display — clicking navigates to the LLMs page where the user
 * can actually change the underlying provider/model.
 */
export function ActiveLLMBadge() {
  const [model, setModel] = useState<HermesModelSection | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    hermesConfigRead()
      .then((view) => {
        if (alive) {
          setModel(view.model);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const label = (() => {
    if (loading) return 'Loading…';
    if (!model || (!model.provider && !model.default)) return '(LLM not configured)';
    const parts = [model.provider, model.default].filter(Boolean);
    return parts.join(' · ');
  })();

  return (
    <button
      type="button"
      onClick={() => navigate({ to: '/models' })}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs',
        'bg-bg-elev-1 text-fg transition',
        'hover:border-gold-500/40 hover:bg-bg-elev-2',
      )}
      title="Current LLM (click to configure)"
    >
      <Icon icon={Cpu} size="xs" className="opacity-60" />
      <code className="font-mono">{label}</code>
      <Icon icon={Settings2} size="xs" className="opacity-60" />
    </button>
  );
}
