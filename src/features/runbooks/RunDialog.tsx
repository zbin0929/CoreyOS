import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { RunbookRow } from '@/lib/ipc';

import { detectParams, renderRunbook } from './utils';

export function RunDialog({
  runbook,
  onCancel,
  onLaunch,
}: {
  runbook: RunbookRow;
  onCancel: () => void;
  onLaunch: (rendered: string) => void;
}) {
  const { t } = useTranslation();
  const params = useMemo(() => detectParams(runbook.template), [runbook.template]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p, ''])),
  );
  const allFilled = params.every((p) => (values[p] ?? '').trim().length > 0);

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="runbook-run-dialog"
    >
      <div>
        <h2 className="text-sm font-medium text-fg">{runbook.name}</h2>
        {runbook.description && (
          <p className="text-xs text-fg-muted">{runbook.description}</p>
        )}
      </div>

      {params.length === 0 ? (
        <div className="text-xs text-fg-subtle">{t('runbooks.no_params_to_fill')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {params.map((p) => (
            <label key={p} className="flex flex-col gap-1 text-xs">
              <span className="font-mono text-fg">{`{{${p}}}`}</span>
              <textarea
                value={values[p] ?? ''}
                onChange={(e) => setValues((s) => ({ ...s, [p]: e.target.value }))}
                rows={2}
                className={cn(
                  'resize-y rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-xs text-fg',
                  'focus:border-gold-500/40 focus:outline-none',
                )}
                data-testid={`runbook-param-${p}`}
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <Icon icon={X} size="sm" />
          {t('runbooks.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={params.length > 0 && !allFilled}
          onClick={() => onLaunch(renderRunbook(runbook.template, values))}
          data-testid="runbook-launch"
        >
          <Icon icon={Play} size="sm" />
          {t('runbooks.launch')}
        </Button>
      </div>
    </div>
  );
}
