import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

import type { ChannelDiffLine } from './ChannelForm';

/** Compact inline "diff modal". Shows one row per pending change with
 *  before → after. Secrets render as presence only (the form produced
 *  that already). Restart warning is inline so the user sees the
 *  consequence before they click Save. */
export function ConfirmDiff({
  diffs,
  busy,
  hotReloadable,
  onCancel,
  onConfirm,
}: {
  diffs: ChannelDiffLine[];
  busy: boolean;
  hotReloadable: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-2 rounded border border-accent/40 bg-accent/5 p-2 text-[11px]"
      data-testid="channel-confirm-diff"
    >
      <div className="font-medium text-fg">{t('channels.confirm_title')}</div>
      <ul className="flex flex-col gap-1">
        {diffs.map((d) => (
          <li
            key={`${d.kind}:${d.label}`}
            className="grid grid-cols-[auto_1fr] gap-x-2 font-mono"
          >
            <span
              className={cn(
                'rounded px-1 text-[9px] uppercase',
                d.kind === 'env'
                  ? 'bg-amber-500/15 text-amber-500'
                  : 'bg-accent/15 text-accent',
              )}
            >
              {d.kind}
            </span>
            <span className="truncate text-fg-muted" title={d.label}>
              {d.label}
            </span>
            <span />
            <span className="text-fg-subtle">
              {d.before}
              <span className="mx-1 text-fg-subtle/60">→</span>
              <span className="text-fg">{d.after}</span>
            </span>
          </li>
        ))}
      </ul>
      {!hotReloadable && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-amber-500">
          <Icon icon={AlertCircle} size="xs" className="mr-1 inline" />
          {t('channels.not_hot_reloadable')}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          <Icon icon={X} size="xs" />
          {t('channels.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={onConfirm}
          disabled={busy}
          data-testid="channel-confirm-save"
        >
          {busy ? (
            <Icon icon={Loader2} size="xs" className="animate-spin" />
          ) : (
            <Icon icon={Check} size="xs" />
          )}
          {t('channels.confirm_save')}
        </Button>
      </div>
    </div>
  );
}
