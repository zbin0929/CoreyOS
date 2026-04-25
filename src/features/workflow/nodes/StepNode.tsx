import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/cn';

const TYPE_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  agent: { color: 'border-blue-500 bg-blue-500/5', icon: '🤖', label: 'Agent' },
  tool: { color: 'border-green-500 bg-green-500/5', icon: '🔧', label: 'Tool' },
  parallel: { color: 'border-purple-500 bg-purple-500/5', icon: '⚡', label: 'Parallel' },
  branch: { color: 'border-orange-500 bg-orange-500/5', icon: '🔀', label: 'Branch' },
  loop: { color: 'border-yellow-500 bg-yellow-500/5', icon: '🔄', label: 'Loop' },
  approval: { color: 'border-red-500 bg-red-500/5', icon: '✋', label: 'Approval' },
};

export interface StepNodeData {
  id: string;
  name: string;
  stepType: string;
  agentId?: string;
  [key: string]: unknown;
}

function StepNodeInner({ data }: NodeProps) {
  const d = data as unknown as StepNodeData;
  const cfg = TYPE_CONFIG[d.stepType] ?? { color: 'border-border bg-bg-elev-1', icon: '•', label: d.stepType };

  return (
    <div
      className={cn(
        'min-w-[160px] rounded-lg border-2 px-4 py-3 shadow-sm transition-colors',
        cfg.color,
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-fg-subtle !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span className="text-base">{cfg.icon}</span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-fg">{d.name || d.id}</div>
          <div className="text-[10px] text-fg-subtle">{cfg.label}</div>
        </div>
      </div>
      {d.agentId && (
        <div className="mt-1 truncate text-[10px] text-fg-subtle">→ {d.agentId}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-fg-subtle !w-2 !h-2" />
    </div>
  );
}

export const StepNode = memo(StepNodeInner);
