import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { DEMOTED_ROUTES } from '@/app/nav-config';

import { Section } from '../shared';

/**
 * "Advanced" surface for routes that survive (per N-2) but were
 * removed from the sidebar in the 2026-05-06 audit because they
 * were either redundant with another page (e.g. /agents vs
 * Settings → Hermes Instances), low-frequency for B2B users
 * (e.g. /scheduler — workflow page already creates cron triggers),
 * or half-finished placeholders (/voice waits on the v0.4.0 Talk
 * Mode work).
 *
 * Power users / developers can still reach them here or by typing
 * the URL directly. The list is data-driven from `DEMOTED_ROUTES`
 * so future demotions only edit `nav-config.ts`.
 */
export function AdvancedSection() {
  const { t } = useTranslation();
  return (
    <Section
      id="settings-advanced"
      title={
        <span className="flex items-center gap-2">
          <span>{t('settings.advanced.title', { defaultValue: '高级 / 实验功能' })}</span>
          <span className="rounded-full border border-border bg-bg-elev-2 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
            demoted · 2026-05-06
          </span>
        </span>
      }
      description={t('settings.advanced.description', {
        defaultValue:
          '默认隐藏的功能页。多数已被工作流 / 设置内的对应面板替代；保留入口给习惯了它们的老用户。',
      })}
    >
      <ul className="flex flex-col gap-1.5">
        {DEMOTED_ROUTES.map((r) => (
          <li key={r.id}>
            <Link
              to={r.path}
              className="group flex items-center justify-between rounded-lg border border-border/60 bg-bg-elev-1/60 px-3 py-2.5 text-sm text-fg transition hover:border-gold-500/40 hover:bg-bg-elev-2"
            >
              <span className="flex items-center gap-2.5">
                <Icon icon={r.icon} size={14} className="text-fg-subtle" />
                <span>{t(r.labelKey)}</span>
                <code className="rounded bg-bg-elev-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                  {r.path}
                </code>
              </span>
              <Icon
                icon={ArrowRight}
                size={14}
                className="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg"
              />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
