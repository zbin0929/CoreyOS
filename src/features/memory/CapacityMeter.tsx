import { useTranslation } from 'react-i18next';
import { Check, FileText, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

import { formatBytes, revealInFinder, useSavedLabel } from './utils';

export function CapacityMeter({
  bytes,
  maxBytes,
  path,
  exists,
  savedAt,
  dirty,
}: {
  bytes: number;
  maxBytes: number;
  path: string;
  exists: boolean;
  savedAt: number | null;
  dirty: boolean;
}) {
  const { t } = useTranslation();
  const pct = Math.min(100, Math.round((bytes / maxBytes) * 100));
  const hot = pct >= 90;

  // "Saved 3s ago" — decays into a static timestamp after a minute.
  // Re-tick on a 1s interval only when `savedAt` is set AND recent,
  // so the page doesn't keep the event loop busy when there's nothing
  // changing.
  const savedLabel = useSavedLabel(savedAt);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 w-40 overflow-hidden rounded-full bg-bg-elev-2"
          aria-label={t('memory.capacity_meter')}
          data-testid="memory-capacity-bar"
        >
          <div
            className={cn(
              'h-full transition-[width]',
              hot ? 'bg-danger' : 'bg-accent',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn(hot && 'text-danger')}
          data-testid="memory-capacity-text"
        >
          {t('memory.capacity', {
            bytes: formatBytes(bytes),
            max: formatBytes(maxBytes),
          })}
        </span>
      </div>
      {/* Status chip: unsaved > just-saved > new file > plain path.
          Mutually exclusive so the row doesn't get noisy. */}
      {dirty ? (
        <span className="text-warning" data-testid="memory-status-dirty">
          {t('memory.unsaved')}
        </span>
      ) : savedLabel ? (
        <span
          className="inline-flex items-center gap-1 text-emerald-500"
          data-testid="memory-status-saved"
        >
          <Icon icon={Check} size="xs" />
          {savedLabel}
        </span>
      ) : !exists ? (
        <span
          className="inline-flex items-center gap-1"
          data-testid="memory-status-new"
        >
          <Icon icon={FileText} size="xs" />
          {t('memory.new_file_hint')}
        </span>
      ) : null}
      <code
        className="truncate font-mono text-[11px] text-fg-subtle"
        title={path}
      >
        {path}
      </code>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => void revealInFinder(path)}
        aria-label={t('memory.reveal')}
        title={t('memory.reveal')}
        data-testid="memory-reveal"
      >
        <Icon icon={FolderOpen} size="xs" />
      </Button>
    </div>
  );
}
