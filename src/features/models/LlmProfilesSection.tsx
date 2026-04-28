import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  hermesConfigRead,
  hermesConfigWriteModel,
  llmProfileList,
  modelProviderProbe,
  type LlmProfile,
  type HermesModelSection,
} from '@/lib/ipc';

import { LlmProfileCard, type LlmProbeState } from './LlmProfileCard';
import { LlmProfileRow } from './LlmProfileRow';

/**
 * List-and-edit UI for reusable LLM profiles.
 *
 * One profile = one `{provider, base_url, model, api_key_env}` tuple
 * persisted to `<config_dir>/llm_profiles.json`. Multiple agents can
 * reference the same profile by id — edit the profile once, every
 * agent using it picks up the change on next registration.
 *
 * Layout: a masonic/pinterest grid of cards (1/2/3 columns by viewport
 * width). Clicking a card opens an edit Drawer; "+ New LLM" opens an
 * empty drawer for create. Both drawers wrap the same `LlmProfileRow`
 * form so the create / edit code paths are unified.
 *
 * 2026-04-26 — extracted `LlmProfileCard` (+ `ProbeDot` + `LlmProbeState`)
 * and `LlmProfileRow` (the big create/edit form) out of the original
 * 816-line file. The section below keeps only orchestration: list IPC,
 * auto-probe scheduler, and the two drawer wirings.
 */
export function LlmProfilesSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LlmProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [probes, setProbes] = useState<Record<string, LlmProbeState>>({});
  const [defaultModel, setDefaultModel] = useState<HermesModelSection | null>(null);

  const testProfile = useCallback(async (profile: LlmProfile) => {
    setProbes((prev) => ({ ...prev, [profile.id]: 'probing' }));
    try {
      await modelProviderProbe({
        baseUrl: profile.base_url,
        // No raw key on hand here (the profile stores only the env-var
        // NAME, the value is in ~/.hermes/.env). Pass envKey and let
        // the Rust side resolve it via Hermes's .env reader.
        apiKey: null,
        envKey: profile.api_key_env,
      });
      setProbes((prev) => ({ ...prev, [profile.id]: 'ok' }));
    } catch {
      setProbes((prev) => ({ ...prev, [profile.id]: 'err' }));
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [{ profiles }, config] = await Promise.all([
        llmProfileList(),
        hermesConfigRead(),
      ]);
      setRows(profiles);
      setDefaultModel(config.model);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // T8 polish — auto-probe reachability once per row per session.
  // Fires on first mount (after rows load) and on subsequent rows
  // diff (e.g. a new profile saved via the drawer). Staggers ~150ms
  // between probes so a grid of 10 cards doesn't blast 10 parallel
  // HTTPs on page open. Manual retest via the card's Test button
  // still overrides the result and is not blocked by this.
  const autoProbedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!rows) return;
    let i = 0;
    for (const r of rows) {
      if (autoProbedRef.current.has(r.id)) continue;
      autoProbedRef.current.add(r.id);
      const delay = i * 150;
      i += 1;
      window.setTimeout(() => {
        void testProfile(r);
      }, delay);
    }
  }, [rows, testProfile]);

  // Focused edit mode: when the user clicks a card or "+ New LLM",
  // we take over the whole section with the edit form — the grid
  // collapses away so the form has full width and isn't competing
  // with other cards for visual attention. Closing (cancel/save/
  // delete) returns to the grid.
  const setAsDefault = useCallback(async (profile: LlmProfile) => {
    try {
      const config = await hermesConfigWriteModel({
        default: profile.model,
        provider: profile.provider,
        base_url: profile.base_url,
      });
      setDefaultModel(config.model);
    } catch {
      // silent — the star button just won't stick
    }
  }, []);

  const editingProfile = editingId
    ? (rows ?? []).find((r) => r.id === editingId) ?? null
    : null;

  return (
    <section className="flex flex-col gap-3" data-testid="llm-profiles-section">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            {t('models_page.profiles_title')}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {t('models_page.profiles_desc')}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => setAdding(true)}
          data-testid="llm-profiles-add"
        >
          <Icon icon={Plus} size="sm" />
          {t('models_page.profiles_add')}
        </Button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-8 text-center text-xs text-fg-subtle"
          data-testid="llm-profiles-empty"
        >
          {t('models_page.profiles_empty')}
        </div>
      ) : (
        // T8 polish — masonic/pinterest-style grid via CSS columns.
        // Cards break naturally based on content height; `break-inside-
        // avoid` keeps each card intact. Falls back to a single
        // column on mobile. Grid is always visible — the editor
        // lives in a right-side Drawer that slides over it.
        <div
          className="columns-1 gap-3 sm:columns-2 xl:columns-3"
          data-testid="llm-profiles-list"
        >
          {rows.map((p) => (
            <div key={p.id} className="mb-3 break-inside-avoid">
              <LlmProfileCard
                profile={p}
                onOpen={() => setEditingId(p.id)}
                probe={probes[p.id]}
                onTest={() => void testProfile(p)}
                isDefault={
                  defaultModel != null &&
                  defaultModel.provider === p.provider &&
                  defaultModel.default === p.model
                }
                onSetDefault={() => void setAsDefault(p)}
              />
            </div>
          ))}
        </div>
      )}

      {/* New-profile drawer — opens from the right, card grid stays
          visible beneath so users don't lose their bearings. */}
      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        side="right"
        title={t('models_page.profiles_add')}
        testId="llm-profile-new-drawer"
      >
        <LlmProfileRow
          mode="new"
          existingIds={(rows ?? []).map((r) => r.id)}
          initial={{
            id: '',
            label: '',
            provider: '',
            base_url: '',
            model: '',
            api_key_env: null,
          }}
          onSaved={async (next) => {
            setRows((prev) => [...(prev ?? []), next]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      </Drawer>

      {/* Edit-profile drawer — same shape, pre-populated. Keyed by
          id so switching cards without closing re-mounts clean form
          state instead of bleeding the previous card's draft. */}
      <Drawer
        open={editingProfile !== null}
        onClose={() => setEditingId(null)}
        side="right"
        title={editingProfile?.label || editingProfile?.id}
        testId="llm-profile-edit-drawer"
      >
        {editingProfile && (
          <LlmProfileRow
            key={editingProfile.id}
            initial={editingProfile}
            mode="edit"
            existingIds={(rows ?? [])
              .map((r) => r.id)
              .filter((id) => id !== editingProfile.id)}
            onSaved={async (next) => {
              setRows(
                (prev) => prev?.map((r) => (r.id === next.id ? next : r)) ?? [next],
              );
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
            onDeleted={async () => {
              setRows((prev) => prev?.filter((r) => r.id !== editingProfile.id) ?? []);
              setEditingId(null);
            }}
          />
        )}
      </Drawer>
    </section>
  );
}
