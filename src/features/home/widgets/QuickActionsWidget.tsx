import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { FlaskConical, Globe, Play, Settings } from 'lucide-react';

import { SideAction, WidgetCard } from './shared';

export function QuickActionsWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <WidgetCard id="quick_actions" title={t('home.action_title')}>
      <div className="flex flex-col gap-1">
        <SideAction
          icon={Play}
          label={t('home.action_new_chat')}
          color="blue"
          onClick={() => void navigate({ to: '/chat' })}
        />
        <SideAction
          icon={FlaskConical}
          label={t('home.action_run_skill')}
          color="purple"
          onClick={() => void navigate({ to: '/skills' })}
        />
        <SideAction
          icon={Globe}
          label={t('home.action_mcp')}
          color="emerald"
          onClick={() => void navigate({ to: '/mcp' })}
        />
        <SideAction
          icon={Settings}
          label={t('home.action_settings')}
          color="gray"
          onClick={() => void navigate({ to: '/settings' })}
        />
      </div>
    </WidgetCard>
  );
}
