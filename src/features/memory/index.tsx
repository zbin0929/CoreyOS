import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, RefreshCcw, Save } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { MarkdownEditor } from '@/features/skills/MarkdownEditor';
import {
  ipcErrorMessage,
  learningCompactMemory,
  memoryRead,
  memoryWrite,
  type MemoryKind,
} from '@/lib/ipc';

import { CapacityMeter } from './CapacityMeter';
import { SearchPanel } from './SearchPanel';
import { TabBar } from './TabBar';
import {
  dirtyBytes,
  emptyTab,
  type ActiveTab,
  type TabState,
  type Tabs,
} from './utils';

/**
 * Phase 7 · T7.3 — Memory page (GUI over Hermes' native memory stack).
 *
 * Two tabs, two files:
 *   - **Agent** (`~/.hermes/MEMORY.md`) — the agent's running notes.
 *     Hermes injects these into every system prompt automatically.
 *   - **User** (`~/.hermes/USER.md`) — the user's profile / stable
 *     preferences. Same surface, same injection path.
 *
 * Intentionally minimal:
 *   - No RAG, no embeddings. Hermes does retrieval itself off the
 *     filesystem; we're just a GUI.
 *   - No autosave. Memory is high-trust — a stray keystroke shouldn't
 *     silently overwrite the agent's notes. Cmd/Ctrl-S or the Save
 *     button commits; unsaved changes persist only until tab switch,
 *     at which point we warn.
 *   - Includes a session_search tab (T7.3b) over Hermes FTS5 so users
 *     can find prior context without leaving Corey.
 *
 * Reuses the Skills CodeMirror editor verbatim: both surfaces edit
 * Markdown, both want ⌘S, both want hide-the-chrome dark mode support.
 *
 * Subcomponents live in siblings: `TabBar.tsx`, `CapacityMeter.tsx`,
 * `SearchPanel.tsx`; pure helpers and the per-tab state shape live
 * in `utils.ts`.
 */

export function MemoryRoute() {
  const { t } = useTranslation();
  const [active, setActive] = useState<ActiveTab>('agent');
  const [tabs, setTabs] = useState<Tabs>({
    agent: emptyTab(),
    user: emptyTab(),
  });

  const patch = useCallback((kind: MemoryKind, next: Partial<TabState>) => {
    setTabs((prev) => ({ ...prev, [kind]: { ...prev[kind], ...next } }));
  }, []);

  const load = useCallback(
    async (kind: MemoryKind) => {
      patch(kind, { loading: true, error: null });
      try {
        const file = await memoryRead(kind);
        patch(kind, {
          loading: false,
          file,
          dirty: file.content,
          error: null,
        });
      } catch (e) {
        patch(kind, { loading: false, error: ipcErrorMessage(e) });
      }
    },
    [patch],
  );

  // Load both on mount so tab-switch is instant. Cheap: two small
  // file reads, each <256KB.
  useEffect(() => {
    void load('agent');
    void load('user');
  }, [load]);

  // `current` is only defined for the two file tabs; the search tab
  // has its own state inside `<SearchPanel/>` so the header's
  // capacity meter / save button gate naturally.
  const isFileTab = active !== 'search';
  const current = isFileTab ? tabs[active] : null;
  const isDirty =
    current != null &&
    current.file != null &&
    current.dirty !== current.file.content;

  const save = useCallback(
    async (kind: MemoryKind) => {
      const tab = tabs[kind];
      if (tab.saving || tab.file == null) return;
      if (tab.dirty === tab.file.content) return; // no-op
      patch(kind, { saving: true, error: null });
      try {
        const file = await memoryWrite(kind, tab.dirty);
        patch(kind, {
          saving: false,
          file,
          dirty: file.content,
          savedAt: Date.now(),
          error: null,
        });
      } catch (e) {
        patch(kind, { saving: false, error: ipcErrorMessage(e) });
      }
    },
    [patch, tabs],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('memory.title')}
        subtitle={t('memory.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('memory.title')}
              content={t('memory.help_page')}
              testId="memory-help"
            />
            {isFileTab && current ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void learningCompactMemory().then((result) => {
                      if (result.memory_entries_removed > 0) {
                        void load(active);
                      }
                    }).catch(() => {});
                  }}
                  data-testid="memory-compact"
                >
                  <Icon icon={RefreshCcw} size="sm" />
                  {t('memory.compact')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void save(active)}
                  disabled={!isDirty || current.saving}
                  data-testid="memory-save"
                >
                  {current.saving ? (
                    <Icon icon={Loader2} size="sm" className="animate-spin" />
                  ) : (
                    <Icon icon={Save} size="sm" />
                  )}
                  {t('memory.save')}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-col gap-3 border-b border-border/60 bg-bg-elev-1/80 px-4 py-3 backdrop-blur-sm">
        <TabBar active={active} tabs={tabs} onSelect={setActive} />
        {isFileTab && current && current.file && (
          <CapacityMeter
            bytes={dirtyBytes(current.dirty)}
            maxBytes={current.file.max_bytes}
            path={current.file.path}
            exists={current.file.exists}
            savedAt={current.savedAt}
            dirty={isDirty}
          />
        )}
        {isFileTab && current && current.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
            data-testid="memory-error"
          >
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span>{current.error}</span>
          </div>
        )}
      </div>

      {active === 'search' ? (
        <SearchPanel />
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-testid={`memory-editor-${active}`}
        >
          {current!.loading ? (
            <div className="flex flex-1 items-center justify-center text-fg-subtle">
              <Icon icon={Loader2} size="md" className="animate-spin" />
            </div>
          ) : (
            <MarkdownEditor
              value={current!.dirty}
              onChange={(next) => patch(active, { dirty: next })}
              onSave={() => void save(active)}
              testId={`memory-textarea-${active}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
