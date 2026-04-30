import type { ChannelState } from '@/lib/ipc';

export type ChannelStatus = 'configured' | 'partial' | 'unconfigured' | 'qr';

/** Stable ordering for the status-dot severity, highest-priority first.
 *  Post-T6.7a the `'qr'` bucket is unreachable in practice (no Hermes
 *  channel uses QR) but is kept in the union for forward-compat with
 *  the `has_qr_login` spec flag. */
export function computeStatus(c: ChannelState): ChannelStatus {
  if (c.has_qr_login) {
    const required = c.env_keys.filter((k) => k.required);
    if (required.length > 0) {
      const setCount = required.filter((k) => c.env_present[k.name]).length;
      if (setCount >= required.length) return 'configured';
      if (setCount > 0) return 'partial';
    }
    return 'qr';
  }
  const required = c.env_keys.filter((k) => k.required);
  if (required.length === 0) return 'configured';
  const setCount = required.filter((k) => c.env_present[k.name]).length;
  if (setCount === 0) return 'unconfigured';
  if (setCount < required.length) return 'partial';
  return 'configured';
}
