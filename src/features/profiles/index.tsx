import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  Copy,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesProfileClone,
  hermesProfileCreate,
  hermesProfileDelete,
  hermesProfileList,
  hermesProfileRename,
  ipcErrorMessage,
  type HermesProfileInfo,
  type HermesProfilesView,
} from '@/lib/ipc';

/**
 * Profiles route (T2.7).
 *
 * Lists Hermes profiles (`~/.hermes/profiles/*`) with create/rename/
 * delete/clone actions. All writes funnel through the changelog journal
 * so /logs → Changelog tab picks them up next to model/env edits.
 *
 * Deliberately NOT in this sprint (noted in phase-2-config.md):
 *   - tar.gz export / import (needs a file picker + manifest preview)
 *   - per-profile gateway start/stop (lands with Phase 3 channels)
 *   - switching active profile (we only *read* `active_profile` today)
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

export function ProfilesRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [rowMode, setRowMode] = useState<Record<string, RowMode>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [creating, setCreating] = useState<null | { value: string; busy: boolean }>(
    null,
  );

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('profiles.title')}
        subtitle={t('profiles.subtitle')}
        actions={
          <div className="flex items-center gap-2">
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
}

function ProfileCard({
  profile,
  mode,
  status,
  onModeChange,
  onRename,
  onClone,
  onDelete,
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
