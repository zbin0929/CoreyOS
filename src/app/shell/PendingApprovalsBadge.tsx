import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ShieldAlert, X } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  workflowActiveRuns,
  type WorkflowRunResult,
  type WorkflowStepRun,
} from '@/lib/ipc';

/**
 * **Global pending-approvals badge.**
 *
 * Right-bottom floating chip that surfaces workflow steps in
 * `awaiting_approval` state from anywhere in the app — Topbar nav,
 * Home, Skills, even mid-chat. Without this, users had to remember
 * to visit `/approvals` to know something needed their attention.
 *
 * Auto-hides when no approvals are pending so it never gets in the
 * way. Polls every 6 s (slightly less aggressive than the
 * `/approvals` page's 4 s — this is a background signal, not the
 * primary surface).
 *
 * Click → navigate to `/approvals` for the full list. Dismiss arrow
 * hides the chip until the next poll cycle finds new pending items
 * (so users can temporarily mute it without losing the signal
 * permanently).
 */
const POLL_MS = 6_000;

export function PendingApprovalsBadge() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const runs = await workflowActiveRuns();
        if (cancelled) return;
        const next = countAwaitingApproval(runs);
        setCount(next);
        // Auto-unhide when a NEW approval comes in (count went up).
        // Without this the user could dismiss the chip then never
        // see future approvals.
        setHidden((prev) => (next > 0 && next > count ? false : prev));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(ipcErrorMessage(e));
      }
    };

    void refresh();
    timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // count intentionally omitted from deps — we only want refresh
    // to read the latest count via the closure capture, not
    // re-create the interval on every count tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (count === 0 || hidden) return null;
  if (error) return null;

  return (
    <Link
      to="/approvals"
      className={[
        // Bottom-right, above the UpdateBanner z-index but still
        // below tooltips / palette.
        'fixed bottom-4 right-4 z-40 flex items-center gap-2',
        'rounded-full border border-amber-500/40 bg-amber-500/10 pl-3 pr-2 py-1.5',
        'text-xs text-amber-700 dark:text-amber-400 shadow-lg',
        'transition hover:bg-amber-500/15',
      ].join(' ')}
      data-testid="pending-approvals-badge"
    >
      <Icon icon={ShieldAlert} size={14} />
      <span className="font-medium">
        {t('approvals.pending_badge', {
          defaultValue: `${count} 个待审批`,
          count,
        })}
      </span>
      <button
        type="button"
        onClick={(e) => {
          // Stop the link navigation when only dismissing.
          e.preventDefault();
          e.stopPropagation();
          setHidden(true);
        }}
        className="ml-1 rounded-full p-0.5 text-amber-700/60 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-400/60 dark:hover:text-amber-400"
        aria-label={t('approvals.dismiss', { defaultValue: '暂时隐藏' })}
        data-testid="pending-approvals-dismiss"
      >
        <Icon icon={X} size={12} />
      </button>
    </Link>
  );
}

function countAwaitingApproval(runs: WorkflowRunResult[]): number {
  let n = 0;
  for (const run of runs) {
    for (const step of Object.values(run.step_runs ?? {}) as WorkflowStepRun[]) {
      if (step.status === 'awaiting_approval') n += 1;
    }
  }
  return n;
}
