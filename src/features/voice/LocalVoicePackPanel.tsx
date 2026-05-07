import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Archive, CheckCircle2, Download, Loader2, Mic } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  talkLocalStatus,
  talkModelsDownload,
  talkModelsImportZip,
  talkModelsStatus,
  type TalkLocalReadiness,
  type TalkModelsStatus,
} from '@/lib/ipc';

/**
 * Local voice pack downloader (B-8 v1 task 8).
 *
 * Sits inside the Voice settings tab. Surfaces:
 *
 * - Per-file readiness from `talk_models_status` (silero-vad,
 *   whisper-base, sherpa-onnx MeloTTS zh_en).
 * - One-click "Download" that walks the mirror chain in Rust;
 *   live progress comes via `download:progress` events keyed on
 *   `talk-model:<id>` task ids the backend emits.
 * - "Import offline zip" for users behind tight firewalls — the
 *   user picks a zip containing the canonical filenames and the
 *   backend extracts only the files it knows about.
 * - Per-file mirror count badge so users on the wrong side of the
 *   GFW can see at a glance whether a fallback chain exists.
 */
export function LocalVoicePackPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TalkModelsStatus | null>(null);
  const [route, setRoute] = useState<TalkLocalReadiness>({ stt_ready: false, tts_ready: false });
  const [busy, setBusy] = useState<'idle' | 'downloading' | 'importing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [usedMirrors, setUsedMirrors] = useState<[string, string][]>([]);
  const [progress, setProgress] = useState<Record<string, { downloaded: number; total: number }>>({});

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        talkModelsStatus(),
        talkLocalStatus().catch(() => ({ stt_ready: false, tts_ready: false })),
      ]);
      setStatus(s);
      setRoute(r);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to the same `download:*` event channel the generic
  // download manager uses. We filter by the `talk-model:` task-id
  // prefix so we only show progress for our spec, not e.g. a
  // concurrent BGE-M3 download.
  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    let cancelled = false;
    const wire = async () => {
      unlistens.push(
        await listen<{ task_id: string; downloaded: number; total: number }>(
          'download:progress',
          (e) => {
            if (cancelled) return;
            if (!e.payload.task_id.startsWith('talk-model:')) return;
            const id = e.payload.task_id.slice('talk-model:'.length);
            setProgress((prev) => ({
              ...prev,
              [id]: { downloaded: e.payload.downloaded, total: e.payload.total },
            }));
          },
        ),
      );
      unlistens.push(
        await listen<{ task_id: string }>('download:completed', (e) => {
          if (cancelled) return;
          if (!e.payload.task_id.startsWith('talk-model:')) return;
          // Refresh status so the file flips to "installed" without
          // waiting for the whole batch to finish.
          void refresh();
        }),
      );
    };
    void wire();
    return () => {
      cancelled = true;
      void Promise.allSettled(unlistens.map((u) => Promise.resolve(u())));
    };
  }, [refresh]);

  const onDownload = useCallback(async () => {
    setBusy('downloading');
    setError(null);
    setUsedMirrors([]);
    setProgress({});
    try {
      const result = await talkModelsDownload();
      setUsedMirrors(result.used_mirrors);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy('idle');
      await refresh();
    }
  }, [refresh]);

  const onImportZip = useCallback(async () => {
    setBusy('importing');
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (typeof selected !== 'string' || !selected) {
        return;
      }
      await talkModelsImportZip(selected);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy('idle');
      await refresh();
    }
  }, [refresh]);

  if (!status) {
    return (
      <section className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-1 p-4 text-sm text-fg-subtle">
        <Icon icon={Loader2} size="sm" className="animate-spin" />
        {t('voice.local_pack_loading', { defaultValue: '正在读取本地语音包状态...' })}
      </section>
    );
  }

  // Aggregate progress across every file in the spec — the user
  // doesn't care that there are 4 separate model files internally,
  // they just want to see one bar from 0 → 100%. We derive total
  // from each file's known size (already-installed contributes its
  // full min_size_bytes; in-flight contributes live `downloaded`).
  const totalBytes = status.files.reduce((sum, f) => sum + f.min_size_bytes, 0);
  const downloadedBytes = status.files.reduce((sum, f) => {
    if (f.exists) return sum + f.min_size_bytes;
    const prog = progress[f.id];
    return sum + (prog?.downloaded ?? 0);
  }, 0);
  const overallPct = totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0;
  const missingBytes = Math.max(0, totalBytes - downloadedBytes);
  const lastUsedHost = usedMirrors.length > 0 ? hostOf(usedMirrors[usedMirrors.length - 1]![1]) : null;

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="talk-local-pack"
    >
      <header className="flex items-center gap-2">
        <Icon icon={Mic} size="md" className="text-emerald-500" />
        <span className="text-sm font-medium text-fg">
          {t('voice.local_pack_title', { defaultValue: '本地语音包' })}
        </span>
        {status.ready ? (
          <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600">
            <Icon icon={CheckCircle2} size="xs" />
            {route.stt_ready && route.tts_ready
              ? t('voice.local_pack_active', {
                  defaultValue: '全本地链路已启用（whisper + sherpa-onnx）',
                })
              : t('voice.local_pack_ready', {
                  defaultValue: '模型已安装，等待 sidecar 二进制到位',
                })}
          </span>
        ) : (
          <span className="ml-auto text-xs text-fg-subtle">
            {t('voice.local_pack_missing', {
              defaultValue: '未安装 — 当前走云端 STT/TTS',
            })}
          </span>
        )}
      </header>

      {/* Single aggregate progress bar. Always rendered (even when
          fully installed, where it pegs at 100% in emerald) so the
          UI doesn't reflow between "downloading" and "done". */}
      <div className="flex items-center gap-2 text-xs">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-elev-2">
          <div
            className={cn(
              'h-full transition-[width]',
              status.ready ? 'bg-emerald-500' : 'bg-gold-500',
            )}
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <span className="w-28 text-right font-mono text-fg-muted">
          {status.ready
            ? formatBytes(totalBytes)
            : `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`}
        </span>
      </div>

      {!status.ready && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="primary"
            onClick={() => void onDownload()}
            disabled={busy !== 'idle'}
            data-testid="talk-local-pack-download"
          >
            <Icon
              icon={busy === 'downloading' ? Loader2 : Download}
              size="xs"
              className={cn(busy === 'downloading' && 'animate-spin')}
            />
            {busy === 'downloading'
              ? t('voice.local_pack_downloading', { defaultValue: '下载中...' })
              : t('voice.local_pack_download', {
                  defaultValue: `下载（约 ${formatBytes(missingBytes)}）`,
                  size: formatBytes(missingBytes),
                })}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void onImportZip()}
            disabled={busy !== 'idle'}
            data-testid="talk-local-pack-import"
          >
            <Icon
              icon={busy === 'importing' ? Loader2 : Archive}
              size="xs"
              className={cn(busy === 'importing' && 'animate-spin')}
            />
            {t('voice.local_pack_import', { defaultValue: '导入离线 zip' })}
          </Button>
          {lastUsedHost && (
            <span className="text-[10px] text-fg-subtle" title={lastUsedHost}>
              {t('voice.local_pack_via', {
                defaultValue: `通过 ${lastUsedHost} 下载`,
                host: lastUsedHost,
              })}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
