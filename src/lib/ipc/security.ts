import { invoke } from '@tauri-apps/api/core';

/**
 * Severity buckets returned by `security_status_get`. Frontend picks
 * badge colours and sort priority off this.
 */
export type SecurityStatusLevel = 'ok' | 'warn' | 'crit';

/**
 * Snapshot of the Corey guard + hook registration state. Mirrors the
 * Rust `SecurityStatus` struct 1:1 (serde `rename_all = "camelCase"`).
 */
export interface SecurityStatus {
  guardScriptPath: string | null;
  guardScriptInstalled: boolean;
  guardHookRegistered: boolean;
  hooksAutoAccept: boolean;
  recentFires: number;
  recentBlocks: number;
  overall: SecurityStatusLevel;
  issues: string[];
}

/**
 * Read current security posture. Never throws on bad machine state —
 * an unresolved Hermes dir produces `overall: 'crit'` with an
 * `hermes_dir_unresolved` issue marker so the UI can still render.
 */
export function securityStatusGet(): Promise<SecurityStatus> {
  return invoke<SecurityStatus>('security_status_get');
}

/**
 * Re-run the boot-time reconcile (seed guard script + register
 * hook). Returns the post-reconcile status so the UI can
 * show-and-forget.
 *
 * Safe to call repeatedly — both operations are idempotent.
 */
export function securityReconcile(): Promise<SecurityStatus> {
  return invoke<SecurityStatus>('security_reconcile');
}

export interface GuardResolveArgs {
  id: string;
  allowed: boolean;
}

export function guardPromptResolve(args: GuardResolveArgs): Promise<void> {
  return invoke<void>('guard_prompt_resolve', { args });
}
