import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, KeyRound, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ipcErrorMessage, licenseInstall } from '@/lib/ipc';

import { useLicenseStore } from './store';

/**
 * Full-screen overlay shown until the app has a verified license.
 * Mounted at the root of `Providers` so it covers every route.
 *
 * Three terminal states render different UIs:
 *   - `valid` → renders nothing, app is unlocked.
 *   - `missing` → "Enter your license key" form.
 *   - `invalid` / `expired` → same form + an explanatory error
 *     above the textarea.
 *
 * In dev builds (`devMode === true`) the gate is non-blocking — it
 * shows a small "DEV BUILD" banner the maintainer can dismiss for
 * the session via `dismissDev`. Production builds always block until
 * a key activates.
 */
export function LicenseGate() {
  const { t } = useTranslation();
  const verdict = useLicenseStore((s) => s.verdict);
  const loaded = useLicenseStore((s) => s.loaded);
  const devMode = useLicenseStore((s) => s.devMode);
  const devDismissed = useLicenseStore((s) => s.devDismissed);
  const dismissDev = useLicenseStore((s) => s.dismissDev);
  const setReply = useLicenseStore((s) => s.setReply);
  const machineId = useLicenseStore((s) => s.machineId);

  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pre-hydration: render nothing so we don't flash the gate before
  // the IPC verdict comes back. Boot is fast (<100ms), this is just
  // a tiny anti-flicker measure.
  if (!loaded) return null;

  // Already activated — gate stays out of the way.
  if (verdict?.kind === 'valid') return null;

  // Dev builds: collapse to a top banner. Maintainer can dismiss for
  // the session if they don't want to see it while iterating.
  if (devMode) {
    if (devDismissed) return null;
    return (
      <div className="pointer-events-auto fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-yellow-500/15 px-4 py-1.5 text-[11px] text-yellow-700 backdrop-blur dark:text-yellow-200">
        <Icon icon={AlertTriangle} size="xs" />
        <span>{t('license.dev_banner', 'DEV BUILD — license check bypassed.')}</span>
        <button
          type="button"
          onClick={dismissDev}
          className="ml-2 rounded border border-current/30 px-1.5 py-0.5 text-[10px] hover:bg-current/10"
        >
          {t('license.dev_dismiss', 'Hide')}
        </button>
      </div>
    );
  }

  // Production build, license not valid → block the whole UI.
  const headline =
    verdict?.kind === 'expired'
      ? t('license.expired_title', 'Your license expired on {{date}}', {
          date: verdict.expires,
        })
      : verdict?.kind === 'invalid'
        ? t('license.invalid_title', 'License token rejected')
        : verdict?.kind === 'wrong_machine'
          ? t('license.wrong_machine_title', 'License is bound to a different machine')
          : t('license.missing_title', 'Activate Corey');

  const subline =
    verdict?.kind === 'expired'
      ? t('license.expired_desc', 'Paste a renewed key to keep using Corey.')
      : verdict?.kind === 'invalid'
        ? verdict.reason
        : verdict?.kind === 'wrong_machine'
          ? t(
              'license.wrong_machine_desc',
              "Send the seller this install's machine id below — they'll mint a new license bound to it.",
            )
          : t(
              'license.missing_desc',
              'Paste the license key you received. We verify it locally — no data leaves this machine.',
            );

  async function copyMachineId() {
    if (!machineId) return;
    try {
      await navigator.clipboard.writeText(machineId);
    } catch {
      /* clipboard can fail under strict permissions; fine. */
    }
  }

  async function activate() {
    if (!token.trim()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const reply = await licenseInstall(token.trim());
      setReply(reply);
      if (reply.verdict.kind !== 'valid') {
        setSubmitError(
          reply.verdict.kind === 'expired'
            ? t('license.expired_title', 'Your license expired on {{date}}', {
                date: reply.verdict.expires,
              })
            : reply.verdict.kind === 'invalid'
              ? reply.verdict.reason
              : reply.verdict.kind === 'wrong_machine'
                ? t(
                    'license.wrong_machine_title',
                    'License is bound to a different machine',
                  )
                : t('license.missing_title', 'Activate Corey'),
        );
      }
    } catch (e) {
      setSubmitError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/95 px-4 backdrop-blur"
      role="dialog"
      aria-modal="true"
      data-testid="license-gate"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-bg-elev-1 p-6 shadow-2xl">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold-500">
          <Icon icon={KeyRound} size="sm" />
          {t('license.eyebrow', 'License required')}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-fg">{headline}</h1>
          <p className="mt-1 text-xs text-fg-muted">{subline}</p>
        </div>

        {/* Machine id strip — visible whenever the gate is up so the
            user can copy + send to the seller without leaving the
            modal. Especially important on `wrong_machine` where the
            seller needs to re-mint against the correct id. */}
        {machineId && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-2 text-[11px]">
            <span className="flex-none text-fg-subtle">
              {t('license.machine_id_label', 'This machine')}
            </span>
            <code
              className="min-w-0 flex-1 truncate font-mono text-fg"
              title={machineId}
            >
              {machineId}
            </code>
            <button
              type="button"
              onClick={() => void copyMachineId()}
              className="inline-flex flex-none items-center gap-1 rounded p-1 text-fg-subtle hover:bg-bg-elev-3 hover:text-fg"
              aria-label={t('license.machine_id_copy', 'Copy machine id')}
              data-testid="license-gate-copy-machine-id"
            >
              <Icon icon={Copy} size="xs" />
            </button>
          </div>
        )}

        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={4}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="eyJ1c2VyIjoiYWxpY2VAZXhhbXBsZS5jb20iLCJ…"
          className="w-full resize-none rounded-md border border-border bg-bg-elev-2 px-3 py-2 font-mono text-[11px] text-fg placeholder:text-fg-subtle focus:border-gold-500/50 focus:outline-none"
          data-testid="license-gate-input"
        />

        {submitError && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            <Icon icon={AlertTriangle} size="xs" className="mt-0.5 flex-none" />
            <span className="break-words">{submitError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !token.trim()}
            onClick={() => void activate()}
            data-testid="license-gate-activate"
          >
            {busy ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Check} size="sm" />
            )}
            {t('license.activate', 'Activate')}
          </Button>
        </div>

        <p className="text-[10px] text-fg-subtle">
          {t(
            'license.support_hint',
            "Don't have a key yet? Reach out to the seller.",
          )}
        </p>
      </div>
    </div>
  );
}
