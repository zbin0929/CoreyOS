import { type ReactNode, useState } from 'react';
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

function UpdateBanner() {
  const { t } = useTranslation();
  const { state, downloadAndInstall } = useAppUpdater();
  const [downloading, setDownloading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (state.kind === 'error') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-red-500/30 bg-bg-elev-1 px-4 py-3 shadow-lg">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
        <span className="text-sm text-red-400">{t('updater.error')}</span>
        <button onClick={() => setDismissed(true)} className="ml-2 text-fg-subtle hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
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
        {downloading && (
          <span className="text-[10px] text-fg-subtle">{t('updater.downloading')}</span>
        )}
      </div>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          setDownloading(true);
          void downloadAndInstall();
        }}
        disabled={downloading}
      >
        {downloading ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        {downloading ? t('updater.downloading') : t('updater.install')}
      </Button>
    </div>
  );
}
