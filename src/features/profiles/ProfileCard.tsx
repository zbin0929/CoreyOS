import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Loader2,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { HermesProfileInfo } from '@/lib/ipc';

import { inputCls } from './styles';
import type { RowMode, RowStatus } from './types';

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

/**
 * One card per Hermes profile. Renders the header (name + active pill +
 * action toolbar) on top and inlines either the rename/clone form or
 * the delete-confirm strip below depending on `mode`.
 *
 * The card design intentionally avoids modals: every action is reachable
 * inline so the user can flip between cards without losing focus context.
 * Activate/import are the only flows that escalate to a modal because
 * they span multiple profiles or come from a global button.
 */
export function ProfileCard({
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
