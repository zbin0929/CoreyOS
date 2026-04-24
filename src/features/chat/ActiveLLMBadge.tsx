import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  Cpu,
  Loader2,
  RotateCcw,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { ipcErrorMessage, modelList, type ModelInfo } from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';
import { useChatStore } from '@/stores/chat';

/**
 * Compact model picker rendered above the composer.
 *
 * Before T7-polish this was a read-only status badge that linked to the
 * `/models` page — a relic from when Hermes was assumed to ignore the
 * per-request `model` field. That was wrong: Hermes' gateway is
 * OpenAI-compatible and `resolve_turn` in `adapters/hermes/mod.rs`
 * honours `turn.model` with fallback to the gateway default. Now this
 * component writes through `setSessionModel` so the user can pick a
 * different model for the current chat without touching the global
 * default.
 *
 * Semantics:
 *   - Label shows the **effective** model (override ?? global default).
 *   - A "session override" dot + "using default" vs "override" text
 *     makes the two cases distinguishable at a glance.
 *   - "Use default" row clears the override.
 *   - Link to `/models` for actually changing providers / API keys.
 *
 * Model list comes from `modelList()` (the adapter's `/v1/models`),
 * NOT from the old `hermesConfigRead().model` view. That view is just
 * the default — the real list can be bigger (e.g. providers expose
 * dozens of models and the user may want to try any of them for a
 * single turn).
 */
export function ActiveLLMBadge() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Current chat session id; picker writes the override onto this.
  const sessionId = useChatStore((s) => s.currentId);
  const sessionOverride = useChatStore((s) =>
    s.currentId ? (s.sessions[s.currentId]?.model ?? null) : null,
  );
  const setSessionModel = useChatStore((s) => s.setSessionModel);
  const defaultModel = useAppStatusStore((s) => s.currentModel);
  const effective = sessionOverride ?? defaultModel;

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Fetch the model list lazily on first open. Keeps Chat-page boot cheap
  // and a fresh list every time the user actually looks at the dropdown
  // (after they've added providers elsewhere).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    modelList()
      .then((rows) => {
        if (alive) setModels(rows);
      })
      .catch((e) => {
        if (alive) setError(ipcErrorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Outside-click to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const labelText = effective ?? t('chat_page.model_unknown');
  const isOverridden = sessionOverride !== null && sessionOverride !== defaultModel;

  function selectModel(modelId: string | null) {
    if (!sessionId) return;
    setSessionModel(sessionId, modelId);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition',
          isOverridden
            ? 'border-gold-500/40 bg-gold-500/5 text-fg hover:bg-gold-500/10'
            : 'border-border bg-bg-elev-1 text-fg hover:border-gold-500/40 hover:bg-bg-elev-2',
        )}
        title={
          isOverridden
            ? t('chat_page.model_overridden_title')
            : t('chat_page.model_default_title')
        }
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="chat-model-picker-trigger"
        data-overridden={isOverridden ? 'true' : 'false'}
      >
        <Icon icon={Cpu} size="xs" className="opacity-60" />
        <code className="max-w-[180px] truncate font-mono">{labelText}</code>
        {isOverridden && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-gold-500"
            aria-label={t('chat_page.model_overridden_title')}
          />
        )}
        <Icon icon={ChevronDown} size="xs" className="opacity-60" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('chat_page.model_picker_label')}
          className={cn(
            'absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 shadow-2',
          )}
          data-testid="chat-model-picker-list"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-fg-subtle">
            <span>{t('chat_page.model_picker_label')}</span>
            {models && <span className="font-mono">{models.length}</span>}
          </div>

          {/* "Use default" row — always first. Highlighted when no
              override is active; clears the override otherwise. */}
          <button
            type="button"
            onClick={() => selectModel(null)}
            className={cn(
              'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs transition-colors',
              sessionOverride === null
                ? 'bg-bg-elev-2 text-fg'
                : 'text-fg-muted hover:bg-bg-elev-2 hover:text-fg',
            )}
            data-testid="chat-model-picker-use-default"
          >
            <Icon icon={RotateCcw} size="xs" className="opacity-60" />
            <span className="flex-1">
              {t('chat_page.model_use_default')}
              {defaultModel && (
                <code className="ml-1.5 rounded bg-bg px-1 py-0.5 font-mono text-[10px] text-fg-subtle">
                  {defaultModel}
                </code>
              )}
            </span>
            {sessionOverride === null && (
              <Icon icon={Check} size="xs" className="text-gold-500" />
            )}
          </button>

          <ul className="max-h-64 overflow-y-auto py-1">
            {error && (
              <li className="px-3 py-2 text-xs text-danger">{error}</li>
            )}
            {!error && models === null && (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
                <Icon icon={Loader2} size="xs" className="animate-spin" />
                {t('common.loading')}
              </li>
            )}
            {models && models.length === 0 && (
              <li className="px-3 py-2 text-xs text-fg-subtle">
                {t('chat_page.model_picker_empty')}
              </li>
            )}
            {models?.map((m) => {
              const selected = sessionOverride === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectModel(m.id)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                      selected
                        ? 'bg-bg-elev-2'
                        : 'hover:bg-bg-elev-2',
                    )}
                    data-testid={`chat-model-picker-option-${m.id}`}
                  >
                    <Icon
                      icon={m.capabilities.reasoning ? Sparkles : Cpu}
                      size="xs"
                      className={cn(
                        'mt-0.5 flex-none',
                        selected ? 'text-gold-500' : 'opacity-60',
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <code className="truncate font-mono text-xs text-fg">
                        {m.id}
                      </code>
                      <span className="truncate text-[10px] text-fg-subtle">
                        {m.display_name ?? m.provider}
                        {m.is_default && ` · ${t('chat_page.model_default_tag')}`}
                      </span>
                    </span>
                    {selected && (
                      <Icon
                        icon={Check}
                        size="xs"
                        className="mt-0.5 flex-none text-gold-500"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void navigate({ to: '/models' });
            }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-fg-subtle transition-colors hover:bg-bg-elev-2 hover:text-fg"
            data-testid="chat-model-picker-configure"
          >
            <Icon icon={Settings2} size="xs" />
            {t('chat_page.model_configure')}
          </button>
        </div>
      )}
    </div>
  );
}
