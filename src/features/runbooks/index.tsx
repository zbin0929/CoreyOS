import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertCircle,
  BookMarked,
  Check,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  runbookDelete,
  runbookList,
  runbookUpsert,
  type RunbookRow,
} from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';
import { useComposerStore } from '@/stores/composer';

/**
 * Phase 4 · T4.6 — Runbooks.
 *
 * A runbook is a named prompt template with `{{param}}` placeholders. The
 * page lets you CRUD them; selecting "Use" fills the params via an inline
 * dialog, then drops the rendered prompt into the Chat composer via the
 * `composer` store. Palette integration (separate PR) uses the same
 * `launchRunbook` helper, exported at the bottom so it stays in one place.
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
          mode.kind === 'list' && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setMode({ kind: 'new' })}
              data-testid="runbooks-new"
            >
              <Icon icon={Plus} size="sm" />
              {t('runbooks.new')}
            </Button>
          )
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

// ───────────────────────── Editor ─────────────────────────

function RunbookEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: RunbookRow;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [template, setTemplate] = useState(
    initial?.template ?? 'Summarize the following notes:\n\n{{notes}}',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const params = useMemo(() => detectParams(template), [template]);
  // T4.6b — scope picker. `null` means "any profile", non-null pins the
  // runbook to a specific Hermes profile. Defaults for NEW runbooks:
  // any-profile (keeps historical behaviour). For EDIT: whatever's
  // persisted.
  const [scopeProfile, setScopeProfile] = useState<string | null>(
    initial?.scope_profile ?? null,
  );
  const activeProfile = useAppStatusStore((s) => s.activeProfile);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !template.trim() || saving) return;
    setSaving(true);
    setErr(null);
    const now = Date.now();
    const row: RunbookRow = initial
      ? {
          ...initial,
          name: name.trim(),
          description: description.trim() || null,
          template,
          scope_profile: scopeProfile,
          updated_at: now,
        }
      : {
          id: newRunbookId(),
          name: name.trim(),
          description: description.trim() || null,
          template,
          scope_profile: scopeProfile,
          created_at: now,
          updated_at: now,
        };
    try {
      await runbookUpsert(row);
      await onSaved();
    } catch (e) {
      setErr(ipcErrorMessage(e));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="runbook-editor"
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">{t('runbooks.field.name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="daily-standup"
          className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-sm text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="runbook-name"
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">{t('runbooks.field.description')}</span>
        <input
          value={description ?? ''}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('runbooks.field.description_placeholder')}
          className="rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-sm text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="runbook-description"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-subtle">
          {t('runbooks.field.template')}{' '}
          <span className="text-fg-subtle/80">{t('runbooks.field.template_hint')}</span>
        </span>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={6}
          className="min-h-[120px] resize-y rounded border border-border bg-bg-elev-2 px-2 py-1.5 font-mono text-xs text-fg focus:border-gold-500/40 focus:outline-none"
          data-testid="runbook-template"
        />
        {params.length > 0 && (
          <span className="text-[10px] text-fg-subtle">
            {t('runbooks.field.detected', { list: params.join(', ') })}
          </span>
        )}
      </label>

      {/* T4.6b — scope picker. Two-option radio keeps the UI compact;
          non-active profile scopes stay editable via direct DB edit.
          When there's no active profile Hermes isn't installed, so the
          picker hides entirely (any-profile is the only sensible
          default). */}
      {activeProfile && (
        <fieldset
          className="flex flex-col gap-1.5 rounded border border-border bg-bg-elev-2/40 px-2 py-1.5 text-xs"
          data-testid="runbook-scope-picker"
        >
          <legend className="px-1 text-fg-subtle">
            {t('runbooks.field.scope')}
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="runbook-scope"
              checked={scopeProfile === null}
              onChange={() => setScopeProfile(null)}
              data-testid="runbook-scope-any"
            />
            <span>{t('runbooks.scope.any')}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="runbook-scope"
              checked={scopeProfile === activeProfile}
              onChange={() => setScopeProfile(activeProfile)}
              data-testid="runbook-scope-current"
            />
            <span>
              {t('runbooks.scope.this_profile', { profile: activeProfile })}
            </span>
          </label>
        </fieldset>
      )}

      {err && (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/5 px-2 py-1 text-xs text-danger">
          <Icon icon={AlertCircle} size="sm" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          <Icon icon={X} size="sm" />
          {t('runbooks.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={saving || !name.trim() || !template.trim()}
          data-testid="runbook-save"
        >
          {saving ? <Icon icon={Loader2} size="sm" className="animate-spin" /> : <Icon icon={Check} size="sm" />}
          {t('runbooks.save')}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Run dialog ─────────────────────────

function RunDialog({
  runbook,
  onCancel,
  onLaunch,
}: {
  runbook: RunbookRow;
  onCancel: () => void;
  onLaunch: (rendered: string) => void;
}) {
  const { t } = useTranslation();
  const params = useMemo(() => detectParams(runbook.template), [runbook.template]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p, ''])),
  );
  const allFilled = params.every((p) => (values[p] ?? '').trim().length > 0);

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="runbook-run-dialog"
    >
      <div>
        <h2 className="text-sm font-medium text-fg">{runbook.name}</h2>
        {runbook.description && (
          <p className="text-xs text-fg-muted">{runbook.description}</p>
        )}
      </div>

      {params.length === 0 ? (
        <div className="text-xs text-fg-subtle">{t('runbooks.no_params_to_fill')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {params.map((p) => (
            <label key={p} className="flex flex-col gap-1 text-xs">
              <span className="font-mono text-fg">{`{{${p}}}`}</span>
              <textarea
                value={values[p] ?? ''}
                onChange={(e) => setValues((s) => ({ ...s, [p]: e.target.value }))}
                rows={2}
                className={cn(
                  'resize-y rounded border border-border bg-bg-elev-2 px-2 py-1.5 text-xs text-fg',
                  'focus:border-gold-500/40 focus:outline-none',
                )}
                data-testid={`runbook-param-${p}`}
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <Icon icon={X} size="sm" />
          {t('runbooks.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={params.length > 0 && !allFilled}
          onClick={() => onLaunch(renderRunbook(runbook.template, values))}
          data-testid="runbook-launch"
        >
          <Icon icon={Play} size="sm" />
          {t('runbooks.launch')}
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Helpers ─────────────────────────

/** Unique-preserving scan of `{{param}}` placeholders. Names are
 *  alphanumeric + underscore (no dots; no filters à la handlebars). */
export function detectParams(template: string): string[] {
  const re = /\{\{(\w+)\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of template.matchAll(re)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Substitute `{{param}}` with the matching value. Unknown placeholders
 *  pass through unchanged so the user sees something is off rather than
 *  an empty string. */
export function renderRunbook(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`);
}

function newRunbookId(): string {
  return `rb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * T4.6b — scope filter predicate shared by the Runbooks list and the
 * command palette. Universal runbooks (`scope_profile === null`) are
 * always visible; profile-scoped ones only match when the active
 * profile equals the scope value.
 *
 * Edge cases:
 *   - `activeProfile === null` (Hermes not installed / pointer file
 *     missing): we show ONLY universal runbooks. Scoped ones would
 *     otherwise be orphaned until the user installs Hermes, which
 *     would silently break existing workflows.
 *   - Case-sensitive match on purpose — profile dir names are
 *     filesystem-identifiers and Hermes treats them as such.
 */
export function runbookScopeApplies(
  rb: Pick<RunbookRow, 'scope_profile'>,
  activeProfile: string | null,
): boolean {
  if (rb.scope_profile === null) return true;
  if (activeProfile === null) return false;
  return rb.scope_profile === activeProfile;
}
