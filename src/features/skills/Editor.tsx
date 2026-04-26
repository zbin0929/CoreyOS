import { useTranslation } from 'react-i18next';
import { FileText, History, Loader2, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { MarkdownEditor } from './MarkdownEditor';
import type { Selection } from './helpers';

export function Editor({
  sel,
  saving,
  onChange,
  onSave,
  onDelete,
  onHistory,
}: {
  sel: Extract<Selection, { kind: 'open' }>;
  saving: boolean;
  onChange: (body: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  const dirty = sel.dirty !== sel.loaded.body;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="skills-editor">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon icon={FileText} size="sm" className="text-fg-subtle" />
            <code className="truncate font-mono text-xs text-fg">{sel.path}</code>
            {dirty && (
              <span
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-500"
                data-testid="skills-dirty-badge"
              >
                {t('skills.unsaved')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onHistory}
            disabled={saving}
            data-testid="skills-history"
            title={t('skills.history_title')}
          >
            <Icon icon={History} size="sm" />
            {t('skills.history')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={saving}
            data-testid="skills-delete"
            title={t('skills.delete')}
          >
            <Icon icon={Trash2} size="sm" className="text-danger" />
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onSave}
            disabled={saving || !dirty}
            data-testid="skills-save"
          >
            {saving ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Save} size="sm" />
            )}
            {t('skills.save')}
          </Button>
        </div>
      </header>
      <MarkdownEditor value={sel.dirty} onChange={onChange} onSave={onSave} />
    </div>
  );
}
