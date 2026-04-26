import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { ModelInfo } from '@/lib/ipc';

export function ModelPicker({
  models,
  selectedIds,
  onChange,
  max,
  disabled,
}: {
  models: ModelInfo[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  max: number;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const atCap = selectedIds.length >= max;

  function add(id: string) {
    onChange([...selectedIds, id]);
    setOpen(false);
  }
  function remove(id: string) {
    // Removes the FIRST instance only — the user may have picked the same
    // model twice on purpose (rare, but legal).
    const idx = selectedIds.indexOf(id);
    if (idx < 0) return;
    const next = selectedIds.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="compare-model-picker">
      {selectedIds.map((id, i) => {
        const m = models.find((x) => x.id === id);
        const label = m?.display_name ?? id;
        return (
          <span
            key={`${id}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elev-2 px-2.5 py-1 text-xs text-fg"
            data-testid={`compare-model-chip-${id}`}
          >
            <span className="truncate max-w-[160px]">{label}</span>
            <button
              type="button"
              onClick={() => remove(id)}
              disabled={disabled}
              className="text-fg-subtle hover:text-fg disabled:opacity-40"
              title={t('compare.remove_model')}
              aria-label={t('compare.remove_model')}
            >
              <Icon icon={X} size="xs" />
            </button>
          </span>
        );
      })}
      <div className="relative">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen((s) => !s)}
          disabled={disabled || atCap || models.length === 0}
          data-testid="compare-add-model"
          title={
            atCap
              ? t('compare.max_reached', { n: max })
              : t('compare.add_model')
          }
        >
          <Icon icon={Plus} size="sm" />
          {t('compare.add_model')}
          <Icon icon={ChevronDown} size="xs" />
        </Button>
        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-bg-elev-2 shadow-2">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => add(m.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-fg hover:bg-bg-elev-3"
                data-testid={`compare-add-option-${m.id}`}
              >
                <span className="truncate">{m.display_name ?? m.id}</span>
                <span className="text-[10px] text-fg-subtle">{m.provider}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {atCap && (
        <span className="text-[11px] text-fg-subtle">
          {t('compare.max_reached', { n: max })}
        </span>
      )}
    </div>
  );
}
