import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  CircleOff,
  Hash,
  Loader2,
  MessageSquareMore,
  Pencil,
  RefreshCw,
  RotateCw,
  X,
} from 'lucide-react';
import { isVerifiedChannel } from './verified';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import {
  hermesChannelList,
  hermesChannelSave,
  hermesChannelStatusList,
  hermesGatewayRestart,
  ipcErrorMessage,
  type ChannelLiveStatus,
  type ChannelState,
} from '@/lib/ipc';
import {
  ChannelForm,
  type ChannelDiffLine,
  type ChannelFormSubmission,
} from './ChannelForm';

/**
 * Channels route — Phase 3 · T3.1 (catalog) + T3.2 (inline forms).
 *
 * Each card starts in a compact read-only view with a status pill
 * ("Configured" / "Partial" / "Not configured" / "QR login"), the
 * declared env-key presence, and the current yaml-field values.
 * Clicking **Edit** expands the card into an inline `ChannelForm`
 * driven entirely by the channel's `ChannelSpec`. On submit the form
 * returns the computed diff; we show a confirmation view under the
 * form (no separate modal — stays consistent with the Profiles
 * screen) and only call `hermes_channel_save` after the user
 * confirms. For `hot_reloadable = false` channels we surface a
 * "Restart gateway?" prompt after a successful save.
 *
 * Why we still ship this as one big file:
 *   - The surface is small (~500 LoC) and cohesive.
 *   - Card ↔ form ↔ restart-prompt share a per-card state machine;
 *     splitting them across files would just move prop-drilling
 *     plumbing around.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; channels: ChannelState[] }
  | { kind: 'error'; message: string };

/** Stable ordering for the status-dot severity, highest-priority first.
 *  Post-T6.7a the `'qr'` bucket is unreachable in practice (no Hermes
 *  channel uses QR) but is kept in the union for forward-compat with
 *  the `has_qr_login` spec flag. */
function computeStatus(c: ChannelState):
  | 'configured'
  | 'partial'
  | 'unconfigured'
  | 'qr' {
  if (c.has_qr_login) return 'qr';
  const required = c.env_keys.filter((k) => k.required);
  if (required.length === 0) return 'configured';
  const setCount = required.filter((k) => c.env_present[k.name]).length;
  if (setCount === 0) return 'unconfigured';
  if (setCount < required.length) return 'partial';
  return 'configured';
}

export function ChannelsRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  // T3.4: keyed by channel id for O(1) lookup from each card. Kept
  // at the route level so a single IPC call populates all 8 cards;
  // the force-refresh button on the page header bypasses the 30s
  // backend cache.
  const [liveStatuses, setLiveStatuses] = useState<Record<string, ChannelLiveStatus>>({});
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const channels = await hermesChannelList();
      setState({ kind: 'loaded', channels });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, []);

  const probe = useCallback(async (force: boolean) => {
    setProbing(true);
    try {
      const rows = await hermesChannelStatusList(force);
      const map: Record<string, ChannelLiveStatus> = {};
      for (const r of rows) map[r.id] = r;
      setLiveStatuses(map);
    } catch {
      // Silent — the live pill just stays on its previous value
      // (or is absent on first load). No need to blow up the whole
      // page for a log-parse failure.
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void probe(false);
  }, [load, probe]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('channels.title')}
        subtitle={t('channels.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {/* T3.4 live-probe button. Distinct from the catalog
                reload above it because the probe reads logs, not
                config — a change on the filesystem is the only
                thing that moves liveness. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void probe(true)}
              disabled={probing}
              data-testid="channels-probe-button"
            >
              <Icon
                icon={RefreshCw}
                size="sm"
                className={cn(probing && 'animate-spin')}
              />
              {t('channels.probe')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void load();
                void probe(true);
              }}
              disabled={state.kind === 'loading'}
              data-testid="channels-refresh-button"
            >
              <Icon
                icon={RotateCw}
                size="sm"
                className={cn(state.kind === 'loading' && 'animate-spin')}
              />
              {t('channels.refresh')}
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              {t('channels.refresh')}…
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <div className="flex-1">
                <div className="font-medium">{t('channels.error_title')}</div>
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
                  {t('channels.retry')}
                </Button>
              </div>
            </div>
          )}

          {state.kind === 'loaded' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {state.channels.map((c) => (
                <ChannelCard
                  key={c.id}
                  channel={c}
                  liveStatus={liveStatuses[c.id]}
                  onSaved={(fresh) => {
                    setState((prev) =>
                      prev.kind === 'loaded'
                        ? {
                            ...prev,
                            channels: prev.channels.map((x) =>
                              x.id === fresh.id ? fresh : x,
                            ),
                          }
                        : prev,
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Card ─────────────────────────

/** Per-card state machine. `view` is read-only. `edit` shows the
 *  form. `confirm` renders the computed diff + Save/Cancel. `saving`
 *  is the brief flash between IPC-in-flight and the restart prompt
 *  (or a fresh `view`). `restart-prompt` offers to run
 *  `hermes_gateway_restart` for non-hot-reloadable channels. */
type CardMode =
  | { kind: 'view' }
  | { kind: 'edit' }
  | { kind: 'confirm'; submission: ChannelFormSubmission }
  | { kind: 'saving'; submission: ChannelFormSubmission }
  | { kind: 'restart-prompt' }
  | { kind: 'error'; message: string };

function ChannelCard({
  channel,
  liveStatus,
  onSaved,
}: {
  channel: ChannelState;
  /** T3.4 — may be absent on first render if the probe hasn't
   *  landed yet. When present we render an extra pill next to the
   *  configured/partial/unconfigured one. */
  liveStatus?: ChannelLiveStatus;
  onSaved: (fresh: ChannelState) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CardMode>({ kind: 'view' });
  const status = computeStatus(channel);
  const requiredEnv = channel.env_keys.filter((k) => k.required);
  const setCount = requiredEnv.filter((k) => channel.env_present[k.name]).length;
  const busy = mode.kind === 'saving';
  // T3.5: below 720px the edit/confirm/restart UI moves into a bottom
  // drawer instead of expanding inline. Above that threshold we
  // render exactly the same sections in-card as before — no behavior
  // change on desktop, which keeps the existing e2e suite stable
  // (tests run on the default 1280x720 viewport).
  const isMobile = useIsMobile(720);
  const isInteractive =
    mode.kind === 'edit' ||
    mode.kind === 'confirm' ||
    mode.kind === 'saving' ||
    mode.kind === 'restart-prompt' ||
    mode.kind === 'error';

  async function doSave(submission: ChannelFormSubmission) {
    setMode({ kind: 'saving', submission });
    try {
      const fresh = await hermesChannelSave({
        id: channel.id,
        env_updates: submission.envUpdates,
        yaml_updates: submission.yamlUpdates,
      });
      onSaved(fresh);
      // Hot-reloadable channels: no restart prompt — flip back to
      // the read-only view immediately. Otherwise surface the
      // "Restart gateway?" offer so the user's change actually
      // takes effect.
      if (fresh.hot_reloadable) {
        setMode({ kind: 'view' });
      } else {
        setMode({ kind: 'restart-prompt' });
      }
    } catch (e) {
      setMode({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }

  async function doRestart() {
    setMode({ kind: 'saving', submission: { envUpdates: {}, yamlUpdates: {}, diffs: [] } });
    try {
      await hermesGatewayRestart();
      setMode({ kind: 'view' });
    } catch (e) {
      setMode({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }

  return (
    <article
      data-testid={`channel-card-${channel.id}`}
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-bg-elev-1 p-3 transition-colors',
        status === 'configured' && 'border-emerald-500/40',
        status === 'partial' && 'border-amber-500/50',
        status === 'unconfigured' && 'border-border',
        status === 'qr' && 'border-gold-500/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon icon={MessageSquareMore} size="md" className="flex-none text-fg-muted" />
            <h3 className="truncate text-sm font-medium text-fg">
              {channel.display_name}
            </h3>
          </div>
          <code className="mt-0.5 block text-[11px] text-fg-subtle">
            #{channel.id}
          </code>
        </div>
        <div className="flex items-center gap-2">
          {/* T6.7b — "Verified" badge for channels with a shipping
              e2e smoke test. Purely informational; doesn't gate any
              functionality. See `./verified.ts` for the catalog. */}
          {isVerifiedChannel(channel.id) && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500"
              title={t('channels.verified_title')}
              data-testid={`channel-verified-${channel.id}`}
            >
              <Icon icon={BadgeCheck} size={10} />
              {t('channels.verified')}
            </span>
          )}
          <StatusPill
            status={status}
            setCount={setCount}
            totalCount={requiredEnv.length}
          />
          {/* T3.4 — live-state pill. We intentionally hide it for
              channels whose configured-status is unconfigured
              (there's nothing to be online about yet) and for the
              QR-login channel whose liveness we can't yet probe. */}
          {liveStatus &&
            status !== 'unconfigured' &&
            status !== 'qr' && (
              <LiveStatusPill status={liveStatus} />
            )}
          {mode.kind === 'view' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMode({ kind: 'edit' })}
              data-testid={`channel-edit-${channel.id}`}
              title={t('channels.edit')}
            >
              <Icon icon={Pencil} size="sm" />
            </Button>
          )}
        </div>
      </div>

      {/* View mode — read-only summary. */}
      {(mode.kind === 'view' || mode.kind === 'restart-prompt' || mode.kind === 'error') && (
        <>
          {/* Env keys — one row each with a check/cross. We never render
              the value, only the name + presence, so the card is safe
              to share in a screenshot. */}
          {channel.env_keys.length > 0 && (
            <ul className="flex flex-col gap-1">
              {channel.env_keys.map((k) => (
                <li
                  key={k.name}
                  className="flex items-center gap-2 text-[11px] text-fg-muted"
                >
                  {channel.env_present[k.name] ? (
                    <Icon icon={Check} size="xs" className="flex-none text-emerald-500" />
                  ) : (
                    <Icon
                      icon={CircleOff}
                      size="xs"
                      className={cn(
                        'flex-none',
                        k.required ? 'text-fg-subtle' : 'text-fg-subtle/60',
                      )}
                    />
                  )}
                  <code className="truncate font-mono">{k.name}</code>
                  {!k.required && (
                    <span className="rounded border border-border px-1 text-[9px] uppercase tracking-wider text-fg-subtle">
                      {t('channels.optional')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {channel.yaml_fields.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[11px] text-fg-subtle group-open:text-fg-muted">
                {t('channels.behavior_fields', {
                  count: channel.yaml_fields.length,
                })}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-[11px]">
                {channel.yaml_fields.map((f) => (
                  <li
                    key={f.path}
                    className="flex items-center justify-between gap-2"
                  >
                    <code
                      className="truncate font-mono text-fg-subtle"
                      title={f.path}
                    >
                      <Icon icon={Hash} size={10} className="mr-0.5 inline" />
                      {f.path}
                    </code>
                    <span className="truncate font-mono text-fg-muted">
                      {formatYamlValue(channel.yaml_values[f.path])}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {/* Edit / confirm / restart / error panels. On desktop they
          render inline below the summary; on mobile (<720px) the
          whole group moves into a bottom-drawer that slides over
          the page. Condition below short-circuits when the card is
          in a non-interactive mode so the drawer doesn't mount. */}
      {!isMobile && renderInteractivePanels()}
      {isMobile && isInteractive && (
        <Drawer
          open
          onClose={() => {
            // From any interactive state, hitting X on the drawer
            // header should drop us back to view mode — matching
            // the behavior Cancel buttons inside the panels give.
            setMode({ kind: 'view' });
          }}
          title={channel.display_name}
          testId={`channel-drawer-${channel.id}`}
        >
          <div className="flex flex-col gap-3">{renderInteractivePanels()}</div>
        </Drawer>
      )}
    </article>
  );

  /** Inline / drawer-content panels. Extracted so the desktop
   *  (inline below summary) and mobile (inside Drawer) paths share
   *  one source of truth. */
  function renderInteractivePanels() {
    return (
      <>
      {mode.kind === 'edit' && (
        <ChannelForm
          channel={channel}
          busy={false}
          onCancel={() => setMode({ kind: 'view' })}
          onSubmit={(submission) => {
            // Empty patches → no-op. Keep the user in edit mode so
            // they notice nothing changed rather than silently
            // bouncing them back to view with no feedback.
            if (
              Object.keys(submission.envUpdates).length === 0 &&
              Object.keys(submission.yamlUpdates).length === 0
            ) {
              setMode({ kind: 'error', message: t('channels.no_changes') });
              return;
            }
            setMode({ kind: 'confirm', submission });
          }}
        />
      )}

      {/* Confirm mode — diff + Save/Cancel. Used as a lightweight
          "DiffModal" without layering a real overlay — consistent
          with the Profiles card flow. */}
      {(mode.kind === 'confirm' || mode.kind === 'saving') && (
        <ConfirmDiff
          diffs={mode.submission.diffs}
          busy={busy}
          hotReloadable={channel.hot_reloadable}
          onCancel={() => setMode({ kind: 'edit' })}
          onConfirm={() => doSave(mode.submission)}
        />
      )}

      {/* Non-hot-reloadable channels: after a successful save, prompt
          for a gateway restart. User can decline — the change is
          already on disk, just not picked up yet. */}
      {mode.kind === 'restart-prompt' && (
        <div
          className="flex flex-col gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-fg"
          data-testid={`channel-restart-prompt-${channel.id}`}
        >
          <div className="flex items-start gap-1.5">
            <Icon icon={RotateCw} size="xs" className="mt-0.5 flex-none text-amber-500" />
            <span>{t('channels.restart_prompt')}</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMode({ kind: 'view' })}
            >
              <Icon icon={X} size="xs" />
              {t('channels.restart_later')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={doRestart}
              data-testid={`channel-restart-confirm-${channel.id}`}
            >
              <Icon icon={RotateCw} size="xs" />
              {t('channels.restart_now')}
            </Button>
          </div>
        </div>
      )}

      {mode.kind === 'error' && (
        <div className="flex items-start gap-1 rounded border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="flex-1 break-all">{mode.message}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMode({ kind: 'view' })}
          >
            <Icon icon={X} size="xs" />
          </Button>
        </div>
      )}
      </>
    );
  }
}

// ───────────────────────── Confirm diff ─────────────────────────

/** Compact inline "diff modal". Shows one row per pending change with
 *  before → after. Secrets render as presence only (the form produced
 *  that already). Restart warning is inline so the user sees the
 *  consequence before they click Save. */
function ConfirmDiff({
  diffs,
  busy,
  hotReloadable,
  onCancel,
  onConfirm,
}: {
  diffs: ChannelDiffLine[];
  busy: boolean;
  hotReloadable: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-2 rounded border border-accent/40 bg-accent/5 p-2 text-[11px]"
      data-testid="channel-confirm-diff"
    >
      <div className="font-medium text-fg">{t('channels.confirm_title')}</div>
      <ul className="flex flex-col gap-1">
        {diffs.map((d) => (
          <li
            key={`${d.kind}:${d.label}`}
            className="grid grid-cols-[auto_1fr] gap-x-2 font-mono"
          >
            <span
              className={cn(
                'rounded px-1 text-[9px] uppercase',
                d.kind === 'env'
                  ? 'bg-amber-500/15 text-amber-500'
                  : 'bg-accent/15 text-accent',
              )}
            >
              {d.kind}
            </span>
            <span className="truncate text-fg-muted" title={d.label}>
              {d.label}
            </span>
            <span />
            <span className="text-fg-subtle">
              {d.before}
              <span className="mx-1 text-fg-subtle/60">→</span>
              <span className="text-fg">{d.after}</span>
            </span>
          </li>
        ))}
      </ul>
      {!hotReloadable && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-amber-500">
          <Icon icon={AlertCircle} size="xs" className="mr-1 inline" />
          {t('channels.not_hot_reloadable')}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          <Icon icon={X} size="xs" />
          {t('channels.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={onConfirm}
          disabled={busy}
          data-testid="channel-confirm-save"
        >
          {busy ? (
            <Icon icon={Loader2} size="xs" className="animate-spin" />
          ) : (
            <Icon icon={Check} size="xs" />
          )}
          {t('channels.confirm_save')}
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Pill ─────────────────────────

function StatusPill({
  status,
  setCount,
  totalCount,
}: {
  status: ReturnType<typeof computeStatus>;
  setCount: number;
  totalCount: number;
}) {
  const { t } = useTranslation();
  const map = {
    configured: { cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40', key: 'channels.status.configured' },
    partial: { cls: 'bg-amber-500/10 text-amber-500 border-amber-500/50', key: 'channels.status.partial' },
    unconfigured: { cls: 'bg-bg-elev-2 text-fg-subtle border-border', key: 'channels.status.unconfigured' },
    qr: { cls: 'bg-gold-500/10 text-gold-500 border-gold-500/40', key: 'channels.status.qr' },
  } as const;
  const { cls, key } = map[status];
  return (
    <span
      data-testid={`channel-status-${status}`}
      className={cn(
        'flex-none rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
      title={
        status === 'partial' ? `${setCount} / ${totalCount}` : undefined
      }
    >
      {t(key)}
      {status === 'partial' && ` · ${setCount}/${totalCount}`}
    </span>
  );
}

/** T3.4 live-state pill. Sits next to `StatusPill` and renders
 *  online / offline / unknown derived from the backend's log probe.
 *  Title tooltip shows the triggering log line (truncated) so power
 *  users can see WHICH event drove the verdict without opening the
 *  Logs tab. */
function LiveStatusPill({ status }: { status: ChannelLiveStatus }) {
  const { t } = useTranslation();
  const map = {
    online: {
      cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40',
      key: 'channels.live.online',
    },
    offline: {
      cls: 'bg-danger/10 text-danger border-danger/40',
      key: 'channels.live.offline',
    },
    unknown: {
      cls: 'bg-bg-elev-2 text-fg-subtle border-border',
      key: 'channels.live.unknown',
    },
  } as const;
  const { cls, key } = map[status.state];
  const marker = status.last_marker ?? '';
  return (
    <span
      data-testid={`channel-live-${status.state}-${status.id}`}
      className={cn(
        'flex-none rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
      title={marker.length > 0 ? marker.slice(0, 160) : undefined}
    >
      {t(key)}
    </span>
  );
}

// ───────────────────────── helpers ─────────────────────────

/** Render a YAML value compactly for the card preview. `null` / undefined
 *  show as a muted em-dash so empty defaults don't look like a bug. */
function formatYamlValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') {
    if (v.length <= 24) return v;
    return v.slice(0, 24) + '…';
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.length === 1) return `[${formatYamlValue(v[0])}]`;
    return `[${v.length} items]`;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
