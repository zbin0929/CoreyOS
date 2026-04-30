import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { useUIStore, type Theme } from '@/stores/ui';
import { supportedLngs, type Lang } from '@/lib/i18n';
import { Section, Field } from './shared';

export function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const resolvedLang = i18n.language?.split('-')[0] ?? 'zh';
  const currentLang: Lang = (supportedLngs as readonly string[]).includes(resolvedLang)
    ? (resolvedLang as Lang)
    : 'zh';

  const themes: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: 'dark', label: t('settings.appearance.theme_dark'), icon: Moon },
    { value: 'light', label: t('settings.appearance.theme_light'), icon: Sun },
    { value: 'system', label: t('settings.appearance.theme_system'), icon: Monitor },
  ];

  return (
    <Section
      id="settings-appearance"
      title={t('settings.appearance.title')}
      description={t('settings.appearance.desc')}
    >
      <Field label={t('settings.appearance.theme')}>
        <div
          role="radiogroup"
          aria-label={t('settings.appearance.theme')}
          className="inline-flex rounded-md border border-border bg-bg-elev-1 p-0.5"
        >
          {themes.map(({ value, label, icon: IconCmp }) => {
            const active = theme === value;
            return (
              <button
                type="button"
                key={value}
                role="radio"
                aria-checked={active}
                data-testid={`settings-theme-${value}`}
                onClick={() => setTheme(value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition',
                  active
                    ? 'bg-gold-500/20 text-fg'
                    : 'text-fg-subtle hover:bg-bg-elev-2 hover:text-fg',
                )}
              >
                <Icon icon={IconCmp} size="sm" />
                {label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t('settings.appearance.language')}>
        <div className="max-w-[200px]">
          <Select<Lang>
            value={currentLang}
            onChange={(v) => void i18n.changeLanguage(v)}
            data-testid="settings-lang"
            ariaLabel={t('settings.appearance.language')}
            options={[
              { value: 'en', label: t('settings.appearance.lang_en') },
              { value: 'zh', label: t('settings.appearance.lang_zh') },
            ]}
          />
        </div>
      </Field>
    </Section>
  );
}
