import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Table as TableIcon } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { saveText } from '@/lib/saveText';

/**
 * **B-9.4 long-table artifact card.**
 *
 * Wraps every chat-rendered markdown table with an optional header
 * bar that surfaces row count and a "Download CSV" affordance.
 * Header only appears for tables with ≥ `MIN_ROWS_FOR_HEADER` rows
 * — short reference tables (3-line schedules, 5-line price lists)
 * stay clean.
 *
 * ## Why DOM-walk at click time
 *
 * react-markdown hands us `children` as a React node tree; cell
 * text is buried inside `<td>` elements that may themselves
 * contain `<strong>` / `<em>` / `<code>` siblings. Stringifying
 * via the React tree means re-implementing markdown text-extract,
 * which is a known hairball. The rendered DOM is the source of
 * truth, so we just walk it via `textContent` at click time —
 * matches what the user sees, including any inline formatting.
 *
 * ## CSV escaping
 *
 * RFC 4180: wrap every cell in double quotes and double any
 * embedded quotes. Newlines inside cells are preserved (Excel /
 * Numbers / Sheets all import this correctly when the cell is
 * quoted). We don't strip newlines because that would silently
 * lose data.
 */
const MIN_ROWS_FOR_HEADER = 10;

export function TableArtifact({ children }: { children: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [rowCount, setRowCount] = useState(0);

  // Recount on every children change. ReactMarkdown re-renders the
  // whole tree on edit / streaming, so this fires often during
  // assistant streaming but is cheap (single DOM query).
  useLayoutEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    setRowCount(t.querySelectorAll('tr').length);
  }, [children]);

  const showHeader = rowCount >= MIN_ROWS_FOR_HEADER;

  const onDownloadCsv = () => {
    const t = tableRef.current;
    if (!t) return;
    const rows = Array.from(t.querySelectorAll('tr'));
    const csv = rows
      .map((row) =>
        Array.from(row.querySelectorAll('th,td'))
          .map((cell) => {
            const txt = (cell.textContent ?? '').replace(/"/g, '""');
            return `"${txt}"`;
          })
          .join(','),
      )
      .join('\n');
    void saveText(csv, `table-${Date.now()}.csv`, 'text/csv');
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-bg-elev-1">
      {showHeader && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-bg-elev-2 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon={TableIcon} size={13} className="text-fg-muted" />
            <span className="text-[11px] text-fg-subtle">{rowCount} 行表格</span>
          </div>
          <button
            type="button"
            onClick={onDownloadCsv}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-muted transition hover:bg-bg-elev-3 hover:text-fg"
            data-testid="table-download-csv"
          >
            <Icon icon={Download} size={12} />
            <span>下载 CSV</span>
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table ref={tableRef} className="min-w-full border-collapse text-xs">
          {children}
        </table>
      </div>
    </div>
  );
}
