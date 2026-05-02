import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Hammer, Network } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { DbMessageWithTools } from '@/lib/ipc';

import { formatTime } from './helpers';
import { groupToolCallsBySubagent, hasDelegation, type SubagentNode } from './subagents';

/**
 * Render a flat list of tool calls either as a flat ribbon (no
 * delegation) or as a nested tree (one or more `delegate_task`
 * parents with their subsequent calls grouped underneath). The tree
 * is inferred from event ordering — see `./subagents.ts` for the
 * heuristic and why we don't have an explicit parent_id today.
 *
 * Parents are collapsible; default is expanded so users see what
 * happened immediately. The state is local (per-row) so collapsing
 * one delegation doesn't hide all the others.
 */
export function ToolCallTree({ calls }: { calls: DbMessageWithTools['tool_calls'] }) {
  const tree = useMemo(() => groupToolCallsBySubagent(calls), [calls]);
  const delegated = hasDelegation(calls);

  if (!delegated) {
    // Fast path — no delegation, keep the classic flat look so
    // regression risk on the common case is zero.
    return (
      <ul
        className="mt-1 flex flex-col gap-1 pl-8"
        data-testid="trajectory-tool-calls"
      >
        {calls.map((tc) => (
          <ToolCallChip key={tc.id} call={tc} />
        ))}
      </ul>
    );
  }

  return (
    <ul
      className="mt-1 flex flex-col gap-1 pl-8"
      data-testid="trajectory-tool-tree"
    >
      {tree.map((node) => (
        <ToolCallTreeNode key={node.call.id} node={node} />
      ))}
    </ul>
  );
}

function ToolCallTreeNode({ node }: { node: SubagentNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const isParent = node.children.length > 0;

  if (!isParent) {
    return <ToolCallChip call={node.call} />;
  }

  return (
    <li
      className="flex flex-col gap-1 rounded border border-gold-500/30 bg-gold-500/5 px-2 py-1"
      data-testid={`trajectory-delegate-${node.call.id}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-left text-[11px] text-fg-muted hover:text-fg"
        aria-expanded={open}
        aria-controls={`subagent-${node.call.id}`}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} size="xs" />
        <Icon icon={Network} size="xs" className="text-gold-600 dark:text-gold-400" />
        <code className="font-mono text-fg">{node.call.tool}</code>
        {node.call.label && (
          <span className="truncate text-fg-muted">{node.call.label}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-fg-subtle">
          {t('trajectory.subagent.step_count', { n: node.children.length })}
          <span>·</span>
          <span>{formatTime(node.call.at)}</span>
        </span>
      </button>

      {open && (
        <ul
          id={`subagent-${node.call.id}`}
          className="ml-2 flex flex-col gap-1 border-l border-gold-500/20 pl-3"
        >
          {node.children.map((c) => (
            <ToolCallChip key={c.id} call={c} inSubagent />
          ))}
        </ul>
      )}
    </li>
  );
}

function ToolCallChip({
  call,
  inSubagent = false,
}: {
  call: { id: string; tool: string; emoji: string | null; label: string | null; at: number };
  inSubagent?: boolean;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded border px-2 py-1 text-[11px] text-fg-muted',
        inSubagent
          ? 'border-border/60 bg-bg-elev-2/40'
          : 'border-border bg-bg-elev-2/60',
      )}
      data-testid={`trajectory-tool-${call.id}`}
    >
      <Icon icon={Hammer} size="xs" className="text-fg-subtle" />
      <code className="font-mono text-fg">{call.tool}</code>
      {call.label && <span className="truncate">{call.label}</span>}
      <span className="ml-auto text-[10px] text-fg-subtle">{formatTime(call.at)}</span>
    </li>
  );
}
