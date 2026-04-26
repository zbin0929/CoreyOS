import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Plus, Wand2 } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  skillDelete,
  skillGet,
  skillList,
  skillSave,
  type SkillSummary,
} from '@/lib/ipc';

import { Editor } from './Editor';
import { HubPanel } from './HubPanel';
import { NewSkillPrompt } from './NewSkillPrompt';
import { SkillHistoryDrawer } from './SkillHistoryDrawer';
import { SkillsTree } from './SkillsTree';
import { groupByFolder, stripMdExt, type Selection } from './helpers';
import './skills.css';

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
 *
 * Subcomponents live in siblings: `SkillsTree.tsx`, `Editor.tsx`,
 * `NewSkillPrompt.tsx`, `HubPanel.tsx`, `SkillHistoryDrawer.tsx`.
 * Pure helpers + the `Selection` union live in `helpers.ts`.
 */

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
          <SkillsTree
            list={list}
            groups={groups}
            listError={listError}
            sel={sel}
            onSelect={(path) => void select(path)}
          />

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
