import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, Check, ShieldOff, Timer } from 'lucide-react';
import { Infinity as InfinityIcon } from 'lucide-react';
import { useState } from 'react';
import type { ChatApprovalRequest } from '@/lib/ipc';

type Props = {
  approval: ChatApprovalRequest;
  sessionId: string;
  onResolved: () => void;
};

export function ApprovalCard({ approval, sessionId, onResolved }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  const respond = async (choice: string) => {
    setLoading(choice);
    try {
      await invoke('hermes_approval_respond', {
        args: { sessionId: approval._session_id || sessionId, choice },
      });
      onResolved();
    } catch {
      setLoading(null);
    }
  };

  return (
    <div className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-amber-200">
            {approval.description || 'Dangerous command requires approval'}
          </p>
          <code className="block text-xs bg-black/30 rounded px-2 py-1 text-amber-100 font-mono whitespace-pre-wrap break-all">
            {approval.command}
          </code>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => respond('deny')}
          disabled={!!loading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50"
        >
          <ShieldOff className="w-3.5 h-3.5" />
          {loading === 'deny' ? '...' : 'Deny'}
        </button>
        <button
          onClick={() => respond('once')}
          disabled={!!loading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-green-500/20 text-green-300 hover:bg-green-500/30 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          {loading === 'once' ? '...' : 'Allow once'}
        </button>
        <button
          onClick={() => respond('session')}
          disabled={!!loading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
        >
          <Timer className="w-3.5 h-3.5" />
          {loading === 'session' ? '...' : 'This session'}
        </button>
        <button
          onClick={() => respond('always')}
          disabled={!!loading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-50"
        >
          <InfinityIcon className="w-3.5 h-3.5" />
          {loading === 'always' ? '...' : 'Always'}
        </button>
      </div>
    </div>
  );
}
