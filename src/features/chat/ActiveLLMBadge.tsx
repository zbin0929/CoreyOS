import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Cpu } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  llmProfileEnsureAdapter,
  llmProfileList,
  modelList,
  type LlmProfile,
  type ModelInfo,
} from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';
import { useChatStore } from '@/stores/chat';

import { PickerPopover } from './activeLLMBadge/PickerPopover';
import type { PickerRow } from './activeLLMBadge/types';

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
 *
 * The dropdown's listbox/search UI is factored into
 * `activeLLMBadge/PickerPopover.tsx` so this file stays focused on
 * state + IPC + keyboard routing.
 */
export function ActiveLLMBadge() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const sessionId = useChatStore((s) => s.currentId);
  const sessionOverride = useChatStore((s) =>
    s.currentId ? (s.sessions[s.currentId]?.model ?? null) : null,
  );
  // v10 — per-session LLM Profile pin. When set, the composer picks
  // this over the session's owning `adapterId`. Drives the selected
  // ring on Profile rows; null when the user hasn't picked a profile.
  const sessionLlmProfileId = useChatStore((s) =>
    s.currentId ? (s.sessions[s.currentId]?.llmProfileId ?? null) : null,
  );
  const setSessionModel = useChatStore((s) => s.setSessionModel);
  const setSessionLlmProfile = useChatStore((s) => s.setSessionLlmProfile);
  const defaultModel = useAppStatusStore((s) => s.currentModel);
  const effective = sessionOverride ?? defaultModel;

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  // LLM Profiles (from ~/.<config>/llm_profiles.json). These were
  // invisible in the chat picker until T-polish: the backend now
  // auto-registers each profile as `hermes:profile:<id>` so we can
  // route turns to it directly. Fetched in parallel with `modelList`
  // so the dropdown opens fast even when one side is slow.
  const [profiles, setProfiles] = useState<LlmProfile[] | null>(null);
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
    // Fan out both fetches in parallel. Errors from either side are
    // non-fatal individually — we only surface a picker-level error
    // when BOTH fail (no list to render). That way a profile-file
    // read failure doesn't hide the gateway's models and vice versa.
    Promise.allSettled([modelList(), llmProfileList()]).then((results) => {
      if (!alive) return;
      const [m, p] = results;
      if (m.status === 'fulfilled') setModels(m.value);
      if (p.status === 'fulfilled') setProfiles(p.value.profiles);
      if (m.status === 'rejected' && p.status === 'rejected') {
        setError(ipcErrorMessage(m.reason));
      }
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

  // Unified, optionally-filtered picker list. Models come first
  // (preserves the pre-T-polish ordering so regular users see the
  // familiar default gateway's models on top), then LLM Profiles
  // get appended as a second group. Free-text filter matches against
  // id / display name / provider (models) OR id / label / provider /
  // model field (profiles).
  const filtered = useMemo<PickerRow[]>(() => {
    const q = query.trim().toLowerCase();
    const modelRows: PickerRow[] = (models ?? [])
      .filter(
        (m) =>
          !q ||
          m.id.toLowerCase().includes(q) ||
          (m.display_name?.toLowerCase().includes(q) ?? false) ||
          m.provider.toLowerCase().includes(q),
      )
      .map((m) => ({ kind: 'model' as const, m }));
    const profileRows: PickerRow[] = (profiles ?? [])
      .filter(
        (p) =>
          !q ||
          p.id.toLowerCase().includes(q) ||
          p.label.toLowerCase().includes(q) ||
          p.provider.toLowerCase().includes(q) ||
          p.model.toLowerCase().includes(q),
      )
      .map((p) => ({ kind: 'profile' as const, p }));
    return [...modelRows, ...profileRows];
  }, [models, profiles, query]);

  const firstProfileIdx = useMemo(
    () => filtered.findIndex((r) => r.kind === 'profile'),
    [filtered],
  );

  const showSearch = filtered.length > 6;

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
  // "Override" pill lights up whenever this session diverges from
  // the global default: a per-session model override OR a pinned
  // LLM Profile (which routes through a non-default adapter).
  const isOverridden =
    (sessionOverride !== null && sessionOverride !== defaultModel) ||
    sessionLlmProfileId !== null;

  // Flip the session's model to a gateway-reported model id. Also
  // clears any Profile pin so the next turn routes through the
  // session's owning adapter — otherwise picking a gateway model
  // after a profile would keep talking to the profile's base_url
  // with the wrong model id.
  function selectGatewayModel(modelId: string | null) {
    if (!sessionId) return;
    if (sessionLlmProfileId !== null) {
      // Clear the profile pin in the same write that sets the model
      // override, so a concurrent send can't observe a mismatched
      // pair (new model on old profile).
      setSessionLlmProfile(sessionId, null, modelId);
    } else {
      setSessionModel(sessionId, modelId);
    }
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Materialise a Profile as a live adapter, then pin the session to
  // it. Both steps run back-to-back so the UI doesn't briefly show
  // a state where `llm_profile_id` names a slot the backend hasn't
  // registered yet — a racing send would 404.
  async function selectProfile(p: LlmProfile) {
    if (!sessionId) return;
    try {
      await llmProfileEnsureAdapter(p.id);
      setSessionLlmProfile(sessionId, p.id, p.model);
    } catch (e) {
      // Surface in the picker instead of a silent failure — the user
      // just clicked, they expect feedback. Keep the picker open so
      // they can read the message and pick something else.
      setError(ipcErrorMessage(e));
      return;
    }
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectRow(row: PickerRow) {
    if (row.kind === 'model') selectGatewayModel(row.m.id);
    else selectProfile(row.p);
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
      if (activeIdx === -1) selectGatewayModel(null);
      else if (filtered[activeIdx]) selectRow(filtered[activeIdx]);
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
        <PickerPopover
          models={models}
          profiles={profiles}
          filtered={filtered}
          firstProfileIdx={firstProfileIdx}
          query={query}
          setQuery={setQuery}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          showSearch={showSearch}
          onNavKey={onNavKey}
          error={error}
          defaultModel={defaultModel}
          sessionOverride={sessionOverride}
          sessionLlmProfileId={sessionLlmProfileId}
          listRef={listRef}
          searchRef={searchRef}
          selectGatewayModel={selectGatewayModel}
          selectProfile={selectProfile}
          onConfigure={() => {
            setOpen(false);
            void navigate({ to: '/models' });
          }}
        />
      )}
    </div>
  );
}
