import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, X, Check, Clock, Infinity as InfinityIcon } from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { guardPromptResolve, type GuardResolveArgs } from '@/lib/ipc/security';

interface GuardPromptEvent {
  id: string;
  reason: string;
}

export function GuardConfirmModal() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<GuardPromptEvent | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn;
    void (async () => {
      unlisten = await listen<GuardPromptEvent>(
        'guard:prompt:request',
        (event) => {
          setPending(event.payload);
        },
      );
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const respond = useCallback(async (allowed: boolean) => {
    if (!pending) return;
    setLoading(allowed ? 'allow' : 'deny');
    try {
      const args: GuardResolveArgs = { id: pending.id, allowed };
      await guardPromptResolve(args);
    } catch {
      // resolve failed — still clear so the card doesn't get stuck
    }
    setPending(null);
    setLoading(null);
  }, [pending]);

  useEffect(() => {
    if (pending) setLoading(null);
  }, [pending]);

  if (!pending) return null;

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
          {pending.reason}
        </code>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={() => respond(false)}
          disabled={!!loading}
          className={`${btnBase} bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25`}
        >
          <X className="w-3.5 h-3.5" />
          {loading === 'deny' ? '…' : t('chat_page.approval_deny')}
        </button>
        <button
          onClick={() => respond(true)}
          disabled={!!loading}
          className={`${btnBase} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25`}
        >
          <Check className="w-3.5 h-3.5" />
          {loading === 'allow' ? '…' : t('chat_page.approval_once')}
        </button>
        <button
          onClick={() => respond(true)}
          disabled={!!loading}
          className={`${btnBase} bg-sky-500/15 text-sky-600 dark:text-sky-400 hover:bg-sky-500/25`}
        >
          <Clock className="w-3.5 h-3.5" />
          {loading === 'allow' ? '…' : t('chat_page.approval_session')}
        </button>
        <button
          onClick={() => respond(true)}
          disabled={!!loading}
          className={`${btnBase} bg-violet-500/15 text-violet-600 dark:text-violet-400 hover:bg-violet-500/25`}
        >
          <InfinityIcon className="w-3.5 h-3.5" />
          {loading === 'allow' ? '…' : t('chat_page.approval_always')}
        </button>
      </div>
    </div>
  );
}
