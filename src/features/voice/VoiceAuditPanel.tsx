import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { voiceAuditLog, type VoiceAuditEntry } from '@/lib/ipc';

import { PROVIDER_LABELS } from './providers';

export function VoiceAuditPanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<VoiceAuditEntry[]>([]);

  useEffect(() => {
    void voiceAuditLog(50).then(setEntries).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon icon={Eye} size="md" className="text-fg-subtle" />
        <h3 className="text-sm font-medium text-fg">{t('voice.audit_title')}</h3>
      </div>
      <p className="text-xs text-fg-subtle">{t('voice.audit_desc')}</p>
      {entries.length === 0 ? (
        <div className="text-sm text-fg-muted py-8 text-center">{t('voice.audit_empty')}</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e, i) => (
            <li
              key={i}
              className={cn(
                'flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs',
                e.success ? 'bg-bg-elev-1' : 'bg-danger/5 border-danger/30',
              )}
            >
              <span className={cn('font-mono', e.success ? 'text-fg' : 'text-danger')}>
                {e.event_type}
              </span>
              <span className="text-fg-subtle">{new Date(e.timestamp * 1000).toLocaleString()}</span>
              <span className="text-fg-subtle">{e.duration_ms}ms</span>
              <span className="text-fg-subtle truncate">{PROVIDER_LABELS[e.provider] ?? e.provider}</span>
              <span className={cn('ml-auto text-[10px]', e.success ? 'text-emerald-500' : 'text-danger')}>
                {e.success ? '✓' : '✗'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
