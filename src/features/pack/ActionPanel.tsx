import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Play, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { workflowRun } from '@/lib/ipc/runtime';
import type { PackAction } from '@/lib/ipc/pack';

interface ActionPanelProps {
  actions: PackAction[];
  packId: string;
  viewId: string;
}

export function ActionPanel({ actions, packId, viewId }: ActionPanelProps) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action, i) => (
        <ActionBtn key={`${action.label}-${i}`} action={action} packId={packId} viewId={viewId} />
      ))}
    </div>
  );
}

function ActionBtn({ action, packId, viewId }: { action: PackAction; packId: string; viewId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (action.confirm && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action.workflow) {
        await workflowRun(action.workflow, { packId, viewId });
      } else if (action.skill) {
        void navigate({ to: '/chat' });
      }
      setConfirming(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <Button
        size="sm"
        variant={confirming ? 'danger' : 'ghost'}
        disabled={busy}
        onClick={() => void onClick()}
      >
        <Icon icon={action.confirm ? ShieldAlert : Play} size="xs" />
        {confirming ? `Confirm: ${action.label}` : action.label}
      </Button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
