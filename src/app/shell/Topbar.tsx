import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Sun, Moon, Search, CircleDot } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { usePaletteStore } from '@/stores/palette';
import { useUIStore } from '@/stores/ui';
import { useAppStatusStore, type GatewayHealth } from '@/stores/appStatus';
import { cn } from '@/lib/cn';

export function Topbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const togglePalette = usePaletteStore((s) => s.toggle);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const currentModel = useAppStatusStore((s) => s.currentModel);
  const gateway = useAppStatusStore((s) => s.gateway);
  const gatewayLatencyMs = useAppStatusStore((s) => s.gatewayLatencyMs);
  const refreshGateway = useAppStatusStore((s) => s.refreshGateway);

  // Tauri v2: the whole `<header>` is a drag region. Children keep working
  // because Tauri checks `event.target` — clicks on an interactive
  // descendant (which lacks the attribute) still fire normally. The
  // previous ghost `<div absolute inset-0 -z-10>` approach was broken on
  // two counts: the parent wasn't `relative` (so `inset-0` anchored to
  // the viewport) and `-z-10` hid it behind the right-hand buttons.
  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-elev-1 px-4 select-none"
    >
      {/* Model picker — jumps to /models for a full edit. */}
      <button
        type="button"
        onClick={() => navigate({ to: '/models' })}
        title={t('topbar.change_model')}
        className={cn(
          'flex h-7 items-center gap-2 rounded px-2 text-sm text-fg-muted',
          'hover:bg-bg-elev-2 hover:text-fg transition-colors duration-fast',
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gold-500" />
        <span className="max-w-[180px] truncate font-mono text-xs">
          {currentModel ?? t('topbar.model_unknown')}
        </span>
      </button>

      {/* Gateway status — click to re-probe. */}
      <button
        type="button"
        onClick={() => void refreshGateway()}
        title={gatewayTooltip(gateway, gatewayLatencyMs, t)}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded px-2 text-xs',
          'border bg-bg-elev-2/50 transition-colors duration-fast',
          gateway === 'online' && 'border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10',
          gateway === 'offline' && 'border-danger/40 text-danger hover:bg-danger/10',
          gateway === 'unknown' && 'border-border text-fg-subtle hover:bg-bg-elev-2',
        )}
      >
        <CircleDot size={12} className={gateway === 'online' ? 'animate-pulse' : undefined} />
        <span>{gatewayLabel(gateway, gatewayLatencyMs, t)}</span>
      </button>

      <div className="flex-1" />

      {/* Palette trigger */}
      <button
        type="button"
        onClick={togglePalette}
        className={cn(
          'flex h-7 items-center gap-2 rounded-md border border-border bg-bg-elev-2 px-2.5',
          'text-xs text-fg-muted hover:border-border-strong hover:text-fg',
          'transition-colors duration-fast',
        )}
        aria-label={t('topbar.open_palette')}
      >
        <Search size={13} />
        <span className="hidden sm:inline">{t('palette.placeholder')}</span>
        <Kbd keys={['mod', 'k']} className="ml-2" />
      </button>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elev-2 hover:text-fg"
        aria-label={t('topbar.toggle_theme')}
        title={t('topbar.toggle_theme')}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </header>
  );
}

// ───────────────────────── Helpers ─────────────────────────

type TFn = (key: string) => string;

function gatewayLabel(g: GatewayHealth, latencyMs: number | null, t: TFn): string {
  if (g === 'online') {
    return latencyMs !== null
      ? `${t('topbar.gateway_connected')} · ${latencyMs}ms`
      : t('topbar.gateway_connected');
  }
  if (g === 'offline') return t('topbar.gateway_disconnected');
  return t('topbar.gateway_unknown');
}

function gatewayTooltip(g: GatewayHealth, latencyMs: number | null, t: TFn): string {
  return `${gatewayLabel(g, latencyMs, t)} — ${t('topbar.gateway_click_to_refresh')}`;
}
