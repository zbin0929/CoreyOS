import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, FolderOpen, RotateCcw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  appDataDirClear,
  appDataDirSet,
  appPaths,
  coreyConfigReset,
  hermesDataReset,
  ipcErrorMessage,
  type AppPaths,
} from '@/lib/ipc';

import { Section } from '../shared';

/**
 * Read-only display of the on-disk locations Corey writes to, plus a
 * user-editable slot for the Hermes data dir (`.hermes/`). Lives at
 * the bottom of Settings — least-frequently-needed but useful for
 * backup / debugging / relocating off the system drive on Windows.
 * The container hides itself if the IPC fails (see `SettingsRoute`).
 */
export function StorageSection({
  paths,
  onPathsChange,
}: {
  paths: AppPaths;
  onPathsChange?: (next: AppPaths) => void;
}) {
  const { t } = useTranslation();
  const rows: Array<{ key: keyof AppPaths; label: string }> = [
    { key: 'config_dir', label: t('settings.storage.config_dir') },
    { key: 'data_dir', label: t('settings.storage.data_dir') },
    { key: 'db_path', label: t('settings.storage.db_path') },
    { key: 'changelog_path', label: t('settings.storage.changelog_path') },
  ];

  return (
    <Section
      id="settings-storage"
      title={t('settings.storage.title')}
      description={t('settings.storage.desc')}
    >
      {/* Primary row: the one location users actually want to
          relocate. Skills, MEMORY.md, profiles, chat logs — all the
          user-generated data Hermes owns sits here. Sized + styled
          prominently so users don't mistake it for the read-only
          Tauri internals below. */}
      <HermesDataDirRow paths={paths} onPathsChange={onPathsChange} />

      {/* Tauri-managed app-support paths. Small (≪ 10 MB), OS-standard
          location, not relocatable without restarting under a different
          platform-dirs bundle id. Shown for backup / debugging. */}
      <details className="group rounded-md border border-border/60 bg-bg-elev-1/40">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs text-fg-muted hover:text-fg">
          <span>{t('settings.storage.internals_title')}</span>
          <span className="text-fg-subtle transition group-open:rotate-180">▾</span>
        </summary>
        <ul className="flex flex-col gap-2 border-t border-border/60 p-2">
          {rows.map((row) => (
            <PathRow key={row.key} label={row.label} value={paths[row.key] as string} />
          ))}
        </ul>
      </details>

      <DangerZone />
    </Section>
  );
}

/**
 * Hermes data dir (`.hermes/`) picker. Unlike the other rows this is
 * a mutable field — users move it off the system drive, or to an
 * encrypted volume, etc. Restart is NOT required: subsystems resolve
 * the path lazily on the next read/write.
 */
function HermesDataDirRow({
  paths,
  onPathsChange,
}: {
  paths: AppPaths;
  onPathsChange?: (next: AppPaths) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await appPaths();
      onPathsChange?.(next);
    } catch {
      /* Non-fatal: the user can re-open Settings to refetch. */
    }
  }

  async function onBrowse() {
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      setBusy(true);
      await appDataDirSet(picked);
      await refresh();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setError(null);
    setBusy(true);
    try {
      await appDataDirClear();
      await refresh();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs">
      <div className="flex items-center gap-3">
        <span className="min-w-[110px] flex-none text-fg-subtle">
          {t('settings.storage.hermes_data_dir')}
        </span>
        <code
          className="min-w-0 flex-1 truncate font-mono text-fg"
          title={paths.hermes_data_dir}
        >
          {paths.hermes_data_dir || '—'}
        </code>
        <div className="flex flex-none items-center gap-1.5">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onBrowse()}>
            <Icon icon={FolderOpen} size="sm" />
            {t('settings.storage.change')}
          </Button>
          {paths.hermes_data_dir_overridden && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onReset()}>
              <Icon icon={RotateCcw} size="sm" />
              {t('settings.storage.reset')}
            </Button>
          )}
        </div>
      </div>
      {error && <div className="text-red-500">{error}</div>}
      <div className="text-fg-subtle">{t('settings.storage.hermes_data_dir_hint')}</div>
    </li>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard access can fail under strict permissions — silently
         ignore. Users can still select + copy the path manually. */
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs">
      <span className="min-w-[110px] flex-none text-fg-subtle">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-fg" title={value}>
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex flex-none items-center gap-1 rounded p-1 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
        aria-label={t('settings.storage.copy')}
      >
        {copied ? (
          <>
            <Icon icon={Check} size="sm" className="text-emerald-500" />
            <span className="text-emerald-500">{t('settings.storage.copied')}</span>
          </>
        ) : (
          <>
            <Icon icon={Copy} size="sm" />
            <span>{t('settings.storage.copy')}</span>
          </>
        )}
      </button>
    </li>
  );
}

function DangerZone() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirmHermes, setConfirmHermes] = useState(false);
  const [confirmCorey, setConfirmCorey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onHermesReset() {
    if (!confirmHermes) { setConfirmHermes(true); return; }
    setBusy(true);
    setError(null);
    try {
      await hermesDataReset();
      setConfirmHermes(false);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCoreyReset() {
    if (!confirmCorey) { setConfirmCorey(true); return; }
    setBusy(true);
    setError(null);
    try {
      await coreyConfigReset();
      setConfirmCorey(false);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-danger">
        <Icon icon={AlertTriangle} size="md" />
        {t('settings.storage.danger_zone')}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-fg">{t('settings.storage.hermes_reset_title')}</div>
            <div className="text-[11px] text-fg-muted">{t('settings.storage.hermes_reset_desc')}</div>
          </div>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void onHermesReset()} data-testid="btn-hermes-reset">
            <Icon icon={Trash2} size="xs" />
            {confirmHermes ? t('settings.storage.confirm') : t('settings.storage.hermes_reset_btn')}
          </Button>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-fg">{t('settings.storage.corey_reset_title')}</div>
            <div className="text-[11px] text-fg-muted">{t('settings.storage.corey_reset_desc')}</div>
          </div>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void onCoreyReset()} data-testid="btn-corey-reset">
            <Icon icon={RotateCcw} size="xs" />
            {confirmCorey ? t('settings.storage.confirm') : t('settings.storage.corey_reset_btn')}
          </Button>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-danger">{error}</div>}
    </div>
  );
}
