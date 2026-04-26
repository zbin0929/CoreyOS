import { invoke } from '@tauri-apps/api/core';

// ───────────────────────── Hermes logs ─────────────────────────

export type HermesLogKind = 'agent' | 'gateway' | 'error';

export interface HermesLogTail {
  /** Absolute path on disk the backend tried to read. */
  path: string;
  /** `true` if the file didn't exist — `lines` will be empty. */
  missing: boolean;
  /** Last N lines in chronological order (oldest first). */
  lines: string[];
  /** Total line count in the file before truncation. Lets the UI show
   *  "Showing last 500 of 12,340 lines". */
  total_lines: number;
}

/** Tail one of Hermes's rolling log files. `maxLines` is clamped server-
 *  side to [1, 5000] and defaults to 500. */
export function hermesLogTail(args: {
  kind: HermesLogKind;
  maxLines?: number;
}): Promise<HermesLogTail> {
  return invoke<HermesLogTail>('hermes_log_tail', {
    kind: args.kind,
    maxLines: args.maxLines ?? null,
  });
}

// ───────────────────────── App paths ─────────────────────────

export interface AppPaths {
  config_dir: string;
  data_dir: string;
  db_path: string;
  changelog_path: string;
}

/** Platform-native paths the app uses on disk. Read-only view for the
 *  Settings → Storage section. No I/O — AppState caches these at boot. */
export function appPaths(): Promise<AppPaths> {
  return invoke<AppPaths>('app_paths');
}

// ───────────────────────── Presets ─────────────────────────

/** Bundled starter content shipped inside the app (skills + MCP +
 *  memory templates). Installed into `~/.hermes/` on demand; never
 *  overwrites existing user files. Vendor-customised builds swap the
 *  default preset for an industry-specific one (e-commerce, legal, …)
 *  — that's the product's main differentiation lever. */
export interface PresetManifest {
  id: string;
  name: string;
  description: string;
  version: number;
}

export interface PresetInstallResult {
  /** Relative labels of files / mcp ids newly written. */
  installed: string[];
  /** Labels of files skipped because the user already had them. */
  skipped: string[];
  manifest: PresetManifest | null;
}

/** Read a preset's manifest without installing. Useful for showing the
 *  preset's name + description in a confirm dialog before the user hits
 *  "Install". */
export function presetDescribe(id: string): Promise<PresetManifest> {
  return invoke<PresetManifest>('preset_describe', { id });
}

/** Install a named preset into `~/.hermes/`. Idempotent — existing
 *  user files are never clobbered, so re-running is safe. Returns a
 *  summary the UI can display as a toast. */
export function presetInstall(id: string): Promise<PresetInstallResult> {
  return invoke<PresetInstallResult>('preset_install', { id });
}

// ───────────────────────── Hermes's own config.yaml ─────────────────────────

export interface HermesModelSection {
  default?: string | null;
  provider?: string | null;
  base_url?: string | null;
}

export interface HermesConfigView {
  /** Absolute path on disk, for display + error messages. */
  config_path: string;
  /** `true` if the file existed and parsed. */
  present: boolean;
  model: HermesModelSection;
  /** Names of `*_API_KEY` env vars with non-empty values in ~/.hermes/.env. */
  env_keys_present: string[];
}

/** Current `model` section from `~/.hermes/config.yaml`. */
export function hermesConfigRead(): Promise<HermesConfigView> {
  return invoke<HermesConfigView>('hermes_config_read');
}

/** Result of the first-run Hermes detection probe. `installed === false`
 *  means the `hermes` CLI isn't on PATH / at the canonical install path
 *  — the Home page renders an install CTA in that case. */
export interface HermesDetection {
  installed: boolean;
  path: string | null;
  version: string | null;
}

/** Detect whether the Hermes CLI is installed locally. Cheap — one
 *  `hermes --version` invocation at most. */
export function hermesDetect(): Promise<HermesDetection> {
  return invoke<HermesDetection>('hermes_detect');
}

/** `hermes gateway start` — used by Home's "Start gateway" button
 *  when the binary is present but the /health probe fails. */
export function hermesGatewayStart(): Promise<string> {
  return invoke<string>('hermes_gateway_start');
}

/**
 * Persist a new `model` section to `~/.hermes/config.yaml`. Other fields are
 * preserved. Returns the re-read view for UI reconciliation.
 *
 * NOTE: The Hermes gateway does NOT hot-reload this file. Changes take effect
 * only after `hermes gateway restart`. The UI should surface this.
 */
export function hermesConfigWriteModel(
  model: HermesModelSection,
): Promise<HermesConfigView> {
  return invoke<HermesConfigView>('hermes_config_write_model', { model });
}

/**
 * Upsert or delete a `*_API_KEY` entry in `~/.hermes/.env`. Pass `null` or
 * an empty string to remove. Only `*_API_KEY` suffixes are permitted
 * server-side. Returns the refreshed config view.
 */
export function hermesEnvSetKey(
  key: string,
  value: string | null,
): Promise<HermesConfigView> {
  return invoke<HermesConfigView>('hermes_env_set_key', { key, value });
}

/**
 * Run `hermes gateway restart`. Resolves with the process's combined stdout
 * (or stderr on empty stdout). Rejects with the process's error output on
 * non-zero exit. The call is long — typically a few seconds while the
 * gateway shuts down and re-binds port 8642.
 */
export function hermesGatewayRestart(): Promise<string> {
  return invoke<string>('hermes_gateway_restart');
}

// ───────────────────────── Provider probe ─────────────────────────

export interface DiscoveredModel {
  id: string;
  owned_by?: string | null;
  /** Unix seconds when the provider first published the model, if any. */
  created?: number | null;
}

export interface ProbeReport {
  /** The URL we actually queried (post-normalization of the user's base_url). */
  endpoint: string;
  latency_ms: number;
  models: DiscoveredModel[];
}

/**
 * `GET {base_url}/v1/models` against an OpenAI-compatible provider.
 * Bypasses the local Hermes gateway — talks straight to the upstream.
 *
 * Auth source is exactly one of:
 * - `envKey`: name of a `*_API_KEY` entry in `~/.hermes/.env`. Server reads
 *   the value; raw secret never crosses IPC. **Preferred.**
 * - `apiKey`: literal key. Crosses IPC but is never persisted.
 * - neither: anonymous probe (self-hosted endpoints).
 */
export function modelProviderProbe(args: {
  baseUrl: string;
  envKey?: string | null;
  apiKey?: string | null;
}): Promise<ProbeReport> {
  return invoke<ProbeReport>('model_provider_probe', {
    baseUrl: args.baseUrl,
    envKey: args.envKey ?? null,
    apiKey: args.apiKey ?? null,
  });
}

// ───────────────────────── Changelog journal ─────────────────────────

export interface ChangelogEntry {
  /** `<rfc3339>-<session-seq>`. Stable primary key. */
  id: string;
  /** RFC-3339 timestamp (UTC). */
  ts: string;
  /** Dotted op namespace, e.g. `hermes.config.model`. */
  op: string;
  before?: unknown;
  after?: unknown;
  /** Human-readable summary for display. */
  summary: string;
}

/** Newest-first list, capped server-side at 500. Defaults to 100. */
export function changelogList(limit?: number): Promise<ChangelogEntry[]> {
  return invoke<ChangelogEntry[]>('changelog_list', { limit });
}

export interface RevertReport {
  /** The fresh entry describing the revert itself (also appears in next list). */
  revert_entry: ChangelogEntry;
}

/**
 * Revert one journal entry by id. Dispatches server-side by the entry's `op`.
 *
 * Revertible ops (current):
 * - `hermes.config.model` — restores provider/model/base_url.
 *
 * Irreversible ops (server returns `unsupported`):
 * - `hermes.env.key` — we never persisted the secret, so we can't put it back.
 *
 * The revert itself is journaled as a new entry, so the history stays
 * append-only and reverts can be re-reverted.
 */
export function changelogRevert(entryId: string): Promise<RevertReport> {
  return invoke<RevertReport>('changelog_revert', { entryId });
}

