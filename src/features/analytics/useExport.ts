import type { AnalyticsSummaryDto, CostBreakdown, LatencyStats, ErrorStats } from '@/lib/ipc';

function toCsvRow(cells: string[]): string {
  return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
}

export async function exportAnalyticsCsv(
  summary: AnalyticsSummaryDto,
  cost: CostBreakdown | null,
  latency: LatencyStats | null,
  errors: ErrorStats | null,
): Promise<void> {
  const rows: string[] = [];

  rows.push(toCsvRow(['--- Summary ---']));
  rows.push(toCsvRow(['Metric', 'Value']));
  const t = summary.totals;
  rows.push(toCsvRow(['Sessions', String(t.sessions)]));
  rows.push(toCsvRow(['Messages', String(t.messages)]));
  rows.push(toCsvRow(['Tool Calls', String(t.tool_calls)]));
  rows.push(toCsvRow(['Active Days', String(t.active_days)]));
  rows.push(toCsvRow(['Total Tokens', String(t.total_tokens)]));
  rows.push(toCsvRow(['Est. Cost USD', t.estimated_cost_usd.toFixed(2)]));
  rows.push(toCsvRow(['Est. Cost CNY', t.estimated_cost_cny.toFixed(2)]));
  if (latency && latency.avg_ms > 0) {
    rows.push(toCsvRow(['Avg Latency (ms)', String(latency.avg_ms)]));
    rows.push(toCsvRow(['P50 Latency (ms)', String(latency.p50_ms)]));
    rows.push(toCsvRow(['P95 Latency (ms)', String(latency.p95_ms)]));
    rows.push(toCsvRow(['P99 Latency (ms)', String(latency.p99_ms)]));
  }
  if (errors && errors.total_messages > 0) {
    rows.push(toCsvRow(['Error Rate', `${(errors.error_rate * 100).toFixed(1)}%`]));
    rows.push(toCsvRow(['Total Errors', String(errors.total_errors)]));
  }
  rows.push('');

  rows.push(toCsvRow(['--- Daily Messages ---']));
  rows.push(toCsvRow(['Date', 'Count']));
  for (const d of summary.messages_per_day) {
    rows.push(toCsvRow([d.date, String(d.count)]));
  }
  rows.push('');

  rows.push(toCsvRow(['--- Daily Tokens ---']));
  rows.push(toCsvRow(['Date', 'Count']));
  for (const d of summary.tokens_per_day) {
    rows.push(toCsvRow([d.date, String(d.count)]));
  }
  rows.push('');

  if (cost && cost.by_model.length > 0) {
    rows.push(toCsvRow(['--- Cost by Model ---']));
    rows.push(toCsvRow(['Model', 'Prompt Tokens', 'Completion Tokens', 'Cost USD']));
    for (const m of cost.by_model) {
      rows.push(toCsvRow([m.model, String(m.prompt_tokens), String(m.completion_tokens), m.cost_usd.toFixed(4)]));
    }
    rows.push('');
  }

  if (cost && cost.daily_cost.length > 0) {
    rows.push(toCsvRow(['--- Daily Cost ---']));
    rows.push(toCsvRow(['Date', 'Cost USD']));
    for (const d of cost.daily_cost) {
      rows.push(toCsvRow([d.date, d.cost_usd.toFixed(4)]));
    }
    rows.push('');
  }

  if (errors && errors.top_error_types.length > 0) {
    rows.push(toCsvRow(['--- Top Errors ---']));
    rows.push(toCsvRow(['Error', 'Count']));
    for (const e of errors.top_error_types) {
      rows.push(toCsvRow([e.name, String(e.count)]));
    }
  }

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'analytics-export.csv';
  a.click();
  URL.revokeObjectURL(url);
}
