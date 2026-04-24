import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Brain,
  Check,
  FileText,
  Loader2,
  Save,
  UserCircle2,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MarkdownEditor } from '@/features/skills/MarkdownEditor';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  memoryRead,
  memoryWrite,
  type MemoryFile,
  type MemoryKind,
} from '@/lib/ipc';

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
 *   - No session_search panel yet — deferred to a T7.3b follow-up once
 *     the Hermes FTS5 surface is pinned down. The editor + capacity
 *     meter is the core value here; search over past sessions is
 *     additive.
 *
 * Reuses the Skills CodeMirror editor verbatim: both surfaces edit
 * Markdown, both want ⌘S, both want hide-the-chrome dark mode support.
 */

type TabState = {
  loading: boolean;
  file: MemoryFile | null;
  dirty: string;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
};

function emptyTab(): TabState {
  return {
    loading: true,
    file: null,
    dirty: '',
    saving: false,
    savedAt: null,
    error: null,
  };
}

type Tabs = Record<MemoryKind, TabState>;

export function MemoryRoute() {
  const { t } = useTranslation();
  const [active, setActive] = useState<MemoryKind>('agent');
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

  const current = tabs[active];
  const isDirty = current.file != null && current.dirty !== current.file.content;

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
        }
      />

      <div className="flex flex-col gap-3 border-b border-border bg-bg-elev-1 px-4 py-3">
        <TabBar active={active} tabs={tabs} onSelect={setActive} />
        {current.file && (
          <CapacityMeter
            bytes={dirtyBytes(current.dirty)}
            maxBytes={current.file.max_bytes}
            path={current.file.path}
            exists={current.file.exists}
            savedAt={current.savedAt}
            dirty={isDirty}
          />
        )}
        {current.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
            data-testid="memory-error"
          >
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span>{current.error}</span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col" data-testid={`memory-editor-${active}`}>
        {current.loading ? (
          <div className="flex flex-1 items-center justify-center text-fg-subtle">
            <Icon icon={Loader2} size="md" className="animate-spin" />
          </div>
        ) : (
          <MarkdownEditor
            value={current.dirty}
            onChange={(next) => patch(active, { dirty: next })}
            onSave={() => void save(active)}
            testId={`memory-textarea-${active}`}
          />
        )}
      </div>
    </div>
  );
}

/** Byte-count using UTF-8 encoding so the cap matches what the Rust
 *  side enforces (which also sees the UTF-8 byte length via
 *  `String::len()`). `content.length` would under-count any char
 *  outside the BMP or any multi-byte CJK run — a real concern since
 *  most of our Chinese users write notes in `zh`. */
function dirtyBytes(content: string): number {
  // `TextEncoder` is synchronous and available in every Tauri webview
  // we target. Caching the instance is a micro-opt that isn't worth
  // the module-level state.
  return new TextEncoder().encode(content).length;
}

function TabBar({
  active,
  tabs,
  onSelect,
}: {
  active: MemoryKind;
  tabs: Tabs;
  onSelect: (kind: MemoryKind) => void;
}) {
  const { t } = useTranslation();
  const items: Array<{ kind: MemoryKind; label: string; icon: typeof Brain }> = [
    { kind: 'agent', label: t('memory.tab_agent'), icon: Brain },
    { kind: 'user', label: t('memory.tab_user'), icon: UserCircle2 },
  ];
  return (
    <div
      role="tablist"
      aria-label={t('memory.title')}
      className="inline-flex self-start rounded-lg border border-border bg-bg p-0.5"
    >
      {items.map(({ kind, label, icon }) => {
        const tab = tabs[kind];
        const dirty = tab.file != null && tab.dirty !== tab.file.content;
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={active === kind}
            onClick={() => onSelect(kind)}
            data-testid={`memory-tab-${kind}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition',
              active === kind
                ? 'bg-bg-elev-2 text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon icon={icon} size="sm" />
            <span>{label}</span>
            {/* Unsaved-changes dot mirrors the Skills editor convention
                so both pages feel like part of the same "authoring"
                surface. `aria-hidden` because the save button's
                disabled state already conveys dirtiness to ATs. */}
            {dirty && (
              <span
                aria-hidden
                className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent"
                data-testid={`memory-tab-${kind}-dirty`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function CapacityMeter({
  bytes,
  maxBytes,
  path,
  exists,
  savedAt,
  dirty,
}: {
  bytes: number;
  maxBytes: number;
  path: string;
  exists: boolean;
  savedAt: number | null;
  dirty: boolean;
}) {
  const { t } = useTranslation();
  const pct = Math.min(100, Math.round((bytes / maxBytes) * 100));
  const hot = pct >= 90;

  // "Saved 3s ago" — decays into a static timestamp after a minute.
  // Re-tick on a 1s interval only when `savedAt` is set AND recent,
  // so the page doesn't keep the event loop busy when there's nothing
  // changing.
  const savedLabel = useSavedLabel(savedAt);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 w-40 overflow-hidden rounded-full bg-bg-elev-2"
          aria-label={t('memory.capacity_meter')}
          data-testid="memory-capacity-bar"
        >
          <div
            className={cn(
              'h-full transition-[width]',
              hot ? 'bg-danger' : 'bg-accent',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn(hot && 'text-danger')}
          data-testid="memory-capacity-text"
        >
          {t('memory.capacity', {
            bytes: formatBytes(bytes),
            max: formatBytes(maxBytes),
          })}
        </span>
      </div>
      {/* Status chip: unsaved > just-saved > new file > plain path.
          Mutually exclusive so the row doesn't get noisy. */}
      {dirty ? (
        <span className="text-warning" data-testid="memory-status-dirty">
          {t('memory.unsaved')}
        </span>
      ) : savedLabel ? (
        <span
          className="inline-flex items-center gap-1 text-emerald-500"
          data-testid="memory-status-saved"
        >
          <Icon icon={Check} size="xs" />
          {savedLabel}
        </span>
      ) : !exists ? (
        <span
          className="inline-flex items-center gap-1"
          data-testid="memory-status-new"
        >
          <Icon icon={FileText} size="xs" />
          {t('memory.new_file_hint')}
        </span>
      ) : null}
      <code
        className="truncate font-mono text-[11px] text-fg-subtle"
        title={path}
      >
        {path}
      </code>
    </div>
  );
}

function useSavedLabel(savedAt: number | null): string | null {
  const { t } = useTranslation();
  // Re-render every second for the first minute after a save so the
  // "Saved 3s ago" string decays. After that we stop the interval and
  // just say "Saved".
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const elapsed = Date.now() - savedAt;
    if (elapsed > 60_000) return;
    const h = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, [savedAt]);
  return useMemo(() => {
    if (!savedAt) return null;
    const s = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
    // Reference `tick` to pin the memoised value to the ticker.
    void tick;
    if (s < 60) return t('memory.saved_ago', { seconds: s });
    return t('memory.saved');
  }, [savedAt, tick, t]);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}
