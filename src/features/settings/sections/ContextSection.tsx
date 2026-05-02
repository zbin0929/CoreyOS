import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Save,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesConfigRead,
  hermesConfigWriteCompression,
  hermesGatewayRestart,
  ipcErrorMessage,
  type HermesCompressionSection,
} from '@/lib/ipc';

import { Field, Section } from '../shared';
import { inputCls } from '../styles';

/**
 * Settings → Context section.
 *
 * Surfaces Hermes' built-in `compression:` knobs (it's enabled by
 * default; users had no GUI to discover or tune it before v9). Three
 * preset radios cover 95% of users; the rest get an `<details>` block
 * with the raw threshold / target_ratio / protect_last_n fields.
 *
 * Save → write to `~/.hermes/config.yaml` → show "needs restart"
 * affordance. We could auto-restart but that kills any in-flight chat,
 * so we make it a deliberate one-click button instead.
 */

interface Preset {
  id: 'aggressive' | 'balanced' | 'conservative';
  threshold: number;
  target_ratio: number;
  protect_last_n: number;
  i18nKey: string;
}

// Preset definitions. The "balanced" defaults match what Hermes ships
// with out of the box; if a user picks "balanced" we still write the
// values explicitly to the YAML so the GUI's selected radio survives
// app restarts (otherwise we'd have to infer "balanced" from null +
// equal-to-default, which is fragile).
const PRESETS: Preset[] = [
  {
    id: 'aggressive',
    threshold: 0.3,
    target_ratio: 0.1,
    protect_last_n: 10,
    i18nKey: 'settings.context.preset_aggressive',
  },
  {
    id: 'balanced',
    threshold: 0.5,
    target_ratio: 0.2,
    protect_last_n: 20,
    i18nKey: 'settings.context.preset_balanced',
  },
  {
    id: 'conservative',
    threshold: 0.7,
    target_ratio: 0.3,
    protect_last_n: 40,
    i18nKey: 'settings.context.preset_conservative',
  },
];

/** Effective values after Hermes' built-in defaults are layered onto
 * whatever the YAML had. The fallback values come from
 * `agent/context_compressor.py`. */
function effective(c: HermesCompressionSection | null | undefined) {
  return {
    enabled: c?.enabled ?? true,
    threshold: c?.threshold ?? 0.5,
    target_ratio: c?.target_ratio ?? 0.2,
    protect_last_n: c?.protect_last_n ?? 20,
  };
}

/** Match the current values to a preset id, or return null when
 * they're custom (user hand-edited or migrated from older defaults). */
function matchPreset(c: HermesCompressionSection | null | undefined): Preset['id'] | null {
  const e = effective(c);
  for (const p of PRESETS) {
    if (
      e.threshold === p.threshold &&
      e.target_ratio === p.target_ratio &&
      e.protect_last_n === p.protect_last_n
    ) {
      return p.id;
    }
  }
  return null;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'err'; message: string };

export function ContextSection() {
  const { t } = useTranslation();
  const [view, setView] = useState<HermesCompressionSection | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [presetId, setPresetId] = useState<Preset['id'] | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [targetRatio, setTargetRatio] = useState(0.2);
  const [protectN, setProtectN] = useState(20);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const v = await hermesConfigRead();
        setView(v.compression);
        const e = effective(v.compression);
        setEnabled(e.enabled);
        setThreshold(e.threshold);
        setTargetRatio(e.target_ratio);
        setProtectN(e.protect_last_n);
        setPresetId(matchPreset(v.compression));
      } catch (e) {
        setError(ipcErrorMessage(e));
      }
    })();
  }, []);

  function applyPreset(id: Preset['id']) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setThreshold(p.threshold);
    setTargetRatio(p.target_ratio);
    setProtectN(p.protect_last_n);
  }

  // Mark "custom" when the user edits raw fields away from the
  // selected preset. Cheaper than recomputing matchPreset on every
  // render — done eagerly on the three setters via the helper below.
  function bumpToCustom(next: Partial<{ threshold: number; target_ratio: number; protect_last_n: number }>) {
    const t2 = next.threshold ?? threshold;
    const r2 = next.target_ratio ?? targetRatio;
    const p2 = next.protect_last_n ?? protectN;
    if (next.threshold !== undefined) setThreshold(t2);
    if (next.target_ratio !== undefined) setTargetRatio(r2);
    if (next.protect_last_n !== undefined) setProtectN(p2);
    setPresetId(matchPreset({ threshold: t2, target_ratio: r2, protect_last_n: p2 }));
  }

  async function onSave() {
    if (save.kind === 'saving') return;
    setSave({ kind: 'saving' });
    setError(null);
    try {
      const v = await hermesConfigWriteCompression({
        enabled,
        threshold,
        target_ratio: targetRatio,
        protect_last_n: protectN,
      });
      setView(v.compression);
      setSave({ kind: 'saved' });
      setNeedsRestart(true);
      window.setTimeout(() => {
        setSave((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2500);
    } catch (e) {
      setSave({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }

  async function onRestart() {
    if (restarting) return;
    setRestarting(true);
    try {
      await hermesGatewayRestart();
      setNeedsRestart(false);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setRestarting(false);
    }
  }

  // Dirty = current state diverges from what we last wrote.
  const eView = effective(view);
  const dirty =
    enabled !== eView.enabled ||
    threshold !== eView.threshold ||
    targetRatio !== eView.target_ratio ||
    protectN !== eView.protect_last_n;

  return (
    <Section
      id="settings-context"
      title={t('settings.context.title')}
      description={t('settings.context.description')}
    >
      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-xs text-danger flex items-start gap-2">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Master enable toggle */}
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elev-1/70 px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <Icon icon={Sparkles} size="sm" className="text-gold-500" />
          <div>
            <div className="text-sm font-medium text-fg">
              {t('settings.context.enabled_label')}
            </div>
            <div className="text-xs text-fg-muted">
              {t('settings.context.enabled_hint')}
            </div>
          </div>
        </div>
        <input
          type="checkbox"
          className="h-4 w-4 accent-gold-500"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </label>

      {/* Three preset radios */}
      <fieldset className={cn(!enabled && 'opacity-50 pointer-events-none')}>
        <legend className="text-xs font-medium text-fg-muted mb-2">
          {t('settings.context.preset_legend')}
        </legend>
        <div className="grid gap-2">
          {PRESETS.map((p) => (
            <label
              key={p.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-2.5 transition-colors',
                presetId === p.id
                  ? 'border-gold-500/50 bg-gold-500/5'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name="compression-preset"
                checked={presetId === p.id}
                onChange={() => applyPreset(p.id)}
                className="mt-0.5 accent-gold-500"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg">
                  {t(`${p.i18nKey}.title`)}
                </div>
                <div className="text-xs text-fg-muted mt-0.5">
                  {t(`${p.i18nKey}.detail`, {
                    threshold: Math.round(p.threshold * 100),
                    target: Math.round(p.target_ratio * 100),
                    protect: p.protect_last_n,
                  })}
                </div>
              </div>
            </label>
          ))}
          {presetId === null && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-400">
              {t('settings.context.custom_active')}
            </div>
          )}
        </div>
      </fieldset>

      {/* Advanced — raw values */}
      <details className={cn('group', !enabled && 'opacity-50 pointer-events-none')}>
        <summary className="cursor-pointer list-none flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors">
          <Icon icon={ChevronDown} size="xs" className="transition-transform group-open:rotate-180" />
          {t('settings.context.advanced_label')}
        </summary>
        <div className="mt-3 grid gap-3 rounded-lg border border-border bg-bg-elev-1/70 p-3 shadow-sm">
          <Field
            label={t('settings.context.threshold_label')}
            hint={t('settings.context.threshold_hint')}
          >
            <input
              type="number"
              min={0.1}
              max={0.95}
              step={0.05}
              className={inputCls}
              value={threshold}
              onChange={(e) => bumpToCustom({ threshold: clamp(parseFloat(e.target.value) || 0.5, 0.1, 0.95) })}
            />
          </Field>
          <Field
            label={t('settings.context.target_label')}
            hint={t('settings.context.target_hint')}
          >
            <input
              type="number"
              min={0.05}
              max={0.5}
              step={0.05}
              className={inputCls}
              value={targetRatio}
              onChange={(e) => bumpToCustom({ target_ratio: clamp(parseFloat(e.target.value) || 0.2, 0.05, 0.5) })}
            />
          </Field>
          <Field
            label={t('settings.context.protect_label')}
            hint={t('settings.context.protect_hint')}
          >
            <input
              type="number"
              min={1}
              max={200}
              step={1}
              className={inputCls}
              value={protectN}
              onChange={(e) => bumpToCustom({ protect_last_n: clampInt(parseInt(e.target.value, 10) || 20, 1, 200) })}
            />
          </Field>
        </div>
      </details>

      {/* Save row + restart affordance */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="text-xs text-fg-muted">
          {save.kind === 'saved' && (
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <Icon icon={CheckCircle2} size="xs" />
              {t('settings.context.saved')}
            </span>
          )}
          {save.kind === 'err' && (
            <span className="inline-flex items-start gap-1 text-danger">
              <Icon icon={AlertCircle} size="xs" className="mt-0.5" />
              <span className="break-all">{save.message}</span>
            </span>
          )}
          {needsRestart && save.kind !== 'err' && (
            <span className="text-amber-600 dark:text-amber-400">
              {t('settings.context.needs_restart')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {needsRestart && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void onRestart()}
              disabled={restarting}
            >
              {restarting ? (
                <Icon icon={Loader2} size="xs" className="animate-spin" />
              ) : null}
              {t('settings.context.restart_now')}
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void onSave()}
            disabled={!dirty || save.kind === 'saving'}
          >
            {save.kind === 'saving' ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={Save} size="xs" />
            )}
            {t('settings.context.save')}
          </Button>
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────── helpers ─────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
