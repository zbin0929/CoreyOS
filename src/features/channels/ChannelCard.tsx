import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  CircleOff,
  Hash,
  MessageSquareMore,
  Pencil,
  QrCode,
  RotateCw,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import {
  hermesChannelSave,
  hermesGatewayRestart,
  ipcErrorMessage,
  type ChannelLiveStatus,
  type ChannelState,
} from '@/lib/ipc';

import { ChannelForm, type ChannelFormSubmission } from './ChannelForm';
import { ChannelQrPanel } from './ChannelQrPanel';
import { ConfirmDiff } from './ConfirmDiff';
import { LiveStatusPill, StatusPill } from './StatusPill';
import { computeStatus } from './computeStatus';
import { isVerifiedChannel } from './verified';
import { formatYamlValue } from './yaml';

/** Per-card state machine. `view` is read-only. `edit` shows the
 *  form. `confirm` renders the computed diff + Save/Cancel. `saving`
 *  is the brief flash between IPC-in-flight and the restart prompt
 *  (or a fresh `view`). `restart-prompt` offers to run
 *  `hermes_gateway_restart` for non-hot-reloadable channels. */
type CardMode =
  | { kind: 'view' }
  | { kind: 'edit' }
  | { kind: 'qr' }
  | { kind: 'confirm'; submission: ChannelFormSubmission }
  | { kind: 'saving'; submission: ChannelFormSubmission }
  | { kind: 'restart-prompt' }
  | { kind: 'error'; message: string };

export function ChannelCard({
  channel,
  liveStatus,
  onSaved,
  onQrDone,
}: {
  channel: ChannelState;
  liveStatus?: ChannelLiveStatus;
  onSaved: (fresh: ChannelState) => void;
  onQrDone?: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CardMode>({ kind: 'view' });
  const status = computeStatus(channel);
  const requiredEnv = channel.env_keys.filter((k) => k.required);
  const setCount = requiredEnv.filter((k) => channel.env_present[k.name]).length;
  const busy = mode.kind === 'saving';
  const isMobile = useIsMobile(720);
  const isInteractive =
    mode.kind === 'edit' ||
    mode.kind === 'qr' ||
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

  function renderInteractivePanels() {
    return (
      <>
      {mode.kind === 'edit' && (
        <ChannelForm
          channel={channel}
          busy={false}
          onCancel={() => setMode({ kind: 'view' })}
          onSubmit={(submission) => {
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

      {mode.kind === 'qr' && (
        <ChannelQrPanel
          channelId={channel.id}
          onClose={() => setMode({ kind: 'view' })}
          onDone={() => {
            setMode({ kind: 'view' });
            onQrDone?.();
          }}
        />
      )}

      {(mode.kind === 'confirm' || mode.kind === 'saving') && (
        <ConfirmDiff
          diffs={mode.submission.diffs}
          busy={busy}
          hotReloadable={channel.hot_reloadable}
          onCancel={() => setMode({ kind: 'edit' })}
          onConfirm={() => doSave(mode.submission)}
        />
      )}

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

  return (
    <article
      data-testid={`channel-card-${channel.id}`}
      className={cn(
        'relative flex flex-col gap-3 rounded-md border bg-bg-elev-1 p-3 transition-colors',
        liveStatus?.state === 'online' && 'border-emerald-500',
        liveStatus?.state !== 'online' && status === 'configured' && 'border-emerald-500/40',
        liveStatus?.state !== 'online' && status === 'partial' && 'border-amber-500/50',
        liveStatus?.state !== 'online' && status === 'unconfigured' && 'border-border',
        liveStatus?.state !== 'online' && status === 'qr' && 'border-gold-500/40',
      )}
    >
      {liveStatus?.state === 'online' && (
        <span
          className="absolute -left-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
          title={t('channels.live.online')}
          data-testid={`channel-online-check-${channel.id}`}
        >
          <Icon icon={Check} size={12} strokeWidth={3} />
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon icon={MessageSquareMore} size="md" className="flex-none text-fg-muted" />
            <h3 className="truncate text-sm font-medium text-fg">
              {t(`channels.name_${channel.id}`, channel.display_name)}
            </h3>
          </div>
          <code className="mt-0.5 block text-[11px] text-fg-subtle">
            #{channel.id}
          </code>
          {(() => {
            const key = `channels.card_desc.${channel.id}`;
            const desc = t(key);
            if (!desc || desc === key) return null;
            return (
              <p className="mt-1 text-[11px] leading-snug text-fg-muted">
                {desc}
              </p>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
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
          {liveStatus &&
            status !== 'unconfigured' &&
            status !== 'qr' && (
              <LiveStatusPill status={liveStatus} />
            )}
          {mode.kind === 'view' && channel.has_qr_login && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMode({ kind: 'qr' })}
              data-testid={`channel-qr-${channel.id}`}
              title={t('channels.qr_setup_title', { defaultValue: '扫码配置' })}
            >
              <Icon icon={QrCode} size="sm" />
            </Button>
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

      {(mode.kind === 'view' || mode.kind === 'restart-prompt' || mode.kind === 'error') && (
        <>
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

      {!isMobile && renderInteractivePanels()}
      {isMobile && isInteractive && (
        <Drawer
          open
          onClose={() => {
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
}
