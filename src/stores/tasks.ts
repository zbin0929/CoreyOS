import { create } from 'zustand';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { workflowActiveRuns, type WorkflowRunResult } from '@/lib/ipc';

const POLL_MS = 5_000;

interface TasksState {
  active: WorkflowRunResult[];
  runningCount: number;
  pausedCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastTerminalIds = new Set<string>();
let permissionEnsured = false;

async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionEnsured) return true;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === 'granted';
    }
    permissionEnsured = granted;
    return granted;
  } catch {
    return false;
  }
}

function notify(title: string, body: string) {
  void ensureNotificationPermission().then((ok) => {
    if (!ok) return;
    try {
      sendNotification({ title, body });
    } catch {
      // best-effort; never throw from notification path.
    }
  });
}

export const useTasksStore = create<TasksState>((set, get) => ({
  active: [],
  runningCount: 0,
  pausedCount: 0,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const list = await workflowActiveRuns();
      const running = list.filter((r) => r.status === 'running' || r.status === 'pending').length;
      const paused = list.filter((r) => r.status === 'paused').length;

      const prevActive = get().active;
      const prevIds = new Set(prevActive.map((r) => r.id));
      const currentIds = new Set(list.map((r) => r.id));

      // Detect transitions: ids that disappeared from active are
      // either completed/failed/cancelled. We re-fetch their status
      // by checking the previous snapshot.
      for (const prev of prevActive) {
        if (!currentIds.has(prev.id) && !lastTerminalIds.has(prev.id)) {
          lastTerminalIds.add(prev.id);
          // Cap memory: keep only last 200 terminal ids.
          if (lastTerminalIds.size > 200) {
            const arr = Array.from(lastTerminalIds);
            lastTerminalIds = new Set(arr.slice(arr.length - 200));
          }
          const wasRunning = prev.status === 'running' || prev.status === 'pending';
          if (wasRunning) {
            notify('任务完成', `${prev.workflow_id} 已结束`);
          }
        }
      }

      // Detect newly-failed runs (still in active list but status flipped)
      for (const cur of list) {
        const prev = prevActive.find((p) => p.id === cur.id);
        if (prev && prev.status !== cur.status && cur.status === 'failed') {
          notify('任务失败', `${cur.workflow_id}: ${cur.error ?? '未知错误'}`);
        }
        // Also detect transition into 'paused' (awaiting approval)
        if (prev && prev.status !== 'paused' && cur.status === 'paused') {
          notify('等待审批', `${cur.workflow_id} 暂停，等待你确认`);
        }
      }
      // Newly-failed terminal that vanished in same poll window:
      for (const prev of prevActive) {
        if (!currentIds.has(prev.id) && prev.status === 'failed' && !lastTerminalIds.has(prev.id)) {
          notify('任务失败', `${prev.workflow_id}: ${prev.error ?? '未知错误'}`);
        }
      }

      // Track ids that appear as failed even on first observation.
      for (const cur of list) {
        if ((cur.status === 'failed' || cur.status === 'cancelled') && !prevIds.has(cur.id)) {
          // first observation in failed state — likely we missed the transition
          // (e.g. polling started after a long task already crashed); skip notify.
        }
      }

      set({ active: list, runningCount: running, pausedCount: paused, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    void get().refresh();
    pollTimer = setInterval(() => {
      void get().refresh();
    }, POLL_MS);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
