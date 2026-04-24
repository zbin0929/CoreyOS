import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FolderOpen,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
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
  type HermesProfileInfo,
  type HermesProfilesView,
  type ProfileImportPreview,
} from '@/lib/ipc';

/**
 * Profiles route (T2.7).
 *
 * Lists Hermes profiles (`~/.hermes/profiles/*`) with create/rename/
 * delete/clone actions. All writes funnel through the changelog journal
 * so /logs → Changelog tab picks them up next to model/env edits.
 *
 * T2.7 + 2026-04-23 follow-ups:
 *   - ✅ tar.gz export / import with manifest preview.
 *   - Per-profile gateway start/stop still deferred.
 *   - Switching active profile still deferred.
 *
 * The design is "one card per profile"; each card can be in `view`,
 * `rename`, `clone`, or `confirm-delete` mode. State lives per-row so
 * multiple cards can't be in an inconsistent action state at once.
 */
type Loaded = { kind: 'loaded'; view: HermesProfilesView };
type State =
  | { kind: 'loading' }
  | Loaded
  | { kind: 'error'; message: string };

type RowMode =
  | { kind: 'view' }
  | { kind: 'rename'; value: string }
  | { kind: 'clone'; value: string }
  | { kind: 'confirm-delete' };

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'err'; message: string };

/** Inflight import flow. Lives at the page level (not per-card)
 *  because the user starts it from a global button before choosing
 *  which profile it'll become. */
type ImportMode =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'preview';
      preview: ProfileImportPreview;
      bytesBase64: string;
      /** Optional rename — the user can type a different target name
       *  before committing. Defaults to the manifest's own name. */
      targetName: string;
    }
  | { kind: 'overwrite-prompt'; preview: ProfileImportPreview; bytesBase64: string; targetName: string }
  | { kind: 'error'; message: string };

/** Activate-profile flow. `confirm` carries the target and the previous
 *  active profile (when known) so the modal can render `dev → prod`
 *  and the user gets one last chance to back out before the gateway
 *  gets bounced. `restarting` is the transient state we hold while the
 *  two IPC calls (activate + optional gateway restart) run in series. */
type ActivateMode =
  | { kind: 'idle' }
  | { kind: 'confirm'; target: string; previous: string | null; restartGateway: boolean }
  | { kind: 'busy'; target: string; restartGateway: boolean }
  | { kind: 'error'; target: string; message: string };

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

// ───────────────────────── Card ─────────────────────────

interface CardProps {
  profile: HermesProfileInfo;
  mode: RowMode;
  status: RowStatus;
  onModeChange: (mode: RowMode) => void;
  onRename: (to: string) => void;
  onClone: (dst: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onActivate: () => void;
}

function ProfileCard({
  profile,
  mode,
  status,
  onModeChange,
  onRename,
  onClone,
  onDelete,
  onExport,
  onActivate,
}: CardProps) {
  const { t } = useTranslation();
  const busy = status.kind === 'busy';

  return (
    <div
      data-testid={`profile-card-${profile.name}`}
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-bg-elev-1 p-3 transition-colors',
        profile.is_active
          ? 'border-gold-500/60 bg-gold-500/5'
          : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="break-all text-sm font-medium text-fg">
              {profile.name}
            </span>
            {profile.is_active && (
              <span className="rounded-full border border-gold-500/60 bg-gold-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-500">
                {t('profiles.active')}
              </span>
            )}
          </div>
          <code
            className="mt-1 block truncate font-mono text-[11px] text-fg-subtle"
            title={profile.path}
          >
            {profile.path}
          </code>
          {profile.updated_at > 0 && (
            <span className="mt-1 block text-[11px] text-fg-subtle">
              {t('profiles.updated_at', {
                when: new Date(profile.updated_at).toLocaleString(),
              })}
            </span>
          )}
        </div>

        {mode.kind === 'view' && (
          <div className="flex flex-none items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onModeChange({ kind: 'rename', value: profile.name })}
              disabled={busy}
              title={t('profiles.rename')}
              data-testid={`profile-action-rename-${profile.name}`}
            >
              <Icon icon={Pencil} size="sm" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onModeChange({ kind: 'clone', value: `${profile.name}-copy` })
              }
              disabled={busy}
              title={t('profiles.clone')}
              data-testid={`profile-action-clone-${profile.name}`}
            >
              <Icon icon={Copy} size="sm" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onExport}
              disabled={busy}
              title={t('profiles.export')}
              data-testid={`profile-action-export-${profile.name}`}
            >
              <Icon icon={Download} size="sm" />
            </Button>
            {!profile.is_active && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onActivate}
                disabled={busy}
                title={t('profiles.activate')}
                data-testid={`profile-action-activate-${profile.name}`}
              >
                <Icon icon={Play} size="sm" />
                <span className="ml-1">{t('profiles.activate')}</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onModeChange({ kind: 'confirm-delete' })}
              // Can't delete the active profile — the backend would
              // refuse anyway, but disabling the button shows the why.
              disabled={busy || profile.is_active}
              title={
                profile.is_active
                  ? t('profiles.cant_delete_active')
                  : t('profiles.delete')
              }
              data-testid={`profile-action-delete-${profile.name}`}
            >
              <Icon icon={Trash2} size="sm" />
            </Button>
          </div>
        )}
      </div>

      {/* Inline action bodies. We render them below the header row so
          the card height grows gracefully — modals would be overkill. */}
      {(mode.kind === 'rename' || mode.kind === 'clone') && (
        <InlineNameForm
          icon={mode.kind === 'rename' ? Pencil : Copy}
          label={t(mode.kind === 'rename' ? 'profiles.rename' : 'profiles.clone')}
          value={mode.value}
          busy={busy}
          placeholder={t('profiles.name_placeholder')}
          onChange={(value) => onModeChange({ kind: mode.kind, value })}
          onSubmit={() => {
            const v = mode.value.trim();
            if (!v) return;
            if (mode.kind === 'rename') onRename(v);
            else onClone(v);
          }}
          onCancel={() => onModeChange({ kind: 'view' })}
        />
      )}

      {mode.kind === 'confirm-delete' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-fg">
          <span>
            {t('profiles.confirm_delete', { name: profile.name })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onModeChange({ kind: 'view' })}
              disabled={busy}
            >
              <Icon icon={X} size="sm" />
              {t('profiles.cancel')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onDelete}
              disabled={busy}
              data-testid={`profile-action-delete-confirm-${profile.name}`}
              className="!text-danger"
            >
              {busy ? (
                <Icon icon={Loader2} size="sm" className="animate-spin" />
              ) : (
                <Icon icon={Trash2} size="sm" />
              )}
              {t('profiles.delete')}
            </Button>
          </div>
        </div>
      )}

      {status.kind === 'err' && (
        <div className="flex items-start gap-1 text-[11px] text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="break-all">{status.message}</span>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Inline name form ─────────────────────────

function InlineNameForm({
  icon: IconCmp,
  label,
  value,
  busy,
  placeholder,
  onChange,
  onSubmit,
  onCancel,
}: {
  icon: typeof Pencil;
  label: string;
  value: string;
  busy: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-2 rounded border border-border bg-bg-elev-2/50 p-2"
    >
      <div className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Icon icon={IconCmp} size="sm" />
        {label}
      </div>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {t('profiles.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={busy || !value.trim()}
        >
          {busy ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Check} size="sm" />
          )}
          {t('profiles.confirm')}
        </Button>
      </div>
    </form>
  );
}

const inputCls = cn(
  'w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
);

// ───────────────────────── Import modal ─────────────────────────

/**
 * One modal covers every non-idle import state. Keeping the branches
 * together (loading / preview / overwrite-prompt / error) lets the
 * backdrop + focus trap live in one place — React's modal story is
 * allergic to fragmentation. We keep this lightweight (no portal,
 * no animation lib) because it only surfaces during an explicit user
 * action.
 */
function ImportModal({
  mode,
  busy,
  onCancel,
  onTargetNameChange,
  onConfirm,
}: {
  mode: ImportMode;
  busy: boolean;
  onCancel: () => void;
  onTargetNameChange: (name: string) => void;
  onConfirm: (overwrite: boolean) => void;
}) {
  const { t } = useTranslation();
  if (mode.kind === 'idle') return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      data-testid="profiles-import-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elev-1 p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon icon={Upload} size="sm" className="text-gold-500" />
            {t('profiles.import')}
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            aria-label={t('profiles.cancel')}
          >
            <Icon icon={X} size="xs" />
          </Button>
        </div>

        {mode.kind === 'loading' && (
          <div className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
            <Icon icon={Loader2} size="sm" className="animate-spin" />
            {t('profiles.import_reading')}
          </div>
        )}

        {mode.kind === 'error' && (
          <div className="mt-4 flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span className="break-all">{mode.message}</span>
          </div>
        )}

        {(mode.kind === 'preview' || mode.kind === 'overwrite-prompt') && (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-fg-subtle">{t('profiles.import_manifest_name')}</dt>
              <dd className="text-fg">{mode.preview.manifest.name}</dd>

              <dt className="text-fg-subtle">{t('profiles.import_manifest_files')}</dt>
              <dd className="text-fg tabular-nums">
                {mode.preview.file_count} · {formatBytes(mode.preview.total_bytes)}
              </dd>

              {mode.preview.manifest.exporter_version && (
                <>
                  <dt className="text-fg-subtle">{t('profiles.import_manifest_exporter')}</dt>
                  <dd className="font-mono text-[11px] text-fg-muted">
                    v{mode.preview.manifest.exporter_version}
                  </dd>
                </>
              )}

              <dt className="text-fg-subtle">{t('profiles.import_manifest_created')}</dt>
              <dd className="text-fg">
                {mode.preview.manifest.created_at > 0
                  ? new Date(mode.preview.manifest.created_at).toLocaleString()
                  : '—'}
              </dd>
            </dl>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-fg-subtle">
                {t('profiles.import_target_name')}
              </span>
              <input
                autoFocus
                className={inputCls}
                value={mode.targetName}
                onChange={(e) => onTargetNameChange(e.target.value)}
                disabled={busy}
                data-testid="profiles-import-target-name"
              />
            </label>

            {mode.kind === 'overwrite-prompt' && (
              <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-600">
                <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
                <span>
                  {t('profiles.import_overwrite_warn', {
                    name: mode.targetName,
                  })}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            data-testid="profiles-import-cancel"
          >
            {t('profiles.cancel')}
          </Button>
          {(mode.kind === 'preview' || mode.kind === 'overwrite-prompt') && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onConfirm(mode.kind === 'overwrite-prompt')}
              disabled={busy || !mode.targetName.trim()}
              data-testid={
                mode.kind === 'overwrite-prompt'
                  ? 'profiles-import-confirm-overwrite'
                  : 'profiles-import-confirm'
              }
            >
              {busy ? (
                <Icon icon={Loader2} size="sm" className="animate-spin" />
              ) : (
                <Icon icon={Check} size="sm" />
              )}
              {mode.kind === 'overwrite-prompt'
                ? t('profiles.import_confirm_overwrite')
                : t('profiles.import_confirm')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── helpers ─────────────────────────

/** Encode an ArrayBuffer into base64 without blowing the call stack on
 *  big buffers. `btoa(String.fromCharCode(...chunk))` blows up past
 *  ~65 kB on most engines; chunking at 32 kB keeps us on the safe
 *  side across WebKit/WebView2. */
function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000; // 32 KB
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

// ───────────────────────── Activate modal ─────────────────────────

/**
 * Confirm dialog for switching the active profile. Walks through three
 * visible states: `confirm` (the default — shows from → to + the
 * restart-gateway toggle), `busy` (spinner while IPCs run), and
 * `error` (when either the pointer write or the subsequent gateway
 * bounce fails). `idle` is filtered out at the call site so we never
 * see it here.
 */
function ActivateModal({
  mode,
  onCancel,
  onToggleRestart,
  onConfirm,
}: {
  mode: ActivateMode;
  onCancel: () => void;
  onToggleRestart: (v: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (mode.kind === 'idle') return null;
  const busy = mode.kind === 'busy';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      data-testid="profiles-activate-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elev-1 p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon icon={Play} size="sm" className="text-gold-500" />
            {t('profiles.activate')}
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            aria-label={t('profiles.cancel')}
          >
            <Icon icon={X} size="xs" />
          </Button>
        </div>

        {(mode.kind === 'confirm' || mode.kind === 'busy') && (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <p className="text-fg-muted">
              {mode.kind === 'confirm' && mode.previous
                ? t('profiles.activate_confirm_from_to', {
                    from: mode.previous,
                    to: mode.target,
                  })
                : t('profiles.activate_confirm_fresh', { to: mode.target })}
            </p>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={
                  mode.kind === 'confirm' ? mode.restartGateway : mode.restartGateway
                }
                disabled={busy}
                onChange={(e) => onToggleRestart(e.target.checked)}
                data-testid="profiles-activate-restart-toggle"
              />
              <span>{t('profiles.activate_restart_gateway')}</span>
            </label>
          </div>
        )}

        {mode.kind === 'error' && (
          <div className="mt-4 flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span className="break-all">{mode.message}</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            data-testid="profiles-activate-cancel"
          >
            {t('profiles.cancel')}
          </Button>
          {mode.kind === 'confirm' && (
            <Button
              size="sm"
              variant="primary"
              onClick={onConfirm}
              data-testid="profiles-activate-confirm"
            >
              <Icon icon={Check} size="sm" />
              {t('profiles.activate_confirm')}
            </Button>
          )}
          {mode.kind === 'busy' && (
            <Button size="sm" variant="primary" disabled>
              <Icon icon={Loader2} size="sm" className="animate-spin" />
              {t('profiles.activate_busy')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
