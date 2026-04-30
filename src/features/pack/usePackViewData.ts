import { useEffect, useState } from 'react';
import { packViewData } from '@/lib/ipc/pack';

interface PackViewDataState {
  /** `null` while loading; `{}` when the view has no data source. */
  data: unknown;
  loading: boolean;
  error: string | null;
}

/**
 * Single hook every Pack view template calls to get its data.
 * Backed by the `pack_view_data` IPC, which dispatches against
 * the manifest's `data_source` directive.
 *
 * Cancelled-on-unmount: stale fetches don't clobber a newer
 * view's state when the user navigates between Pack views.
 */
export function usePackViewData(packId: string, viewId: string): PackViewDataState {
  const [state, setState] = useState<PackViewDataState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    packViewData(packId, viewId).then(
      (data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      },
      (err) => {
        if (!cancelled)
          setState({ data: null, loading: false, error: String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [packId, viewId]);

  return state;
}
