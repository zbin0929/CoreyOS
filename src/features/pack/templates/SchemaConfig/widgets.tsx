/**
 * Widget catalog for the v0.3.0 `SchemaConfig` template. Each
 * widget renders one scalar field type. Composite types
 * (`nested` / `array` / `computed`) are handled directly by
 * `SchemaConfig.tsx`.
 *
 * Adding a new widget:
 *   1. Implement a component matching `WidgetComponent`.
 *   2. Register it in `WIDGET_REGISTRY` keyed by the manifest
 *      `type` string.
 *   3. The renderer resolves unknown types to `TextWidget` so a
 *      manifest typo degrades gracefully.
 */
import { useState, type ComponentType } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { Select, type SelectOption } from '@/components/ui/select';
import type { PackConfigSchemaField } from '@/lib/ipc/pack';

import { CronPicker } from '../shared/CronPicker';
import { INPUT_FULL_CLASS } from '../shared/inputStyles';

export interface WidgetProps {
  field: PackConfigSchemaField;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Visual width hint resolved by the renderer. */
  widthClass: string;
  /** Set when validation has flagged this field. */
  hasError: boolean;
}

export type WidgetComponent = ComponentType<WidgetProps>;

function asString(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

export function TextWidget({ field, value, onChange, hasError }: WidgetProps) {
  return (
    <input
      type="text"
      value={asString(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      aria-invalid={hasError || undefined}
      className={INPUT_FULL_CLASS}
    />
  );
}

export function NumberWidget({ field, value, onChange, hasError }: WidgetProps) {
  return (
    <input
      type="number"
      value={asString(value)}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : Number(v));
      }}
      placeholder={field.placeholder}
      aria-invalid={hasError || undefined}
      className={INPUT_FULL_CLASS}
    />
  );
}

export function SecretWidget({ field, value, onChange, hasError }: WidgetProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={asString(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        aria-invalid={hasError || undefined}
        className={`${INPUT_FULL_CLASS} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide value' : 'Show value'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
      >
        <Icon icon={visible ? EyeOff : Eye} size="sm" />
      </button>
    </div>
  );
}

export function SelectWidget({ field, value, onChange }: WidgetProps) {
  const opts: SelectOption[] = (field.options ?? []).map((o) => ({ value: o, label: o }));
  return (
    <Select
      value={asString(value)}
      onChange={(v) => onChange(v)}
      options={opts}
      className="w-full"
    />
  );
}

export function BooleanWidget({ value, onChange }: WidgetProps) {
  return (
    <Select
      value={value === true ? 'true' : value === false ? 'false' : ''}
      onChange={(v) => onChange(v === '' ? undefined : v === 'true')}
      options={[
        { value: '', label: '--' },
        { value: 'true', label: '是' },
        { value: 'false', label: '否' },
      ]}
      className="w-full"
    />
  );
}

export function TimeWidget({ value, onChange, hasError }: WidgetProps) {
  return (
    <input
      type="time"
      value={asString(value)}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={hasError || undefined}
      className={INPUT_FULL_CLASS}
    />
  );
}

export function CronWidget({ value, onChange }: WidgetProps) {
  return <CronPicker value={asString(value)} onChange={(c) => onChange(c)} />;
}

/** Tag input — comma-separated. Stored as `string[]`. */
export function TagWidget({ field, value, onChange, hasError }: WidgetProps) {
  const arr = Array.isArray(value) ? (value as unknown[]).map(String) : [];
  const [draft, setDraft] = useState(arr.join(', '));
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        onChange(next);
      }}
      placeholder={field.placeholder || '逗号分隔，如 a, b, c'}
      aria-invalid={hasError || undefined}
      className={INPUT_FULL_CLASS}
    />
  );
}

/**
 * Registry mapping manifest `type` strings to widget components.
 * Unknown types fall back to `TextWidget`.
 */
export const WIDGET_REGISTRY: Record<string, WidgetComponent> = {
  text: TextWidget,
  string: TextWidget,
  url: TextWidget,
  number: NumberWidget,
  secret: SecretWidget,
  enum: SelectWidget,
  select: SelectWidget,
  bool: BooleanWidget,
  boolean: BooleanWidget,
  time: TimeWidget,
  cron: CronWidget,
  tag: TagWidget,
};

export function resolveWidget(type: string): WidgetComponent {
  return WIDGET_REGISTRY[type] ?? TextWidget;
}
