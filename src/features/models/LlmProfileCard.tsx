import { useTranslation } from 'react-i18next';
import { Edit3, Key, Loader2, Star, Wifi } from 'lucide-react';

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
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex w-full flex-col items-start gap-2 rounded-md border bg-bg-elev-1 p-3 pr-20 text-left',
          'transition-colors hover:border-gold-500/40 hover:bg-bg-elev-2',
          'focus:outline-none focus-visible:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/30',
          isDefault ? 'border-gold-500/50' : 'border-border',
        )}
        data-testid={`llm-profile-row-${profile.id}`}
      >
        <div className="flex w-full items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border bg-bg-elev-2 text-xs font-semibold uppercase text-fg-muted">
            {profile.provider.slice(0, 2) || '?'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-fg">
                {profile.label || profile.id}
              </span>
              <ProbeDot state={probe} />
              {isDefault && (
                <span className="inline-flex items-center gap-0.5 rounded bg-gold-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold-600">
                  <Icon icon={Star} size="xs" />
                  {t('models_page.default_badge')}
                </span>
              )}
            </div>
            <code className="truncate text-[10px] text-fg-subtle">
              {profile.id}
            </code>
          </div>
          <Icon
            icon={Edit3}
            size="sm"
            className="flex-none text-fg-subtle transition-colors group-hover:text-fg"
          />
        </div>
        <div className="flex w-full flex-col gap-0.5 text-[11px] text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <span className="truncate font-mono">{profile.model}</span>
            {profile.vision && (
              <span className="rounded bg-purple-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-purple-500">
                Vision
              </span>
            )}
          </span>
          <code className="truncate font-mono text-fg-subtle">
            {profile.base_url}
          </code>
          {profile.api_key_env && (
            <span className="inline-flex items-center gap-1 text-fg-subtle">
              <Icon icon={Key} size="xs" />
              <code>{profile.api_key_env}</code>
            </span>
          )}
        </div>
      </button>
      <div className="absolute right-2 top-2 flex items-center gap-1">
        {!isDefault && onSetDefault && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetDefault();
            }}
            title={t('models_page.set_default_title')}
            aria-label={t('models_page.set_default_title')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md',
              'text-fg-subtle transition-colors hover:bg-gold-500/10 hover:text-gold-600',
            )}
            data-testid={`llm-profile-set-default-${profile.id}`}
          >
            <Icon icon={Star} size="sm" />
          </button>
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
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md',
            'text-fg-subtle transition-colors hover:bg-bg-elev-3 hover:text-fg',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          data-testid={`llm-profile-test-${profile.id}`}
        >
          <Icon
            icon={probe === 'probing' ? Loader2 : Wifi}
            size="sm"
            className={probe === 'probing' ? 'animate-spin' : undefined}
          />
        </button>
      </div>
    </div>
  );
}

/**
 * Inline connection indicator. `undefined` = not tested yet (no dot);
 * `'probing'` = amber pulse; `'ok'` = emerald; `'err'` = red. Tiny by
 * design — it's a signal, not a feature.
 */
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
