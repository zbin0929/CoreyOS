import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, Loader2, Trash2, Undo2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { hermesChannelProbeToken, type ChannelState } from '@/lib/ipc';

import {
  coerceToFieldValue,
  fieldValueEqual,
  formatForDiff,
  PROBE_TARGETS,
  toWireValue,
  type ChannelDiffLine,
  type ChannelFormSubmission,
  type FieldValue,
  type ProbeSlot,
} from './channelFormHelpers';
import { ProbeBadge } from './ProbeBadge';
import { YamlFieldInput } from './YamlFieldInput';

export type { ChannelFormSubmission, ChannelDiffLine } from './channelFormHelpers';

/**
 * Phase 3 · T3.2 — dynamic channel form.
 *
 * One component drives all channels: fields + env keys come from the
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
 * T6.7a (2026-04-23 pm): removed the WeChat QR path. Hermes upstream
 * has no QR flow — WeiXin uses plain text inputs for account_id +
 * token. `has_qr_login` remains in the spec type for forward
 * compatibility but the form no longer renders a QR panel when set.
 *
 * 2026-04-27 — extracted `ProbeBadge`, `YamlFieldInput`, and the
 * coercion / diff helpers into siblings under `./channelFormHelpers`
 * so this file stays focused on layout + state wiring.
 */
export function ChannelForm({
  channel,
  busy,
  onCancel,
  onSubmit,
}: {
  channel: ChannelState;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (submission: ChannelFormSubmission) => void;
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
  // T-P1: per-env probe state. Only populated for env keys whose
  // channel + key name are in `PROBE_TARGETS`. The form fires a
  // debounced probe on input changes ≥ 12 chars (under that, every
  // platform we support rejects as malformed anyway).
  const [probes, setProbes] = useState<Record<string, ProbeSlot>>({});
  const probeTimerRef = useRef<number | null>(null);

  const probeEnvKey = PROBE_TARGETS[channel.id] ?? null;
  const probeInput = probeEnvKey ? envInputs[probeEnvKey] ?? '' : '';

  useEffect(() => {
    // No probe target for this channel → nothing to do.
    if (!probeEnvKey) return;
    // Cancel any pending probe before kicking a new one. Stops a
    // user mid-typing from spamming the platform's API.
    if (probeTimerRef.current !== null) {
      window.clearTimeout(probeTimerRef.current);
      probeTimerRef.current = null;
    }
    const trimmed = probeInput.trim();
    if (trimmed.length === 0) {
      // Wipe the slot so the previous result doesn't shadow a
      // brand-new (empty) field.
      setProbes((s) => ({ ...s, [probeEnvKey]: { kind: 'idle' } }));
      return;
    }
    if (trimmed.length < 12) {
      // Too short to be any of the three target platforms' tokens
      // (Telegram is "id:hex" ≥ 40, Discord ≥ 50, Slack `xoxb-…`).
      // Skip the probe, keep the slot quiet so we don't render a
      // stale ✗ during typing.
      setProbes((s) => ({ ...s, [probeEnvKey]: { kind: 'idle' } }));
      return;
    }
    probeTimerRef.current = window.setTimeout(() => {
      setProbes((s) => ({ ...s, [probeEnvKey]: { kind: 'probing' } }));
      hermesChannelProbeToken(channel.id, trimmed)
        .then((result) =>
          setProbes((s) => ({ ...s, [probeEnvKey]: { kind: 'done', result } })),
        )
        .catch(() => {
          // Treat IPC errors as a non-result rather than a failure —
          // we don't want a transport hiccup to make the user think
          // their token is bad. The Save button still works without
          // a positive probe.
          setProbes((s) => ({ ...s, [probeEnvKey]: { kind: 'idle' } }));
        });
    }, 500);
    return () => {
      if (probeTimerRef.current !== null) {
        window.clearTimeout(probeTimerRef.current);
        probeTimerRef.current = null;
      }
    };
  }, [probeEnvKey, probeInput, channel.id]);
  // T3.5 follow-up — env keys the user has marked for deletion in this
  // session. On save we send an empty string, which `write_env_key`
  // interprets as "remove this line from .env". Kept out of
  // `envInputs` so flipping the trash toggle doesn't clobber a
  // half-typed replacement value in the input.
  const [toClear, setToClear] = useState<Record<string, boolean>>({});

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
      // Explicit "clear" wins over a typed value — the trash toggle
      // is meant to delete, so if the user somehow did both we honor
      // the destructive intent.
      if (toClear[k.name]) {
        envUpdates[k.name] = '';
        diffs.push({
          kind: 'env',
          label: k.name,
          before: t('channels.diff.env_set'),
          after: t('channels.diff.env_unset'),
        });
      } else if (typed.length > 0) {
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
          <div className="flex items-center gap-1">
            <input
              type={revealed[k.name] ? 'text' : 'password'}
              value={envInputs[k.name] ?? ''}
              onChange={(e) =>
                setEnvInputs((s) => ({ ...s, [k.name]: e.target.value }))
              }
              placeholder={
                toClear[k.name]
                  ? t('channels.env_placeholder_will_clear')
                  : channel.env_present[k.name]
                  ? t('channels.env_placeholder_overwrite')
                  : t('channels.env_placeholder_new')
              }
              disabled={toClear[k.name]}
              className={
                'flex-1 rounded border border-border bg-bg-elev-1 px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none' +
                (toClear[k.name] ? ' opacity-60 line-through' : '')
              }
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
              <Icon icon={revealed[k.name] ? EyeOff : Eye} size="xs" />
            </Button>
            {/* Trash / undo toggles "mark for clear". Only offered
                when there's actually a value on disk — clearing a
                never-set key would be a no-op write. */}
            {channel.env_present[k.name] && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setToClear((s) => ({ ...s, [k.name]: !s[k.name] }))
                }
                title={
                  toClear[k.name]
                    ? t('channels.env_clear_undo')
                    : t('channels.env_clear')
                }
                data-testid={`channel-env-clear-${channel.id}-${k.name}`}
              >
                <Icon icon={toClear[k.name] ? Undo2 : Trash2} size="xs" />
              </Button>
            )}
          </div>
          {k.hint_key && (
            <span className="text-fg-subtle">{t(k.hint_key)}</span>
          )}
          {/* T-P1 — inline probe verdict. Only shown for the
              channel's probe target env key, and only after a
              real result lands. We keep the slot reserved during
              `probing` so the row doesn't jump on success. */}
          {probeEnvKey === k.name && (
            <ProbeBadge slot={probes[k.name] ?? { kind: 'idle' }} />
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

      {/* Footer ------------------------------------------------- */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          <Icon icon={X} size="sm" />
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
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Check} size="sm" />
          )}
          {t('channels.save')}
        </Button>
      </div>
    </form>
  );
}
