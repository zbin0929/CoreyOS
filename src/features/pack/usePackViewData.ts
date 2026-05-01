import { useEffect, useState } from 'react';
import { packViewData } from '@/lib/ipc/pack';
import { useDateRange } from '@/features/pack/useDateRange';

interface PackViewDataState {
  /** `null` while loading; `{}` when the view has no data source. */
  data: unknown;
  loading: boolean;
  error: string | null;
}

function normalizeError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    try {
      return JSON.stringify(err);
    } catch {
      return 'unknown error';
    }
  }
  return 'unknown error';
}

/**
 * Single hook every Pack view template calls to get its data.
 * Backed by the `pack_view_data` IPC, which dispatches against
 * the manifest's `data_source` directive.
 *
 * Cancelled-on-unmount: stale fetches don't clobber a newer
 * view's state when the user navigates between Pack views.
 */
export function usePackViewData(
  packId: string,
  viewId: string,
  params?: Record<string, unknown>,
): PackViewDataState {
  const contextDateRange = useDateRange();
  const merged = contextDateRange
    ? { date_range: contextDateRange, ...params }
    : params;
  const paramsKey = merged ? JSON.stringify(merged) : '';
  const [state, setState] = useState<PackViewDataState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    packViewData(packId, viewId, merged).then(
      (data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      },
      (err) => {
        if (!cancelled)
          setState({ data: null, loading: false, error: normalizeError(err) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, viewId, paramsKey]);

  return state;
}
