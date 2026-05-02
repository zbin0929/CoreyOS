import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Brain, Loader2, Plus, Save, Trash2, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  learningSuggestRouting,
  routingRuleDelete,
  routingRuleUpsert,
  type RoutingMatch,
  type RoutingRule,
  type RoutingSuggestion,
} from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';
import { useRoutingStore } from '@/stores/routing';

import { Field, Section } from '../shared';

/**
 * T6.4 — manage prompt-routing rules. Each rule maps a prefix /
 * substring / regex match to a target adapter. Rules are evaluated
 * top-to-bottom by Rust; the UI renders them in a flat list with
 * inline edit/delete + an AI-suggested-rules button (Phase E · P4)
 * that mines the user's history for repeating patterns.
 */
export function RoutingRulesSection() {
  const { t } = useTranslation();
  const rules = useRoutingStore((s) => s.rules);
  const setRules = useRoutingStore((s) => s.setRules);
  const hydrate = useRoutingStore((s) => s.hydrate);
  const adapters = useAgentsStore((s) => s.adapters);
  const [adding, setAdding] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<RoutingSuggestion[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (rules === null) void hydrate();
  }, [rules, hydrate]);

  const adapterOptions = (adapters ?? []).map((a) => ({
    value: a.id,
    label: a.name ? `${a.name} (${a.id})` : a.id,
  }));

  return (
    <Section
      id="settings-routing"
      title={t('settings.routing_rules.title')}
      description={t('settings.routing_rules.desc')}
    >
      {rules === null ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Loader2} size="sm" className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="routing-rules-list">
          {rules.map((r) => (
            <RoutingRuleRow
              key={r.id}
              initial={r}
              adapterOptions={adapterOptions}
              onSaved={(next) => {
                setRules((rules ?? []).map((p) => (p.id === next.id ? next : p)));
              }}
              onDeleted={() => {
                setRules((rules ?? []).filter((p) => p.id !== r.id));
              }}
            />
          ))}
          {rules.length === 0 && !adding && (
            <div className="rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-4 text-center text-xs text-fg-subtle">
              {t('settings.routing_rules.empty')}
            </div>
          )}
        </ul>
      )}

      {adding ? (
        <RoutingRuleRow
          isNew
          adapterOptions={adapterOptions}
          initial={{
            id: '',
            name: '',
            enabled: true,
            match: { kind: 'prefix', value: '/code ', case_sensitive: false },
            target_adapter_id: adapterOptions[0]?.value ?? 'hermes',
          }}
          onSaved={(next) => {
            setRules([...(rules ?? []), next]);
            setAdding(false);
          }}
          onCancelNew={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setAdding(true)}
            data-testid="routing-rules-add"
          >
            <Icon icon={Plus} size="sm" />
            {t('settings.routing_rules.add')}
          </Button>
        </div>
      )}

      {/* Phase E · P4 — AI routing suggestions */}
      <div className="mt-4 rounded-md border border-dashed border-border bg-bg-elev-1 px-3 py-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={aiLoading}
            onClick={() => {
              setAiLoading(true);
              void learningSuggestRouting()
                .then(setAiSuggestions)
                .catch(() => setAiSuggestions([]))
                .finally(() => setAiLoading(false));
            }}
            data-testid="routing-ai-suggest"
          >
            <Icon icon={Wand2} size="sm" />
            {t('settings.routing_rules.ai_suggest')}
          </Button>
          {aiLoading && (
            <Icon icon={Loader2} size="sm" className="animate-spin text-fg-subtle" />
          )}
        </div>
        {aiSuggestions !== null && aiSuggestions.length === 0 && (
          <p className="mt-2 text-xs text-fg-subtle">
            {t('settings.routing_rules.ai_empty')}
          </p>
        )}
        {aiSuggestions && aiSuggestions.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {aiSuggestions.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded border border-border bg-bg-elev-2 px-3 py-2 text-xs"
              >
                <Icon icon={Brain} size="xs" className="mt-0.5 flex-none text-gold-500" />
                <div className="flex-1">
                  <p className="font-medium text-fg">{s.pattern}</p>
                  <p className="text-fg-subtle">{s.reason}</p>
                  <p className="mt-1 text-fg-muted">
                    {t('settings.routing_rules.ai_confidence')}: {Math.round(s.confidence * 100)}%
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function RoutingRuleRow({
  initial,
  isNew = false,
  adapterOptions,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  initial: RoutingRule;
  isNew?: boolean;
  adapterOptions: Array<{ value: string; label: string }>;
  onSaved: (next: RoutingRule) => void;
  onDeleted?: () => void;
  onCancelNew?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RoutingRule>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await routingRuleUpsert(draft);
      setDraft(saved);
      onSaved(saved);
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!onDeleted) return;
    if (!window.confirm(t('settings.routing_rules.confirm_delete', { name: draft.name })))
      return;
    setSaving(true);
    try {
      await routingRuleDelete(draft.id);
      onDeleted();
    } catch (e) {
      setErr(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Helper: update a single field on the match predicate while
  // preserving the discriminant + case toggle.
  function setMatch(next: Partial<RoutingMatch>): void {
    setDraft({
      ...draft,
      match: { ...draft.match, ...next } as RoutingMatch,
    });
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border p-3',
        draft.enabled
          ? 'border-border bg-bg-elev-1'
          : 'border-border/50 bg-bg-elev-1/50',
      )}
      data-testid={`routing-rule-row-${initial.id || 'new'}`}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t('settings.routing_rules.field_id')}
          hint={t('settings.routing_rules.field_id_hint')}
        >
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none disabled:opacity-50"
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            placeholder="code-prefix"
            disabled={!isNew}
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.routing_rules.field_name')}>
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t('settings.routing_rules.field_name_placeholder')}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('settings.routing_rules.field_kind')}>
          <Select<RoutingMatch['kind']>
            value={draft.match.kind}
            onChange={(kind) => {
              setDraft({
                ...draft,
                match: {
                  kind,
                  value: draft.match.value,
                  case_sensitive: draft.match.case_sensitive,
                } as RoutingMatch,
              });
            }}
            options={[
              { value: 'prefix', label: t('settings.routing_rules.kind_prefix') },
              { value: 'contains', label: t('settings.routing_rules.kind_contains') },
              { value: 'regex', label: t('settings.routing_rules.kind_regex') },
            ]}
          />
        </Field>
        <Field label={t('settings.routing_rules.field_value')}>
          <input
            type="text"
            className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
            value={draft.match.value}
            onChange={(e) => setMatch({ value: e.target.value })}
            placeholder={
              draft.match.kind === 'regex' ? '^\\d{4}' : '/code '
            }
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.routing_rules.field_adapter')}>
          <Select
            value={draft.target_adapter_id}
            onChange={(v) => setDraft({ ...draft, target_adapter_id: v })}
            options={
              adapterOptions.length === 0
                ? [{ value: draft.target_adapter_id, label: draft.target_adapter_id }]
                : adapterOptions
            }
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          {t('settings.routing_rules.enabled')}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.match.case_sensitive === true}
            onChange={(e) => setMatch({ case_sensitive: e.target.checked })}
          />
          {t('settings.routing_rules.case_sensitive')}
        </label>
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isNew ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onCancelNew?.()}>
            {t('common.cancel')}
          </Button>
        ) : (
          onDeleted && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={saving}
            >
              <Icon icon={Trash2} size="sm" className="text-danger" />
              {t('common.delete')}
            </Button>
          )
        )}
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={onSave}
          disabled={
            saving ||
            !draft.id.trim() ||
            !draft.match.value.trim() ||
            !draft.target_adapter_id.trim()
          }
          data-testid={`routing-rule-save-${initial.id || 'new'}`}
        >
          {saving ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Save} size="sm" />
          )}
          {isNew ? t('settings.routing_rules.create') : t('settings.routing_rules.save')}
        </Button>
      </div>
    </li>
  );
}
