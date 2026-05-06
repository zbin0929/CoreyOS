import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Package } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { lucideByName } from '@/lib/lucide-map';
import { usePackStore } from '@/lib/usePackStore';

import { EmptyHint, WidgetCard } from './shared';

/**
 * Aggregator widget for any Pack view that opted into Home by
 * declaring `nav_section: home` in its manifest. Renders a single
 * card listing the views — clicking jumps to `/pack/<packId>/<viewId>`.
 *
 * The widget itself only renders when at least one such view exists,
 * so the catalog can leave it permanently visible without polluting
 * Home for users who haven't installed any home-aware Packs.
 */
export function PackHomeWidgetsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const views = usePackStore((s) => s.views);
  const refresh = usePackStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const homeViews = views.filter((v) => v.navSection === 'home');
  if (homeViews.length === 0) return null;

  return (
    <WidgetCard
      id="pack_home_views"
      title={t('home.widget_pack_views', { defaultValue: 'Pack 首页视图' })}
      action={
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void navigate({ to: '/settings', hash: 'settings-packs' })}
        >
          {t('home.view_all')}
          <Icon icon={ArrowRight} size="xs" />
        </Button>
      }
    >
      {homeViews.length === 0 ? (
        <EmptyHint
          icon={Package}
          text={t('home.widget_pack_views_empty', {
            defaultValue: '尚无 Pack 注册首页视图',
          })}
        />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {homeViews.map((v) => {
            const Ico = lucideByName(v.icon);
            return (
              <li key={`${v.packId}-${v.viewId}`}>
                <button
                  type="button"
                  onClick={() =>
                    void navigate({ to: `/pack/${v.packId}/${v.viewId}` })
                  }
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-bg-elev-2"
                >
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-gold-500/10 text-gold-500">
                    <Icon icon={Ico} size="xs" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {v.title || v.viewId}
                  </span>
                  <span className="text-[10px] text-fg-subtle">
                    {v.packTitle || v.packId}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
