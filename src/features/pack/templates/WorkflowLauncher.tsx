/**
 * WorkflowLauncher view template — quick-launch grid for Pack
 * workflows.
 *
 * Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: weekly-report
 *     title: 周报中心
 *     template: WorkflowLauncher
 *     workflows: [profit_weekly, ad_weekly]
 * ```
 *
 * Each entry resolves against the prefixed workflow id
 * (`pack__<pack_id>__<workflow_id>`) installed by Stage 4b.
 * Stage 5d shows the buttons; stage 5e wires `workflow_run`
 * so click actually fires.
 */
import type { PackView } from '@/lib/ipc/pack';
import { Play } from 'lucide-react';

export function WorkflowLauncherTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const workflows = Array.isArray(options.workflows)
    ? (options.workflows as string[])
    : [];

  if (workflows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This WorkflowLauncher view has no <code>workflows:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {workflows.map((id) => (
        <button
          key={id}
          type="button"
          disabled
          className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 p-4 text-left opacity-80 hover:bg-bg-elev-2 disabled:cursor-not-allowed"
          title="stage 5d: click handler lands in stage 5e"
        >
          <Play className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
          <div className="flex flex-col gap-0.5 truncate">
            <span className="truncate text-sm font-medium text-fg">{id}</span>
            <span className="text-xs text-fg-subtle">tap to run</span>
          </div>
        </button>
      ))}
    </div>
  );
}
