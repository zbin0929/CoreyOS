import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Server,
  Trash2,
  Wand2,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesInstanceDelete,
  hermesInstanceList,
  hermesInstanceTest,
  hermesInstanceUpsert,
  ipcErrorMessage,
  sandboxScopeList,
  type HermesInstance,
  type HermesInstanceProbeResult,
  type SandboxScope,
} from '@/lib/ipc';
import { AgentWizard } from './AgentWizard';
import { Section, Field } from './shared';
import { PROVIDER_TEMPLATES } from './providerTemplates';

type AgentProbeState = 'probing' | 'ok' | 'err';

export function HermesInstancesSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HermesInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [scopes, setScopes] = useState<SandboxScope[]>([]);
  const [probes, setProbes] = useState<Record<string, AgentProbeState>>({});

  async function testInstance(inst: HermesInstance) {
    setProbes((prev) => ({ ...prev, [inst.id]: 'probing' }));
    try {
      const r = await hermesInstanceTest(inst);
      setProbes((prev) => ({ ...prev, [inst.id]: r.ok ? 'ok' : 'err' }));
    } catch {
      setProbes((prev) => ({ ...prev, [inst.id]: 'err' }));
    }
  }

  async function refresh() {
    setError(null);
    try {
      const [instResp, scopeResp] = await Promise.all([
        hermesInstanceList(),
        sandboxScopeList().catch(() => [] as SandboxScope[]),
      ]);
      setRows(instResp.instances);
      setScopes(scopeResp);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setRows([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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
        void testInstance(r);
      }, delay);
    }
  }, [rows]);

  const editingRow = editingId
    ? (rows ?? []).find((r) => r.id === editingId) ?? null
    : null;

  return (
    <Section
      title={t('settings.hermes_instances.title')}
      description={t('settings.hermes_instances.desc')}
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => setWizardOpen(true)}
          data-testid="hermes-instances-quick-add"
        >
          <Icon icon={Plus} size="sm" />
          {t('settings.hermes_instances.quick_add')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void sandboxScopeList()
              .then((next) => setScopes(next))
              .catch(() => {});
            setAdding(true);
          }}
          data-testid="hermes-instances-add"
        >
          {t('settings.hermes_instances.add_advanced')}
        </Button>
      </div>

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
          data-testid="hermes-instances-list"
        >
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
            <Icon icon={Server} size="md" className="text-accent" />
          </div>
          <p className="mb-1 font-medium text-fg">{t('settings.hermes_instances.empty_title')}</p>
          <p className="mb-3">{t('settings.hermes_instances.empty')}</p>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => setWizardOpen(true)}
          >
            <Icon icon={Plus} size="sm" />
            {t('settings.hermes_instances.quick_add')}
          </Button>
        </div>
      ) : (
        <div
          className="columns-1 gap-3 sm:columns-2 xl:columns-3"
          data-testid="hermes-instances-list"
        >
          {rows.map((r) => (
            <div key={r.id} className="mb-3 break-inside-avoid">
              <HermesInstanceCard
                instance={r}
                scope={scopes.find((s) => s.id === r.sandbox_scope_id) ?? null}
                onOpen={() => setEditingId(r.id)}
                probe={probes[r.id]}
                onTest={() => void testInstance(r)}
              />
            </div>
          ))}
        </div>
      )}

      <AgentWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        existingIds={(rows ?? []).map((r) => r.id)}
        onCreated={async (next) => {
          setRows((prev) => [...(prev ?? []), next]);
        }}
      />

      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        side="right"
        title={t('settings.hermes_instances.new_row')}
        testId="hermes-instance-new-drawer"
      >
        <HermesInstanceRow
          initial={{
            id: '',
            label: '',
            base_url: 'http://127.0.0.1:8642',
            api_key: null,
            default_model: null,
            sandbox_scope_id: null,
          }}
          isNew
          scopes={scopes}
          onSaved={async (next) => {
            setRows((prev) => [...(prev ?? []), next]);
            setAdding(false);
          }}
          onCancelNew={() => setAdding(false)}
        />
      </Drawer>

      <Drawer
        open={editingRow !== null}
        onClose={() => setEditingId(null)}
        side="right"
        title={editingRow?.label || editingRow?.id}
        testId="hermes-instance-edit-drawer"
      >
        {editingRow && (
          <HermesInstanceRow
            key={editingRow.id}
            initial={editingRow}
            scopes={scopes}
            onSaved={async (next) => {
              setRows((prev) =>
                (prev ?? []).map((p) => (p.id === next.id ? next : p)),
              );
              setEditingId(null);
            }}
            onDeleted={async () => {
              setRows((prev) => (prev ?? []).filter((p) => p.id !== editingRow.id));
              setEditingId(null);
            }}
            onCancelNew={() => setEditingId(null)}
          />
        )}
      </Drawer>
    </Section>
  );
}

function HermesInstanceCard({
  instance,
  scope,
  onOpen,
  probe,
  onTest,
}: {
  instance: HermesInstance;
  scope: SandboxScope | null;
  onOpen: () => void;
  probe?: AgentProbeState;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex w-full flex-col items-start gap-2 rounded-md border border-border bg-bg-elev-1 p-3 pr-10 text-left',
          'transition-colors hover:border-gold-500/40 hover:bg-bg-elev-2',
          'focus:outline-none focus-visible:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/30',
        )}
        data-testid={`hermes-instance-card-${instance.id}`}
      >
        <div className="flex w-full items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border bg-bg-elev-2 text-xs font-semibold uppercase text-fg-muted">
            {instance.id.slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-fg">
                {instance.label || instance.id}
              </span>
              <AgentProbeDot state={probe} />
            </div>
            <code className="truncate text-[10px] text-fg-subtle">
              {instance.id}
            </code>
          </div>
          <Icon
            icon={Edit3}
            size="sm"
            className="flex-none text-fg-subtle transition-colors group-hover:text-fg"
          />
        </div>
        <div className="flex w-full flex-col gap-0.5 text-[11px] text-fg-muted">
          {instance.default_model && (
            <span className="truncate font-mono">{instance.default_model}</span>
          )}
          <code className="truncate font-mono text-fg-subtle">
            {instance.base_url}
          </code>
          {scope && (
            <span className="truncate text-fg-subtle">
              {scope.label}
              {scope.id !== 'default' ? ` · ${scope.id}` : ''}
            </span>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTest();
        }}
        disabled={probe === 'probing'}
        title={t('settings.hermes_instances.test')}
        aria-label={t('settings.hermes_instances.test')}
        className={cn(
          'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md',
          'text-fg-subtle transition-colors hover:bg-bg-elev-3 hover:text-fg',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        data-testid={`hermes-instance-test-${instance.id}`}
      >
        <Icon
          icon={probe === 'probing' ? Loader2 : Wifi}
          size="sm"
          className={probe === 'probing' ? 'animate-spin' : undefined}
        />
      </button>
    </div>
  );
}

function AgentProbeDot({ state }: { state?: AgentProbeState }) {
  const { t } = useTranslation();
  if (!state) return null;
  const cls =
    state === 'ok'
      ? 'bg-emerald-500'
      : state === 'err'
        ? 'bg-danger'
        : 'bg-amber-500 animate-pulse';
  const title =
    state === 'ok'
      ? t('models_page.profile_probe_ok')
      : state === 'err'
        ? t('models_page.profile_probe_err')
        : t('models_page.profile_probe_running');
  return (
    <span
      className={cn('inline-block h-2 w-2 flex-none rounded-full', cls)}
      title={title}
      aria-label={title}
      role="status"
    />
  );
}

function HermesInstanceRow({
  initial,
  isNew = false,
  scopes,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  initial: HermesInstance;
  isNew?: boolean;
  scopes: SandboxScope[];
  onSaved: (next: HermesInstance) => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onCancelNew?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<HermesInstance>(initial);
  const [showKey, setShowKey] = useState(false);
  const [probe, setProbe] = useState<HermesInstanceProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onTest() {
    setProbing(true);
    setErr(null);
    try {
      const r = await hermesInstanceTest(draft);
      setProbe(r);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setProbing(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await hermesInstanceUpsert(draft);
      setDraft(saved);
      await onSaved(saved);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const h = window.setTimeout(() => setDeleteArmed(false), 3000);
    return () => window.clearTimeout(h);
  }, [deleteArmed]);

  async function onDelete() {
    if (!onDeleted) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await hermesInstanceDelete(draft.id);
      await onDeleted();
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-3"
      data-testid={`hermes-instance-row-${initial.id || 'new'}`}
    >
      <div className="flex items-center gap-2">
        <Icon icon={Server} size="sm" className="text-fg-subtle" />
        <span className="text-sm font-medium text-fg">
          {draft.label.trim() || draft.id || t('settings.hermes_instances.new_row')}
        </span>
        {!isNew && (
          <code className="rounded bg-bg-elev-3 px-1 py-0.5 text-[10px] text-fg-muted">
            hermes:{initial.id}
          </code>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t('settings.hermes_instances.field_id')}
          hint={t('settings.hermes_instances.field_id_hint')}
        >
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none disabled:opacity-50"
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            placeholder="work"
            disabled={!isNew}
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.hermes_instances.field_label')}>
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder={t('settings.hermes_instances.field_label_placeholder')}
          />
        </Field>
      </div>

      <Field label={t('settings.hermes_instances.field_base_url')}>
        <input
          type="url"
          className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
          value={draft.base_url}
          onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
          placeholder="http://127.0.0.1:8642"
          spellCheck={false}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('settings.hermes_instances.field_api_key')}>
          <div className="flex items-center gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
              value={draft.api_key ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, api_key: e.target.value || null })
              }
              placeholder={t('settings.hermes_instances.field_api_key_placeholder')}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowKey((v) => !v)}
              aria-label={
                showKey
                  ? t('settings.gateway.hide_key')
                  : t('settings.gateway.show_key')
              }
            >
              <Icon icon={showKey ? EyeOff : Eye} size="sm" />
            </Button>
          </div>
        </Field>
        <Field
          label={t('settings.hermes_instances.field_default_model')}
          hint={t('settings.hermes_instances.field_default_model_hint')}
        >
          {(() => {
            const tpl = PROVIDER_TEMPLATES.find((p) =>
              draft.base_url
                ? draft.base_url.startsWith(p.baseUrl.replace(/\/v1\/?$/, ''))
                : false,
            );
            const suggestions = tpl?.suggestedModels ?? [];
            return (
              <Combobox
                value={draft.default_model ?? ''}
                onChange={(v) =>
                  setDraft({ ...draft, default_model: v || null })
                }
                options={suggestions.map((m) => ({ value: m, label: m }))}
                placeholder={
                  suggestions[0] ??
                  t('settings.hermes_instances.field_default_model_placeholder')
                }
                inputClassName="font-mono"
                data-testid={`hermes-instance-model-${initial.id || 'new'}`}
                ariaLabel={t('settings.hermes_instances.field_default_model')}
              />
            );
          })()}
        </Field>
      </div>

      <Field
        label={t('settings.hermes_instances.field_sandbox_scope')}
        hint={t('settings.hermes_instances.field_sandbox_scope_hint')}
      >
        <select
          data-testid="hermes-instance-scope-new"
          className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          value={draft.sandbox_scope_id ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, sandbox_scope_id: e.target.value || null })
          }
        >
          <option value="">{t('settings.hermes_instances.scope_default')}</option>
          {scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.id})
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onTest()}
          disabled={probing}
        >
          <Icon icon={probing ? Loader2 : Wifi} size="sm" className={probing ? 'animate-spin' : undefined} />
          {t('settings.hermes_instances.test')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void onSave()}
          disabled={saving}
        >
          <Icon icon={Wand2} size="sm" />
          {t('settings.hermes_instances.save')}
        </Button>
        {isNew ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancelNew}
          >
            {t('common.cancel')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onDelete()}
            disabled={saving}
            className={deleteArmed ? 'text-danger hover:bg-danger/10' : ''}
          >
            <Icon icon={Trash2} size="sm" />
            {deleteArmed ? t('settings.hermes_instances.confirm_delete') : t('common.delete')}
          </Button>
        )}
      </div>

      {probe && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-xs',
            probe.ok
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600'
              : 'border-danger/30 bg-danger/5 text-danger',
          )}
        >
          {probe.ok ? t('settings.hermes_instances.probe_ok') : t('settings.hermes_instances.probe_err')}
        </div>
      )}

      {err && (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}
    </li>
  );
}
