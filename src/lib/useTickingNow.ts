import { useEffect, useState } from 'react';

/**
 * Re-renders the calling component every `intervalMs` while `active` is
 * true, returning `Date.now()` as it ticks. Used by the chat tool-progress
 * UI to drive a "1m 23s" live elapsed-time counter while Hermes is still
 * inside an agent loop (most painfully visible during `delegate_task`,
 * which can run 30s–3min with no intermediate signal).
 *
 * Cheap by design: a single 500 ms timer per active message; nothing fires
 * once `active` flips to false (e.g. when the assistant finishes streaming
 * or errors out), so idle conversations don't pay for it.
 */
export function useTickingNow(active: boolean, intervalMs = 500): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** Format milliseconds as `12s` / `1m 23s` / `1h 02m`. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec.toString().padStart(2, '0')}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin.toString().padStart(2, '0')}m`;
}
