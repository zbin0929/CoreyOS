import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * **B-9.2 follow-up — desktop notification level.**
 *
 * Controls which workflow-finish events fire a native desktop
 * notification through `useWorkflowNotifications`.
 *
 * - `all` (default): every terminal status (Completed / Failed /
 *   Cancelled) fires a notification.
 * - `failure`: only Failed runs fire. Completed / Cancelled go
 *   silent — useful for users running 100s of cron-driven runs
 *   who only care about exceptions.
 * - `off`: notification path is fully short-circuited; the tray
 *   counter still updates because that's a separate signal.
 *
 * Persisted to localStorage so the preference survives reloads
 * without a backend round-trip. We deliberately don't sync this
 * to `~/.hermes/config.yaml` — it's a per-device UX preference,
 * not a portable workspace setting.
 */
export type NotificationLevel = 'all' | 'failure' | 'off';

interface NotificationPrefsState {
  level: NotificationLevel;
  setLevel: (level: NotificationLevel) => void;
}

export const useNotificationPrefs = create<NotificationPrefsState>()(
  persist(
    (set) => ({
      level: 'all',
      setLevel: (level) => set({ level }),
    }),
    {
      name: 'caduceus.notification-prefs',
      version: 1,
    },
  ),
);

/**
 * Pure-function variant for non-component call sites (event
 * listeners, `useEffect` callbacks). Reads the current value
 * synchronously from the store.
 */
export function getNotificationLevel(): NotificationLevel {
  return useNotificationPrefs.getState().level;
}
