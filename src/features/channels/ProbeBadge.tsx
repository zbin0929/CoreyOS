import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';

import type { ProbeSlot } from './channelFormHelpers';

/** Inline verdict pill rendered below a probeable env input. Three
 *  states: probing (spinner), success (✓ + label), failure (✗ +
 *  platform error). `idle` renders nothing — there's no signal
 *  worth taking up vertical space for an empty field. */
export function ProbeBadge({ slot }: { slot: ProbeSlot }) {
  const { t } = useTranslation();
  if (slot.kind === 'idle') return null;
  if (slot.kind === 'probing') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-fg-subtle"
        data-testid="channel-probe-loading"
      >
        <Icon icon={Loader2} size="xs" className="animate-spin" />
        {t('channels.token_probe.checking')}
      </span>
    );
  }
  const { result } = slot;
  if (result.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-emerald-500"
        title={result.identifier ?? undefined}
        data-testid="channel-probe-ok"
      >
        <Icon icon={Check} size="xs" />
        {t('channels.probe.ok', {
          name: result.display_name ?? result.identifier ?? '?',
        })}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-danger"
      data-testid="channel-probe-err"
    >
      <Icon icon={AlertCircle} size="xs" />
      {result.error ?? t('channels.token_probe.err')}
    </span>
  );
}
