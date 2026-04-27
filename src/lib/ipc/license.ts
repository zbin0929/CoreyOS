import { invoke } from '@tauri-apps/api/core';

/** Decoded payload returned by the backend when a license verifies.
 *  Mirrors `crate::license::Payload` 1:1. */
export interface LicensePayload {
  user: string;
  issued: string;
  expires?: string | null;
  features: string[];
  /** Set when the seller minted the license bound to a specific
   *  install. `null` / undefined = portable. */
  machine_id?: string | null;
}

/** Tagged union the backend returns for any license query. The
 *  React side switches on `kind` to decide which UI to render. */
export type LicenseVerdict =
  | { kind: 'missing' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'expired'; user: string; expires: string }
  | {
      kind: 'wrong_machine';
      user: string;
      /** Machine id baked into the license token. */
      expected: string;
      /** Local install's machine id — what we want the seller to
       *  re-issue against. */
      actual: string;
    }
  | { kind: 'valid'; payload: LicensePayload };

export interface LicenseStatusReply {
  verdict: LicenseVerdict;
  /** True for `cargo build` debug binaries — frontend uses this to
   *  bypass the gate during development without disabling the IPC. */
  dev_mode: boolean;
}

/** Read + verify the on-disk license. Cheap; called once on app
 *  boot and after Settings → "Sign out". */
export function licenseStatus(): Promise<LicenseStatusReply> {
  return invoke<LicenseStatusReply>('license_status');
}

/** Verify + persist a token the user pasted into the activation
 *  dialog. Returns the verdict from `license_status` semantics so
 *  the frontend can render the new state without a follow-up call. */
export function licenseInstall(token: string): Promise<LicenseStatusReply> {
  return invoke<LicenseStatusReply>('license_install', { token });
}

/** Wipe the on-disk license. Idempotent — non-existent file is OK. */
export function licenseClear(): Promise<void> {
  return invoke<void>('license_clear');
}

/** Persistent per-install UUID. Shown in the gate + Settings so the
 *  user can email it to the seller, who mints a license bound to it. */
export function licenseMachineId(): Promise<string> {
  return invoke<string>('license_machine_id');
}
