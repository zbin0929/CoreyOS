import { type ReactNode, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, X, AlertCircle } from 'lucide-react';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from '@/components/command-palette/Palette';
import { ShortcutsDialog } from '@/components/shortcuts/ShortcutsDialog';
import { useShortcutsHotkey } from '@/components/shortcuts/useShortcuts';
import { Button } from '@/components/ui/button';
import { useMenuEvents } from '../useMenuEvents';
import { useNavShortcuts } from '../useNavShortcuts';
import { useAppUpdater } from '@/lib/useAppUpdater';

export function AppShell({ children }: { children: ReactNode }) {
  useNavShortcuts();
  useShortcutsHotkey();
  useMenuEvents();
  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-fg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
      <UpdateBanner />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UpdateBanner() {
  const { t } = useTranslation();
  const { state, downloadAndInstall } = useAppUpdater();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state.kind === 'error' && !dismissed) {
      const timer = setTimeout(() => setDismissed(true), 8000);
      return () => clearTimeout(timer);
    }
  }, [state.kind, dismissed]);

  if (dismissed) return null;

  if (state.kind === 'error') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-red-500/30 bg-bg-elev-1 px-4 py-3 shadow-lg max-w-sm">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm text-red-400">{t('updater.error')}</span>
          {state.message && (
            <span className="text-[10px] text-red-400/60 truncate">{state.message}</span>
          )}
        </div>
        <button onClick={() => setDismissed(true)} className="ml-2 shrink-0 text-fg-subtle hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (state.kind === 'downloading') {
    const pct = state.total > 0 ? Math.round((state.progress / state.total) * 100) : 0;
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-gold-500/30 bg-bg-elev-1 px-4 py-3 shadow-lg min-w-[240px]">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-gold-500" />
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg">{t('updater.downloading')}</span>
            <span className="text-[10px] text-fg-subtle">
              {state.total > 0 ? `${formatBytes(state.progress)} / ${formatBytes(state.total)}` : formatBytes(state.progress)}
            </span>
          </div>
          {state.total > 0 && (
            <div className="h-1 w-full rounded-full bg-bg-elev-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-gold-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (state.kind === 'downloaded') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-gold-500/30 bg-bg-elev-1 px-4 py-3 shadow-lg">
        <span className="text-sm font-medium text-fg">
          {t('updater.downloaded', { version: state.version })}
        </span>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void downloadAndInstall()}
        >
          <RefreshCw className="h-3 w-3" />
          {t('updater.relaunch')}
        </Button>
      </div>
    );
  }

  if (state.kind !== 'available') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-gold-500/30 bg-bg-elev-1 px-4 py-3 shadow-lg">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">
          {t('updater.available', { version: state.version })}
        </span>
      </div>
      <Button
        size="sm"
        variant="primary"
        onClick={() => void downloadAndInstall()}
      >
        <Download className="h-3 w-3" />
        {t('updater.install')}
      </Button>
    </div>
  );
}
