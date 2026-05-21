import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Loader2, User2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesGatewayRestart,
  hermesProfileActivate,
  hermesProfileList,
  ipcErrorMessage,
  type HermesProfileInfo,
} from '@/lib/ipc';

/**
 * Hermes Profile picker rendered next to the model picker in the composer.
 *
 * This allows users to switch between different expert profiles (e.g.,
 * ecom-ad-expert, ecom-inventory-expert) during a chat session. The
 * selected profile's SOUL.md is injected into the system prompt.
 *
 * IMPORTANT: Switching profiles requires a gateway restart for the new
 * SOUL to take effect. This component handles that automatically.
 *
 * Note: This is different from LLM Profiles (which configure model/provider).
 * Hermes Profiles are expert personas with specialized knowledge.
 */
export function ActiveProfileBadge() {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<HermesProfileInfo[] | null>(null);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState<number>(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Fetch profile list on open
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    setLoading(true);
    hermesProfileList()
      .then((view) => {
        if (!alive) return;
        setProfiles(view.profiles);
        setActiveProfile(view.active);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(ipcErrorMessage(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
    }
  }, [open]);

  // Outside click + Esc to close
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

  // Filter profiles by query
  const filtered = useMemo(() => {
    if (!profiles) return [];
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(q));
  }, [profiles, query]);

  const showSearch = (profiles?.length ?? 0) > 5;

  // Focus search or list on open
  useEffect(() => {
    if (!open) return;
    if (showSearch) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, showSearch]);

  // Scroll active row into view
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  // Select a profile and restart gateway
  async function selectProfile(name: string) {
    if (name === activeProfile) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      await hermesProfileActivate(name);
      // Gateway restart is required for the new SOUL to take effect
      await hermesGatewayRestart();
      setActiveProfile(name);
      setOpen(false);
      triggerRef.current?.focus();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // Keyboard navigation
  function onNavKey(e: React.KeyboardEvent) {
    const max = filtered.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i >= max ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? max : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIdx]) {
        void selectProfile(filtered[activeIdx].name);
      }
    }
  }

  const displayName = activeProfile ?? 'default';

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
          'border-border bg-bg-elev-1 text-fg hover:border-purple-500/40 hover:bg-bg-elev-2',
        )}
        title={t('chat_page.profile_picker_title', { defaultValue: '切换专家 Profile' })}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="chat-profile-picker-trigger"
      >
        <Icon icon={User2} size="xs" className="opacity-60" />
        <code className="max-w-[120px] truncate font-mono">{displayName}</code>
        <Icon icon={ChevronDown} size="xs" className="opacity-60" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute left-0 bottom-full z-40 mb-1 w-64 overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 shadow-2',
          )}
          data-testid="chat-profile-picker-list"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-fg-subtle">
            <span>{t('chat_page.profile_picker_label', { defaultValue: '专家 Profile' })}</span>
            {profiles && (
              <span className="font-mono">
                {query ? `${filtered.length}/${profiles.length}` : profiles.length}
              </span>
            )}
          </div>

          {showSearch && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={onNavKey}
                placeholder={t('chat_page.profile_picker_search', { defaultValue: '搜索...' })}
                className={cn(
                  'flex-1 bg-transparent text-xs text-fg outline-none',
                  'placeholder:text-fg-subtle',
                )}
              />
            </div>
          )}

          <ul
            ref={listRef}
            role="listbox"
            tabIndex={showSearch ? -1 : 0}
            onKeyDown={onNavKey}
            className="max-h-60 overflow-y-auto focus:outline-none"
          >
            {loading && profiles === null && (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
                <Icon icon={Loader2} size="xs" className="animate-spin" />
                {t('common.loading')}
              </li>
            )}
            {error && (
              <li className="px-3 py-2 text-xs text-danger">{error}</li>
            )}
            {!loading && profiles !== null && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-fg-subtle">
                {t('chat_page.profile_picker_empty', { defaultValue: '无匹配 Profile' })}
              </li>
            )}
            {filtered.map((p, idx) => {
              const isActive = activeIdx === idx;
              const isSelected = p.is_active;
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    data-row-idx={idx}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => void selectProfile(p.name)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                      isActive ? 'bg-bg-elev-2' : 'hover:bg-bg-elev-2',
                    )}
                    disabled={loading}
                  >
                    <Icon
                      icon={User2}
                      size="xs"
                      className={cn(
                        'flex-none',
                        isSelected ? 'text-purple-500' : 'opacity-60',
                      )}
                    />
                    <span className="flex-1 truncate font-mono">{p.name}</span>
                    {isSelected && (
                      <Icon icon={Check} size="xs" className="flex-none text-purple-500" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
