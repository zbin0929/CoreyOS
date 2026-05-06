import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { useDashboard } from '../useDashboard';
import { EmptyHint, WidgetCard } from './shared';

export function RecentChatsWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { recentSessions } = useDashboard();
  return (
    <WidgetCard
      id="recent_chats"
      title={t('home.recent_chats')}
      action={
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void navigate({ to: '/chat' })}
        >
          {t('home.view_all')}
          <Icon icon={ArrowRight} size="xs" />
        </Button>
      }
    >
      {recentSessions.length === 0 ? (
        <EmptyHint icon={MessageSquare} text={t('home.no_chats_yet')} />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {recentSessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: '/chat', search: { session: s.id } })
                }
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-bg-elev-2"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                  <Icon icon={MessageSquare} size="xs" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {s.title || t('home.untitled_chat')}
                </span>
                <span className="text-[11px] text-fg-subtle">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
