/**
 * Pure-function helpers for the Agent Wizard. Lives in a `.ts` file
 * (no JSX) so React Fast Refresh stays happy on the component-only
 * modules that import it.
 */

/**
 * Generate a filesystem-safe id unique against existingIds. Starts
 * with the provider template's short id (`openai`, `anthropic`, …)
 * and appends a numeric suffix if needed: `openai`, `openai-2`, …
 *
 * Falls back to `<base>-new` after 99 collisions of the same provider —
 * pathological case that means the user already has 99 instances of
 * one provider, where neither outcome is great but at least we don't
 * loop forever.
 */
export function generateUniqueId(base: string, existing: string[]): string {
  const seen = new Set(existing);
  if (!seen.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!seen.has(candidate)) return candidate;
  }
  return `${base}-new`;
}
