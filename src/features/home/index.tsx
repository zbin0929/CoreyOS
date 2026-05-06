import { useTranslation } from 'react-i18next';
import { Loader2, Wifi, WifiOff } from 'lucide-react';

import { CoreyMark } from '@/components/ui/corey-mark';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useAppStatusStore } from '@/stores/appStatus';
import { useIsWidgetVisible } from '@/stores/homeLayout';

import { FirstRunModal } from './FirstRunModal';
import { HermesInstallCard } from './HermesInstallCard';
import { PresetCard } from './PresetCard';
import { useDashboard } from './useDashboard';
import { EditModeBar } from './widgets/EditModeBar';
import { HOME_WIDGETS } from './widgets/catalog';

export function HomeRoute() {
  const { t } = useTranslation();
  const refreshGateway = useAppStatusStore((s) => s.refreshGateway);
  const { gateway, loading } = useDashboard();
  const isOnline = gateway === 'online';

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      style={{ background: 'var(--gradient-page)' }}
    >
      <FirstRunModal />

      <div className="mx-auto flex w-full max-w-6xl flex-col px-6 py-6">
        <div className="animate-fade-in mb-8 flex items-center gap-4">
          <div className="relative">
            <CoreyMark className="h-12 w-12 shadow-lg ring-1 ring-border/60" />
            {isOnline && (
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[var(--online-dot-ring)] bg-emerald-500 shadow-[0_0_8px_hsl(155_80%_50%/0.6)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-fg">CoreyOS</h1>
            <p className="text-xs text-fg-muted">{t('home.dashboard_subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <EditModeBar />
            <button
              type="button"
              onClick={() => void refreshGateway()}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-200',
                isOnline
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-[0_0_12px_hsl(155_80%_50%/0.15)] hover:shadow-[0_0_20px_hsl(155_80%_50%/0.25)]'
                  : gateway === 'offline'
                    ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15'
                    : 'border-border bg-bg-elev-2 text-fg-muted hover:bg-bg-elev-3',
              )}
            >
              <Icon icon={isOnline ? Wifi : WifiOff} size="sm" />
              {isOnline
                ? t('home.gateway_online')
                : gateway === 'offline'
                  ? t('home.gateway_offline')
                  : t('home.gateway_unknown')}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <HermesInstallCard />
        </div>
        <div className="mb-4">
          <PresetCard />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-fg-muted">
            <Icon icon={Loader2} size="lg" className="animate-spin" />
          </div>
        ) : (
          <WidgetGrid />
        )}
      </div>
    </div>
  );
}

/**
 * Renders every widget the user has visible, slotting `full` widgets
 * into a top row and splitting the rest into a 2-column (`wide` /
 * `sidebar`) grid on `lg+` screens.
 */
function WidgetGrid() {
  const fullSlot = HOME_WIDGETS.filter((w) => w.span === 'full');
  const wideSlot = HOME_WIDGETS.filter((w) => w.span === 'wide');
  const sidebarSlot = HOME_WIDGETS.filter((w) => w.span === 'sidebar');

  return (
    <div className="flex flex-col gap-6">
      {fullSlot.map((spec) => (
        <SlotRender key={spec.id} spec={spec} />
      ))}

      <div
        className="animate-slide-up grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]"
        style={{ animationDelay: '0.1s' }}
      >
        <div className="flex min-w-0 flex-col gap-4">
          {wideSlot.map((spec) => (
            <SlotRender key={spec.id} spec={spec} />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {sidebarSlot.map((spec) => (
            <SlotRender key={spec.id} spec={spec} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SlotRender({
  spec,
}: {
  spec: (typeof HOME_WIDGETS)[number];
}) {
  const visible = useIsWidgetVisible(spec.id, spec.defaultVisible);
  if (!visible) return null;
  const C = spec.Component;
  return <C />;
}
