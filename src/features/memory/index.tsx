import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Brain,
  Check,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCcw,
  Save,
  Search,
  UserCircle2,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { MarkdownEditor } from '@/features/skills/MarkdownEditor';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  learningCompactMemory,
  memoryRead,
  memoryWrite,
  sessionSearch,
  type MemoryFile,
  type MemoryKind,
  type SessionSearchHit,
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
 *   - Includes a session_search tab (T7.3b) over Hermes FTS5 so users
 *     can find prior context without leaving Corey.
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

type ActiveTab = MemoryKind | 'search';

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

      <div className="flex flex-col gap-3 border-b border-border bg-bg-elev-1 px-4 py-3">
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
            className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
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
  active: ActiveTab;
  tabs: Tabs;
  onSelect: (kind: ActiveTab) => void;
}) {
  const { t } = useTranslation();
  const items: Array<{ kind: ActiveTab; label: string; icon: typeof Brain }> = [
    { kind: 'agent', label: t('memory.tab_agent'), icon: Brain },
    { kind: 'user', label: t('memory.tab_user'), icon: UserCircle2 },
    { kind: 'search', label: t('memory.tab_search'), icon: Search },
  ];
  return (
    <div
      role="tablist"
      aria-label={t('memory.title')}
      className="inline-flex self-start rounded-lg border border-border bg-bg p-0.5"
    >
      {items.map(({ kind, label, icon }) => {
        // Search tab has no file / dirty state; the dirty dot only
        // applies to the two editor tabs.
        const tab = kind !== 'search' ? tabs[kind] : null;
        const dirty =
          tab != null && tab.file != null && tab.dirty !== tab.file.content;
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
      <Button
        size="xs"
        variant="ghost"
        onClick={() => void revealInFinder(path)}
        aria-label={t('memory.reveal')}
        title={t('memory.reveal')}
        data-testid="memory-reveal"
      >
        <Icon icon={FolderOpen} size="xs" />
      </Button>
    </div>
  );
}

/**
 * "Reveal in Finder" — opens the containing directory with the
 * system's default file manager. We intentionally open the PARENT
 * directory rather than the file itself so `open("…/MEMORY.md")`
 * doesn't launch Markdown in a text editor. Best-effort: falls back
 * to a no-op when the shell plugin isn't available (tests, Storybook).
 */
async function revealInFinder(absPath: string): Promise<void> {
  const dir = absPath.slice(0, absPath.lastIndexOf('/')) || absPath;
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(dir);
  } catch {
    // Plugin unavailable in non-tauri contexts; swallow so the UI
    // doesn't toast an error for something users can work around by
    // copying the path from the tooltip.
  }
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

/**
 * T7.3b — session search tab. FTS5 over Hermes' `~/.hermes/state.db`.
 *
 * UX is intentionally spartan: a single search input (Enter to run),
 * a vertical list of hit rows. No filter chips, no "open session"
 * navigation yet — we don't have a corresponding session viewer on
 * our side (Hermes' sessions live in its DB, not Corey's). Clicking
 * a row just highlights it; the session id is in the tooltip so
 * power users can `hermes -r <id>` from the CLI.
 */
function SearchPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<SessionSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await sessionSearch(q, 50);
      setHits(rows);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setHits([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          placeholder={t('memory.search_placeholder')}
          className="flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          data-testid="memory-search-input"
        />
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run()}
          disabled={loading || !query.trim()}
          data-testid="memory-search-run"
        >
          {loading ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Search} size="sm" />
          )}
          {t('memory.search_run')}
        </Button>
      </div>
      <p className="text-[11px] text-fg-subtle">{t('memory.search_hint')}</p>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
          data-testid="memory-search-error"
        >
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto" data-testid="memory-search-results">
        {hits === null ? (
          <div className="flex items-center justify-center py-10 text-xs text-fg-subtle">
            {t('memory.search_idle')}
          </div>
        ) : hits.length === 0 ? (
          <div
            className="flex items-center justify-center py-10 text-xs text-fg-subtle"
            data-testid="memory-search-empty"
          >
            {t('memory.search_no_hits')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {hits.map((h, i) => (
              <SearchHitRow key={`${h.session_id}-${i}`} hit={h} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SearchHitRow({ hit }: { hit: SessionSearchHit }) {
  const { t } = useTranslation();
  const ts = new Date(hit.timestamp_ms);
  // FTS5 snippet comes back with `>>>match<<<` markers. We split on
  // them and wrap the matched fragments in <mark> so highlights
  // render without trusting arbitrary HTML from the query.
  const parts = splitHighlight(hit.snippet);
  return (
    <li
      className="rounded-md border border-border bg-bg-elev-1 p-3 text-xs"
      title={hit.session_id}
      data-testid="memory-search-hit"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
        <span className="font-medium text-fg">
          {hit.session_title ?? t('memory.search_untitled')}
        </span>
        <span className="rounded bg-bg-elev-2 px-1.5 py-0.5 uppercase tracking-wider">
          {hit.session_source || 'cli'}
        </span>
        <span className="rounded bg-bg-elev-2 px-1.5 py-0.5 uppercase tracking-wider">
          {hit.role}
        </span>
        <span className="ml-auto">{ts.toLocaleString()}</span>
      </div>
      <div className="whitespace-pre-wrap text-fg">
        {parts.map((p, idx) =>
          p.match ? (
            <mark
              key={idx}
              className="rounded bg-accent/20 px-0.5 text-accent"
            >
              {p.text}
            </mark>
          ) : (
            <span key={idx}>{p.text}</span>
          ),
        )}
      </div>
    </li>
  );
}

/** Parse Hermes' `>>>match<<<` snippet into alternating plain and
 *  matched fragments. Non-regex so stray `>` / `<` in user text
 *  can't trigger a runaway match. */
function splitHighlight(raw: string): Array<{ text: string; match: boolean }> {
  const out: Array<{ text: string; match: boolean }> = [];
  let i = 0;
  while (i < raw.length) {
    const openIdx = raw.indexOf('>>>', i);
    if (openIdx < 0) {
      out.push({ text: raw.slice(i), match: false });
      break;
    }
    if (openIdx > i) out.push({ text: raw.slice(i, openIdx), match: false });
    const closeIdx = raw.indexOf('<<<', openIdx + 3);
    if (closeIdx < 0) {
      // Unterminated marker — render rest as plain text.
      out.push({ text: raw.slice(openIdx), match: false });
      break;
    }
    out.push({ text: raw.slice(openIdx + 3, closeIdx), match: true });
    i = closeIdx + 3;
  }
  return out;
}
