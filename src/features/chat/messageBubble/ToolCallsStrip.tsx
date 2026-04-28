import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Loader2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { formatElapsed, useTickingNow } from '@/lib/useTickingNow';
import type { UiToolCall } from '@/stores/chat';

import { prettifyTool } from './toolMeta';

/**
 * Strip of tool-call cards rendered ABOVE the assistant's prose.
 *
 * Each row shows the tool slug + emoji Hermes picked + a one-line summary
 * (URL / shell command / search query) parsed from the SSE
 * `hermes.tool.progress` event's `label` field. Click to expand and see the
 * full label without truncation — useful for long curl invocations or URLs.
 *
 * Special rendering for `delegate_task`: while the parent message is still
 * `pending`, the latest delegate row shows a live elapsed-time counter and a
 * "子员工并行执行中" subtitle. This is the only signal we have for sub-agent
 * activity — Hermes' gateway-mode SSE batches but does NOT forward
 * sub-agent progress events to the parent stream (see Hermes docs:
 * "In gateway mode, progress is batched and relayed to the parent's
 * progress callback" — i.e. internally only). Until upstream exposes
 * those events, the live timer is what tells the user "yes, it's working".
 */
export function ToolCallsStrip({
  calls,
  pending = false,
}: {
  calls: UiToolCall[];
  pending?: boolean;
}) {
  // The LAST tool call is "in flight" iff the assistant is still streaming
  // (no `[DONE]` yet). Earlier calls are guaranteed complete because the
  // agent loop only emits the next progress event after the previous tool
  // returned.
  const lastIdx = calls.length - 1;

  // Group consecutive same-tool calls so a long delegation chain like
  // [delegate_task, delegate_task, delegate_task] renders as a single
  // "🔀 任务委派 × 3" row instead of three identical-looking cards.
  // Non-consecutive runs stay separate (keeps the timeline meaningful
  // when the agent interleaves tools, e.g. `web → read → web → write`).
  const groups: ToolCallGroup[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i]!;
    const last = groups[groups.length - 1];
    if (last && last.tool === c.tool) {
      last.calls.push(c);
      last.endIdx = i;
    } else {
      groups.push({ tool: c.tool, calls: [c], startIdx: i, endIdx: i });
    }
  }

  return (
    <div className="mb-2 flex flex-col gap-1">
      {groups.map((g) => {
        const isLastGroup = g.endIdx === lastIdx;
        const next = calls[g.endIdx + 1];
        return (
          <ToolCallGroupRow
            key={g.calls[0]!.id}
            group={g}
            pending={pending && isLastGroup}
            // For non-last groups: the next call's start time is the
            // implicit end. For the last (in-flight) group we tick live.
            endedAt={next ? next.at : null}
          />
        );
      })}
    </div>
  );
}

function ToolCallDetailRow({
  call,
  index,
  total,
}: {
  call: UiToolCall;
  index: number;
  total: number;
}) {
  const [copied, setCopied] = useState(false);
  const hasArgs = !!call.args || !!call.label;
  const hasResult = !!call.result;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <li className="rounded border border-border bg-bg-elev-1">
      <div className="flex items-center gap-1.5 px-2 py-1">
        {call.emoji && <span className="flex-none text-sm leading-none">{call.emoji}</span>}
        <span className="flex-none font-medium text-fg">
          {prettifyTool(call.tool).name}
        </span>
        {total > 1 && (
          <span className="flex-none font-mono text-[10px] text-fg-subtle">
            #{index}
          </span>
        )}
        {call.duration_ms != null && (
          <span className="ml-auto flex-none font-mono text-[10px] text-fg-subtle">
            {formatElapsed(call.duration_ms)}
          </span>
        )}
      </div>
      {hasArgs && (
        <div className="border-t border-border px-2 py-1">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Input
          </div>
          <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-fg-muted">
            {call.args ?? call.label}
          </code>
          <button
            type="button"
            onClick={() => handleCopy(call.args ?? call.label ?? '')}
            className="mt-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-fg-subtle hover:bg-bg-elev-3 hover:text-fg"
          >
            <Icon icon={Copy} size="xs" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {hasResult && (
        <div className="border-t border-border px-2 py-1">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Output
          </div>
          <code className="block max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-fg-muted">
            {call.result}
          </code>
          <button
            type="button"
            onClick={() => handleCopy(call.result ?? '')}
            className="mt-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-fg-subtle hover:bg-bg-elev-3 hover:text-fg"
          >
            <Icon icon={Copy} size="xs" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {!hasArgs && !hasResult && (
        <div className="border-t border-border px-2 py-1 text-fg-subtle">
          No details available
        </div>
      )}
    </li>
  );
}
interface ToolCallGroup {
  tool: string;
  calls: UiToolCall[];
  startIdx: number;
  endIdx: number;
}

function ToolCallGroupRow({
  group,
  pending,
  endedAt,
}: {
  group: ToolCallGroup;
  pending: boolean;
  endedAt: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isMultiple = group.calls.length > 1;
  // Earliest start defines the group's elapsed clock — feels right when a
  // chain of three quick `web_search` calls fires in <1s and the user
  // wants to see the chain's total cost, not just the last call's tail.
  const startedAt = group.calls[0]!.at;
  const lastCall = group.calls[group.calls.length - 1]!;
  const now = useTickingNow(pending);
  const elapsedMs = pending
    ? now - startedAt
    : endedAt != null
      ? endedAt - startedAt
      : 0;
  const showElapsed = pending || (endedAt != null && elapsedMs >= 500);
  const isDelegate = group.tool === 'delegate_task';
  const pretty = prettifyTool(group.tool);
  // For a single call we show its label as the inline summary; for a group
  // of N we show the LAST call's label (closest to "what's happening
  // right now") and the count badge tells the user there were prior
  // sister-calls. The full per-call list is in the expanded panel.
  const summaryLabel = lastCall.label;
  const expandable =
    isMultiple || !!summaryLabel || isDelegate;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-bg-elev-2 transition-colors',
        pending && 'border-accent/40 bg-accent/5',
      )}
    >
      <button
        type="button"
        onClick={() => expandable && setExpanded((v) => !v)}
        disabled={!expandable}
        className={cn(
          'flex w-full items-center gap-1.5 px-2 py-1 text-left',
          'text-[11px] text-fg-muted',
          expandable && 'cursor-pointer hover:bg-bg-elev-3',
          !expandable && 'cursor-default',
        )}
      >
        {expandable ? (
          <Icon
            icon={expanded ? ChevronDown : ChevronRight}
            size="xs"
            className="flex-none text-fg-subtle"
          />
        ) : (
          <span className="w-3" />
        )}
        {pending ? (
          <Icon
            icon={Loader2}
            size="xs"
            className="flex-none animate-spin text-accent"
          />
        ) : lastCall.emoji ? (
          <span className="flex-none text-sm leading-none">
            {lastCall.emoji}
          </span>
        ) : (
          <span className="flex-none text-sm leading-none">
            {pretty.fallbackEmoji}
          </span>
        )}
        <span className="flex-none font-semibold text-fg">{pretty.name}</span>
        {isMultiple && (
          <span
            className={cn(
              'flex-none rounded bg-bg-elev-3 px-1 font-mono tabular-nums',
              pending ? 'text-accent' : 'text-fg-subtle',
            )}
          >
            × {group.calls.length}
          </span>
        )}
        {isDelegate && pending ? (
          <span className="flex-none text-fg-subtle">· 并行执行中…</span>
        ) : !isDelegate && summaryLabel ? (
          <>
            <span className="flex-none text-fg-subtle">·</span>
            <code className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {summaryLabel}
            </code>
          </>
        ) : null}
        {showElapsed && (
          <span
            className={cn(
              'ml-auto flex-none tabular-nums',
              pending ? 'text-accent' : 'text-fg-subtle',
            )}
          >
            {pending ? '⏱' : '✓'} {formatElapsed(elapsedMs)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-border px-2 py-1.5 text-[11px]">
          {isDelegate && (
            <div className="mb-1.5 text-fg-subtle">
              子员工细节暂不可见（Hermes 限制）
              {pending && '，等待汇总…'}
            </div>
          )}
          {!isDelegate && (
            <ul className="flex flex-col gap-1">
              {group.calls.map((c, idx) => (
                <ToolCallDetailRow key={c.id} call={c} index={idx + 1} total={group.calls.length} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

