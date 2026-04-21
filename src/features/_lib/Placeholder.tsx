import { type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/app/shell/PageHeader';
import { EmptyState } from '@/components/ui/empty-state';

export interface PlaceholderProps {
  titleKey: string;
  subtitleKey?: string;
  emptyTitleKey: string;
  emptyDescKey: string;
  icon: LucideIcon;
  phase: number;
}

export function Placeholder({
  titleKey,
  subtitleKey,
  emptyTitleKey,
  emptyDescKey,
  icon,
  phase,
}: PlaceholderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t(titleKey)}
        subtitle={subtitleKey ? t(subtitleKey) : undefined}
        actions={
          <span className="rounded-full border border-border bg-bg-elev-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
            {t('common.phase', { n: phase })}
          </span>
        }
      />
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={icon}
          title={t(emptyTitleKey)}
          description={t(emptyDescKey)}
          className="max-w-lg"
        />
      </div>
    </div>
  );
}
