import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Loader2,
  Save,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesMemoryStatus,
  hermesUserMdWrite,
  ipcErrorMessage,
  type HermesMemoryStatus,
} from '@/lib/ipc';

import { Section } from '../shared';

/**
 * Settings → Memory section.
 *
 * Three jobs:
 *
 *   1. **Status overview** — show which memory provider is active
 *      (`holographic` post-v9, or "built-in only" if the user
 *      disabled it), how many facts have been extracted, and a
 *      mini histogram of fact categories so the user can SEE the
 *      agent learning over time.
 *
 *   2. **USER.md editor** — direct text editor for the user-facing
 *      half of Hermes' built-in memory pair. Edit + Save → atomic
 *      write to `~/.hermes/memories/USER.md`. The agent picks it
 *      up at the next session start (it's frozen into the system
 *      prompt then; mid-session writes don't change the prompt).
 *
 *   3. **Disclaimers** — make clear that auto-extraction runs at
 *      session END (not mid-session), so the fact count won't tick
 *      up DURING a chat. This avoids users staring at a number
 *      that doesn't move and assuming it's broken.
 *
 * MEMORY.md is deliberately NOT editable here — it belongs to the
 * agent and we don't want users to develop a habit of tampering
 * with the agent's own notes (creates more confusion than it
 * solves).
 */

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'err'; message: string };

export function MemorySection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HermesMemoryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  const refresh = async () => {
    try {
      const s = await hermesMemoryStatus();
      setStatus(s);
      setDraft(s.user_md_content);
      setError(null);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  async function onSave() {
    if (save.kind === 'saving') return;
    setSave({ kind: 'saving' });
    try {
      const s = await hermesUserMdWrite(draft);
      setStatus(s);
      setDraft(s.user_md_content);
      setSave({ kind: 'saved' });
      window.setTimeout(() => {
        setSave((cur) => (cur.kind === 'saved' ? { kind: 'idle' } : cur));
      }, 2500);
    } catch (e) {
      setSave({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }

  const dirty = status !== null && draft !== status.user_md_content;

  return (
    <Section
      id="settings-memory"
      title={t('settings.memory.title')}
      description={t('settings.memory.description')}
    >
      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-2.5 text-xs text-danger flex items-start gap-2">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Status block — provider + stats. Renders skeleton dots
          while the first IPC is in flight. */}
      <div className="rounded-md border border-border bg-bg-elev-1 p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Icon icon={Brain} size="sm" className="text-gold-500" />
          <div className="text-sm font-medium text-fg">
            {status?.provider
              ? t('settings.memory.provider_active', { provider: status.provider })
              : t('settings.memory.provider_builtin_only')}
          </div>
        </div>

        {status && (
          <>
            {/* Holographic-specific knob summary. Plain-text so
                users with a different provider just see one
                line of context, not noise. */}
            {status.provider === 'holographic' && (
              <div className="text-xs text-fg-muted flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  {status.auto_extract === true
                    ? t('settings.memory.auto_extract_on')
                    : t('settings.memory.auto_extract_off')}
                </span>
                {status.temporal_decay_days !== null && status.temporal_decay_days > 0 && (
                  <span>
                    {t('settings.memory.decay', { days: status.temporal_decay_days })}
                  </span>
                )}
              </div>
            )}

            {/* Fact count + recent additions. */}
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label={t('settings.memory.fact_count')}
                value={
                  status.db_present
                    ? status.fact_count !== null
                      ? formatCount(status.fact_count)
                      : '—'
                    : t('settings.memory.fact_count_empty')
                }
                hint={
                  status.db_present
                    ? undefined
                    : t('settings.memory.fact_count_empty_hint')
                }
              />
              <Stat
                label={t('settings.memory.recent_fact_count')}
                value={
                  status.recent_fact_count !== null
                    ? formatCount(status.recent_fact_count)
                    : '—'
                }
                hint={t('settings.memory.recent_fact_count_hint')}
              />
            </div>

            {/* Top-N category histogram — text-bar style.
                Skipped when the count list is empty (DB has no
                facts yet, or schema mismatch). */}
            {status.top_categories.length > 0 && (
              <CategoryHistogram
                categories={status.top_categories}
                t={t}
              />
            )}

            {/* DB path — quiet diagnostic chip at the bottom. */}
            <div className="text-[11px] text-fg-subtle font-mono break-all">
              {status.db_path}
            </div>
          </>
        )}
      </div>

      {/* USER.md editor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Icon icon={Sparkles} size="sm" className="text-gold-500" />
          <div className="text-sm font-medium text-fg">
            {t('settings.memory.user_md_title')}
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          {t('settings.memory.user_md_description')}
        </p>
        <textarea
          rows={8}
          className={cn(
            'min-h-[160px] resize-y rounded-md border border-border bg-bg-elev-1',
            'px-3 py-2 text-sm text-fg placeholder:text-fg-subtle font-mono',
            'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
          )}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('settings.memory.user_md_placeholder')}
          spellCheck={false}
          data-testid="memory-user-md"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-fg-subtle font-mono break-all">
            {status?.user_md_path}
          </div>
          <div className="flex items-center gap-2">
            {save.kind === 'saved' && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                <Icon icon={CheckCircle2} size="xs" />
                {t('settings.memory.saved')}
              </span>
            )}
            {save.kind === 'err' && (
              <span className="inline-flex items-start gap-1 text-xs text-danger">
                <Icon icon={AlertCircle} size="xs" className="mt-0.5" />
                <span className="break-all">{save.message}</span>
              </span>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void onSave()}
              disabled={!dirty || save.kind === 'saving'}
            >
              {save.kind === 'saving' ? (
                <Icon icon={Loader2} size="xs" className="animate-spin" />
              ) : (
                <Icon icon={Save} size="xs" />
              )}
              {t('settings.memory.save')}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────── helpers ─────────────────────────

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/** Compact stat tile. Two lines: value (large) + label (muted). */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-elev-2 px-3 py-2 flex flex-col gap-0.5">
      <div className="text-base font-semibold text-fg">{value}</div>
      <div className="text-[11px] text-fg-muted">{label}</div>
      {hint && <div className="text-[10px] text-fg-subtle mt-0.5">{hint}</div>}
    </div>
  );
}

/** Horizontal text-bar histogram of fact categories. Each row = label
 *  + filled bar proportional to the largest count + numeric badge. */
function CategoryHistogram({
  categories,
  t,
}: {
  categories: { category: string; count: number }[];
  t: (k: string) => string;
}) {
  const max = Math.max(...categories.map((c) => c.count), 1);
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-medium text-fg-muted">
        {t('settings.memory.category_legend')}
      </div>
      <div className="flex flex-col gap-0.5">
        {categories.map((c) => {
          const pct = Math.max(2, Math.round((c.count / max) * 100));
          return (
            <div
              key={c.category}
              className="flex items-center gap-2 text-xs"
              title={`${c.category}: ${c.count}`}
            >
              <div className="w-20 truncate text-fg-muted">{c.category}</div>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-bg-elev-2">
                <div
                  className="h-full rounded-full bg-gold-500/60"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-8 text-right tabular-nums text-fg-subtle">
                {c.count}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
