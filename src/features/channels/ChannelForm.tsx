import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChannelFieldKind, ChannelState } from '@/lib/ipc';
import { WeChatQr } from './WeChatQr';

/**
 * Phase 3 · T3.2 — dynamic channel form.
 *
 * One component drives all 8 channels: fields + env keys come from the
 * `ChannelSpec` the backend shipped with each card. Design intent:
 *
 *   - Secrets never pre-fill. We only know PRESENCE (`env_present`),
 *     never the value. An empty input + "current: set" badge means
 *     "leave unchanged"; typing into it will upsert on save.
 *   - Unchanged fields aren't sent. The save diff is computed at
 *     submit time: if a field is equal to its current value, we omit
 *     it from the patch map so the journal doesn't pollute with
 *     no-op entries.
 *   - Booleans default to the spec's `default_bool` when unset on
 *     disk, matching how Hermes itself resolves defaults.
 *
 * WeChat is the one exception — `has_qr_login` channels get a CTA
 * placeholder instead of text inputs (real QR flow lands in T3.3).
 */

/** One pending field, keyed in two flavors: `env:NAME` or `yaml:path`.
 *  The prefix avoids collisions if a channel ever reuses a slug. */
type FieldValue = string | boolean | string[];

export interface ChannelFormSubmission {
  envUpdates: Record<string, string | null>;
  yamlUpdates: Record<string, unknown>;
  /** Human-readable one-line diff per changed field, used in the
   *  confirmation view. Values are presence-only for env keys. */
  diffs: ChannelDiffLine[];
}

export interface ChannelDiffLine {
  kind: 'env' | 'yaml';
  label: string;
  before: string;
  after: string;
}

export function ChannelForm({
  channel,
  busy,
  onCancel,
  onSubmit,
  onWechatScanned,
}: {
  channel: ChannelState;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (submission: ChannelFormSubmission) => void;
  /** Called after a successful WeChat QR scan wrote
   *  `WECHAT_SESSION` to disk. The parent card should refetch its
   *  `ChannelState` so the env_present map reflects the new token.
   *  Separate from `onSubmit` because the form save path doesn't
   *  fire — the backend wrote the env directly. */
  onWechatScanned?: () => void;
}) {
  const { t } = useTranslation();

  // Initial form state — blank for env inputs (never pre-fill secrets),
  // current value for YAML fields.
  const initial = useMemo(() => {
    const envInputs: Record<string, string> = {};
    for (const k of channel.env_keys) envInputs[k.name] = '';
    const yamlValues: Record<string, FieldValue> = {};
    for (const f of channel.yaml_fields) {
      const cur = channel.yaml_values[f.path];
      yamlValues[f.path] = coerceToFieldValue(f.kind, cur, f.default_bool);
    }
    return { envInputs, yamlValues };
  }, [channel]);

  const [envInputs, setEnvInputs] = useState(initial.envInputs);
  const [yamlValues, setYamlValues] = useState(initial.yamlValues);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const envUpdates: Record<string, string | null> = {};
    const yamlUpdates: Record<string, unknown> = {};
    const diffs: ChannelDiffLine[] = [];

    // Env: only include keys the user typed into (non-empty) OR
    // explicitly cleared via the delete action (Phase 3.3+). For now,
    // typing a value upserts; there's no "delete existing secret"
    // affordance on the form — the user can do that from the
    // changelog page (revert) or by editing the .env directly. That
    // keeps the T3.2 surface small.
    for (const k of channel.env_keys) {
      const typed = envInputs[k.name] ?? '';
      if (typed.length > 0) {
        envUpdates[k.name] = typed;
        diffs.push({
          kind: 'env',
          label: k.name,
          before: channel.env_present[k.name]
            ? t('channels.diff.env_set')
            : t('channels.diff.env_unset'),
          after: t('channels.diff.env_set'),
        });
      }
    }

    // YAML: compare to current disk value; omit no-ops.
    for (const f of channel.yaml_fields) {
      const cur = channel.yaml_values[f.path];
      const next = yamlValues[f.path] ?? coerceToFieldValue(f.kind, undefined, f.default_bool);
      if (!fieldValueEqual(f.kind, cur, next)) {
        yamlUpdates[f.path] = toWireValue(f.kind, next);
        diffs.push({
          kind: 'yaml',
          label: f.path,
          before: formatForDiff(cur),
          after: formatForDiff(next),
        });
      }
    }

    onSubmit({ envUpdates, yamlUpdates, diffs });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded border border-border bg-bg-elev-2/60 p-3"
      data-testid={`channel-form-${channel.id}`}
    >
      {/* Env-key inputs ----------------------------------------- */}
      {channel.env_keys.map((k) => (
        <label key={k.name} className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-fg">{k.name}</span>
            <span className="text-fg-subtle">
              {channel.env_present[k.name]
                ? t('channels.diff.env_set')
                : k.required
                ? t('channels.required')
                : t('channels.optional')}
            </span>
          </div>
          {channel.has_qr_login && !k.required ? (
            // T3.3: the optional "sentinel" env key for QR-login
            // channels (WeChat's WECHAT_SESSION) isn't typed — it's
            // written by the QR flow below. Suppress the password
            // input entirely; the `WeChatQr` panel handles it.
            <span className="text-[10px] text-fg-subtle">
              {t('channels.wechat.written_by_qr')}
            </span>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type={revealed[k.name] ? 'text' : 'password'}
                value={envInputs[k.name] ?? ''}
                onChange={(e) =>
                  setEnvInputs((s) => ({ ...s, [k.name]: e.target.value }))
                }
                placeholder={
                  channel.env_present[k.name]
                    ? t('channels.env_placeholder_overwrite')
                    : t('channels.env_placeholder_new')
                }
                className="flex-1 rounded border border-border bg-bg-elev-1 px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
                data-testid={`channel-env-input-${channel.id}-${k.name}`}
                autoComplete="off"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setRevealed((s) => ({ ...s, [k.name]: !s[k.name] }))
                }
                title={revealed[k.name] ? t('channels.hide') : t('channels.show')}
              >
                {revealed[k.name] ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </Button>
            </div>
          )}
          {k.hint_key && (
            <span className="text-fg-subtle">{t(k.hint_key)}</span>
          )}
        </label>
      ))}

      {/* YAML behavior fields ----------------------------------- */}
      {channel.yaml_fields.map((f) => (
        <YamlFieldInput
          key={f.path}
          kind={f.kind}
          labelKey={f.label_key}
          path={f.path}
          channelId={channel.id}
          value={yamlValues[f.path] ?? coerceToFieldValue(f.kind, undefined, f.default_bool)}
          onChange={(v) => setYamlValues((s) => ({ ...s, [f.path]: v }))}
        />
      ))}

      {/* T3.3: QR-login panel. Rendered for channels whose spec
          sets `has_qr_login = true` (today only WeChat). Owns its
          own network + timing; on success it calls back to the
          parent card so the env_present map refreshes. */}
      {channel.has_qr_login && (
        <WeChatQr onScanned={() => onWechatScanned?.()} />
      )}

      {/* Footer ------------------------------------------------- */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          <X className="h-3.5 w-3.5" />
          {t('channels.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={busy}
          data-testid={`channel-form-save-${channel.id}`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {t('channels.save')}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── YAML field input ─────────────────────────

function YamlFieldInput({
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

// ───────────────────────── helpers ─────────────────────────

/** Resolve whatever the backend returned (unknown from JSON) into a
 *  typed `FieldValue` we can feed into form state. Falls back to the
 *  spec default when the field is absent on disk. */
function coerceToFieldValue(
  kind: ChannelFieldKind,
  raw: unknown,
  defaultBool?: boolean,
): FieldValue {
  if (kind === 'bool') {
    if (typeof raw === 'boolean') return raw;
    return defaultBool ?? false;
  }
  if (kind === 'string_list') {
    if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
    return [];
  }
  // string
  return typeof raw === 'string' ? raw : '';
}

/** Structural equality for a field's old / new value. Avoids shipping
 *  no-op writes down the IPC. Arrays compare by element identity,
 *  which is fine for string lists. */
function fieldValueEqual(kind: ChannelFieldKind, cur: unknown, next: FieldValue): boolean {
  if (kind === 'bool') {
    if (typeof cur === 'boolean') return cur === next;
    // Missing on disk; equal iff the form state matches the default
    // the spec told us to assume (already baked into `next`'s initial
    // value). Treat `next === false` against unset as "no change"
    // only when the default is false — otherwise toggling off a
    // default-true field should write an explicit `false`.
    return false;
  }
  if (kind === 'string_list') {
    const curArr = Array.isArray(cur) ? cur : [];
    const nextArr = Array.isArray(next) ? next : [];
    if (curArr.length !== nextArr.length) return false;
    for (let i = 0; i < curArr.length; i++) {
      if (curArr[i] !== nextArr[i]) return false;
    }
    return true;
  }
  // string
  const curStr = typeof cur === 'string' ? cur : '';
  return curStr === next;
}

/** Convert a typed field value to the wire format (JSON). Booleans +
 *  strings pass through; string_list goes as `string[]` (serde_json
 *  → serde_yaml sequence). */
function toWireValue(kind: ChannelFieldKind, v: FieldValue): unknown {
  if (kind === 'bool') return Boolean(v);
  if (kind === 'string_list') return Array.isArray(v) ? v : [];
  return typeof v === 'string' ? v : '';
}

/** Compact render for the diff confirmation view. */
function formatForDiff(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v.length > 32 ? v.slice(0, 32) + '…' : v;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const joined = v.join(', ');
    return joined.length > 32 ? `[${v.length} items]` : `[${joined}]`;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

