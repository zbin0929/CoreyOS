import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Plus, Server } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import {
  hermesInstanceList,
  hermesInstanceTest,
  ipcErrorMessage,
  sandboxScopeList,
  type HermesInstance,
  type SandboxScope,
} from '@/lib/ipc';

import { AgentWizard } from './AgentWizard';
import { HermesInstanceCard, type AgentProbeState } from './HermesInstanceCard';
import { HermesInstanceRow } from './HermesInstanceRow';
import { Section } from './shared';

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
