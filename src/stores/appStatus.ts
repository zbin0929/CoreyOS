import { create } from 'zustand';
import { configGet, configTest, hermesConfigRead, type GatewayConfigDto } from '@/lib/ipc';

/**
 * App-wide status the shell reads from: the current default model (shown in
 * the topbar "profile" slot) and live gateway health. Populated once at boot
 * by `Providers`, then kept warm with a slow poll.
 *
 * The chat store's `newSession` reads `currentModel` synchronously so every
 * fresh conversation carries the correct model label into SQLite (which the
 * Analytics page groups by).
 */
export type GatewayHealth = 'unknown' | 'online' | 'offline';

interface AppStatusState {
  /**
   * The model the gateway will route to by default. Resolved at boot from
   * `~/.hermes/config.yaml` → `model.default`, with a fallback to the
   * gateway adapter's `default_model` if that's empty.
   */
  currentModel: string | null;
  /** Most-recent gateway probe result. */
  gateway: GatewayHealth;
  /** Round-trip latency from the last successful probe (ms). */
  gatewayLatencyMs: number | null;

  /** Explicit setter — called by Settings/LLMs pages after the user saves. */
  setCurrentModel: (m: string | null) => void;

  /** Re-resolve the current model from Hermes + gateway config. */
  refreshModel: () => Promise<void>;

  /**
   * Hit `/health` via the Rust adapter. Flips `gateway` + `gatewayLatencyMs`.
   * Catches all errors — never throws.
   */
  refreshGateway: () => Promise<void>;

  /** Kick off one-off refresh plus a slow interval (30 s). Idempotent. */
  startBackgroundRefresh: () => void;
  stopBackgroundRefresh: () => void;
}

let gatewayInterval: ReturnType<typeof setInterval> | null = null;

export const useAppStatusStore = create<AppStatusState>()((set, get) => ({
  currentModel: null,
  gateway: 'unknown',
  gatewayLatencyMs: null,

  setCurrentModel: (m) => set({ currentModel: m && m.trim() ? m : null }),

  refreshModel: async () => {
    // Try the Hermes config file first — that's the LLM the gateway will
    // ACTUALLY talk to. Fall back to the adapter's configured default.
    try {
      const view = await hermesConfigRead();
      const m = view.model.default?.trim() || '';
      if (m) {
        set({ currentModel: m });
        return;
      }
    } catch {
      // fall through
    }
    try {
      const cfg: GatewayConfigDto = await configGet();
      const m = cfg.default_model?.trim() || '';
      set({ currentModel: m || null });
    } catch {
      // leave whatever was there
    }
  },

  refreshGateway: async () => {
    try {
      // Reuse `config_test` with the already-saved config to probe /health.
      const cfg = await configGet();
      const probe = await configTest(cfg);
      set({ gateway: 'online', gatewayLatencyMs: probe.latency_ms });
    } catch {
      set({ gateway: 'offline', gatewayLatencyMs: null });
    }
  },

  startBackgroundRefresh: () => {
    // One-shot immediate refresh so the UI doesn't sit on "unknown" for long.
    void get().refreshModel();
    void get().refreshGateway();
    if (gatewayInterval !== null) return;
    gatewayInterval = setInterval(() => {
      void get().refreshGateway();
    }, 30_000);
  },

  stopBackgroundRefresh: () => {
    if (gatewayInterval !== null) {
      clearInterval(gatewayInterval);
      gatewayInterval = null;
    }
  },
}));
