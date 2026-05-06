import { useCallback, useEffect, useState } from 'react';
import {
  ipcErrorMessage,
  workflowList,
  workflowGet,
  workflowDelete,
  workflowActiveRuns,
  type WorkflowDef,
  type WorkflowSummary,
} from '@/lib/ipc';
import { WorkflowEditor } from './Editor';
import { useWorkflowRun } from './useWorkflowRun';
import { WorkflowRunView } from './WorkflowRunView';
import { WorkflowList } from './WorkflowList';

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; wfId: string | null; seed?: WorkflowDef }
  | { kind: 'run'; wf: WorkflowSummary; def?: WorkflowDef };

export function WorkflowRoute() {
  const [rows, setRows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [inputsPrompt, setInputsPrompt] = useState<{
    wf: WorkflowSummary;
    def: WorkflowDef;
  } | null>(null);

  const run = useWorkflowRun({ onError: setError });

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await workflowList();
      setRows(list);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const active = await workflowActiveRuns();
        if (active.length > 0) {
          const ar = active[0]!;
          const wf = rows?.find((w) => w.id === ar.workflow_id);
          if (wf) {
            let def: WorkflowDef | undefined;
            try { def = await workflowGet(ar.workflow_id); } catch { /* non-fatal */ }
            setMode({ kind: 'run', wf, def });
            run.rehydrate(ar, def);
          }
        }
      } catch { /* ignore */ }
    })();
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    try {
      await workflowDelete(id);
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await load();
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const handleDeleteSelected = async () => {
    try {
      await Promise.all([...selected].map((id) => workflowDelete(id)));
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const startRun = async (wf: WorkflowSummary, def: WorkflowDef, inputs: Record<string, unknown>) => {
    setMode({ kind: 'run', wf, def });
    await run.start(wf, def, inputs);
  };

  const handleRun = async (wf: WorkflowSummary) => {
    try {
      const def = await workflowGet(wf.id);
      if (def.inputs && def.inputs.length > 0) {
        setInputsPrompt({ wf, def });
        return;
      }
      await startRun(wf, def, {});
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  if (mode.kind === 'edit') {
    return (
      <WorkflowEditor
        workflowId={mode.wfId}
        seed={mode.seed}
        onBack={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'run' && mode.wf) {
    return (
      <WorkflowRunView
        wf={mode.wf}
        def={mode.def}
        runState={run}
        onBack={() => { setMode({ kind: 'list' }); run.reset(); }}
      />
    );
  }

  return (
    <WorkflowList
      rows={rows}
      error={error}
      selected={selected}
      setSelected={setSelected}
      running={run.running}
      onDelete={handleDelete}
      onDeleteSelected={handleDeleteSelected}
      onRun={handleRun}
      onEdit={(wfId: string) => setMode({ kind: 'edit', wfId })}
      onCreate={() => setMode({ kind: 'edit', wfId: null })}
      generateOpen={generateOpen}
      setGenerateOpen={setGenerateOpen}
      onGenerated={(def: WorkflowDef) => {
        setGenerateOpen(false);
        setMode({ kind: 'edit', wfId: null, seed: def });
      }}
      inputsPrompt={inputsPrompt}
      setInputsPrompt={setInputsPrompt}
      startRun={startRun}
      rejectPrompt={run.rejectPrompt}
      setRejectPrompt={run.setRejectPrompt}
      submitApproval={run.submitApproval}
    />
  );
}
