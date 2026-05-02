import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import {
  CalendarClock,
  MessageSquare,
  Plug,
  Sparkles,
} from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { useChatStore } from '@/stores/chat';
import { useSystemStats } from './useSystemStats';

export function StatusBar() {
  const { t } = useTranslation();
  const location = useRouterState({ select: (s) => s.location });
  const currentId = useChatStore((s) => s.currentId);
  const sessions = useChatStore((s) => s.sessions);
  const { mcpCount, cronCount, skillCount } = useSystemStats();

  const session = currentId ? sessions[currentId] : null;
  const msgCount = session?.messages.length ?? 0;
  const isChat = location.pathname === '/chat';

  return (
    <footer className="flex h-7 shrink-0 items-center border-t border-border/40 bg-bg/90 px-4 text-[10px] tabular-nums select-none backdrop-blur-xl">
      {isChat && session ? (
        <>
          <Icon icon={MessageSquare} size="xs" className="text-fg-subtle" />
          <span className="ml-1.5 max-w-[240px] truncate text-fg">{session.title || t('home.untitled_chat')}</span>
          <Sep />
          <span className="text-fg-subtle">{msgCount} {t('home.statusbar_messages')}</span>
        </>
      ) : (
        <span className="text-fg-subtle">{pageTitle(location.pathname, t)}</span>
      )}

      <div className="flex-1" />

      <span className="inline-flex items-center gap-1 text-fg-subtle">
        <Icon icon={Sparkles} size="xs" />{skillCount} {t('statusbar.skills')}
      </span>
      <Sep />
      <span className="inline-flex items-center gap-1 text-fg-subtle">
        <Icon icon={Plug} size="xs" />{mcpCount} MCP
      </span>
      <Sep />
      <span className="inline-flex items-center gap-1 text-fg-subtle">
        <Icon icon={CalendarClock} size="xs" />{cronCount} {t('statusbar.cron')}
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
