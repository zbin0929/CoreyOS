import { useTranslation } from 'react-i18next';

import type { ChannelFieldKind } from '@/lib/ipc';

import type { FieldValue } from './channelFormHelpers';

/** One row of the channel form's YAML-fields block. The kind decides
 *  the input shape (checkbox / textarea-as-list / text). Kept as a
 *  stand-alone component so `ChannelForm` doesn't need three branching
 *  blocks inline.
 */
export function YamlFieldInput({
  kind,
  labelKey,
  path,
  channelId,
  value,
  onChange,
}: {
  kind: ChannelFieldKind;
  labelKey: string;
  path: string;
  channelId: string;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  const { t } = useTranslation();
  const testId = `channel-yaml-input-${channelId}-${path}`;
  const label = t(labelKey);

  if (kind === 'bool') {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-fg">{label}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={testId}
          className="h-4 w-4 accent-accent"
        />
      </label>
    );
  }

  if (kind === 'string_list') {
    const asText = Array.isArray(value) ? value.join('\n') : '';
    return (
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="text-fg">{label}</span>
        <textarea
          value={asText}
          onChange={(e) =>
            onChange(
              e.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
            )
          }
          rows={3}
          placeholder={t('channels.list_placeholder')}
          className="rounded border border-border bg-bg-elev-1 px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          data-testid={testId}
        />
      </label>
    );
  }

  // string
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <span className="text-fg">{label}</span>
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-bg-elev-1 px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
        data-testid={testId}
      />
    </label>
  );
}
