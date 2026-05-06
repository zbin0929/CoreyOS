import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Info, ArrowRight } from 'lucide-react';

import { Icon } from './icon';

/**
 * Slim banner mounted at the top of every "demoted" route — pages
 * that survive (per N-2) but were pulled from the sidebar in the
 * 2026-05-06 audit. Tells users who landed via direct URL or an old
 * bookmark that the canonical entry now lives in Settings → Advanced.
 *
 * Driven by `DEMOTED_ROUTES` in `nav-config.ts` via a small wrapper
 * (`withDemotedBanner` in `app/routes.tsx`); never embedded by feature
 * pages directly so the visual treatment can evolve in one place.
 */
export function DemotedRouteBanner() {
  const { t } = useTranslation();
  return (
    <div className="border-b border-border/60 bg-bg-elev-2/40 px-4 py-2 text-[11px] text-fg-muted">
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <Icon icon={Info} size={12} className="shrink-0 text-fg-subtle" />
        <span className="flex-1">
          {t('demoted_banner.body', {
            defaultValue:
              '本页已从主侧边栏移除，URL 仍可直达。规范入口：Settings → 高级 / 实验功能。',
          })}
        </span>
        <Link
          to="/settings"
          hash="settings-advanced"
          className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
        >
          {t('demoted_banner.link', { defaultValue: '前往 Settings' })}
          <Icon icon={ArrowRight} size={10} />
        </Link>
      </div>
    </div>
  );
}
