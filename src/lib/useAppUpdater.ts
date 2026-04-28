import { useState, useEffect, useCallback } from 'react';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'available'; version: string; currentVersion: string; body: string }
  | { kind: 'downloading'; version: string }
  | { kind: 'error'; message: string };

export function useAppUpdater() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });

  const checkForUpdate = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      const currentVersion = await getVersion();
      const result = await check();

      if (!result) {
        setState({ kind: 'up-to-date', version: currentVersion });
        return;
      }

      setState({
        kind: 'available',
        version: result.version,
        currentVersion,
        body: result.body ?? '',
      });
    } catch (e) {
      setState({ kind: 'error', message: String(e) });
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (state.kind !== 'available') return;
    const version = state.version;

    try {
      setState({ kind: 'downloading', version });

      const result = await check();
      if (!result) {
        setState({ kind: 'error', message: 'Update no longer available' });
        return;
      }

      await result.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Finished') {
          void relaunch();
        }
      });
    } catch (e) {
      setState({ kind: 'error', message: String(e) });
    }
  }, [state]);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  return { state, checkForUpdate, downloadAndInstall };
}
