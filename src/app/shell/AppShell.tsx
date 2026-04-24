import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from '@/components/command-palette/Palette';
import { ShortcutsDialog } from '@/components/shortcuts/ShortcutsDialog';
import { useShortcutsHotkey } from '@/components/shortcuts/useShortcuts';
import { useMenuEvents } from '../useMenuEvents';
import { useNavShortcuts } from '../useNavShortcuts';

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
    </div>
  );
}
