/**
 * PivotTable view template.
 *
 * Multi-level row grouping — used for P&L statements, balance
 * sheets, hierarchical inventory. Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: profit-loss
 *     title: 损益表
 *     template: PivotTable
 *     data_source: { mcp: erp, method: profit_loss }
 *     row_groups: [category, product]
 *     columns: [current, prior, delta_pct]
 * ```
 *
 * Stage 5c is the layout shell. Stage 5d wires data + collapse /
 * expand interactions.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';
import { cn } from '@/lib/cn';

interface PivotRow {
  label: string;
  indent: number;
  bold: boolean;
  values: Record<string, number | string>;
}

function extractRows(data: unknown): PivotRow[] {
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).rows)
      ? ((data as Record<string, unknown>).rows as unknown[])
      : [];
  return arr
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => {
      const values: Record<string, number | string> = {};
      const valuesObj =
        r.values && typeof r.values === 'object' && !Array.isArray(r.values)
          ? (r.values as Record<string, unknown>)
          : {};
      for (const [k, v] of Object.entries(valuesObj)) {
        if (typeof v === 'number' || typeof v === 'string') values[k] = v;
      }
      return {
        label: typeof r.label === 'string' ? r.label : '',
        indent: typeof r.indent === 'number' ? Math.max(0, Math.min(5, r.indent)) : 0,
        bold: r.bold === true,
        values,
      };
    })
    .filter((r) => r.label.length > 0);
}

function formatCell(value: unknown, col?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (col && (col.includes('pct') || col.includes('rate') || col.includes('margin'))) {
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    }
    return value.toLocaleString();
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function deltaClass(value: unknown): string {
  if (typeof value !== 'number') return '';
  if (value > 0) return 'text-success';
  if (value < 0) return 'text-danger';
  return '';
}

const PIVOT_COL_LABELS: Record<string, string> = {
  current: '本期',
  prior: '上期',
  delta_pct: '同比%',
  amount: '金额',
  pct_of_sales: '占比',
  value: '值',
};

function isGroupHeader(row: PivotRow): boolean {
  return row.indent === 0 && row.bold;
}

export function PivotTableTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(options.columns)
    ? (options.columns as string[])
    : ['value'];
  const rowGroups = Array.isArray(options.row_groups)
    ? (options.row_groups as string[])
    : [];

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const rows = extractRows(data);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  function toggleGroup(idx: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function visibleRows(): { row: PivotRow; originalIdx: number }[] {
    const result: { row: PivotRow; originalIdx: number }[] = [];
    let skipUntilIndent0 = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as PivotRow | undefined;
      if (!row) continue;
      if (isGroupHeader(row)) {
        skipUntilIndent0 = collapsed.has(i);
        result.push({ row, originalIdx: i });
        continue;
      }
      if (skipUntilIndent0 && row.indent > 0) continue;
      if (row.indent === 0) skipUntilIndent0 = false;
      result.push({ row, originalIdx: i });
    }
    return result;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elev-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-fg">
          {rowGroups.length > 0 ? rowGroups.join(' › ') : '数据透视'}
        </span>
        <span className="text-xs text-fg-subtle">{rows.length} 行</span>
      </div>
      {error && (
        <p className="border-b border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="bg-bg-elev-2 text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-3 py-2 text-left font-medium">项目</th>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-medium">
                {PIVOT_COL_LABELS[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [0, 1, 2, 3].map((idx) => (
              <tr key={idx} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="inline-block h-2 w-24 animate-pulse rounded bg-bg-elev-3" />
                </td>
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2 text-right">
                    <span className="inline-block h-2 w-12 animate-pulse rounded bg-bg-elev-3" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr className="border-t border-border">
              <td
                colSpan={columns.length + 1}
                className="px-3 py-6 text-center text-xs text-fg-subtle"
              >
                no rows
              </td>
            </tr>
          ) : (
            visibleRows().map(({ row, originalIdx }) => {
              const isGroup = isGroupHeader(row);
              const isCollapsed = collapsed.has(originalIdx);
              return (
                <tr
                  key={originalIdx}
                  className={cn(
                    'border-t border-border text-fg',
                    isGroup && 'cursor-pointer bg-bg-elev-2/40 hover:bg-bg-elev-2/70',
                    row.indent > 0 && 'text-sm',
                  )}
                  onClick={isGroup ? () => toggleGroup(originalIdx) : undefined}
                >
                  <td
                    className={cn('px-3 py-2', row.bold && 'font-semibold')}
                    style={{ paddingLeft: `${0.75 + row.indent * 1.25}rem` }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {isGroup && (
                        <Icon icon={isCollapsed ? ChevronRight : ChevronDown} size="xs" className="text-fg-muted" />
                      )}
                      {row.label}
                    </span>
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c}
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        row.bold && 'font-semibold',
                        deltaClass(row.values[c]),
                      )}
                    >
                      {formatCell(row.values[c], c)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
