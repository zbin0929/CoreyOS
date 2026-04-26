import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

export function NewSkillPrompt({
  name,
  onChange,
  onCancel,
  onCreate,
}: {
  name: string;
  onChange: (name: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate();
      }}
      className="m-auto flex w-full max-w-md flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="skills-new-form"
    >
      <h2 className="text-sm font-medium text-fg">{t('skills.new')}</h2>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">{t('skills.field.path')}</span>
        <input
          value={name}
          onChange={(e) => onChange(e.target.value)}
          placeholder="daily-standup.md"
          autoFocus
          className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 font-mono text-sm text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="skills-new-name"
        />
        <span className="text-[10px] text-fg-subtle">
          {t('skills.field.path_hint')}
        </span>
      </label>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          {t('skills.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={!name.trim()}
          data-testid="skills-new-create"
        >
          <Icon icon={Check} size="sm" />
          {t('skills.create')}
        </Button>
      </div>
    </form>
  );
}
