export function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Turn a sparse `{date, count}[]` from the backend into a dense 30-day
 * series ending TODAY (UTC). Missing days get count=0 so the line chart
 * still renders a full timeline.
 */
export function padLast30Days(sparse: Array<{ date: string; count: number }>) {
  const byDate = new Map(sparse.map((d) => [d.date, d.count]));
  const out: Array<{ date: string; count: number }> = [];
  const today = new Date();
  // Use UTC to stay consistent with the backend's `date(created_at/1000,'unixepoch')`.
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, count: byDate.get(iso) ?? 0 });
  }
  return out;
}
