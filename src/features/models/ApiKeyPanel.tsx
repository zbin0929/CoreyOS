import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Eye, EyeOff, Key, Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { hermesEnvSetKey, ipcErrorMessage, type HermesConfigView } from '@/lib/ipc';

import { inputCls } from './styles';

/**
 * Inline API-key form shown below the provider dropdown. Collapsed
 * when the key is already present; expandable for rotation. The
 * value never leaves this component as state — it's sent straight to
 * `hermesEnvSetKey` which writes to `~/.hermes/.env` (mode 0600) and
 * then cleared.
 *
 * Two-click clear button mirrors `LlmProfilesSection`'s pattern: first
 * click arms (button turns red), second click calls
 * `hermesEnvSetKey(name, null)` which removes the line. Auto-disarms
 * after 3 s so a stray click can't accidentally wipe a key.
 */
export function ApiKeyPanel({
  envKey,
  present,
  onSaved,
}: {
  envKey: string;
  present: boolean;
  onSaved: (view: HermesConfigView) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!present);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the prop flips (e.g. after a save), collapse + clear.
  useEffect(() => {
    if (present && !saving) {
      setExpanded(false);
      setValue('');
    }
  }, [present, saving]);

  async function save() {
    if (!value.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const view = await hermesEnvSetKey(envKey, value.trim());
      setValue('');
      onSaved(view);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const [clearArmed, setClearArmed] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!clearArmed) return;
    const h = window.setTimeout(() => setClearArmed(false), 3000);
    return () => window.clearTimeout(h);
  }, [clearArmed]);

  async function clearKey() {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const view = await hermesEnvSetKey(envKey, null);
      setClearArmed(false);
      onSaved(view);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setClearing(false);
    }
  }

  if (!expanded) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-2 text-xs">
        <Icon icon={Key} size="sm" className="mt-0.5 flex-none text-emerald-500" />
        <div className="flex-1">
          <span className="text-emerald-600">
            <code className="font-mono">{envKey}</code> is set
          </span>{' '}
          <span className="text-fg-muted">in ~/.hermes/.env</span>
        </div>
        <button
          type="button"
          onClick={() => void clearKey()}
          disabled={clearing}
          className={cn(
            'text-xs transition disabled:opacity-50',
            clearArmed
              ? 'font-medium text-danger'
              : 'text-fg-subtle hover:text-danger',
          )}
          data-testid="models-api-key-clear"
        >
          {clearing ? '…' : clearArmed ? 'Confirm clear' : 'Clear'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-fg-subtle transition hover:text-fg"
        >
          Rotate
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2.5 text-xs',
        present
          ? 'border-border bg-bg-elev-2'
          : 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={Key}
          size="sm"
          className={cn(
            'mt-0.5 flex-none',
            present ? 'text-emerald-500' : 'text-amber-500',
          )}
        />
        <div className="flex-1">
          {present ? (
            <>
              <span className="font-medium text-fg">{t('models_page.rotate_api_key')}</span>
              <span className="ml-1 text-fg-muted">
                {t('models_page.rotate_api_key_hint', { env: envKey })}
              </span>
            </>
          ) : (
            <>
              <span className="font-medium text-amber-600">
                {t('models_page.missing_env', { env: envKey })}
              </span>
              <span className="ml-1 text-fg-muted">
                {t('models_page.missing_env_hint')}
              </span>
            </>
          )}
        </div>
        {present && (
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setValue('');
              setError(null);
            }}
            className="text-xs text-fg-subtle transition hover:text-fg"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          className={cn(inputCls, 'pr-9 font-mono text-xs')}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle transition hover:bg-bg-elev-1 hover:text-fg"
          aria-label={show ? 'Hide' : 'Show'}
          tabIndex={-1}
        >
          <Icon icon={show ? EyeOff : Eye} size="sm" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-subtle">
          Stored only in <code className="font-mono">~/.hermes/.env</code> (mode 0600).
        </span>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={save}
          disabled={!value.trim() || saving}
        >
          {saving ? (
            <Icon icon={Loader2} size="xs" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="xs" />
          )}
          Save key
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-1 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </div>
  );
}
