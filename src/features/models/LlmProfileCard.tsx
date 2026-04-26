import { useTranslation } from 'react-i18next';
import { Edit3, Key, Loader2, Wifi } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { LlmProfile } from '@/lib/ipc';

/**
 * Per-card reachability probe result. `null` / missing = never tested.
 * Section-scoped and ephemeral — we don't persist probes because stale
 * green dots are worse than "unknown": a key can expire or a vendor
 * can go down between app restarts. Re-click to re-test.
 *
 * Distinct from `ProbeState` in `./types` (which is the legacy
 * single-model form's richer probe state with latency + count); this
 * one is a tiny three-value flag for the card grid.
 */
export type LlmProbeState = 'probing' | 'ok' | 'err';

/**
 * Compact card for the profile grid. The entire card is a button —
 * clicking anywhere jumps to the focused edit view. Layout is vertical
 * so it survives a 1-column (mobile) / 2-column / 3-column grid without
 * re-wrapping. The two-letter provider chip in the corner gives users a
 * visual anchor even when labels are long or the grid is dense.
 */
export function LlmProfileCard({
  profile,
  onOpen,
  probe,
  onTest,
}: {
  profile: LlmProfile;
  onOpen: () => void;
  /** Last-probe result. Undefined = never tested this session. */
  probe?: LlmProbeState;
  /** Fire a fresh /v1/models probe against this profile's base_url. */
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex w-full flex-col items-start gap-2 rounded-md border border-border bg-bg-elev-1 p-3 pr-10 text-left',
          'transition-colors hover:border-gold-500/40 hover:bg-bg-elev-2',
          'focus:outline-none focus-visible:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/30',
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
      {/* Test button floats outside the card's click target so it
          doesn't open the editor. Positioned absolute in the padding
          reserved by `pr-10` on the card. */}
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
          'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md',
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
