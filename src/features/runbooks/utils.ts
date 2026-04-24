import type { RunbookRow } from '@/lib/ipc';

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
