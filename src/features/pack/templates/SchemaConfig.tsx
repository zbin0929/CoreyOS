/**
 * SchemaConfig — generic schema-driven Pack configuration form
 * (v0.3.0). Renders the recursive `PackConfigSchemaField` tree
 * using widgets from `SchemaConfig/widgets.tsx`. Backwards
 * compatible with flat schemas — a field whose `type` isn't
 * `nested` / `array` / `computed` lands in `WIDGET_REGISTRY` and
 * renders the same as the legacy `PackConfig` template did.
 *
 * The renderer's three composite primitives:
 *
 *   - `nested`   — `field.fields[]` rendered recursively under a
 *                  bordered card with the parent label as caption.
 *   - `array`    — `field.item[]` rendered per row, with add /
 *                  remove buttons honoring `minItems` / `maxItems`.
 *   - `computed` — read-only preview line whose text comes from
 *                  `fillTemplate(field.preview, scopedCtx)`.
 *
 * Visibility is gated by `field.showIf` evaluated against the
 * current sibling scope. See `expr.ts` for the grammar.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  packConfigGet,
  packConfigSchema,
  packConfigSet,
  packNamedConfigGet,
  packNamedConfigSet,
  type PackConfigSchemaField,
  type PackView,
} from '@/lib/ipc/pack';

import {
  ARRAY_ITEM_CARD_CLASS,
  ARRAY_ITEM_DELETE_BTN_CLASS,
  FIELD_HELP_CLASS,
  FIELD_LABEL_CLASS,
  SECTION_CARD_CLASS,
} from './shared/inputStyles';
import { evalShowIf, fillTemplate, resolvePath, type Ctx } from './SchemaConfig/expr';
import { resolveWidget } from './SchemaConfig/widgets';

type Status = 'idle' | 'saving' | 'saved' | 'error';

function widthClass(width: string): string {
  switch (width) {
    case 'small':
      return 'w-32';
    case 'half':
      return 'w-1/2';
    case 'full':
    default:
      return 'w-full';
  }
}

function getAt(obj: Ctx, path: string): unknown {
  if (!path) return obj;
  return resolvePath(obj, path);
}

function setAt(obj: Ctx, path: string, value: unknown): Ctx {
  if (!path) return (value as Ctx) ?? {};
  const parts = path.split('.');
  const next = JSON.parse(JSON.stringify(obj)) as Ctx;
  let cur: Ctx = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!k) continue;
    const child = cur[k];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      cur[k] = {};
    }
    cur = cur[k] as Ctx;
  }
  const last = parts[parts.length - 1];
  if (last !== undefined) cur[last] = value;
  return next;
}

function defaultForField(field: PackConfigSchemaField): unknown {
  switch (field.type) {
    case 'array':
      return [];
    case 'record':
      return {};
    case 'nested': {
      const out: Ctx = {};
      for (const f of field.fields) out[f.key] = defaultForField(f);
      return out;
    }
    case 'number':
      return undefined;
    case 'bool':
    case 'boolean':
      return false;
    default:
      return field.default ?? '';
  }
}

interface FieldNodeProps {
  field: PackConfigSchemaField;
  scope: Ctx;
  onScopeChange: (next: Ctx) => void;
  errors: Record<string, string>;
}

function FieldNode({ field, scope, onScopeChange, errors }: FieldNodeProps) {
  if (field.showIf && !evalShowIf(field.showIf, scope)) return null;

  if (field.type === 'computed') {
    return (
      <div className="space-y-1">
        {field.label && <div className={FIELD_LABEL_CLASS}>{field.label}</div>}
        <div className="rounded-md border border-dashed border-border/60 bg-bg-elev-1/40 px-3 py-2 text-xs text-fg-subtle">
          {fillTemplate(field.preview, scope) || '—'}
        </div>
        {field.help && <div className={FIELD_HELP_CLASS}>{field.help}</div>}
      </div>
    );
  }

  if (field.type === 'nested') {
    const sub = (getAt(scope, field.key) as Ctx) ?? {};
    return (
      <div className={SECTION_CARD_CLASS}>
        {field.label && (
          <div className="text-sm font-medium text-fg">{field.label}</div>
        )}
        {field.description && (
          <div className="text-xs text-fg-subtle">{field.description}</div>
        )}
        <div className="space-y-3">
          {field.fields.map((child) => (
            <FieldNode
              key={child.key}
              field={child}
              scope={sub}
              onScopeChange={(nextSub) =>
                onScopeChange(setAt(scope, field.key, nextSub))
              }
              errors={errors}
            />
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'record') {
    const dict = (getAt(scope, field.key) as Record<string, unknown>) ?? {};
    const entries = Object.entries(dict);
    const min = field.minItems || 0;
    const max = field.maxItems || 0;
    const canRemove = entries.length > min;
    const canAdd = max === 0 || entries.length < max;
    const updateDict = (next: Record<string, unknown>) =>
      onScopeChange(setAt(scope, field.key, next));
    const entryDefault = (): Ctx => {
      const out: Ctx = {};
      for (const f of field.fields) out[f.key] = defaultForField(f);
      return out;
    };
    const handleAdd = () => {
      const keyLabel = field.keyLabel || '键';
      const raw = window.prompt(`${field.label || field.key} — ${keyLabel}`, '');
      if (raw === null) return;
      const k = raw.trim();
      if (!k) return;
      if (k in dict) {
        window.alert(`键 "${k}" 已存在`);
        return;
      }
      updateDict({ ...dict, [k]: entryDefault() });
    };
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          {field.label && <div className={FIELD_LABEL_CLASS}>{field.label}</div>}
          {canAdd && (
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-bg-elev-1 px-2 py-1 text-xs text-fg hover:border-border"
            >
              <Icon icon={Plus} size="xs" />
              {field.addLabel || '添加'}
            </button>
          )}
        </div>
        {field.description && (
          <div className="text-xs text-fg-subtle">{field.description}</div>
        )}
        {entries.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 bg-bg-elev-1/30 p-3 text-xs text-fg-subtle">
            （空,点击右上角添加一项）
          </div>
        )}
        {entries.map(([k, entry]) => {
          const entryCtx = (entry && typeof entry === 'object' ? entry : {}) as Ctx;
          return (
            <div key={k} className={ARRAY_ITEM_CARD_CLASS}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                  <div className="text-sm font-medium text-fg">{k}</div>
                  {field.fields.map((child) => (
                    <FieldNode
                      key={child.key}
                      field={child}
                      scope={entryCtx}
                      onScopeChange={(nextEntry) => {
                        updateDict({ ...dict, [k]: nextEntry });
                      }}
                      errors={errors}
                    />
                  ))}
                </div>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...dict };
                      delete next[k];
                      updateDict(next);
                    }}
                    aria-label="删除"
                    className={ARRAY_ITEM_DELETE_BTN_CLASS}
                  >
                    <Icon icon={Trash2} size="xs" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (field.type === 'array') {
    const list = (getAt(scope, field.key) as unknown[]) ?? [];
    const min = field.minItems || 0;
    const max = field.maxItems || 0;
    const canRemove = list.length > min;
    const canAdd = max === 0 || list.length < max;
    const updateList = (next: unknown[]) =>
      onScopeChange(setAt(scope, field.key, next));

    const itemDefault = (): Ctx => {
      const out: Ctx = {};
      for (const f of field.item) out[f.key] = defaultForField(f);
      return out;
    };

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          {field.label && <div className={FIELD_LABEL_CLASS}>{field.label}</div>}
          {canAdd && (
            <button
              type="button"
              onClick={() => updateList([...list, itemDefault()])}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-bg-elev-1 px-2 py-1 text-xs text-fg hover:border-border"
            >
              <Icon icon={Plus} size="xs" />
              {field.addLabel || '添加'}
            </button>
          )}
        </div>
        {field.description && (
          <div className="text-xs text-fg-subtle">{field.description}</div>
        )}
        {list.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 bg-bg-elev-1/30 p-3 text-xs text-fg-subtle">
            （空，点击右上角添加一项）
          </div>
        )}
        {list.map((entry, idx) => {
          const entryCtx = (entry && typeof entry === 'object' ? entry : {}) as Ctx;
          return (
            <div key={idx} className={ARRAY_ITEM_CARD_CLASS}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                  {field.item.map((child) => (
                    <FieldNode
                      key={child.key}
                      field={child}
                      scope={entryCtx}
                      onScopeChange={(nextEntry) => {
                        const next = list.slice();
                        next[idx] = nextEntry;
                        updateList(next);
                      }}
                      errors={errors}
                    />
                  ))}
                </div>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => updateList(list.filter((_, i) => i !== idx))}
                    aria-label="删除"
                    className={ARRAY_ITEM_DELETE_BTN_CLASS}
                  >
                    <Icon icon={Trash2} size="xs" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // scalar
  const Widget = resolveWidget(field.type);
  const value = getAt(scope, field.key);
  const fullKey = field.key; // diagnostic only — errors are flat-keyed by callers
  const error = errors[fullKey];

  return (
    <div className={cn('space-y-1', widthClass(field.width))}>
      {field.label && (
        <label className={FIELD_LABEL_CLASS}>
          {field.label}
          {field.required && <span className="ml-1 text-danger">*</span>}
        </label>
      )}
      <Widget
        field={field}
        value={value}
        onChange={(next) => onScopeChange(setAt(scope, field.key, next))}
        widthClass={widthClass(field.width)}
        hasError={Boolean(error)}
      />
      {error && (
        <div className="flex items-center gap-1 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" />
          {error}
        </div>
      )}
      {!error && field.help && <div className={FIELD_HELP_CLASS}>{field.help}</div>}
    </div>
  );
}

function validateField(
  field: PackConfigSchemaField,
  scope: Ctx,
  errors: Record<string, string>,
  prefix = '',
): void {
  const fullKey = prefix + field.key;
  if (field.showIf && !evalShowIf(field.showIf, scope)) return;

  if (field.type === 'nested') {
    const sub = (getAt(scope, field.key) as Ctx) ?? {};
    for (const child of field.fields) {
      validateField(child, sub, errors, `${fullKey}.`);
    }
    return;
  }
  if (field.type === 'array') {
    const list = (getAt(scope, field.key) as unknown[]) ?? [];
    if (field.minItems > 0 && list.length < field.minItems) {
      errors[fullKey] = `至少 ${field.minItems} 项`;
    }
    list.forEach((entry, idx) => {
      const entryCtx = (entry && typeof entry === 'object' ? entry : {}) as Ctx;
      for (const child of field.item) {
        validateField(child, entryCtx, errors, `${fullKey}[${idx}].`);
      }
    });
    return;
  }
  if (field.type === 'record') {
    const dict = (getAt(scope, field.key) as Record<string, unknown>) ?? {};
    const entries = Object.entries(dict);
    if (field.minItems > 0 && entries.length < field.minItems) {
      errors[fullKey] = `至少 ${field.minItems} 项`;
    }
    for (const [k, entry] of entries) {
      const entryCtx = (entry && typeof entry === 'object' ? entry : {}) as Ctx;
      for (const child of field.fields) {
        validateField(child, entryCtx, errors, `${fullKey}[${k}].`);
      }
    }
    return;
  }
  if (field.type === 'computed') return;

  const value = getAt(scope, field.key);
  if (field.required && (value === undefined || value === null || value === '')) {
    errors[fullKey] = `${field.label || field.key} 必填`;
  }
}

/**
 * Coerce a raw `PackConfigSchemaField`-shaped value (parsed from
 * the manifest's per-view `schema:` option) into the recursive TS
 * type expected by `<FieldNode>`. Manifest YAML uses snake_case
 * (`show_if`, `min_items`, ...) but the TS interface mirrors the
 * Rust IPC DTO which is already camelCase. We accept either casing
 * so a Pack author can write whichever feels natural.
 */
function coerceSchema(raw: unknown): PackConfigSchemaField[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceField);
}

function coerceField(v: unknown): PackConfigSchemaField {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  function pick<T>(camel: string, snake: string, fallback: T): T {
    if (camel in r && r[camel] !== undefined) return r[camel] as T;
    if (snake in r && r[snake] !== undefined) return r[snake] as T;
    return fallback;
  }
  return {
    key: typeof r.key === 'string' ? r.key : '',
    label: typeof r.label === 'string' ? r.label : '',
    type: typeof r.type === 'string' ? r.type : 'text',
    required: Boolean(r.required),
    secret: Boolean(r.secret) || r.type === 'secret',
    description: typeof r.description === 'string' ? r.description : '',
    help: typeof r.help === 'string' ? r.help : '',
    group: typeof r.group === 'string' ? r.group : '',
    validation: typeof r.validation === 'string' ? r.validation : '',
    placeholder: typeof r.placeholder === 'string' ? r.placeholder : '',
    default: r.default,
    options: Array.isArray(r.options) ? (r.options as string[]) : [],
    fields: coerceSchema(r.fields),
    item: coerceSchema(r.item),
    showIf: pick<string>('showIf', 'show_if', ''),
    preview: typeof r.preview === 'string' ? r.preview : '',
    minItems: Number(pick<number>('minItems', 'min_items', 0)) || 0,
    maxItems: Number(pick<number>('maxItems', 'max_items', 0)) || 0,
    addLabel: pick<string>('addLabel', 'add_label', ''),
    width: typeof r.width === 'string' ? r.width : '',
    keyLabel: pick<string>('keyLabel', 'key_label', ''),
  };
}

export function SchemaConfigTemplate({ view }: { view: PackView }) {
  const [schema, setSchema] = useState<PackConfigSchemaField[]>([]);
  const [config, setConfig] = useState<Ctx>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [loading, setLoading] = useState(true);

  // v0.3.0 per-view schema — when `view.options.schema` is set the
  // template uses an inline manifest schema and the generic
  // `pack_named_config_*` IPC against `view.options.config_file`.
  // Pre-v0.3.0 fall-back: a Pack with no `schema:` declared falls
  // back to the manifest top-level `config_schema` + the
  // `pack_config_*` IPC (which is hardcoded to fuel-rate-config.yaml).
  const options = (view.options ?? {}) as Record<string, unknown>;
  const inlineSchema = coerceSchema(options.schema);
  const configFile =
    typeof options.config_file === 'string'
      ? (options.config_file as string)
      : typeof options.configFile === 'string'
        ? (options.configFile as string)
        : null;
  const useInlineSchema = inlineSchema.length > 0;
  const useNamedFile = useInlineSchema && configFile !== null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (useInlineSchema) {
          // Inline schema path. Data file is either the
          // generic `pack_named_config_get` (when `config_file`
          // is set) or the legacy transformed `pack_config_get`
          // (which goes through camelCase normalisation).
          const data = useNamedFile && configFile
            ? await packNamedConfigGet(view.packId, configFile)
            : await packConfigGet(view.packId);
          if (cancelled) return;
          setSchema(inlineSchema);
          setConfig(data);
        } else {
          const [s, c] = await Promise.all([
            packConfigSchema(view.packId),
            packConfigGet(view.packId),
          ]);
          if (cancelled) return;
          setSchema(s);
          setConfig(c);
        }
      } catch (e) {
        console.error('SchemaConfig load:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `inlineSchema` is recomputed on every render but its content
    // is driven by `view.options` which is the real input. Tracking
    // the JSON-stringified options avoids re-fetching on identity
    // churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.packId, configFile, useNamedFile, JSON.stringify(options.schema)]);

  const handleSave = useCallback(async () => {
    const next: Record<string, string> = {};
    for (const field of schema) validateField(field, config, next);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setStatus('error');
      return;
    }
    setStatus('saving');
    try {
      if (useNamedFile && configFile) {
        await packNamedConfigSet(view.packId, configFile, config);
      } else {
        await packConfigSet(view.packId, config);
      }
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      console.error('SchemaConfig save:', e);
      setStatus('error');
    }
  }, [schema, config, view.packId, useNamedFile, configFile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-fg-subtle">
        Loading configuration…
      </div>
    );
  }

  if (schema.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        This Pack has no configuration schema defined.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {view.title && <h2 className="text-lg font-semibold text-fg">{view.title}</h2>}
        </div>
        <Button onClick={() => void handleSave()} size="sm" className="flex items-center gap-2">
          <Icon icon={Save} size="sm" />
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && (
            <>
              <Icon icon={CheckCircle2} size="sm" />
              Saved
            </>
          )}
          {status === 'error' && (
            <>
              <Icon icon={AlertCircle} size="sm" />
              Error
            </>
          )}
          {status === 'idle' && 'Save'}
        </Button>
      </div>
      <div className="space-y-3">
        {schema.map((field) => (
          <FieldNode
            key={field.key}
            field={field}
            scope={config}
            onScopeChange={(next) => {
              setConfig(next);
              setStatus('idle');
            }}
            errors={errors}
          />
        ))}
      </div>
    </div>
  );
}
