import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, KeyRound, Loader2, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ipcErrorMessage, licenseClear } from '@/lib/ipc';
import { useLicenseStore } from '@/features/license/store';

import { Section } from '../shared';

/**
 * Settings → License: shows the active license metadata + a
 * "Sign out" button that wipes the on-disk file and re-shows the
 * gate. Only renders when there's something useful to show — dev
 * builds and missing-license states fall through to the gate
 * component itself.
 */
export function LicenseSection() {
  const { t } = useTranslation();
  const verdict = useLicenseStore((s) => s.verdict);
  const hydrate = useLicenseStore((s) => s.hydrate);
  const devMode = useLicenseStore((s) => s.devMode);
  const machineId = useLicenseStore((s) => s.machineId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Hide entirely on dev builds (the banner already explains the
  // state) and when there's no verdict yet.
  if (devMode || !verdict) return null;

  async function signOut() {
    setError(null);
    setBusy(true);
    try {
      await licenseClear();
      await hydrate();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyMachineId() {
    if (!machineId) return;
    try {
      await navigator.clipboard.writeText(machineId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can fail silently — user can still triple-click. */
    }
  }

  const machineRow = machineId ? (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-2 text-[11px]">
      <span className="flex-none text-fg-subtle">
        {t('settings.license.machine_id', 'Machine ID')}
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
        aria-label={t('settings.license.copy_machine_id', 'Copy machine id')}
      >
        <Icon icon={copied ? Check : Copy} size="xs" />
      </button>
    </div>
  ) : null;

  return (
    <Section
      title={t('settings.license.title', 'License')}
      description={t(
        'settings.license.desc',
        'Activation status. The gate reappears on next launch if the key is removed or expires.',
      )}
    >
      {verdict.kind === 'valid' ? (
        <div className="flex flex-col gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <div className="flex items-center gap-2 text-emerald-500">
            <Icon icon={Check} size="sm" />
            <span className="font-medium">
              {t('settings.license.active', 'Active')}
            </span>
          </div>
          <dl className="grid grid-cols-[max-content,1fr] gap-x-4 gap-y-1 text-xs text-fg-muted">
            <dt className="text-fg-subtle">{t('settings.license.user', 'Licensed to')}</dt>
            <dd className="font-mono text-fg">{verdict.payload.user}</dd>
            <dt className="text-fg-subtle">{t('settings.license.issued', 'Issued')}</dt>
            <dd className="font-mono">{verdict.payload.issued || '—'}</dd>
            <dt className="text-fg-subtle">{t('settings.license.expires', 'Expires')}</dt>
            <dd className="font-mono">
              {verdict.payload.expires ?? t('settings.license.perpetual', 'Perpetual')}
            </dd>
            {verdict.payload.features.length > 0 && (
              <>
                <dt className="text-fg-subtle">
                  {t('settings.license.features', 'Features')}
                </dt>
                <dd className="font-mono">{verdict.payload.features.join(', ')}</dd>
              </>
            )}
          </dl>
          {machineRow}
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void signOut()}
              data-testid="license-sign-out"
            >
              <Icon icon={busy ? Loader2 : LogOut} size="sm" className={busy ? 'animate-spin' : ''} />
              {t('settings.license.sign_out', 'Remove license')}
            </Button>
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
      ) : (
        // Expired / invalid / missing — encourage user to re-enter
        // via the gate (which will reappear on next launch). We
        // don't duplicate the activation form here.
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-4 text-xs text-yellow-700 dark:text-yellow-200">
          <Icon icon={KeyRound} size="sm" className="mt-0.5 flex-none" />
          <div className="min-w-0 flex-1">
            {verdict.kind === 'expired'
              ? t(
                  'settings.license.expired',
                  'Your license expired on {{date}}. Restart the app to enter a renewed key.',
                  { date: verdict.expires },
                )
              : verdict.kind === 'invalid'
                ? t('settings.license.invalid', 'License invalid: {{reason}}', {
                    reason: verdict.reason,
                  })
                : t(
                    'settings.license.missing',
                    'No license activated. Restart the app to enter one.',
                  )}
          </div>
        </div>
      )}
    </Section>
  );
}
