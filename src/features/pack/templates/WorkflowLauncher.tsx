/**
 * WorkflowLauncher view template — quick-launch grid for Pack
 * workflows.
 *
 * Manifest accepts two forms:
 *
 * **Legacy (string ids):**
 *
 * ```yaml
 * template: WorkflowLauncher
 * workflows: [profit_weekly, ad_weekly]
 * ```
 *
 * **Inline meta (per-workflow name / description / schedule /
 * icon):**
 *
 * ```yaml
 * template: WorkflowLauncher
 * workflows:
 *   - id: update-fuel-rates-weekly
 *     name: 燃油费率更新
 *     description: UPS + FedEx 燃油附加费
 *     schedule: 每周日 23:30
 *     icon: Fuel
 * ```
 *
 * On click the template fires `workflow_run` with the prefixed
 * id `pack__<packId>__<id>` (matching how the loader installs
 * Pack workflows). It tracks running + last-run status per
 * workflow and surfaces success / error icons next to the run
 * button — replaces the v0.1 "stage 5d disabled placeholder".
 */
import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Fuel,
  Play,
  RefreshCw,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { workflowRun } from '@/lib/ipc/runtime';
import type { PackView } from '@/lib/ipc/pack';

interface WorkflowEntry {
  id: string;
  name?: string;
  description?: string;
  schedule?: string;
  icon?: string;
}

const ICONS: Record<string, LucideIcon> = {
  Play,
  Fuel,
  Truck,
  RefreshCw,
  Clock,
};

function isEntry(v: unknown): v is WorkflowEntry {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { id?: unknown }).id === 'string');
}

function normalize(v: unknown): WorkflowEntry | null {
  if (typeof v === 'string') return { id: v };
  if (isEntry(v)) return v;
  return null;
}

function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Play;
  return ICONS[name] ?? Play;
}

interface RowState {
  status: 'idle' | 'running' | 'ok' | 'error';
  error?: string;
}

export function WorkflowLauncherTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(options.workflows) ? (options.workflows as unknown[]) : [];
  const workflows = raw.map(normalize).filter((w): w is WorkflowEntry => w !== null);

  const [rows, setRows] = useState<Record<string, RowState>>({});

  if (workflows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This WorkflowLauncher view has no <code>workflows:</code> declared.</p>
      </div>
    );
  }

  async function run(id: string) {
    setRows((prev) => ({ ...prev, [id]: { status: 'running' } }));
    try {
      await workflowRun(`pack__${view.packId}__${id}`, { packId: view.packId });
      setRows((prev) => ({ ...prev, [id]: { status: 'ok' } }));
    } catch (e) {
      setRows((prev) => ({
        ...prev,
        [id]: { status: 'error', error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {workflows.map((wf) => {
        const state = rows[wf.id] ?? { status: 'idle' as const };
        const IconLeft = resolveIcon(wf.icon);
        const isRunning = state.status === 'running';
        return (
          <div
            key={wf.id}
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-bg-elev-1 p-4 shadow-sm transition-shadow hover:shadow-1"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-500/10 text-gold-500">
              <Icon icon={IconLeft} size="sm" />
            </span>
            <div className="flex flex-1 flex-col gap-0.5 min-w-0">
              <span className="truncate text-sm font-medium text-fg">
                {wf.name ?? wf.id}
              </span>
              {wf.description && (
                <span className="truncate text-xs text-fg-subtle">{wf.description}</span>
              )}
              {wf.schedule && (
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-fg-muted">
                  <Icon icon={Clock} size="xs" />
                  {wf.schedule}
                </div>
              )}
              {state.status === 'error' && state.error && (
                <span className="mt-0.5 truncate text-[10px] text-danger" title={state.error}>
                  {state.error}
                </span>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              {state.status === 'ok' && (
                <Icon icon={CheckCircle2} size="sm" className="text-success" />
              )}
              {state.status === 'error' && (
                <Icon icon={AlertCircle} size="sm" className="text-danger" />
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={isRunning}
                onClick={() => void run(wf.id)}
                className="gap-1 text-xs"
              >
                {isRunning ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Icon icon={ChevronRight} size="xs" />
                )}
                {isRunning ? '执行中' : '执行'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
