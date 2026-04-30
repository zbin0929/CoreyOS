import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import {
  MessageSquare,
} from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { useChatStore } from '@/stores/chat';

export function StatusBar() {
  const { t } = useTranslation();
  const location = useRouterState({ select: (s) => s.location });
  const currentId = useChatStore((s) => s.currentId);
  const sessions = useChatStore((s) => s.sessions);

  const session = currentId ? sessions[currentId] : null;
  const msgCount = session?.messages.length ?? 0;
  const isChat = location.pathname === '/chat';

  return (
    <footer className="flex h-10 shrink-0 items-center border-t border-border bg-bg-elev-1 px-4 text-[11px] select-none">
      {isChat && session ? (
        <>
          <Icon icon={MessageSquare} size="xs" className="text-fg-subtle" />
          <span className="ml-1.5 max-w-[240px] truncate text-fg">{session.title || t('home.untitled_chat')}</span>
          <Sep />
          <span className="text-fg-subtle">{msgCount} {t('statusbar.messages')}</span>
        </>
      ) : (
        <span className="text-fg-subtle">{pageTitle(location.pathname, t)}</span>
      )}

      <div className="flex-1" />

      <span className="text-fg-subtle">
        <Kbd keys={['mod', 'k']} className="mr-1" />
        {t('statusbar.search')}
      </span>

      <Sep />

      <span className="text-fg-muted">Corey v{__APP_VERSION__}</span>
    </footer>
  );
}

function Sep() {
  return <span className="mx-2 text-border/60">·</span>;
}

function pageTitle(pathname: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    '/': t('nav.home'),
    '/chat': t('nav.chat'),
    '/workflows': t('nav.workflows'),
    '/agents': t('nav.agents'),
    '/models': t('nav.models'),
    '/compare': t('nav.compare'),
    '/analytics': t('nav.analytics'),
    '/terminal': t('nav.terminal'),
    '/logs': t('nav.logs'),
    '/skills': t('nav.skills'),
    '/trajectory': t('nav.trajectory'),
    '/channels': t('nav.channels'),
    '/scheduler': t('nav.scheduler'),
    '/profiles': t('nav.profiles'),
    '/runbooks': t('nav.runbooks'),
    '/budgets': t('nav.budgets'),
    '/memory': t('nav.memory'),
    '/knowledge': t('nav.knowledge'),
    '/voice': t('nav.voice'),
    '/mcp': t('nav.mcp'),
    '/settings': t('nav.settings'),
    '/help': t('nav.help'),
  };
  for (const [prefix, label] of Object.entries(map)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return label;
  }
  return 'CoreyOS';
}
