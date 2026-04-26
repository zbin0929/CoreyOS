import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/cn';
import {
  hermesGatewayRestart,
  hermesProfileActivate,
  hermesProfileClone,
  hermesProfileCreate,
  hermesProfileDelete,
  hermesProfileExport,
  hermesProfileImport,
  hermesProfileImportPreview,
  hermesProfileList,
  hermesProfileRename,
  ipcErrorMessage,
} from '@/lib/ipc';

import { ActivateModal } from './ActivateModal';
import { base64FromArrayBuffer } from './helpers';
import { ImportModal } from './ImportModal';
import { ProfileCard } from './ProfileCard';
import { inputCls } from './styles';
import type {
  ActivateMode,
  ImportMode,
  RowMode,
  RowStatus,
  State,
} from './types';

/**
 * Profiles route (T2.7).
 *
 * Lists Hermes profiles (`~/.hermes/profiles/*`) with create/rename/
 * delete/clone actions. All writes funnel through the changelog journal
 * so /logs → Changelog tab picks them up next to model/env edits.
 *
 * T2.7 + 2026-04-23 follow-ups:
 *   - ✅ tar.gz export / import with manifest preview.
 *   - ✅ Activate flow with optional gateway restart.
 *
 * The design is "one card per profile"; each card can be in `view`,
 * `rename`, `clone`, or `confirm-delete` mode. State lives per-row so
 * multiple cards can't be in an inconsistent action state at once.
 *
 * 2026-04-26 — extracted ProfileCard / ImportModal / ActivateModal /
 * helpers / types out of the original 1.1k-line file. The route below
 * keeps only orchestration: list IPC, per-row write dispatch, import
 * file picking, and the activate flow.
 */
export function ProfilesRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [rowMode, setRowMode] = useState<Record<string, RowMode>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [creating, setCreating] = useState<null | { value: string; busy: boolean }>(
    null,
  );
  const [importMode, setImportMode] = useState<ImportMode>({ kind: 'idle' });
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 2026-04-23 — per-profile activate flow. Lives at the page level
  // (not per-card) because the confirm dialog spans profiles (shows
  // `from → to`) and because the gateway-restart opt-in is global.
  const [activateMode, setActivateMode] = useState<ActivateMode>({ kind: 'idle' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const view = await hermesProfileList();
      setState({ kind: 'loaded', view });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function setMode(name: string, mode: RowMode) {
    setRowMode((m) => ({ ...m, [name]: mode }));
  }

  /** Run a write op, then reload the list from scratch so the UI stays
   *  authoritative re: active profile, mtimes, and sort order. */
  async function runWrite(name: string, op: () => Promise<unknown>) {
    setRowStatus((m) => ({ ...m, [name]: { kind: 'busy' } }));
    try {
      await op();
      setRowStatus((m) => ({ ...m, [name]: { kind: 'idle' } }));
      setMode(name, { kind: 'view' });
      await load();
    } catch (e) {
      setRowStatus((m) => ({
        ...m,
        [name]: { kind: 'err', message: ipcErrorMessage(e) },
      }));
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!creating) return;
    const name = creating.value.trim();
    if (!name) return;
    setCreating({ ...creating, busy: true });
    try {
      await hermesProfileCreate(name);
      setCreating(null);
      await load();
    } catch (err) {
      setCreating({ value: creating.value, busy: false });
      // Surface error on the pseudo-row using the same status map.
      setRowStatus((m) => ({
        ...m,
        __create__: { kind: 'err', message: ipcErrorMessage(err) },
      }));
    }
  }

  /**
   * Export flow: ask the backend for the tar.gz bytes, decode base64
   * to a Blob, and trigger a standard `<a download>` — no Tauri
   * file-dialog plugin, no filesystem writes on our side. The browser
   * drops the file into the user's Downloads folder.
   */
  async function onExport(name: string) {
    setRowStatus((m) => ({ ...m, [name]: { kind: 'busy' } }));
    try {
      const resp = await hermesProfileExport(name);
      // atob → Uint8Array → Blob. We don't stream because profiles are
      // kB-MB range and the simplicity win is worth it.
      const bin = atob(resp.bytes_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${resp.name}.tar.gz`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Give the browser a tick to start the download before we
        // revoke the URL — revoking too eagerly cancels it in some
        // WebView2/WebKit builds.
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      setRowStatus((m) => ({ ...m, [name]: { kind: 'idle' } }));
    } catch (e) {
      setRowStatus((m) => ({
        ...m,
        [name]: { kind: 'err', message: ipcErrorMessage(e) },
      }));
    }
  }

  /**
   * Kick off the import flow by triggering the hidden file input. Once
   * the user picks a file, `onImportFilePicked` parses the manifest
   * and drops us into the preview state so the user can confirm (and
   * optionally rename) before anything touches disk.
   */
  function onImportClick() {
    if (importBusy) return;
    setImportMode({ kind: 'idle' });
    fileInputRef.current?.click();
  }

  async function onImportFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires change.
    e.target.value = '';
    if (!file) return;
    setImportMode({ kind: 'loading' });
    try {
      const buf = await file.arrayBuffer();
      // base64-encode chunkwise to avoid the huge-apply-string stack
      // overflow on big profiles.
      const bytesBase64 = base64FromArrayBuffer(buf);
      const preview = await hermesProfileImportPreview(bytesBase64);
      setImportMode({
        kind: 'preview',
        preview,
        bytesBase64,
        targetName: preview.manifest.name,
      });
    } catch (err) {
      setImportMode({ kind: 'error', message: ipcErrorMessage(err) });
    }
  }

  async function commitImport(overwrite: boolean) {
    if (importMode.kind !== 'preview' && importMode.kind !== 'overwrite-prompt') return;
    const { bytesBase64, targetName, preview } = importMode;
    const name = targetName.trim() || preview.manifest.name;
    setImportBusy(true);
    try {
      await hermesProfileImport({ bytesBase64, targetName: name, overwrite });
      setImportMode({ kind: 'idle' });
      await load();
    } catch (err) {
      const message = ipcErrorMessage(err);
      // The backend's `AlreadyExists` is the only expected failure we
      // want to upgrade into an extra confirm step; everything else
      // is a hard error.
      if (!overwrite && /already exists/i.test(message)) {
        setImportMode({
          kind: 'overwrite-prompt',
          preview,
          bytesBase64,
          targetName: name,
        });
      } else {
        setImportMode({ kind: 'error', message });
      }
    } finally {
      setImportBusy(false);
    }
  }

  /**
   * Kick off the activate flow for `target`. The card surface calls us
   * with the target name; we look up the current active profile from
   * the loaded view so the modal can show `current → target`. The
   * restart-gateway toggle starts on because it's the whole point of
   * switching — users who just want the pointer flipped without an
   * immediate bounce can uncheck it before confirming.
   */
  function openActivate(target: string) {
    if (state.kind !== 'loaded') return;
    const previous = state.view.active;
    // Short-circuit if the user somehow clicked Activate on the
    // already-active profile — the button is disabled in that case
    // but this makes the flow idempotent against double-clicks.
    if (previous === target) return;
    setActivateMode({
      kind: 'confirm',
      target,
      previous,
      restartGateway: true,
    });
  }

  async function commitActivate() {
    if (activateMode.kind !== 'confirm') return;
    const { target, restartGateway } = activateMode;
    setActivateMode({ kind: 'busy', target, restartGateway });
    try {
      await hermesProfileActivate(target);
      if (restartGateway) {
        // Bounce is best-effort — Hermes might not be running, in
        // which case `hermes gateway restart` will error. We still
        // consider the activation a success because the pointer
        // flipped; surface the restart-specific error inline so the
        // user knows to start the gateway manually.
        try {
          await hermesGatewayRestart();
        } catch (err) {
          setActivateMode({
            kind: 'error',
            target,
            message: ipcErrorMessage(err),
          });
          await load();
          return;
        }
      }
      setActivateMode({ kind: 'idle' });
      await load();
    } catch (err) {
      setActivateMode({
        kind: 'error',
        target,
        message: ipcErrorMessage(err),
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('profiles.title')}
        subtitle={t('profiles.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('profiles.title')}
              content={t('profiles.help_page')}
              testId="profiles-help"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={load}
              disabled={state.kind === 'loading'}
            >
              <Icon
                icon={RefreshCw}
                size="sm"
                className={cn(state.kind === 'loading' && 'animate-spin')}
              />
              {t('profiles.refresh')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onImportClick}
              disabled={importBusy || state.kind === 'loading'}
              data-testid="profiles-import"
            >
              <Icon icon={Upload} size="sm" />
              {t('profiles.import')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreating({ value: '', busy: false })}
              disabled={creating !== null || state.kind === 'loading'}
              data-testid="profiles-new"
            >
              <Icon icon={Plus} size="sm" />
              {t('profiles.new')}
            </Button>
          </div>
        }
      />

      {/* Hidden file input driving the Import button above. `.tar.gz`
       *  + `.tgz` accept hint keeps the picker focused. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".tar.gz,.tgz,application/gzip,application/x-gzip,application/x-tar"
        className="hidden"
        onChange={(e) => void onImportFilePicked(e)}
        data-testid="profiles-import-input"
      />

      {importMode.kind !== 'idle' && (
        <ImportModal
          mode={importMode}
          busy={importBusy}
          onCancel={() => setImportMode({ kind: 'idle' })}
          onTargetNameChange={(name) =>
            setImportMode((m) =>
              m.kind === 'preview' || m.kind === 'overwrite-prompt'
                ? { ...m, targetName: name }
                : m,
            )
          }
          onConfirm={(overwrite) => void commitImport(overwrite)}
        />
      )}

      {activateMode.kind !== 'idle' && (
        <ActivateModal
          mode={activateMode}
          onCancel={() => setActivateMode({ kind: 'idle' })}
          onToggleRestart={(v) =>
            setActivateMode((m) =>
              m.kind === 'confirm' ? { ...m, restartGateway: v } : m,
            )
          }
          onConfirm={() => void commitActivate()}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              {t('profiles.refresh')}…
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <div className="flex-1">
                <div className="font-medium">{t('profiles.error_title')}</div>
                <div className="mt-1 break-all text-xs opacity-80">
                  {state.message}
                </div>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  onClick={load}
                >
                  <Icon icon={RefreshCw} size="sm" />
                  {t('profiles.retry')}
                </Button>
              </div>
            </div>
          )}

          {creating && (
            <form
              onSubmit={onCreate}
              className="flex flex-col gap-2 rounded-md border border-gold-500/40 bg-gold-500/5 p-3"
            >
              <div className="flex items-center gap-2">
                <Icon icon={Plus} size="md" className="text-gold-500" />
                <span className="text-sm font-medium text-fg">
                  {t('profiles.new')}
                </span>
              </div>
              <input
                autoFocus
                value={creating.value}
                onChange={(e) =>
                  setCreating({ value: e.target.value, busy: creating.busy })
                }
                placeholder={t('profiles.name_placeholder')}
                data-testid="profiles-new-input"
                className={inputCls}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreating(null)}
                  disabled={creating.busy}
                >
                  {t('profiles.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={creating.busy || !creating.value.trim()}
                >
                  {creating.busy ? (
                    <Icon icon={Loader2} size="sm" className="animate-spin" />
                  ) : (
                    <Icon icon={Check} size="sm" />
                  )}
                  {t('profiles.create')}
                </Button>
              </div>
              {rowStatus.__create__?.kind === 'err' && (
                <div className="flex items-start gap-1 text-xs text-danger">
                  <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
                  <span className="break-all">
                    {rowStatus.__create__.message}
                  </span>
                </div>
              )}
            </form>
          )}

          {state.kind === 'loaded' && state.view.missing_root && (
            <EmptyState
              icon={FolderOpen}
              title={t('profiles.missing_title')}
              description={t('profiles.missing_desc', { path: state.view.root })}
              className="mx-auto mt-10 max-w-lg"
            />
          )}

          {state.kind === 'loaded' &&
            !state.view.missing_root &&
            state.view.profiles.length === 0 && (
              <EmptyState
                icon={FolderOpen}
                title={t('profiles.empty_title')}
                description={t('profiles.empty_desc')}
                className="mx-auto mt-10 max-w-lg"
              />
            )}

          {state.kind === 'loaded' &&
            state.view.profiles.map((p) => (
              <ProfileCard
                key={p.name}
                profile={p}
                mode={rowMode[p.name] ?? { kind: 'view' }}
                status={rowStatus[p.name] ?? { kind: 'idle' }}
                onModeChange={(m) => setMode(p.name, m)}
                onRename={(to) =>
                  runWrite(p.name, () =>
                    hermesProfileRename({ from: p.name, to }),
                  )
                }
                onClone={(dst) =>
                  runWrite(p.name, () =>
                    hermesProfileClone({ src: p.name, dst }),
                  )
                }
                onDelete={() => runWrite(p.name, () => hermesProfileDelete(p.name))}
                onExport={() => void onExport(p.name)}
                onActivate={() => openActivate(p.name)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
