import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, ToggleLeft, ToggleRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { usePackStore } from '@/lib/usePackStore';

import { Section } from '../shared';

export function PacksSection() {
  const { t } = useTranslation();
  const packs = usePackStore((s) => s.packs);
  const loading = usePackStore((s) => s.loading);
  const error = usePackStore((s) => s.error);
  const refresh = usePackStore((s) => s.refresh);
  const setEnabled = usePackStore((s) => s.setEnabled);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Section
      id="settings-packs"
      title={t('settings.packs.title')}
      description={t('settings.packs.desc')}
    >
      <div className="rounded-md border border-border bg-bg-elev-1 p-3 text-xs">
        {loading && (
          <span className="text-fg-muted">{t('settings.packs.loading')}</span>
        )}

        {error && (
          <div className="text-red-500">{error}</div>
        )}

        {!loading && !error && packs.length === 0 && (
          <span className="text-fg-muted">{t('settings.packs.empty')}</span>
        )}

        {!loading && packs.length > 0 && (
          <ul className="flex flex-col gap-2">
            {packs.map((p) => (
              <li
                key={p.manifestId}
                className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-2 px-3 py-2"
              >
                <Icon icon={Package} size="sm" className="text-fg-subtle shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg">
                      {p.title || p.manifestId}
                    </span>
                    <span className="shrink-0 text-fg-subtle">v{p.version}</span>
                    {p.author && (
                      <span className="shrink-0 text-fg-subtle">· {p.author}</span>
                    )}
                  </div>
                  {p.description && (
                    <div className="mt-0.5 truncate text-fg-subtle">{p.description}</div>
                  )}
                  {p.error && (
                    <div className="mt-1 text-red-500">{p.error}</div>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(p.error)}
                  onClick={() => void setEnabled(p.manifestId, !p.enabled)}
                  title={p.enabled ? t('settings.packs.disable') : t('settings.packs.enable')}
                >
                  <Icon
                    icon={p.enabled ? ToggleRight : ToggleLeft}
                    size="sm"
                    className={p.enabled ? 'text-emerald-500' : 'text-fg-subtle'}
                  />
                  {p.enabled ? t('settings.packs.on') : t('settings.packs.off')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
