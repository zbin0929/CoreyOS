import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  Cpu,
  Loader2,
  RotateCcw,
  Search,
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
 * Interaction model:
 *   - Click the badge → dropdown opens. ↓ lands focus on the first row.
 *   - ↑/↓ moves through rows including the "Use default" sentinel.
 *   - Enter picks the focused row; Esc closes without committing.
 *   - Search field auto-appears when the list has > 6 entries; types
 *     filter the displayed options. Search is id + display_name substring,
 *     case-insensitive.
 *
 * Model list comes from `modelList()` (the adapter's `/v1/models`),
 * NOT from `hermesConfigRead().model`. That view is just the default —
 * the real list can be bigger.
 */
export function ActiveLLMBadge() {
  const { t } = useTranslation();
  const navigate = useNavigate();

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
  const [query, setQuery] = useState('');
  // Active row index for keyboard navigation. -1 = "Use default" sentinel,
  // 0..N-1 = model rows in their post-filter order.
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Fetch the model list lazily on first open — keeps Chat-page boot cheap
  // and gets a fresh list every time the user actually opens the dropdown
  // (useful after they've added providers elsewhere).
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

  // Reset transient picker state every time it opens — stale query /
  // focus from the previous interaction would surprise the user.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(-1);
    }
  }, [open]);

  // Outside-click + Esc to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.display_name?.toLowerCase().includes(q) ?? false) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, query]);

  const showSearch = (models?.length ?? 0) > 6;

  // Focus the search box when it appears; otherwise the list itself.
  useEffect(() => {
    if (!open) return;
    if (showSearch) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, showSearch]);

  // Scroll the active row into view as the user arrows through.
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const labelText = effective ?? t('chat_page.model_unknown');
  const isOverridden = sessionOverride !== null && sessionOverride !== defaultModel;

  function selectModel(modelId: string | null) {
    if (!sessionId) return;
    setSessionModel(sessionId, modelId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Keyboard handler shared by search input and list container. -1 is the
  // "Use default" sentinel row; 0..len-1 are the filtered model rows.
  function onNavKey(e: React.KeyboardEvent) {
    const max = filtered.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i >= max ? -1 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= -1 ? max : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx === -1) selectModel(null);
      else if (filtered[activeIdx]) selectModel(filtered[activeIdx].id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(-1);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(max);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
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
          className={cn(
            // Open UPWARD (bottom-full + mb-1). The model pill sits
            // at the top of the composer footer, so opening downward
            // made the popover overlap the textarea and the send
            // button — visually jarring and caused the composer
            // placeholder to show through the popover gaps. There's
            // plenty of chat scrollback above; bias the popup there.
            'absolute left-0 bottom-full z-40 mb-1 w-72 overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 shadow-2',
          )}
          data-testid="chat-model-picker-list"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-fg-subtle">
            <span>{t('chat_page.model_picker_label')}</span>
            {models && (
              <span className="font-mono">
                {query ? `${filtered.length}/${models.length}` : models.length}
              </span>
            )}
          </div>

          {/* Search field — only shown when there are enough rows to justify
              the extra visual weight. */}
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Icon icon={Search} size="xs" className="opacity-60" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(-1);
                }}
                onKeyDown={onNavKey}
                placeholder={t('chat_page.model_picker_search')}
                className={cn(
                  'flex-1 bg-transparent text-xs text-fg outline-none',
                  'placeholder:text-fg-subtle',
                )}
                data-testid="chat-model-picker-search"
                aria-controls="chat-model-picker-listbox"
              />
            </div>
          )}

          <ul
            ref={listRef}
            id="chat-model-picker-listbox"
            role="listbox"
            aria-label={t('chat_page.model_picker_label')}
            tabIndex={showSearch ? -1 : 0}
            onKeyDown={onNavKey}
            className="max-h-72 overflow-y-auto focus:outline-none"
          >
            {/* "Use default" sentinel row — always first. */}
            <li>
              <button
                type="button"
                data-row-idx={-1}
                role="option"
                aria-selected={sessionOverride === null}
                onClick={() => selectModel(null)}
                onMouseEnter={() => setActiveIdx(-1)}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs transition-colors',
                  activeIdx === -1 && 'bg-bg-elev-2',
                  sessionOverride === null
                    ? 'text-fg'
                    : 'text-fg-muted hover:text-fg',
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
            </li>

            {error && (
              <li className="px-3 py-2 text-xs text-danger">{error}</li>
            )}
            {!error && models === null && (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
                <Icon icon={Loader2} size="xs" className="animate-spin" />
                {t('common.loading')}
              </li>
            )}
            {!error && models && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-fg-subtle">
                {query
                  ? t('chat_page.model_picker_no_matches')
                  : t('chat_page.model_picker_empty')}
              </li>
            )}
            {filtered.map((m, idx) => {
              const selected = sessionOverride === m.id;
              const isActive = activeIdx === idx;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    data-row-idx={idx}
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectModel(m.id)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                      isActive ? 'bg-bg-elev-2' : 'hover:bg-bg-elev-2',
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
