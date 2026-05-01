/**
 * DataTable view template.
 *
 * Pack manifest example:
 *
 * ```yaml
 * views:
 *   - id: ad-monitor
 *     title: 广告守卫
 *     template: DataTable
 *     columns: [campaign, acos, spend, sales]
 *     data_source:
 *       static:
 *         rows:
 *           - { campaign: "Holiday Q4", acos: "32%", spend: 1200, sales: 3750 }
 *           - { campaign: "Brand defence", acos: "8%", spend: 200, sales: 2500 }
 * ```
 *
 * The data source is expected to return either a top-level array
 * of row objects, or `{ rows: [...] }`. Each row object is keyed
 * by the column name.
 */
import { type JSX, useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';

function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(
      (r): r is Record<string, unknown> =>
        typeof r === 'object' && r !== null && !Array.isArray(r),
    );
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      return obj.rows.filter(
        (r): r is Record<string, unknown> =>
          typeof r === 'object' && r !== null && !Array.isArray(r),
      );
    }
  }
  return [];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function labelForColumn(column: string): string {
  const zhMap: Record<string, string> = {
    order_id: '订单号',
    sku: 'SKU',
    product: '商品',
    quantity: '数量',
    price: '价格',
    status: '状态',
    date: '日期',
    campaign: '广告活动',
    acos: 'ACOS',
    spend: '花费',
    sales: '销售额',
    clicks: '点击',
    ctr: 'CTR',
    fba_qty: 'FBA库存',
    inbound: '在途',
    sell_rate: '日销量',
    days_of_stock: '可售天数',
    asin: 'ASIN',
    variant: '变体',
    tacos: 'TACoS',
    refund_rate: '退货率',
    organic_sales: '自然销售',
    ppc_sales: '广告销售',
    profit: '利润',
    profit_margin: '利润率',
    revenue: '销售额',
    cost: '成本',
    stage: '漏斗阶段',
    value: '数值',
    conversion_rate: '转化率',
    drop_rate: '流失率',
    impressions: '曝光量',
    sessions: '会话数',
    page_views: '页面浏览',
    add_to_cart: '加购数',
    conversions: '下单数',
  };
  if (zhMap[column]) return zhMap[column];
  return column
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusClass(value: string): string {
  const v = value.toLowerCase();
  if (v.includes('critical') || v.includes('over_acos') || v.includes('cancel') || v.includes('low_cvr') || v.includes('drop')) {
    return 'bg-danger/10 text-danger border-danger/30';
  }
  if (v.includes('warning') || v.includes('pending') || v.includes('high_ctr_low_cvr') || v.includes('below_avg')) {
    return 'bg-warning/10 text-warning border-warning/30';
  }
  if (v.includes('healthy') || v.includes('shipped') || v.includes('ok') || v.includes('above_avg') || v.includes('good')) {
    return 'bg-success/10 text-success border-success/30';
  }
  return 'bg-bg-elev-2 text-fg-muted border-border';
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[%$,]/g, ''));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

const STATUS_LABELS: Record<string, string> = {
  healthy: '健康',
  good: '良好',
  above_avg: '高于均值',
  below_avg: '低于均值',
  warning: '预警',
  critical: '严重',
  over_acos: 'ACOS超标',
  high_ctr_low_cvr: '高点击低转化',
  low_cvr: '低转化',
  drop: '流失',
  shipped: '已发货',
  pending: '待处理',
  cancelled: '已取消',
  ok: '正常',
};

function statusLabel(raw: string): string {
  const key = raw.toLowerCase();
  return STATUS_LABELS[key] ?? raw;
}

function renderCell(column: string, value: unknown): string | JSX.Element {
  if (column !== 'status') return formatCell(value);
  const text = formatCell(value);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(text)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(text)}`} />
      {statusLabel(text)}
    </span>
  );
}

function statusDotClass(value: string): string {
  const v = value.toLowerCase();
  if (v.includes('critical') || v.includes('over_acos') || v.includes('cancel') || v.includes('low_cvr') || v.includes('drop')) return 'bg-danger';
  if (v.includes('warning') || v.includes('pending') || v.includes('high_ctr_low_cvr') || v.includes('below_avg')) return 'bg-warning';
  if (v.includes('healthy') || v.includes('shipped') || v.includes('ok') || v.includes('above_avg') || v.includes('good')) return 'bg-success';
  return 'bg-fg-muted';
}

type SortDir = 'asc' | 'desc' | null;

function hasChildren(row: Record<string, unknown>): boolean {
  return Array.isArray(row.children) && row.children.length > 0;
}

function getChildren(row: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(row.children)) return [];
  return row.children.filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r),
  );
}

export function DataTableTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(options.columns)
    ? (options.columns as string[])
    : [];

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const rawRows = extractRows(data);

  const rows = useMemo(() => {
    if (!sortCol || !sortDir) return rawRows;
    return [...rawRows].sort((a, b) => {
      const av = numericValue(a[sortCol]);
      const bv = numericValue(b[sortCol]);
      if (av !== null && bv !== null) return sortDir === 'asc' ? av - bv : bv - av;
      const as = String(a[sortCol] ?? '');
      const bs = String(b[sortCol] ?? '');
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [rawRows, sortCol, sortDir]);

  function toggleSort(col: string) {
    if (sortCol !== col) { setSortCol(col); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    setSortCol(null); setSortDir(null);
  }

  if (columns.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This DataTable view has no <code>columns:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-elev-1 shadow-sm">
      {error && (
        <p className="border-b border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg-elev-2/80 text-xs tracking-wide text-fg-subtle">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="cursor-pointer select-none px-3 py-2.5 text-left font-medium transition-colors hover:text-fg"
                  onClick={() => toggleSort(c)}
                >
                  <span className="inline-flex items-center gap-1">
                    {labelForColumn(c)}
                    {sortCol === c ? (
                      <Icon icon={sortDir === 'asc' ? ArrowUp : ArrowDown} size="xs" className="text-gold-500" />
                    ) : (
                      <Icon icon={ArrowUpDown} size="xs" className="opacity-0 group-hover:opacity-40" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3].map((row) => (
                <tr key={`skel-${row}`} className="border-t border-border/60">
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-2.5">
                      <span className="inline-block h-3 w-16 animate-pulse rounded bg-bg-elev-3/60" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center"
                >
                  <div className="flex flex-col items-center gap-2 text-fg-subtle">
                    <Icon icon={Inbox} size="lg" className="text-fg-disabled" />
                    <span className="text-xs">暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
              const expandable = hasChildren(row);
              const isOpen = expanded.has(idx);
              return (
                <>
                  <tr
                    key={idx}
                    className={`border-t border-border/50 text-fg transition-colors hover:bg-gold-500/[0.03] odd:bg-bg-elev-1 even:bg-bg-elev-2/20 ${expandable ? 'cursor-pointer' : ''}`}
                    onClick={expandable ? () => setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(idx)) next.delete(idx); else next.add(idx);
                      return next;
                    }) : undefined}
                  >
                    {columns.map((c, ci) => (
                      <td key={c} className="px-3 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {ci === 0 && expandable && (
                            <Icon icon={isOpen ? ChevronDown : ChevronRight} size="xs" className="text-fg-muted" />
                          )}
                          {renderCell(c, row[c])}
                        </span>
                      </td>
                    ))}
                  </tr>
                  {isOpen && getChildren(row).map((child, ci) => (
                    <tr
                      key={`${idx}-c-${ci}`}
                      className="border-t border-border/30 bg-bg-elev-2/40 text-fg-subtle text-xs transition-colors hover:bg-gold-500/[0.02]"
                    >
                      {columns.map((c, colIdx) => (
                        <td key={c} className="px-3 py-2 whitespace-nowrap" style={colIdx === 0 ? { paddingLeft: '2rem' } : undefined}>
                          {renderCell(c, child[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              );
            })
            )}
          </tbody>
        </table>
      </div>
      {!loading && rows.length > 0 && (
        <div className="border-t border-border/60 bg-bg-elev-2/40 px-3 py-1.5 text-[11px] text-fg-muted">
          共 {rows.length} 条记录
        </div>
      )}
    </div>
  );
}
