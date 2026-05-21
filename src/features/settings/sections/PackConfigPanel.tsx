import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, Loader2, Settings2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import {
  packConfigGet,
  packConfigSchema,
  packConfigSet,
  type PackConfigSchema,
  type PackConfigSchemaField,
} from '@/lib/ipc/pack';

interface PackConfigPanelProps {
  packId: string;
  onClose: () => void;
}

function evalShowIf(expr: string, values: Record<string, unknown>): boolean {
  if (!expr) return true;
  const match = expr.match(/^(\w+)\s*(==|!=)\s*(.+)$/);
  if (!match) return true;
  const [, key, op, rawVal] = match;
  if (!key || !op || !rawVal) return true;
  const actual = values[key];
  let expected: unknown = rawVal;
  if (rawVal === 'true') expected = true;
  else if (rawVal === 'false') expected = false;
  else if (/^\d+$/.test(rawVal)) expected = Number(rawVal);
  if (op === '==') return actual === expected;
  if (op === '!=') return actual !== expected;
  return true;
}

function ConfigField({
  field,
  value,
  onChange,
  values,
}: {
  field: PackConfigSchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
  values: Record<string, unknown>;
}) {
  const [showSecret, setShowSecret] = useState(false);

  if (!evalShowIf(field.showIf, values)) return null;

  const renderInput = () => {
    switch (field.type) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm text-fg-muted">{value ? '已启用' : '未启用'}</span>
          </label>
        );
      case 'secret':
        return (
          <div className="relative">
            <Input
              type={showSecret ? 'text' : 'password'}
              value={String(value ?? '')}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder}
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
              onClick={() => setShowSecret(!showSecret)}
            >
              <Icon icon={showSecret ? EyeOff : Eye} size="sm" />
            </button>
          </div>
        );
      case 'enum':
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm"
          >
            <option value="">选择...</option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case 'number':
        return (
          <Input
            type="number"
            value={value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
            placeholder={field.placeholder}
          />
        );
      default:
        return (
          <Input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        );
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-fg">
          {field.label || field.key}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      </div>
      {renderInput()}
      {field.description && (
        <p className="text-xs text-fg-muted">{field.description}</p>
      )}
    </div>
  );
}

export function PackConfigPanel({ packId, onClose }: PackConfigPanelProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schema, setSchema] = useState<PackConfigSchema | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [schemaData, configData] = await Promise.all([
          packConfigSchema(packId),
          packConfigGet(packId),
        ]);
        setSchema(schemaData);
        const defaults: Record<string, unknown> = {};
        for (const f of schemaData.schema) {
          if (f.default !== null && f.default !== undefined) {
            defaults[f.key] = f.default;
          }
        }
        setValues({ ...defaults, ...configData });
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [packId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await packConfigSet(packId, values);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Icon icon={Loader2} size="lg" className="animate-spin text-fg-muted" />
      </div>
    );
  }

  if (!schema || schema.schema.length === 0) {
    return (
      <div className="p-4 text-center text-fg-muted">
        {t('settings.packs.no_config', { defaultValue: '此 Pack 无需配置' })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Icon icon={Settings2} size="md" className="text-gold-500" />
          <h3 className="font-medium text-fg">{schema.packTitle} 配置</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-fg-muted hover:text-fg"
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {schema.schema.map((field) => (
          <ConfigField
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            values={values}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Check} size="sm" />
          )}
          保存
        </Button>
      </div>
    </div>
  );
}
