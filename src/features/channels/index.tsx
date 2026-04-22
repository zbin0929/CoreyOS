import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  CircleOff,
  Hash,
  Loader2,
  MessageSquareMore,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  hermesChannelList,
  ipcErrorMessage,
  type ChannelState,
} from '@/lib/ipc';

/**
 * Channels route — Phase 3 · T3.1 (catalog-only pass).
 *
 * This iteration renders the read-only channel catalog returned by
 * `hermes_channel_list`: one card per channel with a status pill
 * ("Configured" / "Partial" / "Not configured" / "QR login"), a
 * condensed summary of which env keys are set, and a peek at the
 * current YAML field values. There's no inline form yet — that's T3.2.
 *
 * Why ship the read-only grid first:
 *   - It exercises the Rust catalog + IPC end-to-end so any schema
 *     bugs surface before we invest in 8 custom forms.
 *   - It gives us somewhere to dock the per-channel status pills that
 *     T3.4's live-probing hooks into later.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; channels: ChannelState[] }
  | { kind: 'error'; message: string };

/** Stable ordering for the status-dot severity, highest-priority first. */
function computeStatus(c: ChannelState):
  | 'configured'
  | 'partial'
  | 'unconfigured'
  | 'qr' {
  if (c.has_qr_login) {
    // WeChat: QR-only. Bucket as "qr" regardless of credential presence
    // until T3.3 wires live session-state checks.
    return 'qr';
  }
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

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const channels = await hermesChannelList();
      setState({ kind: 'loaded', channels });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('channels.title')}
        subtitle={t('channels.subtitle')}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={state.kind === 'loading'}
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5',
                state.kind === 'loading' && 'animate-spin',
              )}
            />
            {t('channels.refresh')}
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('channels.refresh')}…
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
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
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('channels.retry')}
                </Button>
              </div>
            </div>
          )}

          {state.kind === 'loaded' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {state.channels.map((c) => (
                <ChannelCard key={c.id} channel={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Card ─────────────────────────

function ChannelCard({ channel }: { channel: ChannelState }) {
  const { t } = useTranslation();
  const status = computeStatus(channel);
  const requiredEnv = channel.env_keys.filter((k) => k.required);
  const setCount = requiredEnv.filter((k) => channel.env_present[k.name]).length;

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
            <MessageSquareMore className="h-4 w-4 flex-none text-fg-muted" />
            <h3 className="truncate text-sm font-medium text-fg">
              {channel.display_name}
            </h3>
          </div>
          <code className="mt-0.5 block text-[11px] text-fg-subtle">
            #{channel.id}
          </code>
        </div>
        <StatusPill
          status={status}
          setCount={setCount}
          totalCount={requiredEnv.length}
        />
      </div>

      {/* Env keys — one row each with a check/cross. We never render the
          value, only the name + presence, so the card is safe to share
          in a screenshot. */}
      {channel.env_keys.length > 0 && (
        <ul className="flex flex-col gap-1">
          {channel.env_keys.map((k) => (
            <li
              key={k.name}
              className="flex items-center gap-2 text-[11px] text-fg-muted"
            >
              {channel.env_present[k.name] ? (
                <Check className="h-3 w-3 flex-none text-emerald-500" />
              ) : (
                <CircleOff
                  className={cn(
                    'h-3 w-3 flex-none',
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

      {channel.has_qr_login && (
        <div className="flex items-center gap-1.5 rounded border border-gold-500/40 bg-gold-500/5 px-2 py-1 text-[11px] text-gold-500">
          <QrCode className="h-3 w-3" />
          {t('channels.qr_hint')}
        </div>
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
                  <Hash className="mr-0.5 inline h-2.5 w-2.5" />
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
    </article>
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
