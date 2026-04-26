import { invoke } from '@tauri-apps/api/core';

// ───────────────────────── Hermes channels ─────────────────────────

/** Field shape drives how a form cell is rendered. Mirrors the Rust
 *  `FieldKind` enum; any other value from the backend will fall through
 *  to a plain text input in the UI. */
export type ChannelFieldKind = 'bool' | 'string' | 'string_list';

export interface ChannelYamlFieldSpec {
  /** Relative dotted path under the channel's yaml_root. */
  path: string;
  kind: ChannelFieldKind;
  label_key: string;
  default_bool?: boolean;
  default_string?: string;
}

export interface ChannelEnvKeySpec {
  name: string;
  required: boolean;
  /** i18n key for a hint rendered under the input. Empty string when
   *  serialized → normalized to `undefined` on the wire. */
  hint_key?: string;
}

export interface ChannelState {
  id: string;
  display_name: string;
  yaml_root: string;
  env_keys: ChannelEnvKeySpec[];
  yaml_fields: ChannelYamlFieldSpec[];
  hot_reloadable: boolean;
  has_qr_login: boolean;
  /** Map from env key name → whether currently set in `.env`. */
  env_present: Record<string, boolean>;
  /** Current YAML values keyed by `yaml_fields[*].path`. `null` when
   *  the field isn't set. */
  yaml_values: Record<string, unknown>;
}

/** Read-only join of the static channel catalog with current disk
 *  state. See `src-tauri/src/channels.rs` for the catalog. */
export function hermesChannelList(): Promise<ChannelState[]> {
  return invoke<ChannelState[]>('hermes_channel_list');
}

/** Patch payload for `hermesChannelSave`. Fields left out of both maps
 *  are untouched on disk. The backend enforces that every key in
 *  `env_updates` / `yaml_updates` is declared by the channel spec. */
export interface ChannelSaveArgs {
  id: string;
  /** Env-key name → new value. `null` or `""` DELETES the key. */
  env_updates?: Record<string, string | null>;
  /** YAML field path (relative to yaml_root) → new value. JSON `null`
   *  deletes the field; booleans / strings / arrays round-trip as-is. */
  yaml_updates?: Record<string, unknown>;
}

/**
 * Atomic write of a channel's credentials + behavior fields.
 *
 * Writes happen in two phases, each atomic:
 *   1) `.env` upserts — one journal entry per env key.
 *   2) `config.yaml` patch — single journal entry for the whole patch.
 *
 * Returns the refreshed `ChannelState` for the saved channel so the
 * UI can update its card without refetching the full list. If the
 * channel is not hot-reloadable (`hot_reloadable = false`) the UI
 * should prompt the user to call `hermesGatewayRestart`.
 */
export function hermesChannelSave(args: ChannelSaveArgs): Promise<ChannelState> {
  return invoke<ChannelState>('hermes_channel_save', { args });
}

// ──────────────────────── Channel live status (T3.4) ─────────────────────────

/** Three-way liveness verdict for a single channel. `unknown` when the
 *  logs have no recent line matching the channel's slug — distinct
 *  from `offline` so unconfigured channels don't falsely read as down. */
export type ChannelLiveState = 'online' | 'offline' | 'unknown';

export interface ChannelLiveStatus {
  id: string;
  state: ChannelLiveState;
  /** Raw log line that drove the verdict, or null for `unknown`.
   *  The UI surfaces the first ~120 chars as a tooltip. */
  last_marker: string | null;
  /** Unix millis at which the snapshot was computed. Shared across
   *  every row in a single response — they're classified from the
   *  same log tail. */
  probed_at_ms: number;
}

/** 30s-cached probe; `force=true` bypasses the cache. Reads
 *  `~/.hermes/logs/{gateway,agent}.log` and regex-classifies the
 *  most-recent marker per channel. */
export function hermesChannelStatusList(force = false): Promise<ChannelLiveStatus[]> {
  return invoke<ChannelLiveStatus[]>('hermes_channel_status_list', { force });
}

// ───────────────────────── Hermes profiles ─────────────────────────

export interface HermesProfileInfo {
  name: string;
  path: string;
  is_active: boolean;
  updated_at: number;
}

export interface HermesProfilesView {
  /** Absolute path the backend scanned, e.g. `/Users/x/.hermes/profiles`. */
  root: string;
  /** `true` if that directory doesn't exist yet — Hermes not installed or
   *  a brand-new install. */
  missing_root: boolean;
  profiles: HermesProfileInfo[];
  /** Name of the active profile per `~/.hermes/active_profile`. `null`
   *  when the pointer file is missing or empty. */
  active: string | null;
}

/** Scan `~/.hermes/profiles/`. Pure read; never mutates state. */
export function hermesProfileList(): Promise<HermesProfilesView> {
  return invoke<HermesProfilesView>('hermes_profile_list');
}

/** Create a new profile directory with a minimal seed `config.yaml`. */
export function hermesProfileCreate(name: string): Promise<HermesProfileInfo> {
  return invoke<HermesProfileInfo>('hermes_profile_create', { name });
}

/** Rename in place. Fails on collision or if `from` doesn't exist. */
export function hermesProfileRename(args: { from: string; to: string }): Promise<void> {
  return invoke<void>('hermes_profile_rename', args);
}

/** Remove the directory tree. Refuses the active profile. */
export function hermesProfileDelete(name: string): Promise<void> {
  return invoke<void>('hermes_profile_delete', { name });
}

/** Recursive copy. The clone starts inactive; switching is via
 *  `hermesProfileActivate` below. */
export function hermesProfileClone(args: {
  src: string;
  dst: string;
}): Promise<HermesProfileInfo> {
  return invoke<HermesProfileInfo>('hermes_profile_clone', args);
}

/** Switch the active-profile pointer (`~/.hermes/active_profile`) to
 *  `name`. Atomic on disk; journaled alongside the rest of the profile
 *  ops. Does **not** bounce the gateway — callers chain
 *  `hermesGatewayRestart()` when the user opts in. */
export function hermesProfileActivate(name: string): Promise<HermesProfileInfo> {
  return invoke<HermesProfileInfo>('hermes_profile_activate', { name });
}

// ─────────────────── tar.gz import / export ───────────────────

/** Manifest written at the root of a Caduceus profile archive. */
export interface ProfileManifest {
  version: number;
  name: string;
  /** Unix-ms timestamp of the export. */
  created_at: number;
  /** Caduceus version that produced the archive (empty string for
   *  older archives that didn't carry this field). */
  exporter_version: string;
}

export interface ProfileExportResponse {
  name: string;
  /** Base64-encoded `.tar.gz` body. Decode with `atob` before wrapping
   *  in a `Blob` for download. */
  bytes_base64: string;
  raw_size: number;
}

export interface ProfileImportPreview {
  manifest: ProfileManifest;
  file_count: number;
  total_bytes: number;
}

export interface ProfileImportResult {
  profile: HermesProfileInfo;
  /** `true` if a pre-existing profile of the same name was replaced. */
  overwrote: boolean;
  file_count: number;
}

/** Pack `~/.hermes/profiles/<name>/` into a tar.gz in memory. The
 *  frontend unwraps `bytes_base64` into a `Blob` and triggers a
 *  standard `<a download>` — no Tauri file-dialog plugin needed. */
export function hermesProfileExport(name: string): Promise<ProfileExportResponse> {
  return invoke<ProfileExportResponse>('hermes_profile_export', { args: { name } });
}

/** Parse an archive's manifest + tally its file count without touching
 *  disk. Used to render a confirm dialog before committing to
 *  `hermesProfileImport`. */
export function hermesProfileImportPreview(
  bytesBase64: string,
): Promise<ProfileImportPreview> {
  return invoke<ProfileImportPreview>('hermes_profile_import_preview', {
    args: { bytes_base64: bytesBase64 },
  });
}

/** Extract an archive under `~/.hermes/profiles/<target>/`. Fails with
 *  `AlreadyExists` unless `overwrite` is explicitly `true`. `target_name`
 *  defaults to the archive's manifest name. */
export function hermesProfileImport(args: {
  bytesBase64: string;
  targetName?: string | null;
  overwrite?: boolean;
}): Promise<ProfileImportResult> {
  return invoke<ProfileImportResult>('hermes_profile_import', {
    args: {
      bytes_base64: args.bytesBase64,
      target_name: args.targetName ?? null,
      overwrite: args.overwrite ?? false,
    },
  });
}

