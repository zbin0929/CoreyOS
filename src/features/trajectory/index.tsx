import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, GitBranch, Loader2 } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import {
  dbLoadAll,
  ipcErrorMessage,
  type DbSessionWithMessages,
} from '@/lib/ipc';

import { Inspector } from './Inspector';
import { SessionPicker } from './SessionPicker';
import { Timeline } from './Timeline';

/**
 * Phase 4 · T4.3 — Trajectory timeline.
 *
 * Read-only visualization of a persisted session: a vertical timeline
 * with one row per message, tool-call ribbons beneath their turn, and a
 * side inspector that opens on click. Scope kept small:
 *
 * - No D3. The timeline is CSS-driven; durations render as proportional
 *   bars against the session's wall-clock span. D3 would add kilobytes
 *   for a layout we don't need yet.
 * - No replay. The plan hints at stream-style replay; deferred until
 *   someone asks for it. The inspector shows the full captured content,
 *   which covers the "I want to see what actually happened" case.
 * - Data source is the local SQLite store — the same `dbLoadAll` hydrate
 *   path the Chat page uses. Adds no new IPC.
 *
 * Subcomponents live in siblings:
 *   - `SessionPicker.tsx` — header dropdown
 *   - `Timeline.tsx`      — message rows + duration bars
 *   - `ToolCallTree.tsx`  — flat ribbons / nested subagent groups
 *   - `Inspector.tsx`     — side panel
 *   - `helpers.tsx`       — pure compute + formatters + RoleIcon
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; sessions: DbSessionWithMessages[] }
  | { kind: 'error'; message: string };

export function TrajectoryRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const sessions = await dbLoadAll();
      setState({ kind: 'loaded', sessions });
      if (sessions.length > 0 && !selectedId) {
        setSelectedId(sessions[0]!.id);
      }
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
    // Intentionally run once; reload via the Refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const session = useMemo(() => {
    if (state.kind !== 'loaded' || !selectedId) return null;
    return state.sessions.find((s) => s.id === selectedId) ?? null;
  }, [state, selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('trajectory.title')}
        subtitle={t('trajectory.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('trajectory.title')}
              content={t('trajectory.help_page')}
              testId="trajectory-help"
            />
            {state.kind === 'loaded' && state.sessions.length > 0 && (
              <SessionPicker
                sessions={state.sessions}
                value={selectedId}
                onChange={(id) => {
                  setSelectedId(id);
                  setInspectorId(null);
                }}
              />
            )}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-6 py-6">
            {state.kind === 'loading' && (
              <div className="flex items-center gap-2 text-fg-muted">
                <Icon icon={Loader2} size="md" className="animate-spin" />
                {t('common.loading')}
              </div>
            )}
            {state.kind === 'error' && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
                <span>{state.message}</span>
              </div>
            )}
            {state.kind === 'loaded' && state.sessions.length === 0 && (
              <EmptyState
                icon={GitBranch}
                title={t('trajectory.empty_title')}
                description={t('trajectory.empty_desc')}
              />
            )}
            {session && (
              <Timeline
                session={session}
                selectedMessageId={inspectorId}
                onSelect={setInspectorId}
              />
            )}
          </div>
        </div>
        {session && inspectorId && (
          <Inspector
            session={session}
            messageId={inspectorId}
            onClose={() => setInspectorId(null)}
          />
        )}
      </div>
    </div>
  );
}
