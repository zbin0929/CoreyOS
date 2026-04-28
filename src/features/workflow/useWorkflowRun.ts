import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ipcErrorMessage,
  workflowRun,
  workflowRunStatus,
  workflowApprove,
  type WorkflowDef,
  type WorkflowSummary,
  type WorkflowRunResult,
} from '@/lib/ipc';

export interface WorkflowRunState {
  running: boolean;
  runResult: WorkflowRunResult | null;
  stepRunningSince: Record<string, number>;
  rejectPrompt: { stepId: string } | null;
  setRejectPrompt: (v: { stepId: string } | null) => void;
  start: (wf: WorkflowSummary, def: WorkflowDef, inputs: Record<string, unknown>) => Promise<void>;
  rehydrate: (result: WorkflowRunResult, def?: WorkflowDef) => void;
  reset: () => void;
  submitApproval: (stepId: string, approved: boolean, feedback?: string) => Promise<void>;
}

export function useWorkflowRun({ onError }: { onError: (msg: string) => void }): WorkflowRunState {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [stepRunningSince, setStepRunningSince] = useState<Record<string, number>>({});
  const [rejectPrompt, setRejectPrompt] = useState<{ stepId: string } | null>(null);

  const runIdRef = useRef<string>('');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAliveRef = useRef(false);

  const stopPolling = useCallback(() => {
    pollAliveRef.current = false;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollRunStatus = useCallback((runId: string) => {
    pollAliveRef.current = true;
    const tick = async () => {
      if (!pollAliveRef.current) return;
      try {
        const result = await workflowRunStatus(runId);
        if (!pollAliveRef.current) return;
        if (result) {
          setRunResult(result);
          if (
            result.status === 'completed' ||
            result.status === 'failed' ||
            result.status === 'cancelled'
          ) {
            setRunning(false);
            stopPolling();
            return;
          }
          const delay = result.status === 'paused' ? 3000 : 1200;
          pollTimerRef.current = setTimeout(tick, delay);
          return;
        }
      } catch { /* transient */ }
      pollTimerRef.current = setTimeout(tick, 1500);
    };
    void tick();
  }, [stopPolling]);

  const start = useCallback(async (wf: WorkflowSummary, _def: WorkflowDef, inputs: Record<string, unknown>) => {
    setRunning(true);
    setRunResult(null);
    try {
      const runId = await workflowRun(wf.id, inputs);
      runIdRef.current = runId;
      void pollRunStatus(runId);
    } catch (e) {
      onError(ipcErrorMessage(e));
      setRunning(false);
    }
  }, [pollRunStatus, onError]);

  const rehydrate = useCallback((result: WorkflowRunResult, _def?: WorkflowDef) => {
    setRunning(true);
    setRunResult(result);
    runIdRef.current = result.id;
    void pollRunStatus(result.id);
  }, [pollRunStatus]);

  const reset = useCallback(() => {
    setRunning(false);
    setRunResult(null);
    setStepRunningSince({});
    stopPolling();
  }, [stopPolling]);

  const submitApproval = useCallback(async (stepId: string, approved: boolean, feedback?: string) => {
    if (!runIdRef.current) return;
    try {
      setRunResult((prev) => {
        if (!prev) return prev;
        const sr = prev.step_runs[stepId];
        if (!sr || sr.status !== 'awaiting_approval') return prev;
        return {
          ...prev,
          status: approved ? 'running' : 'failed',
          step_runs: {
            ...prev.step_runs,
            [stepId]: { ...sr, status: approved ? 'completed' : 'failed' },
          },
        };
      });
      const finalFeedback = approved ? undefined : (feedback?.trim() || t('workflow_page.rejected_default'));
      await workflowApprove(runIdRef.current, stepId, approved, finalFeedback);
    } catch (e) {
      onError(ipcErrorMessage(e));
    }
  }, [onError, t]);

  useEffect(() => {
    if (!runResult) return;
    setStepRunningSince((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const sr of Object.values(runResult.step_runs)) {
        if (sr.status === 'running' && next[sr.step_id] === undefined) {
          next[sr.step_id] = Date.now();
          changed = true;
        } else if (sr.status !== 'running' && next[sr.step_id] !== undefined) {
          delete next[sr.step_id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [runResult]);

  return {
    running,
    runResult,
    stepRunningSince,
    rejectPrompt,
    setRejectPrompt,
    start,
    rehydrate,
    reset,
    submitApproval,
  };
}
