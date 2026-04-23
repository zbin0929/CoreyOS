/**
 * Sandbox consent prompt.
 *
 * Mounted at app root. Renders whenever `useSandboxStore.pending` has
 * entries — one prompt at a time, head-of-queue. User picks:
 *   - **Just this once** → session grant (process-scoped, not persisted).
 *   - **Add to workspace** → persisted root, flips mode to Enforced.
 *   - **Deny** → the original IPC call rejects with the sandbox error.
 *
 * The modal itself does not call IPC — it only resolves the pending
 * promise. `withSandboxConsent()` in the store then dispatches the
 * appropriate `sandbox_grant_once` / `sandbox_add_root` and retries.
 */
import { useTranslation } from 'react-i18next';
import { ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useSandboxStore, type ConsentDecision } from '@/stores/sandbox';
import { type SandboxAccessMode } from '@/lib/ipc';
import { useState } from 'react';

export function SandboxConsentModal() {
  const { t } = useTranslation();
  const pending = useSandboxStore((s) => s.pending);
  const resolvePending = useSandboxStore((s) => s.resolvePending);
  const head = pending[0];
  const [mode, setMode] = useState<SandboxAccessMode>('read_write');

  if (!head) return null;

  function decide(decision: ConsentDecision) {
    if (!head) return;
    resolvePending(head.id, decision);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="sandbox-consent-modal"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elev-1 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon icon={ShieldAlert} size="md" className="text-gold-500" />
            {t('sandbox.consent.title')}
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => decide({ kind: 'deny' })}
            aria-label={t('common.close')}
          >
            <Icon icon={X} size="xs" />
          </Button>
        </div>

        <p className="mt-3 text-xs text-fg-muted">{t('sandbox.consent.desc')}</p>

        <div className="mt-3 rounded border border-border bg-bg-elev-2 px-3 py-2">
          <code
            className="block break-all font-mono text-xs text-fg"
            data-testid="sandbox-consent-path"
          >
            {head.path}
          </code>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
          <span>{t('sandbox.consent.mode_label')}</span>
          <div className="inline-flex rounded-md border border-border bg-bg-elev-1 p-0.5">
            {(['read', 'read_write'] as SandboxAccessMode[]).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={
                    active
                      ? 'rounded bg-gold-500/20 px-2 py-0.5 text-xs text-fg'
                      : 'rounded px-2 py-0.5 text-xs text-fg-subtle hover:bg-bg-elev-2 hover:text-fg'
                  }
                >
                  {t(`sandbox.consent.mode_${m}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => decide({ kind: 'deny' })}>
            {t('sandbox.consent.deny')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => decide({ kind: 'grant_once' })}
          >
            {t('sandbox.consent.grant_once')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => decide({ kind: 'add_root', mode })}
          >
            {t('sandbox.consent.add_root')}
          </Button>
        </div>
      </div>
    </div>
  );
}
