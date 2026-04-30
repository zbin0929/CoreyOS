import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { useAppStatusStore, type GatewayHealth } from '@/stores/appStatus';
import { cn } from '@/lib/cn';

export function StatusBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gateway = useAppStatusStore((s) => s.gateway);
  const gatewayLatencyMs = useAppStatusStore((s) => s.gatewayLatencyMs);
  const currentModel = useAppStatusStore((s) => s.currentModel);
  const refreshGateway = useAppStatusStore((s) => s.refreshGateway);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-1 border-t border-border bg-bg-elev-1 px-3 text-[11px] select-none">
      <button
        type="button"
        onClick={() => void refreshGateway()}
        title={t('topbar.gateway_click_to_refresh')}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
          gateway === 'online' && 'text-emerald-500 hover:bg-emerald-500/10',
          gateway === 'offline' && 'text-danger hover:bg-danger/10',
          gateway === 'unknown' && 'text-fg-subtle hover:bg-bg-elev-2',
        )}
      >
        <Icon
          icon={gateway === 'online' ? Wifi : WifiOff}
          size="xs"
          className={gateway === 'online' ? 'animate-pulse' : undefined}
        />
        <span>{gatewayLabel(gateway, gatewayLatencyMs)}</span>
      </button>

      <Separator />

      {currentModel && (
        <>
          <span className="truncate text-fg-subtle max-w-[160px]">{currentModel}</span>
          <Separator />
        </>
      )}

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => void navigate({ to: '/settings' })}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-subtle hover:bg-bg-elev-2 hover:text-fg transition-colors"
        title={t('nav.settings')}
      >
        <Icon icon={Settings} size="xs" />
        <span>{t('nav.settings')}</span>
      </button>

      <Separator />

      <span className="text-fg-subtle">Corey v{__APP_VERSION__}</span>
    </footer>
  );
}

function Separator() {
  return <span className="mx-1 text-border">│</span>;
}

function gatewayLabel(g: GatewayHealth, latencyMs: number | null): string {
  if (g === 'online') {
    return latencyMs !== null ? `${latencyMs}ms` : 'online';
  }
  if (g === 'offline') return 'offline';
  return '—';
}
