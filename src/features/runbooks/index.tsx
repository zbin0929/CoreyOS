import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertCircle,
  BookMarked,
  Check,
  Download,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  runbookDelete,
  runbookList,
  runbookUpsert,
  type RunbookRow,
} from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';
import { useComposerStore } from '@/stores/composer';

import { RunDialog } from './RunDialog';
import { RunbookEditor } from './RunbookEditor';
import { newRunbookId } from './newRunbookId';
import {
  detectParams,
  parseImportPayload,
  renderRunbook,
  runbookScopeApplies,
} from './utils';

/**
 * Phase 4 · T4.6 — Runbooks.
 *
 * A runbook is a named prompt template with `{{param}}` placeholders. The
 * page lets you CRUD them; selecting "Use" fills the params via an inline
 * dialog, then drops the rendered prompt into the Chat composer via the
 * `composer` store. Palette integration (separate PR) uses the same
 * `launchRunbook` helper, exported at the bottom so it stays in one place.
 *
 * Subcomponents live in siblings: `RunbookEditor.tsx` for the
 * create/edit form, `RunDialog.tsx` for the param-fill modal, and
 * `newRunbookId.ts` / `utils.ts` for shared pure helpers.
 */

type Mode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; runbook: RunbookRow }
  | { kind: 'run'; runbook: RunbookRow };

export function RunbooksRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RunbookRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  // T4.6b — show runbooks scoped to *any* profile OR to the active one.
  // Users can flip to "show all" to edit runbooks across scopes without
  // switching Hermes profile first.
  const [showAllScopes, setShowAllScopes] = useState(false);
  const activeProfile = useAppStatusStore((s) => s.activeProfile);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await runbookList());
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // ─── T-polish: JSON export / import ───
  //
  // Shape is an envelope `{ version: 1, runbooks: RunbookExportEntry[] }`
  // so we have room to add metadata (e.g. exporter_version, source)
  // without breaking parsing. On import we assign fresh ids + timestamps
  // so pasting the same archive twice produces duplicates rather than
  // silently overwriting the originals.
  const onExport = useCallback(() => {
    if (!rows || rows.length === 0) return;
    const payload = {
      version: 1 as const,
      exported_at: new Date().toISOString(),
      runbooks: rows.map((rb) => ({
        name: rb.name,
        description: rb.description,
        template: rb.template,
        scope_profile: rb.scope_profile,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `runbooks-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const onImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so selecting the same file twice still fires.
      e.target.value = '';
      if (!file) return;
      setError(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const entries = parseImportPayload(parsed);
        if (entries.length === 0) {
          setError(t('runbooks.import_empty'));
          return;
        }
        // Assign fresh ids + timestamps — never overwrite existing rows
        // by id match. The user can always hand-rename after import.
        const now = Date.now();
        let imported = 0;
        for (const entry of entries) {
          const row: RunbookRow = {
            id: newRunbookId(),
            name: entry.name,
            description: entry.description ?? null,
            template: entry.template,
            scope_profile: entry.scope_profile ?? null,
            created_at: now,
            updated_at: now,
          };
          await runbookUpsert(row);
          imported += 1;
        }
        await load();
        setError(null);
        // Surface the count via the info hint slot — reuse the banner
        // slot but with a success tone. Simpler than wiring a toast
        // system for a one-off signal.
        setImportNotice(t('runbooks.import_ok', { n: imported }));
        window.setTimeout(() => setImportNotice(null), 4000);
      } catch (err) {
        setError(
          `${t('runbooks.import_failed')}: ${ipcErrorMessage(err)}`,
        );
      }
    },
    [load, t],
  );
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // Partition rows into "visible in the current profile" vs "hidden by
  // scope". Tracking `hiddenCount` so the filter toggle has a meaningful
  // badge even when the list itself is empty.
  const visibleRows = useMemo(() => {
    if (rows === null) return null;
    if (showAllScopes) return rows;
    return rows.filter((rb) => runbookScopeApplies(rb, activeProfile));
  }, [rows, showAllScopes, activeProfile]);
  const hiddenCount = rows && !showAllScopes
    ? rows.length - (visibleRows?.length ?? 0)
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('runbooks.title')}
        subtitle={t('runbooks.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('runbooks.title')}
              content={t('runbooks.help_page')}
              testId="runbooks-help"
            />
            {mode.kind === 'list' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => void onImportFile(e)}
                  data-testid="runbooks-import-input"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onImportClick}
                  data-testid="runbooks-import"
                  title={t('runbooks.import_title')}
                >
                  <Icon icon={Upload} size="sm" />
                  {t('runbooks.import')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onExport}
                  disabled={!rows || rows.length === 0}
                  data-testid="runbooks-export"
                  title={t('runbooks.export_title')}
                >
                  <Icon icon={Download} size="sm" />
                  {t('runbooks.export')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setMode({ kind: 'new' })}
                  data-testid="runbooks-new"
                >
                  <Icon icon={Plus} size="sm" />
                  {t('runbooks.new')}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <span>{error}</span>
            </div>
          )}
          {importNotice && (
            <div
              className="mb-4 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-600"
              data-testid="runbooks-import-notice"
            >
              <Icon icon={Check} size="md" className="mt-0.5 flex-none" />
              <span>{importNotice}</span>
            </div>
          )}

          {mode.kind === 'new' && (
            <RunbookEditor
              onCancel={() => setMode({ kind: 'list' })}
              onSaved={async () => {
                setMode({ kind: 'list' });
                await load();
              }}
            />
          )}
          {mode.kind === 'edit' && (
            <RunbookEditor
              initial={mode.runbook}
              onCancel={() => setMode({ kind: 'list' })}
              onSaved={async () => {
                setMode({ kind: 'list' });
                await load();
              }}
            />
          )}
          {mode.kind === 'run' && (
            <RunDialog
              runbook={mode.runbook}
              onCancel={() => setMode({ kind: 'list' })}
              onLaunch={(text) => {
                useComposerStore.getState().setPendingDraft(text);
                void navigate({ to: '/chat' });
              }}
            />
          )}

          {mode.kind === 'list' &&
            (rows === null ? (
              <div className="flex items-center gap-2 text-fg-muted">
                <Icon icon={Loader2} size="md" className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={BookMarked}
                title={t('runbooks.empty_title')}
                description={t('runbooks.empty_desc')}
              />
            ) : (
              <>
                {/* T4.6b — scope filter toggle. Only rendered when
                    some rows are scoped (either some or all are
                    profile-scoped); a flat library with zero scope
                    usage doesn't need the UI noise. */}
                {rows.some((rb) => rb.scope_profile !== null) && (
                  <div
                    className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-xs text-fg-muted"
                    data-testid="runbooks-scope-filter"
                  >
                    <span>
                      {activeProfile
                        ? t('runbooks.scope.active_hint', { profile: activeProfile })
                        : t('runbooks.scope.no_active_profile')}
                      {hiddenCount > 0 && (
                        <span className="ml-2 rounded-full bg-bg-elev-2 px-1.5 py-0.5 text-[10px]">
                          {t('runbooks.scope.hidden_count', { n: hiddenCount })}
                        </span>
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAllScopes((v) => !v)}
                      data-testid="runbooks-scope-toggle"
                    >
                      {showAllScopes
                        ? t('runbooks.scope.show_active')
                        : t('runbooks.scope.show_all')}
                    </Button>
                  </div>
                )}

                {visibleRows && visibleRows.length === 0 ? (
                  <EmptyState
                    icon={BookMarked}
                    title={t('runbooks.scope.empty_visible_title')}
                    description={t('runbooks.scope.empty_visible_desc')}
                  />
                ) : (
                  <ul className="flex flex-col gap-2" data-testid="runbooks-list">
                    {(visibleRows ?? []).map((rb) => (
                      <li
                        key={rb.id}
                        className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3"
                        data-testid={`runbook-row-${rb.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Icon icon={BookMarked} size="md" className="flex-none text-fg-muted" />
                              <span className="truncate text-sm font-medium text-fg">
                                {rb.name}
                              </span>
                            </div>
                            {rb.description && (
                              <p className="mt-1 text-xs text-fg-muted">
                                {rb.description}
                              </p>
                            )}
                            <div className="mt-1 text-[10px] text-fg-subtle">
                              {detectParams(rb.template).length > 0
                                ? t('runbooks.params_count', {
                                    n: detectParams(rb.template).length,
                                  })
                                : t('runbooks.no_params')}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                // Zero-param → skip the fill dialog and drop
                                // straight into Chat. Matches the palette
                                // behavior so the two entry points feel
                                // identical.
                                if (detectParams(rb.template).length === 0) {
                                  useComposerStore
                                    .getState()
                                    .setPendingDraft(renderRunbook(rb.template, {}));
                                  void navigate({ to: '/chat' });
                                } else {
                                  setMode({ kind: 'run', runbook: rb });
                                }
                              }}
                              data-testid={`runbook-use-${rb.id}`}
                              title={t('runbooks.use')}
                            >
                              <Icon icon={Play} size="xs" />
                              {t('runbooks.use')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setMode({ kind: 'edit', runbook: rb })}
                              data-testid={`runbook-edit-${rb.id}`}
                              title={t('runbooks.edit')}
                            >
                              <Icon icon={Pencil} size="xs" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  await runbookDelete(rb.id);
                                  await load();
                                } catch (e) {
                                  setError(ipcErrorMessage(e));
                                }
                              }}
                              data-testid={`runbook-delete-${rb.id}`}
                              title={t('runbooks.delete')}
                            >
                              <Icon icon={Trash2} size="xs" className="text-danger" />
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ))}
        </div>
      </div>
    </div>
  );
}
