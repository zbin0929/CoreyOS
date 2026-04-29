import { useState, useEffect, useCallback } from 'react';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'available'; version: string; currentVersion: string; body: string }
  | { kind: 'downloading'; version: string; progress: number; total: number }
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
      setState({ kind: 'downloading', version, progress: 0, total: 0 });

      const result = await check();
      if (!result) {
        setState({ kind: 'error', message: 'Update no longer available' });
        return;
      }

      let downloaded = 0;
      let totalSize = 0;

      await result.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case 'Started':
            totalSize = event.data.contentLength ?? 0;
            setState({ kind: 'downloading', version, progress: 0, total: totalSize });
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setState({ kind: 'downloading', version, progress: downloaded, total: totalSize });
            break;
          case 'Finished':
            void relaunch();
            break;
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
