import { Fragment, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Cpu, Loader2, RotateCcw, Search, Settings2, Sparkles } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { LlmProfile, ModelInfo } from '@/lib/ipc';

import type { PickerRow } from './types';

export function PickerPopover({
  models,
  profiles,
  filtered,
  firstProfileIdx,
  query,
  setQuery,
  activeIdx,
  setActiveIdx,
  showSearch,
  onNavKey,
  error,
  defaultModel,
  sessionOverride,
  sessionLlmProfileId,
  listRef,
  searchRef,
  selectGatewayModel,
  selectProfile,
  onConfigure,
}: {
  models: ModelInfo[] | null;
  profiles: LlmProfile[] | null;
  filtered: PickerRow[];
  firstProfileIdx: number;
  query: string;
  setQuery: (v: string) => void;
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  showSearch: boolean;
  onNavKey: (e: React.KeyboardEvent) => void;
  error: string | null;
  defaultModel: string | null;
  sessionOverride: string | null;
  sessionLlmProfileId: string | null;
  listRef: RefObject<HTMLUListElement>;
  searchRef: RefObject<HTMLInputElement>;
  selectGatewayModel: (modelId: string | null) => void;
  selectProfile: (p: LlmProfile) => void | Promise<void>;
  onConfigure: () => void;
}) {
  const { t } = useTranslation();
  return (
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
            onClick={() => selectGatewayModel(null)}
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
        {!error && models === null && profiles === null && (
          <li className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
            <Icon icon={Loader2} size="xs" className="animate-spin" />
            {t('common.loading')}
          </li>
        )}
        {!error && (models !== null || profiles !== null) && filtered.length === 0 && (
          <li className="px-3 py-2 text-xs text-fg-subtle">
            {query
              ? t('chat_page.model_picker_no_matches')
              : t('chat_page.model_picker_empty')}
          </li>
        )}
        {filtered.map((row, idx) => {
          const isActive = activeIdx === idx;
          // Render a mini section header right BEFORE the first
          // profile row so the two groups read as distinct — no
          // extra array entry (preserves stable keyboard indexing).
          const headerNode =
            idx === firstProfileIdx ? (
              <li
                key="__profile_header__"
                className="border-t border-border bg-bg/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-subtle"
                aria-hidden="true"
              >
                {t('chat_page.model_picker_profiles_header')}
              </li>
            ) : null;
          if (row.kind === 'model') {
            const m = row.m;
            // Model row is selected only when the session is NOT
            // pinned to any LLM Profile AND the override equals
            // this model id. Otherwise the profile's row owns
            // the highlight even if its `model` field happens
            // to match a gateway model's id.
            const selected =
              sessionLlmProfileId === null && sessionOverride === m.id;
            return (
              <Fragment key={`m:${m.id}`}>
                {headerNode}
                <li key={`m:${m.id}`}>
                  <button
                    type="button"
                    data-row-idx={idx}
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectGatewayModel(m.id)}
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
              </Fragment>
            );
          }
          // Profile row
          const p = row.p;
          const selected = sessionLlmProfileId === p.id;
          return (
            <Fragment key={`p:${p.id}`}>
              {headerNode}
              <li key={`p:${p.id}`}>
                <button
                  type="button"
                  data-row-idx={idx}
                  role="option"
                  aria-selected={selected}
                  onClick={() => void selectProfile(p)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                    isActive ? 'bg-bg-elev-2' : 'hover:bg-bg-elev-2',
                  )}
                  data-testid={`chat-model-picker-profile-${p.id}`}
                >
                  <Icon
                    icon={Settings2}
                    size="xs"
                    className={cn(
                      'mt-0.5 flex-none',
                      selected ? 'text-gold-500' : 'opacity-60',
                    )}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <code className="truncate font-mono text-xs text-fg">
                      {p.model}
                    </code>
                    <span className="truncate text-[10px] text-fg-subtle">
                      {p.label || p.id} · {p.provider}
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
            </Fragment>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onConfigure}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-fg-subtle transition-colors hover:bg-bg-elev-2 hover:text-fg"
        data-testid="chat-model-picker-configure"
      >
        <Icon icon={Settings2} size="xs" />
        {t('chat_page.model_configure')}
      </button>
    </div>
  );
}
