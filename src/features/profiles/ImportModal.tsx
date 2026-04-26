import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { formatBytes } from './helpers';
import { inputCls } from './styles';
import type { ImportMode } from './types';

/**
 * One modal covers every non-idle import state. Keeping the branches
 * together (loading / preview / overwrite-prompt / error) lets the
 * backdrop + focus trap live in one place — React's modal story is
 * allergic to fragmentation. We keep this lightweight (no portal,
 * no animation lib) because it only surfaces during an explicit user
 * action.
 */
export function ImportModal({
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
