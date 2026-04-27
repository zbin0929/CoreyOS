import { invoke } from '@tauri-apps/api/core';

/**
 * IPC barrel — re-exports every typed wrapper around `@tauri-apps/api`'s
 * `invoke` / `listen` plus their request/response DTOs. Originally a
 * single 2088-line file; split into domain-grouped siblings for
 * navigability while preserving the `@/lib/ipc` import surface used
 * across every feature.
 *
 *   ipc/_errors.ts   IpcErrorKind / IpcError / ipcErrorMessage
 *   ipc/chat.ts      Chat + streaming + models + db + attachments + analytics
 *   ipc/skills.ts    Runbooks / budgets / skills / skillHub / memory /
 *                     learning / session search / mcp / pty
 *   ipc/hermes-channels.ts   Channels + live status + profiles + tar.gz
 *   ipc/hermes-config.ts     Logs / paths / presets / config.yaml /
 *                             provider probe / changelog
 *   ipc/hermes-instances.ts  Settings / agent registry / named instances /
 *                             routing rules
 *   ipc/runtime.ts   Menu / scheduler / rag / knowledge / voice / sandbox /
 *                     workflow
 *
 * The handful of bootstrap demos (`HomeStats`, `homeStats`) live here so
 * consumers can keep importing `homeStats` from `@/lib/ipc` directly.
 */

export interface HomeStats {
  path: string;
  entry_count: number;
  sandbox_mode: 'dev-allow' | 'enforced';
}

/** Phase 0 demo — proves the IPC pipe + Rust fs round-trip. */
export function homeStats(): Promise<HomeStats> {
  return invoke<HomeStats>('home_stats');
}

export * from './ipc/_errors';
export * from './ipc/chat';
export * from './ipc/skills';
export * from './ipc/hermes-channels';
export * from './ipc/hermes-config';
export * from './ipc/hermes-instances';
export * from './ipc/runtime';
export * from './ipc/license';
