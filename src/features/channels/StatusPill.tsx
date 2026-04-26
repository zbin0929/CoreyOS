import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import type { ChannelLiveStatus } from '@/lib/ipc';

import type { ChannelStatus } from './computeStatus';

export function StatusPill({
  status,
  setCount,
  totalCount,
}: {
  status: ChannelStatus;
  setCount: number;
  totalCount: number;
}) {
  const { t } = useTranslation();
  const map = {
    configured: { cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40', key: 'channels.status.configured' },
    partial: { cls: 'bg-amber-500/10 text-amber-500 border-amber-500/50', key: 'channels.status.partial' },
    unconfigured: { cls: 'bg-bg-elev-2 text-fg-subtle border-border', key: 'channels.status.unconfigured' },
    qr: { cls: 'bg-gold-500/10 text-gold-500 border-gold-500/40', key: 'channels.status.qr' },
  } as const;
  const { cls, key } = map[status];
  return (
    <span
      data-testid={`channel-status-${status}`}
      className={cn(
        'flex-none rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
      title={
        status === 'partial' ? `${setCount} / ${totalCount}` : undefined
      }
    >
      {t(key)}
      {status === 'partial' && ` · ${setCount}/${totalCount}`}
    </span>
  );
}

/** T3.4 live-state pill. Sits next to `StatusPill` and renders
 *  online / offline / unknown derived from the backend's log probe.
 *  Title tooltip shows the triggering log line (truncated) so power
 *  users can see WHICH event drove the verdict without opening the
 *  Logs tab. */
export function LiveStatusPill({ status }: { status: ChannelLiveStatus }) {
  const { t } = useTranslation();
  const map = {
    online: {
      cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40',
      key: 'channels.live.online',
    },
    offline: {
      cls: 'bg-danger/10 text-danger border-danger/40',
      key: 'channels.live.offline',
    },
    unknown: {
      cls: 'bg-bg-elev-2 text-fg-subtle border-border',
      key: 'channels.live.unknown',
    },
  } as const;
  const { cls, key } = map[status.state];
  const marker = status.last_marker ?? '';
  return (
    <span
      data-testid={`channel-live-${status.state}-${status.id}`}
      className={cn(
        'flex-none rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
      title={marker.length > 0 ? marker.slice(0, 160) : undefined}
    >
      {t(key)}
    </span>
  );
}
