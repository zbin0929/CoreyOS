import type { ChannelFieldKind, ChannelProbeResult } from '@/lib/ipc';

/**
 * Form-state helpers shared by `ChannelForm` and its sub-components.
 * Lives in its own module so the parent component file can stay
 * focused on layout + event wiring without the type / coercion
 * machinery.
 */

/**
 * Channels whose identity endpoint we wired up in
 * `ipc::channels::probe`. Each entry is `(channel_id, env_key)` —
 * the env key the probe IPC expects in the `token` field. Adding
 * a new platform here is a one-liner once its Rust probe lands.
 */
export const PROBE_TARGETS: Record<string, string> = {
  telegram: 'TELEGRAM_BOT_TOKEN',
  discord: 'DISCORD_BOT_TOKEN',
  slack: 'SLACK_BOT_TOKEN',
};

/** Per-input probe lifecycle. Stays in component state so a paste
 *  → result → manual edit → re-probe sequence renders smoothly. */
export type ProbeSlot =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'done'; result: ChannelProbeResult };

/** One pending field, keyed in two flavors: `env:NAME` or `yaml:path`.
 *  The prefix avoids collisions if a channel ever reuses a slug. */
export type FieldValue = string | boolean | string[];

export interface ChannelFormSubmission {
  envUpdates: Record<string, string | null>;
  yamlUpdates: Record<string, unknown>;
  /** Human-readable one-line diff per changed field, used in the
   *  confirmation view. Values are presence-only for env keys. */
  diffs: ChannelDiffLine[];
}

export interface ChannelDiffLine {
  kind: 'env' | 'yaml';
  label: string;
  before: string;
  after: string;
}

/** Resolve whatever the backend returned (unknown from JSON) into a
 *  typed `FieldValue` we can feed into form state. Falls back to the
 *  spec default when the field is absent on disk. */
export function coerceToFieldValue(
  kind: ChannelFieldKind,
  raw: unknown,
  defaultBool?: boolean,
): FieldValue {
  if (kind === 'bool') {
    if (typeof raw === 'boolean') return raw;
    return defaultBool ?? false;
  }
  if (kind === 'string_list') {
    if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
    return [];
  }
  // string
  return typeof raw === 'string' ? raw : '';
}

/** Structural equality for a field's old / new value. Avoids shipping
 *  no-op writes down the IPC. Arrays compare by element identity,
 *  which is fine for string lists. */
export function fieldValueEqual(
  kind: ChannelFieldKind,
  cur: unknown,
  next: FieldValue,
): boolean {
  if (kind === 'bool') {
    if (typeof cur === 'boolean') return cur === next;
    // Missing on disk; equal iff the form state matches the default
    // the spec told us to assume (already baked into `next`'s initial
    // value). Treat `next === false` against unset as "no change"
    // only when the default is false — otherwise toggling off a
    // default-true field should write an explicit `false`.
    return false;
  }
  if (kind === 'string_list') {
    const curArr = Array.isArray(cur) ? cur : [];
    const nextArr = Array.isArray(next) ? next : [];
    if (curArr.length !== nextArr.length) return false;
    for (let i = 0; i < curArr.length; i++) {
      if (curArr[i] !== nextArr[i]) return false;
    }
    return true;
  }
  // string
  const curStr = typeof cur === 'string' ? cur : '';
  return curStr === next;
}

/** Convert a typed field value to the wire format (JSON). Booleans +
 *  strings pass through; string_list goes as `string[]` (serde_json
 *  → serde_yaml sequence). */
export function toWireValue(kind: ChannelFieldKind, v: FieldValue): unknown {
  if (kind === 'bool') return Boolean(v);
  if (kind === 'string_list') return Array.isArray(v) ? v : [];
  return typeof v === 'string' ? v : '';
}

/** Compact render for the diff confirmation view. */
export function formatForDiff(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v.length > 32 ? v.slice(0, 32) + '…' : v;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const joined = v.join(', ');
    return joined.length > 32 ? `[${v.length} items]` : `[${joined}]`;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
