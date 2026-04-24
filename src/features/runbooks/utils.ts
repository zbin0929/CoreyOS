import type { RunbookRow } from '@/lib/ipc';

/**
 * Minimum shape the importer accepts per entry. `id`, `created_at`,
 * `updated_at` are intentionally NOT part of the contract — the
 * importer assigns fresh ones so round-tripping the same file twice
 * makes two copies rather than mutating the originals by id.
 */
export interface RunbookImportEntry {
  name: string;
  description?: string | null;
  template: string;
  scope_profile?: string | null;
}

/**
 * Pure runbook helpers shared by the Runbooks page, the command
 * palette, and anywhere else that wants to render or filter
 * templates. Extracted from `features/runbooks/index.tsx` so that
 * file only exports React components — keeps Vite's Fast Refresh
 * boundary clean.
 */

/** Unique-preserving scan of `{{param}}` placeholders. Names are
 *  alphanumeric + underscore (no dots; no filters à la handlebars). */
export function detectParams(template: string): string[] {
  const re = /\{\{(\w+)\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of template.matchAll(re)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Substitute `{{param}}` with the matching value. Unknown placeholders
 *  pass through unchanged so the user sees something is off rather than
 *  an empty string. */
export function renderRunbook(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`);
}

/**
 * T4.6b — scope filter predicate shared by the Runbooks list and the
 * command palette. Universal runbooks (`scope_profile === null`) are
 * always visible; profile-scoped ones only match when the active
 * profile equals the scope value.
 *
 * Edge cases:
 *   - `activeProfile === null` (Hermes not installed / pointer file
 *     missing): we show ONLY universal runbooks. Scoped ones would
 *     otherwise be orphaned until the user installs Hermes, which
 *     would silently break existing workflows.
 *   - Case-sensitive match on purpose — profile dir names are
 *     filesystem-identifiers and Hermes treats them as such.
 */
export function runbookScopeApplies(
  rb: Pick<RunbookRow, 'scope_profile'>,
  activeProfile: string | null,
): boolean {
  if (rb.scope_profile === null) return true;
  if (activeProfile === null) return false;
  return rb.scope_profile === activeProfile;
}

/**
 * Parse the JSON envelope produced by the `/runbooks` Export button.
 * Accepts either the canonical shape
 *   `{ version: 1, runbooks: RunbookImportEntry[] }`
 * or a bare array `RunbookImportEntry[]` so hand-written lists work too.
 * Silently drops entries missing required fields (`name`, `template`)
 * rather than failing the whole import — partial wins are more useful
 * than a cliff-edge error.
 */
export function parseImportPayload(parsed: unknown): RunbookImportEntry[] {
  const arr: unknown = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.runbooks)
      ? parsed.runbooks
      : null;
  if (!Array.isArray(arr)) return [];
  const out: RunbookImportEntry[] = [];
  for (const raw of arr) {
    if (!isObject(raw)) continue;
    if (typeof raw.name !== 'string' || !raw.name.trim()) continue;
    if (typeof raw.template !== 'string' || !raw.template) continue;
    const entry: RunbookImportEntry = {
      name: raw.name.trim(),
      template: raw.template,
    };
    if (typeof raw.description === 'string' && raw.description.trim()) {
      entry.description = raw.description;
    } else if (raw.description === null) {
      entry.description = null;
    }
    if (typeof raw.scope_profile === 'string' && raw.scope_profile.trim()) {
      entry.scope_profile = raw.scope_profile;
    } else if (raw.scope_profile === null) {
      entry.scope_profile = null;
    }
    out.push(entry);
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
