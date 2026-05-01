import { useCallback, useEffect, useState } from 'react';
import { ragStatus, ragDownloadModel, ragImportOfflineZip } from '@/lib/ipc/runtime';
import type { RagStatus } from '@/lib/ipc/runtime';

export function useRagStatus() {
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await ragStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const downloadModel = useCallback(async () => {
    setDownloading(true);
    try {
      await ragDownloadModel();
    } finally {
      setDownloading(false);
      await refresh();
    }
  }, [refresh]);

  const importOfflineZip = useCallback(async (zipPath: string) => {
    setImporting(true);
    try {
      await ragImportOfflineZip(zipPath);
    } finally {
      setImporting(false);
      await refresh();
    }
  }, [refresh]);

  const missingFiles = status
    ? status.files.filter((f) => !f.exists)
    : [];

  const totalSize = status
    ? status.files.reduce((sum, f) => sum + (f.exists ? 0 : f.size_bytes), 0)
    : 0;

  return {
    status,
    downloading,
    downloadModel,
    importing,
    importOfflineZip,
    refresh,
    modelInstalled: status?.model_installed ?? false,
    missingFiles,
    totalSize,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
