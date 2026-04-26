import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { DbSessionWithMessages } from '@/lib/ipc';

import { formatDate } from './helpers';

export function SessionPicker({
  sessions,
  value,
  onChange,
}: {
  sessions: DbSessionWithMessages[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = sessions.find((s) => s.id === value) ?? null;
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((s) => !s)}
        data-testid="trajectory-session-picker"
      >
        <span className="max-w-[220px] truncate">
          {selected ? selected.title : t('trajectory.pick_session')}
        </span>
        <Icon icon={ChevronDown} size="xs" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-md border border-border bg-bg-elev-2 shadow-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onChange(s.id);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs text-fg hover:bg-bg-elev-3"
              data-testid={`trajectory-session-option-${s.id}`}
            >
              <span className="truncate text-sm text-fg">{s.title}</span>
              <span className="text-[10px] text-fg-subtle">
                {formatDate(s.updated_at)} · {s.messages.length} msg
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
