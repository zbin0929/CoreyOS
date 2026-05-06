import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

import { getNotificationLevel } from '@/stores/notificationPrefs';

/**
 * Surface a native desktop notification whenever a workflow run hits a
 * terminal state (Completed / Failed / Cancelled).
 *
 * Backend emits `workflow:run-finished` from
 * `ipc::workflow::spawn_run_executor` once per run; this hook is the
 * sole consumer. Mounted in `AppShell` so it stays alive for the
 * lifetime of the window.
 *
 * ## Why route through Tauri events
 *
 * - The notification plugin can only fire from a frontend context that
 *   passed the OS permission prompt. Doing it backend-side would mean
 *   re-implementing the permission state machine in Rust.
 * - The frontend can also drive in-app toasts / sound / Settings
 *   "notify on failure only" toggles without further backend changes.
 *
 * ## Permission handling
 *
 * macOS / Windows ask the user once on first send. We pre-request on
 * mount so the prompt happens silently before the first workflow ever
 * finishes; subsequent runs trigger a notification immediately.
 *
 * ## Failure modes
 *
 * - Storybook / Playwright mock environments: `listen` rejects with
 *   "no IPC available" — we swallow it (console.debug) so the hook
 *   stays safe to mount everywhere.
 * - User denies permission: every `sendNotification` becomes a no-op
 *   inside the plugin. We don't fall back to an in-app toast yet
 *   (B-9.2 follow-up).
 */
const TERMINAL_STATUSES = new Set(['Completed', 'Failed', 'Cancelled']);

interface RunFinishedPayload {
  run_id: string;
  workflow_id: string;
  workflow_name?: string;
  status: string;
  error?: string | null;
  started_at_ms?: number;
  updated_at_ms?: number;
}

export function useWorkflowNotifications(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    // Pre-warm the OS permission so the first real notification
    // doesn't race with the prompt dialog. Errors here are non-fatal.
    void (async () => {
      try {
        const granted = await isPermissionGranted();
        if (!granted) {
          await requestPermission();
        }
      } catch (e) {
        console.debug('notification permission check unavailable:', e);
      }
    })();

    void listen<RunFinishedPayload>('workflow:run-finished', (event) => {
      const { status, workflow_name, workflow_id, error } = event.payload;
      if (!TERMINAL_STATUSES.has(status)) return;

      // B-9.2 follow-up: respect the user's notification level. We
      // read the store synchronously inside the listener so a
      // toggle in Settings takes effect on the very next event
      // without re-mounting this hook.
      const level = getNotificationLevel();
      if (level === 'off') return;
      if (level === 'failure' && status !== 'Failed') return;

      const name = workflow_name?.trim() || workflow_id;
      const titleMap: Record<string, string> = {
        Completed: `工作流完成：${name}`,
        Failed: `工作流失败：${name}`,
        Cancelled: `工作流已取消：${name}`,
      };
      const body =
        status === 'Failed' && error
          ? error.length > 140
            ? `${error.slice(0, 137)}…`
            : error
          : status === 'Completed'
            ? '点击查看任务详情'
            : '已停止';

      try {
        sendNotification({
          title: titleMap[status] ?? `工作流 ${status}：${name}`,
          body,
        });
      } catch (e) {
        console.debug('sendNotification failed:', e);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) => {
        console.debug('workflow:run-finished listen unavailable:', e);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
