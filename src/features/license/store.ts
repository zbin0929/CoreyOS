import { create } from 'zustand';

import {
  licenseMachineId,
  licenseStatus,
  type LicenseStatusReply,
  type LicenseVerdict,
} from '@/lib/ipc';

/**
 * App-wide license state. Hydrated once at boot by `Providers`, then
 * updated whenever the user activates / signs out via the gate or the
 * Settings → License section.
 *
 * The store also owns a `dismissed` flag for dev builds so the
 * maintainer can hide the gate while iterating without writing a real
 * license to disk. Production builds ignore the flag.
 */
interface LicenseState {
  loaded: boolean;
  /** Most-recent verdict from `license_status`. `null` until first
   *  hydrate so the gate can show a brief "checking…" state instead
   *  of flashing the activation modal. */
  verdict: LicenseVerdict | null;
  /** Persistent per-install UUID. Hydrated alongside the verdict so
   *  the gate can show it to the user immediately — they need it to
   *  request a machine-bound license from the seller. */
  machineId: string;
  /** True when the binary was built with `cargo build` (debug). The
   *  gate component reads this to render a yellow banner + a
   *  "dismiss for this session" button instead of forcing
   *  activation. */
  devMode: boolean;
  /** Set when the user clicks "skip" on a dev-mode gate. Reset on
   *  app restart (in-memory only). */
  devDismissed: boolean;
  hydrate: () => Promise<void>;
  setReply: (reply: LicenseStatusReply) => void;
  dismissDev: () => void;
}

export const useLicenseStore = create<LicenseState>((set) => ({
  loaded: false,
  verdict: null,
  machineId: '',
  devMode: false,
  devDismissed: false,
  hydrate: async () => {
    try {
      // Fire both IPCs in parallel — they're independent and machine
      // id is cheap (single fs read of a 36-byte file). The gate
      // needs both to render the "send this id to your seller"
      // affordance even during the initial check.
      const [reply, machineId] = await Promise.all([
        licenseStatus(),
        licenseMachineId().catch(() => ''),
      ]);
      set({
        loaded: true,
        verdict: reply.verdict,
        devMode: reply.dev_mode,
        machineId,
      });
    } catch (e) {
      // IPC failure shouldn't lock the user out forever. Treat as
      // "missing" so they get the activation modal and can paste a
      // key to retry. The console keeps the underlying error.
      console.warn('license_status failed:', e);
      set({
        loaded: true,
        verdict: { kind: 'invalid', reason: String(e) },
        devMode: false,
      });
    }
  },
  setReply: (reply) =>
    set({
      loaded: true,
      verdict: reply.verdict,
      devMode: reply.dev_mode,
    }),
  dismissDev: () => set({ devDismissed: true }),
}));
