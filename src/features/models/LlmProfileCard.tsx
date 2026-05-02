import { useTranslation } from 'react-i18next';
import { Edit3, Loader2, Star, Wifi } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { LlmProfile } from '@/lib/ipc';

export type LlmProbeState = 'probing' | 'ok' | 'err';

export function LlmProfileCard({
  profile,
  onOpen,
  probe,
  onTest,
  isDefault,
  onSetDefault,
}: {
  profile: LlmProfile;
  onOpen: () => void;
  probe?: LlmProbeState;
  onTest: () => void;
  isDefault?: boolean;
  onSetDefault?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex w-full flex-col rounded-md border',
        'transition-colors',
        isDefault
          ? 'border-gold-500/50 bg-gold-500/5'
          : 'border-border bg-bg-elev-1 hover:bg-bg-elev-2',
      )}
      data-testid={`llm-profile-row-${profile.id}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="group flex items-center gap-2.5 px-3 pt-3 pb-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30 focus-visible:ring-inset"
      >
        <span
          className={cn(
            'flex h-8 w-8 flex-none items-center justify-center rounded-md text-xs font-semibold uppercase',
            isDefault
              ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400'
              : 'bg-bg-elev-2 text-fg-muted',
          )}
        >
          {profile.provider.slice(0, 2) || '?'}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
          {profile.label || profile.id}
        </span>
        <ProbeDot state={probe} />
      </button>

      <div className="flex items-center gap-1.5 px-3 py-2">
        <span className="flex-none text-[11px] text-fg-muted">{t('models_page.profile_field_model')}</span>
        <code className="truncate font-mono text-[11px] text-fg-subtle">{profile.model}</code>
        {profile.vision && (
          <span className="rounded bg-purple-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-purple-500">
            Vision
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-border/60 px-3 py-2">
        {isDefault ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gold-700 dark:text-gold-400">
            <Icon icon={Star} size="xs" className="fill-gold-500" />
            {t('models_page.default_badge')}
          </span>
        ) : (
          onSetDefault && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetDefault();
              }}
              title={t('models_page.set_default_title')}
              aria-label={t('models_page.set_default_title')}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-fg-subtle transition-colors hover:bg-gold-500/10 hover:text-gold-600"
              data-testid={`llm-profile-set-default-${profile.id}`}
            >
              <Icon icon={Star} size="xs" />
              {t('models_page.set_default_title')}
            </button>
          )
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTest();
          }}
          disabled={probe === 'probing'}
          title={t('models_page.profile_test_title')}
          aria-label={t('models_page.profile_test_title')}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-fg-subtle transition-colors hover:bg-bg-elev-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`llm-profile-test-${profile.id}`}
        >
          <Icon
            icon={probe === 'probing' ? Loader2 : Wifi}
            size="xs"
            className={probe === 'probing' ? 'animate-spin' : undefined}
          />
          {t('models_page.profile_test_title')}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title={t('models_page.profile_edit_title')}
          aria-label={t('models_page.profile_edit_title')}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-fg-subtle transition-colors hover:bg-bg-elev-3 hover:text-fg"
          data-testid={`llm-profile-edit-${profile.id}`}
        >
          <Icon icon={Edit3} size="xs" />
          {t('models_page.profile_edit_title')}
        </button>
      </div>
    </div>
  );
}

function ProbeDot({ state }: { state?: LlmProbeState }) {
  const { t } = useTranslation();
  if (!state) return null;
  const cls =
    state === 'ok'
      ? 'bg-emerald-500'
      : state === 'err'
        ? 'bg-danger'
        : 'bg-amber-500 animate-pulse';
  const title =
    state === 'ok'
      ? t('models_page.profile_probe_ok')
      : state === 'err'
        ? t('models_page.profile_probe_err')
        : t('models_page.profile_probe_running');
  return (
    <span
      className={cn('inline-block h-2 w-2 flex-none rounded-full', cls)}
      title={title}
      aria-label={title}
      role="status"
    />
  );
}
