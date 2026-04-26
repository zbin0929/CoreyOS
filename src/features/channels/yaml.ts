/** Render a YAML value compactly for the card preview. `null` / undefined
 *  show as a muted em-dash so empty defaults don't look like a bug. */
export function formatYamlValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') {
    if (v.length <= 24) return v;
    return v.slice(0, 24) + '…';
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.length === 1) return `[${formatYamlValue(v[0])}]`;
    return `[${v.length} items]`;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
