import type { SkillContent, SkillSummary } from '@/lib/ipc';

export type Selection =
  | { kind: 'none' }
  | { kind: 'new'; name: string }
  | { kind: 'loading'; path: string }
  | { kind: 'open'; path: string; loaded: SkillContent; dirty: string }
  | { kind: 'error'; path: string | null; message: string };

/** Group summaries by their parent directory. `null` group for root. */
export function groupByFolder(
  rows: SkillSummary[],
): Array<{ group: string | null; rows: SkillSummary[] }> {
  const buckets = new Map<string | null, SkillSummary[]>();
  for (const r of rows) {
    const key = r.group ?? null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }
  // Root first, then folders alphabetically.
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ group: k, rows: buckets.get(k)! }));
}

export function stripMdExt(path: string): string {
  return path.replace(/\.md$/i, '');
}
