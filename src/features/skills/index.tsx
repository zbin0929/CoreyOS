import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  FileText,
  FolderClosed,
  History,
  Loader2,
  Plus,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { HubPanel } from './HubPanel';
import { MarkdownEditor } from './MarkdownEditor';
import { SkillHistoryDrawer } from './SkillHistoryDrawer';
import './skills.css';
import {
  ipcErrorMessage,
  skillDelete,
  skillGet,
  skillList,
  skillSave,
  type SkillContent,
  type SkillSummary,
} from '@/lib/ipc';

/**
 * Phase 4 · T4.2 — Skill editor (MVP).
 *
 * Browse → edit → save for Markdown files under `~/.hermes/skills/`.
 * Deliberately lean compared to the original Phase 4 plan:
 *
 * - No CodeMirror. A `<textarea>` is enough for the first pass — the
 *   files ARE just Markdown, a plain textarea with monospace font
 *   handles them fine. Upgrading to CodeMirror 6 is a drop-in later.
 *   (Weight: ~300kb gzipped avoided today.)
 * - No test-runner. The plan's streaming preview requires wiring chat
 *   with a `{parameters}` form derived from frontmatter. Defer until
 *   we have user feedback on what "test this skill" should mean.
 * - No version history / rollback. We rely on the user's VCS if they
 *   need it. Phase-4b will land a journaled snapshot scheme.
 *
 * What this does ship:
 *   - Tree on the left grouped by directory (one level deep is enough
 *     for Hermes's own skill library).
 *   - Editor on the right with dirty-state tracking + save button.
 *   - Create-new via an inline name prompt.
 *   - Delete with no confirmation dialog — skill files on disk are
 *     cheap to restore from the user's dotfiles repo.
 */

type Selection =
  | { kind: 'none' }
  | { kind: 'new'; name: string }
  | { kind: 'loading'; path: string }
  | { kind: 'open'; path: string; loaded: SkillContent; dirty: string }
  | { kind: 'error'; path: string | null; message: string };

type Tab = 'local' | 'hub';

export function SkillsRoute() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('local');
  const [list, setList] = useState<SkillSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ kind: 'none' });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setListError(null);
    try {
      setList(await skillList());
    } catch (e) {
      setListError(ipcErrorMessage(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo(() => groupByFolder(list ?? []), [list]);

  const select = useCallback(async (path: string) => {
    setSel({ kind: 'loading', path });
    try {
      const loaded = await skillGet(path);
      setSel({ kind: 'open', path, loaded, dirty: loaded.body });
    } catch (e) {
      setSel({ kind: 'error', path, message: ipcErrorMessage(e) });
    }
  }, []);

  const save = useCallback(async () => {
    if (sel.kind !== 'open' || saving) return;
    if (sel.dirty === sel.loaded.body) return; // nothing to save
    setSaving(true);
    try {
      const fresh = await skillSave(sel.path, sel.dirty, false);
      setSel({ kind: 'open', path: sel.path, loaded: fresh, dirty: fresh.body });
      await reload();
    } catch (e) {
      setSel((s) =>
        s.kind === 'open'
          ? { kind: 'error', path: s.path, message: ipcErrorMessage(e) }
          : s,
      );
    } finally {
      setSaving(false);
    }
  }, [sel, saving, reload]);

  // Restore from history: write the historical body via the normal
  // save path so the current version gets snapshotted before
  // overwrite (restore itself stays reversible).
  const restoreBody = useCallback(
    async (body: string) => {
      if (sel.kind !== 'open') return;
      setSaving(true);
      try {
        const fresh = await skillSave(sel.path, body, false);
        setSel({ kind: 'open', path: sel.path, loaded: fresh, dirty: fresh.body });
        await reload();
      } catch (e) {
        setSel((s) =>
          s.kind === 'open'
            ? { kind: 'error', path: s.path, message: ipcErrorMessage(e) }
            : s,
        );
      } finally {
        setSaving(false);
      }
    },
    [sel, reload],
  );

  const [historyOpen, setHistoryOpen] = useState(false);

  const createNew = useCallback(async (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    const path = name.endsWith('.md') ? name : `${name}.md`;
    const body = `# ${stripMdExt(path)}\n\nWrite your prompt here. Supports {{params}}.\n`;
    try {
      const fresh = await skillSave(path, body, true);
      setSel({ kind: 'open', path, loaded: fresh, dirty: fresh.body });
      await reload();
    } catch (e) {
      setSel({ kind: 'error', path: null, message: ipcErrorMessage(e) });
    }
  }, [reload]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('skills.title')}
        subtitle={t('skills.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('skills.title')}
              content={t('skills.help_page')}
              testId="skills-help"
            />
            {tab === 'local' ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => setSel({ kind: 'new', name: '' })}
                data-testid="skills-new"
              >
                <Icon icon={Plus} size="sm" />
                {t('skills.new')}
              </Button>
            ) : null}
          </div>
        }
      />

      {/* T7.4 — Local vs Hub tabs. The hub panel is a separate module
          so the existing local editor logic stays untouched; swapping
          tabs is a pure render switch. */}
      <div
        className="flex border-b border-border bg-bg-elev-1 px-4"
        role="tablist"
        aria-label={t('skills.tabs_label')}
      >
        {(['local', 'hub'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'px-3 py-2 text-xs font-medium transition',
              tab === k
                ? 'border-b-2 border-accent text-fg'
                : 'border-b-2 border-transparent text-fg-muted hover:text-fg',
            )}
            data-testid={`skills-tab-${k}`}
          >
            {k === 'local' ? t('skills.tab_local') : t('skills.tab_hub')}
          </button>
        ))}
      </div>

      {tab === 'hub' ? (
        <HubPanel />
      ) : (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Tree */}
        <aside
          className="flex w-72 flex-none flex-col overflow-hidden border-r border-border bg-bg-elev-1"
          data-testid="skills-tree"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listError && (
              <div className="m-2 flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
                <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
                <span className="break-all">{listError}</span>
              </div>
            )}
            {list === null ? (
              <div className="flex items-center gap-2 p-3 text-xs text-fg-muted">
                <Icon icon={Loader2} size="sm" className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : list.length === 0 ? (
              <div className="p-3 text-xs text-fg-subtle">
                {t('skills.empty_tree')}
              </div>
            ) : (
              <ul className="flex flex-col">
                {groups.map(({ group, rows }) => (
                  <li key={group ?? '__root__'}>
                    {group !== null && (
                      <div className="flex items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                        <Icon icon={FolderClosed} size="xs" />
                        <span className="truncate">{group}</span>
                      </div>
                    )}
                    <ul className="flex flex-col">
                      {rows.map((s) => (
                        <li key={s.path}>
                          <button
                            type="button"
                            onClick={() => void select(s.path)}
                            className={cn(
                              'flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors',
                              'hover:bg-bg-elev-2',
                              sel.kind !== 'none' &&
                                'path' in sel &&
                                sel.path === s.path &&
                                'bg-bg-elev-2 text-fg',
                            )}
                            data-testid={`skill-row-${s.path}`}
                          >
                            <Icon icon={FileText} size="xs" className="flex-none text-fg-subtle" />
                            <span className="truncate">{s.name}</span>
                            {s.path.startsWith('auto/') && (
                              <span className="ml-auto flex-none rounded border border-gold-500/40 bg-gold-500/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-gold-500">
                                AI
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Editor */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {sel.kind === 'none' && (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={Wand2}
                title={t('skills.pick_title')}
                description={t('skills.pick_desc')}
              />
            </div>
          )}
          {sel.kind === 'new' && (
            <NewSkillPrompt
              name={sel.name}
              onChange={(name) => setSel({ kind: 'new', name })}
              onCancel={() => setSel({ kind: 'none' })}
              onCreate={() => void createNew(sel.name)}
            />
          )}
          {sel.kind === 'loading' && (
            <div className="flex flex-1 items-center justify-center text-fg-muted">
              <Icon icon={Loader2} size="md" className="animate-spin" />
            </div>
          )}
          {sel.kind === 'error' && (
            <div className="m-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <span className="break-all">{sel.message}</span>
            </div>
          )}
          {sel.kind === 'open' && (
            <Editor
              sel={sel}
              saving={saving}
              onChange={(body) =>
                setSel((s) => (s.kind === 'open' ? { ...s, dirty: body } : s))
              }
              onSave={() => void save()}
              onHistory={() => setHistoryOpen(true)}
              onDelete={async () => {
                try {
                  await skillDelete(sel.path);
                  setSel({ kind: 'none' });
                  await reload();
                } catch (e) {
                  setSel({ kind: 'error', path: sel.path, message: ipcErrorMessage(e) });
                }
              }}
            />
          )}
        </section>
      </div>
      )}

      <SkillHistoryDrawer
        open={historyOpen}
        path={sel.kind === 'open' ? sel.path : null}
        // Diff baseline is the last-saved body, not the dirty buffer.
        // Diffing against unsaved edits would surface a change the
        // user hasn't committed yet, which conflates two concerns
        // ("what did this version change" vs "what's in my editor").
        currentBody={sel.kind === 'open' ? sel.loaded.body : ''}
        onClose={() => setHistoryOpen(false)}
        onRestore={restoreBody}
      />
    </div>
  );
}

// ───────────────────────── Editor pane ─────────────────────────

function Editor({
  sel,
  saving,
  onChange,
  onSave,
  onDelete,
  onHistory,
}: {
  sel: Extract<Selection, { kind: 'open' }>;
  saving: boolean;
  onChange: (body: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  const dirty = sel.dirty !== sel.loaded.body;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="skills-editor">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon icon={FileText} size="sm" className="text-fg-subtle" />
            <code className="truncate font-mono text-xs text-fg">{sel.path}</code>
            {dirty && (
              <span
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-500"
                data-testid="skills-dirty-badge"
              >
                {t('skills.unsaved')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onHistory}
            disabled={saving}
            data-testid="skills-history"
            title={t('skills.history_title')}
          >
            <Icon icon={History} size="sm" />
            {t('skills.history')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={saving}
            data-testid="skills-delete"
            title={t('skills.delete')}
          >
            <Icon icon={Trash2} size="sm" className="text-danger" />
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onSave}
            disabled={saving || !dirty}
            data-testid="skills-save"
          >
            {saving ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Save} size="sm" />
            )}
            {t('skills.save')}
          </Button>
        </div>
      </header>
      <MarkdownEditor value={sel.dirty} onChange={onChange} onSave={onSave} />
    </div>
  );
}

// ───────────────────────── New-skill prompt ─────────────────────────

function NewSkillPrompt({
  name,
  onChange,
  onCancel,
  onCreate,
}: {
  name: string;
  onChange: (name: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate();
      }}
      className="m-auto flex w-full max-w-md flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="skills-new-form"
    >
      <h2 className="text-sm font-medium text-fg">{t('skills.new')}</h2>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">{t('skills.field.path')}</span>
        <input
          value={name}
          onChange={(e) => onChange(e.target.value)}
          placeholder="daily-standup.md"
          autoFocus
          className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 font-mono text-sm text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="skills-new-name"
        />
        <span className="text-[10px] text-fg-subtle">
          {t('skills.field.path_hint')}
        </span>
      </label>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          {t('skills.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={!name.trim()}
          data-testid="skills-new-create"
        >
          <Icon icon={Check} size="sm" />
          {t('skills.create')}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Helpers ─────────────────────────

/** Group summaries by their parent directory. `null` group for root. */
function groupByFolder(
  rows: SkillSummary[],
): Array<{ group: string | null; rows: SkillSummary[] }> {
  const buckets = new Map<string | null, SkillSummary[]>();
  for (const r of rows) {
    const key = r.group ?? null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }
  // Root first, then folders alphabetically.
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ group: k, rows: buckets.get(k)! }));
}

function stripMdExt(path: string): string {
  return path.replace(/\.md$/i, '');
}
