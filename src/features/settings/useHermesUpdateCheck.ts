import { useCallback, useEffect, useState } from 'react';
import { hermesUpdateCheck, type HermesUpdateCheck } from '@/lib/ipc';

export function useHermesUpdateCheck() {
  const [result, setResult] = useState<HermesUpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(() => {
    setChecking(true);
    hermesUpdateCheck()
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { result, checking, recheck: check };
}
