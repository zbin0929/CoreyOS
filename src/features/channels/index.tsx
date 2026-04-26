import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, RefreshCw, RotateCw } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesChannelList,
  hermesChannelStatusList,
  ipcErrorMessage,
  type ChannelLiveStatus,
  type ChannelState,
} from '@/lib/ipc';

import { ChannelCard } from './ChannelCard';

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
 * Subcomponents are split out into siblings:
 *   - `ChannelCard.tsx`   — per-card state machine + view/edit/confirm
 *   - `ConfirmDiff.tsx`   — inline diff + Save/Cancel panel
 *   - `StatusPill.tsx`    — both StatusPill (config) + LiveStatusPill
 *   - `computeStatus.ts`  — pure status derivation
 *   - `yaml.ts`           — pure formatYamlValue helper
 */
type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; channels: ChannelState[] }
  | { kind: 'error'; message: string };

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
            <InfoHint
              title={t('channels.title')}
              content={t('channels.help_page')}
              testId="channels-help"
            />
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
