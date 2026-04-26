import { useCallback, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseAsyncStateReturn<T> extends AsyncState<T> {
  run: (fn: () => Promise<T>) => Promise<T | null>;
  reset: () => void;
  setData: (data: T) => void;
}

export function useAsyncState<T>(): UseAsyncStateReturn<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const seqRef = useRef(0);

  const run = useCallback(async (fn: () => Promise<T>): Promise<T | null> => {
    const seq = ++seqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await fn();
      if (seq === seqRef.current) {
        setState({ data: result, loading: false, error: null });
      }
      return result;
    } catch (e) {
      if (seq === seqRef.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    seqRef.current++;
    setState({ data: null, loading: false, error: null });
  }, []);

  const setData = useCallback((data: T) => {
    setState((s) => ({ ...s, data }));
  }, []);

  return { ...state, run, reset, setData };
}
