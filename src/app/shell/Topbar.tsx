import { useTranslation } from 'react-i18next';
import { Sun, Moon, Search, CircleDot } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { usePaletteStore } from '@/stores/palette';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

export function Topbar() {
  const { t } = useTranslation();
  const togglePalette = usePaletteStore((s) => s.toggle);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-elev-1 px-4 select-none"
    >
      {/* Profile picker (stub) */}
      <button
        type="button"
        className={cn(
          'flex h-7 items-center gap-2 rounded px-2 text-sm text-fg-muted',
          'hover:bg-bg-elev-2 hover:text-fg transition-colors duration-fast',
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-fg-subtle" />
        <span>default</span>
      </button>

      {/* Gateway status */}
      <div
        className={cn(
          'flex h-7 items-center gap-1.5 rounded px-2 text-xs text-fg-muted',
          'border border-border bg-bg-elev-2/50',
        )}
        title={t('topbar.gateway_unknown')}
      >
        <CircleDot size={12} className="text-fg-subtle" />
        <span className="text-fg-subtle">{t('topbar.gateway_unknown')}</span>
      </div>

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
