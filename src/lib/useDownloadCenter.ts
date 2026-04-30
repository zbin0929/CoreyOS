import { useState, useEffect, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  downloadStart as ipcDownloadStart,
  downloadCancel as ipcDownloadCancel,
  downloadList as ipcDownloadList,
  downloadClearCompleted as ipcDownloadClear,
  type DownloadTask,
} from '@/lib/ipc/runtime';

export type { DownloadTask };

export interface DownloadProgress {
  task_id: string;
  downloaded: number;
  total: number;
  speed_bps: number;
}

export function useDownloadCenter() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    let unlistenProgress: UnlistenFn | undefined;
    let unlistenCompleted: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;

    const setup = async () => {
      unlistenProgress = await listen<DownloadProgress>('download:progress', (e) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === e.payload.task_id
              ? { ...t, downloaded: e.payload.downloaded, total: e.payload.total, speed_bps: e.payload.speed_bps, status: { kind: 'downloading' as const } }
              : t,
          ),
        );
      });

      unlistenCompleted = await listen<{ task_id: string; path: string }>('download:completed', (e) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === e.payload.task_id ? { ...t, status: { kind: 'completed' as const } } : t,
          ),
        );
      });

      unlistenError = await listen<{ task_id: string; message: string }>('download:error', (e) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === e.payload.task_id ? { ...t, status: { kind: 'error' as const, message: e.payload.message } } : t,
          ),
        );
      });

      setListening(true);
    };

    void setup();

    return () => {
      unlistenProgress?.();
      unlistenCompleted?.();
      unlistenError?.();
    };
  }, []);

  useEffect(() => {
    if (!listening) return;
    void ipcDownloadList().then(setTasks);
  }, [listening]);

  const startDownload = useCallback(async (url: string, targetPath: string, label: string) => {
    const id = await ipcDownloadStart({ url, target_path: targetPath, label });
    const newTask: DownloadTask = {
      id,
      url,
      target_path: targetPath,
      filename: url.split('/').pop() ?? 'download',
      label,
      status: { kind: 'pending' },
      downloaded: 0,
      total: 0,
      speed_bps: 0,
    };
    setTasks((prev) => [...prev, newTask]);
    return id;
  }, []);

  const cancelDownload = useCallback(async (taskId: string) => {
    await ipcDownloadCancel(taskId);
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: { kind: 'cancelled' as const } } : t)),
    );
  }, []);

  const clearCompleted = useCallback(async () => {
    await ipcDownloadClear();
    setTasks((prev) => prev.filter((t) => t.status.kind !== 'completed' && t.status.kind !== 'cancelled'));
  }, []);

  const refresh = useCallback(async () => {
    const list = await ipcDownloadList();
    setTasks(list);
  }, []);

  const activeTasks = tasks.filter((t) => t.status.kind === 'downloading' || t.status.kind === 'pending');
  const completedTasks = tasks.filter((t) => t.status.kind === 'completed');
  const errorTasks = tasks.filter((t) => t.status.kind === 'error');

  return {
    tasks,
    activeTasks,
    completedTasks,
    errorTasks,
    startDownload,
    cancelDownload,
    clearCompleted,
    refresh,
  };
}

export function formatSpeed(bps: number): string {
  if (bps === 0) return '';
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
