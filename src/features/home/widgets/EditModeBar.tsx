import { useTranslation } from 'react-i18next';
import { Check, Eye, RotateCcw, SlidersHorizontal } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useHomeLayoutStore, useIsWidgetVisible } from '@/stores/homeLayout';

import { HOME_WIDGETS } from './catalog';

/**
 * Inline toolbar pinned next to the Home page header.
 *
 * Out of edit mode it's a single small button labeled "自定义首页"
 * (the gear). Once pressed, the bar expands into:
 *   - per-widget chips listing every spec in `HOME_WIDGETS` with
 *     a tick when visible (toggle with click)
 *   - a "重置" button that wipes the user's overrides
 *   - a "完成" button that exits edit mode
 *
 * No drag-and-drop reorder yet — just visibility, which covers
 * 80% of "I don't want X on my home page" requests without the
 * UX cost of a real layout editor.
 */
export function EditModeBar() {
  const { t } = useTranslation();
  const editing = useHomeLayoutStore((s) => s.editing);
  const setEditing = useHomeLayoutStore((s) => s.setEditing);
  const reset = useHomeLayoutStore((s) => s.reset);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-bg-elev-2/50 px-3 py-1.5 text-xs text-fg-subtle transition hover:border-gold-500/40 hover:bg-gold-500/5 hover:text-gold-500"
        data-testid="home-edit-toggle"
      >
        <Icon icon={SlidersHorizontal} size="xs" />
        {t('home.customize', { defaultValue: '自定义首页' })}
      </button>
    );
  }

  return (
    <div
      className="flex flex-col items-end gap-2 rounded-xl border border-gold-500/30 bg-gold-500/5 p-3"
      data-testid="home-edit-bar"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-fg-subtle transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          data-testid="home-edit-reset"
        >
          <Icon icon={RotateCcw} size="xs" />
          {t('home.customize_reset', { defaultValue: '重置' })}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="inline-flex items-center gap-1 rounded-md border border-gold-500/40 bg-gold-500/15 px-2.5 py-1 text-[11px] font-medium text-gold-500 transition hover:bg-gold-500/25"
          data-testid="home-edit-done"
        >
          <Icon icon={Check} size="xs" />
          {t('home.customize_done', { defaultValue: '完成' })}
        </button>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {HOME_WIDGETS.map((spec) => (
          <WidgetChip
            key={spec.id}
            id={spec.id}
            labelKey={spec.labelKey}
            defaultVisible={spec.defaultVisible}
          />
        ))}
      </div>
    </div>
  );
}

function WidgetChip({
  id,
  labelKey,
  defaultVisible,
}: {
  id: string;
  labelKey: string;
  defaultVisible: boolean;
}) {
  const { t } = useTranslation();
  const visible = useIsWidgetVisible(id, defaultVisible);
  const hide = useHomeLayoutStore((s) => s.hide);
  const show = useHomeLayoutStore((s) => s.show);
  return (
    <button
      type="button"
      onClick={() => (visible ? hide(id) : show(id))}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition',
        visible
          ? 'border-gold-500/40 bg-gold-500/10 text-gold-500'
          : 'border-border/60 bg-bg-elev-2 text-fg-subtle hover:border-gold-500/30 hover:text-fg',
      )}
      data-testid={`widget-toggle-${id}`}
    >
      <Icon icon={visible ? Check : Eye} size="xs" />
      {t(labelKey, { defaultValue: id })}
    </button>
  );
}
