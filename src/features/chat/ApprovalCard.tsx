import { invoke } from '@tauri-apps/api/core';
import { ShieldAlert, X, Check, Clock, Infinity as InfinityIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatApprovalRequest } from '@/lib/ipc';

type Props = {
  approval: ChatApprovalRequest;
  sessionId: string;
  onResolved: () => void;
};

export function ApprovalCard({ approval, sessionId, onResolved }: Props) {
  const { t } = useTranslation();
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

  const btnBase =
    'flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="my-2 rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.08] to-orange-500/5 p-4 space-y-3 shadow-lg shadow-amber-500/5">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <ShieldAlert className="w-4.5 h-4.5 shrink-0" />
        <span className="text-sm font-semibold">{t('chat_page.approval_title')}</span>
      </div>

      <p className="text-xs text-fg-subtle pl-6">
        {t('chat_page.approval_desc')}
      </p>

      <div className="ml-6 rounded-lg border border-border/60 bg-bg-elev-2/80 px-3 py-2">
        <code className="block text-xs text-fg-muted font-mono whitespace-pre-wrap break-all leading-relaxed">
          {approval.command}
        </code>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={() => respond('deny')}
          disabled={!!loading}
          className={`${btnBase} bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25`}
        >
          <X className="w-3.5 h-3.5" />
          {loading === 'deny' ? '…' : t('chat_page.approval_deny')}
        </button>
        <button
          onClick={() => respond('once')}
          disabled={!!loading}
          className={`${btnBase} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25`}
        >
          <Check className="w-3.5 h-3.5" />
          {loading === 'once' ? '…' : t('chat_page.approval_once')}
        </button>
        <button
          onClick={() => respond('session')}
          disabled={!!loading}
          className={`${btnBase} bg-sky-500/15 text-sky-600 dark:text-sky-400 hover:bg-sky-500/25`}
        >
          <Clock className="w-3.5 h-3.5" />
          {loading === 'session' ? '…' : t('chat_page.approval_session')}
        </button>
        <button
          onClick={() => respond('always')}
          disabled={!!loading}
          className={`${btnBase} bg-violet-500/15 text-violet-600 dark:text-violet-400 hover:bg-violet-500/25`}
        >
          <InfinityIcon className="w-3.5 h-3.5" />
          {loading === 'always' ? '…' : t('chat_page.approval_always')}
        </button>
      </div>
    </div>
  );
}
