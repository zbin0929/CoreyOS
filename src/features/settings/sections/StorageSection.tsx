import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import type { AppPaths } from '@/lib/ipc';

import { Section } from '../shared';

/**
 * Read-only display of the on-disk locations Corey writes to. Lives
 * at the bottom of Settings — least-frequently-needed but useful for
 * backup / debugging. The container hides itself if the IPC fails
 * (see `SettingsRoute`).
 */
export function StorageSection({ paths }: { paths: AppPaths }) {
  const { t } = useTranslation();
  const rows: Array<{ key: keyof AppPaths; label: string }> = [
    { key: 'config_dir', label: t('settings.storage.config_dir') },
    { key: 'data_dir', label: t('settings.storage.data_dir') },
    { key: 'db_path', label: t('settings.storage.db_path') },
    { key: 'changelog_path', label: t('settings.storage.changelog_path') },
  ];

  return (
    <Section
      id="settings-storage"
      title={t('settings.storage.title')}
      description={t('settings.storage.desc')}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <PathRow key={row.key} label={row.label} value={paths[row.key]} />
        ))}
      </ul>
    </Section>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard access can fail under strict permissions — silently
         ignore. Users can still select + copy the path manually. */
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs">
      <span className="min-w-[110px] flex-none text-fg-subtle">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-fg" title={value}>
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex flex-none items-center gap-1 rounded p-1 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
        aria-label={t('settings.storage.copy')}
      >
        {copied ? (
          <>
            <Icon icon={Check} size="sm" className="text-emerald-500" />
            <span className="text-emerald-500">{t('settings.storage.copied')}</span>
          </>
        ) : (
          <>
            <Icon icon={Copy} size="sm" />
            <span>{t('settings.storage.copy')}</span>
          </>
        )}
      </button>
    </li>
  );
}
