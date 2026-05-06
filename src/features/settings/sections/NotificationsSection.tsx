import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import {
  useNotificationPrefs,
  type NotificationLevel,
} from '@/stores/notificationPrefs';

import { Section } from '../shared';

/**
 * **B-9.2 follow-up — desktop notification level toggle.**
 *
 * Maps user choice → which `workflow:run-finished` events fire a
 * native desktop notification:
 *
 *   - `all`      → every Completed / Failed / Cancelled
 *   - `failure`  → only Failed (most users running cron-driven runs)
 *   - `off`      → nothing
 *
 * Lives next to Webhook in Settings because both are "external
 * surface" preferences. Persisted via zustand `persist`; takes
 * effect on the very next finished run with no reload.
 */
export function NotificationsSection() {
  const { t } = useTranslation();
  const level = useNotificationPrefs((s) => s.level);
  const setLevel = useNotificationPrefs((s) => s.setLevel);

  const options: { value: NotificationLevel; labelKey: string; defaultValue: string }[] = [
    {
      value: 'all',
      labelKey: 'settings.notifications.all',
      defaultValue: '全部（完成 / 失败 / 取消）',
    },
    {
      value: 'failure',
      labelKey: 'settings.notifications.failure',
      defaultValue: '只在失败时',
    },
    {
      value: 'off',
      labelKey: 'settings.notifications.off',
      defaultValue: '关闭',
    },
  ];

  return (
    <Section
      id="settings-notifications"
      title={
        <span className="flex items-center gap-2">
          <Icon icon={Bell} size={16} className="text-fg-muted" />
          <span>{t('settings.notifications.title', { defaultValue: '桌面通知' })}</span>
        </span>
      }
      description={t('settings.notifications.description', {
        defaultValue:
          '工作流跑完后是否弹原生通知。Tray 上的运行计数不受影响，始终实时刷新。',
      })}
    >
      <div
        role="radiogroup"
        aria-label={t('settings.notifications.title', { defaultValue: '桌面通知' })}
        className="flex flex-col gap-2"
      >
        {options.map((opt) => {
          const checked = level === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                checked
                  ? 'border-gold-500/40 bg-gold-500/5 text-fg'
                  : 'border-border bg-bg-elev-1/60 text-fg-muted hover:bg-bg-elev-2'
              }`}
            >
              <input
                type="radio"
                name="notification-level"
                value={opt.value}
                checked={checked}
                onChange={() => setLevel(opt.value)}
                className="accent-gold-500"
                data-testid={`notification-level-${opt.value}`}
              />
              <span>{t(opt.labelKey, { defaultValue: opt.defaultValue })}</span>
            </label>
          );
        })}
      </div>
    </Section>
  );
}
