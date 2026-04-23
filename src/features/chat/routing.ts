import type { RoutingMatch, RoutingRule } from '@/lib/ipc';

/**
 * T6.4 — pure routing resolver.
 *
 * Walks the user's rule list in file order and returns the id of the
 * first ENABLED rule whose `match` predicate fires against `text`.
 * The caller is responsible for cross-checking `target_adapter_id`
 * against the live AdapterRegistry — we don't have access to it here
 * and returning a rule for an un-registered adapter is a valid signal
 * the UI can surface as a warning.
 *
 * Never throws: a malformed regex falls through to the next rule and
 * a `console.warn` so the composer doesn't die on a user typo.
 */
export function resolveRoutedRule(
  rules: RoutingRule[] | null | undefined,
  text: string,
): RoutingRule | null {
  if (!rules || rules.length === 0) return null;
  const trimmed = text.replace(/^\s+/, '');
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (matches(rule.match, trimmed, text)) return rule;
  }
  return null;
}

function matches(
  m: RoutingMatch,
  trimmedLeading: string,
  original: string,
): boolean {
  const cs = m.case_sensitive === true;
  const needle = cs ? m.value : m.value.toLowerCase();
  switch (m.kind) {
    case 'prefix': {
      const hay = cs ? trimmedLeading : trimmedLeading.toLowerCase();
      return needle.length > 0 && hay.startsWith(needle);
    }
    case 'contains': {
      const hay = cs ? original : original.toLowerCase();
      return needle.length > 0 && hay.includes(needle);
    }
    case 'regex': {
      if (!m.value) return false;
      try {
        const re = new RegExp(m.value, cs ? '' : 'i');
        return re.test(original);
      } catch (e) {
        // Bad pattern shouldn't brick the composer — skip this rule.
        // One-time-per-render warning is enough; no retry scheduling.
        if (typeof console !== 'undefined') {
          console.warn('[routing] invalid regex in rule, skipping:', m.value, e);
        }
        return false;
      }
    }
  }
}
