import { useTranslation } from 'react-i18next';
import { Edit3, Loader2, Wifi } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { HermesInstance, SandboxScope } from '@/lib/ipc';

export type AgentProbeState = 'probing' | 'ok' | 'err';

export function HermesInstanceCard({
  instance,
  scope,
  onOpen,
  probe,
  onTest,
}: {
  instance: HermesInstance;
  scope: SandboxScope | null;
  onOpen: () => void;
  probe?: AgentProbeState;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex w-full flex-col items-start gap-2 rounded-lg border border-border bg-bg-elev-1 p-3 pr-10 text-left',
          'transition-colors hover:border-gold-500/40 hover:bg-bg-elev-2',
          'focus:outline-none focus-visible:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/30',
        )}
        data-testid={`hermes-instance-card-${instance.id}`}
      >
        <div className="flex w-full items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-border bg-bg-elev-2 text-xs font-semibold uppercase text-fg-muted">
            {instance.id.slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-fg">
                {instance.label || instance.id}
              </span>
              <AgentProbeDot state={probe} />
            </div>
            <code className="truncate text-[10px] text-fg-subtle">
              {instance.id}
            </code>
          </div>
          <Icon
            icon={Edit3}
            size="sm"
            className="flex-none text-fg-subtle transition-colors group-hover:text-fg"
          />
        </div>
        <div className="flex w-full flex-col gap-0.5 text-[11px] text-fg-muted">
          {instance.default_model && (
            <span className="truncate font-mono">{instance.default_model}</span>
          )}
          <code className="truncate font-mono text-fg-subtle">
            {instance.base_url}
          </code>
          {scope && (
            <span className="truncate text-fg-subtle">
              {scope.label}
              {scope.id !== 'default' ? ` · ${scope.id}` : ''}
            </span>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTest();
        }}
        disabled={probe === 'probing'}
        title={t('settings.hermes_instances.test')}
        aria-label={t('settings.hermes_instances.test')}
        className={cn(
          'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md',
          'text-fg-subtle transition-colors hover:bg-bg-elev-3 hover:text-fg',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        data-testid={`hermes-instance-test-${instance.id}`}
      >
        <Icon
          icon={probe === 'probing' ? Loader2 : Wifi}
          size="sm"
          className={probe === 'probing' ? 'animate-spin' : undefined}
        />
      </button>
    </div>
  );
}

function AgentProbeDot({ state }: { state?: AgentProbeState }) {
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
