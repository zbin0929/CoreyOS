import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  Coins,
  Columns3,
  Download,
  Loader2,
  Play,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  chatStream,
  ipcErrorMessage,
  modelList,
  type ChatMessageDto,
  type ChatStreamDone,
  type ChatStreamHandle,
  type ModelInfo,
} from '@/lib/ipc';
import { Markdown } from '@/features/chat/MessageBubble';
import { useAgentsStore } from '@/stores/agents';

/**
 * Phase 4 · T4.1 — Multi-model compare.
 *
 * Runs one shared prompt against multiple models in parallel. Each lane owns
 * an independent `chatStream` handle keyed by model id + run id, so a
 * cancel on one lane never affects the others. The route keeps all state
 * ephemeral (React state, no DB, no compare-specific IPC) so nothing
 * persists across reloads — this is a "scratch pad", not a session.
 *
 * Layout intent:
 *
 *   [ PageHeader · Run / Stop-all / Export ]
 *   [ Prompt textarea — full width ]
 *   [ Model picker chip row — add/remove ]
 *   [ Lanes — one column each, hard-capped at 4 so a 14" laptop stays readable ]
 *   [ Diff footer — latency + token winners once ≥2 lanes complete ]
 *
 * Kept intentionally as a single file (~450 LoC) with a handful of small
 * subcomponents. Splitting it across five files buys us nothing while the
 * feature is cohesive and the surface fits on one screen of code.
 */

const MAX_LANES = 4;

type LaneState =
  | { kind: 'idle' }
  | { kind: 'streaming'; content: string; startedAt: number }
  | {
      kind: 'done';
      content: string;
      startedAt: number;
      finishedAt: number;
      summary: ChatStreamDone;
    }
  | { kind: 'error'; message: string; content: string }
  | { kind: 'cancelled'; content: string };

interface Lane {
  /** Unique per-run lane id. Changing models mid-run would churn this, so
   *  we use a stable `modelId + instanceIndex` suffix when the user adds
   *  two lanes with the same model (rare but not prohibited). */
  laneId: string;
  model: ModelInfo;
  state: LaneState;
}

export function CompareRoute() {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState(0);
  const [lanes, setLanes] = useState<Lane[]>([]);
  // Handles indexed by laneId so Stop-all / per-lane cancel can reach them.
  const handlesRef = useRef<Map<string, ChatStreamHandle>>(new Map());
  const anyStreaming = lanes.some((l) => l.state.kind === 'streaming');

  // ───────────────────────── Model list fetch ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await modelList();
        if (cancelled) return;
        setModels(rows);
        // Seed with the first model so the page isn't dead-empty.
        const first = rows[0];
        if (first && selectedIds.length === 0) {
          setSelectedIds([first.id]);
        }
      } catch (e) {
        if (cancelled) return;
        setModelsError(ipcErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally run-once on mount; selectedIds is seeded here and later
    // owned by user interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedModels = useMemo(
    () =>
      selectedIds
        .map((id) => models.find((m) => m.id === id))
        .filter((m): m is ModelInfo => Boolean(m)),
    [selectedIds, models],
  );

  // ───────────────────────── Run / Stop ─────────────────────────
  const startRun = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || selectedModels.length === 0 || anyStreaming) return;

    // New run id → new lane keys → React fully remounts lane panels, which
    // is simpler than trying to reconcile in-place.
    const rid = runId + 1;
    setRunId(rid);

    // Build a fresh lanes array and spawn one chatStream per model.
    const freshLanes: Lane[] = selectedModels.map((m, i) => ({
      laneId: `r${rid}-${m.id}-${i}`,
      model: m,
      state: { kind: 'streaming', content: '', startedAt: Date.now() },
    }));
    setLanes(freshLanes);
    handlesRef.current.clear();

    const msg: ChatMessageDto = { role: 'user', content: trimmed };

    // T5.5b — route every lane through the active adapter. Compare runs
    // multiple models against the SAME adapter; cross-adapter compare
    // (lanes against different adapters) is a post-Phase-5 idea.
    const activeAdapterId = useAgentsStore.getState().activeId ?? undefined;

    // Fire all streams in parallel. Each resolves with its own handle, which
    // we stash so Stop-all / per-lane X can cancel them.
    await Promise.all(
      freshLanes.map(async (lane) => {
        try {
          const handle = await chatStream(
            { messages: [msg], model: lane.model.id, adapter_id: activeAdapterId },
            {
              onDelta: (chunk) => {
                setLanes((prev) =>
                  prev.map((l) =>
                    l.laneId === lane.laneId && l.state.kind === 'streaming'
                      ? { ...l, state: { ...l.state, content: l.state.content + chunk } }
                      : l,
                  ),
                );
              },
              onDone: (summary) => {
                setLanes((prev) =>
                  prev.map((l) =>
                    l.laneId === lane.laneId && l.state.kind === 'streaming'
                      ? {
                          ...l,
                          state: {
                            kind: 'done',
                            content: l.state.content,
                            startedAt: l.state.startedAt,
                            finishedAt: Date.now(),
                            summary,
                          },
                        }
                      : l,
                  ),
                );
                handlesRef.current.delete(lane.laneId);
              },
              onError: (err) => {
                setLanes((prev) =>
                  prev.map((l) =>
                    l.laneId === lane.laneId
                      ? {
                          ...l,
                          state: {
                            kind: 'error',
                            message: ipcErrorMessage(err),
                            content: l.state.kind === 'streaming' ? l.state.content : '',
                          },
                        }
                      : l,
                  ),
                );
                handlesRef.current.delete(lane.laneId);
              },
            },
          );
          handlesRef.current.set(lane.laneId, handle);
        } catch (e) {
          setLanes((prev) =>
            prev.map((l) =>
              l.laneId === lane.laneId
                ? { ...l, state: { kind: 'error', message: ipcErrorMessage(e), content: '' } }
                : l,
            ),
          );
        }
      }),
    );
  }, [prompt, selectedModels, anyStreaming, runId]);

  const cancelLane = useCallback((laneId: string) => {
    const h = handlesRef.current.get(laneId);
    handlesRef.current.delete(laneId);
    if (h) void h.cancel();
    setLanes((prev) =>
      prev.map((l) =>
        l.laneId === laneId && l.state.kind === 'streaming'
          ? { ...l, state: { kind: 'cancelled', content: l.state.content } }
          : l,
      ),
    );
  }, []);

  const stopAll = useCallback(() => {
    for (const laneId of handlesRef.current.keys()) cancelLane(laneId);
  }, [cancelLane]);

  // Clean up any in-flight streams on unmount — avoids leaking listeners if
  // the user navigates away mid-run.
  useEffect(() => {
    const handles = handlesRef.current;
    return () => {
      for (const h of handles.values()) void h.cancel();
      handles.clear();
    };
  }, []);

  // ───────────────────────── Export ─────────────────────────
  const canExport = lanes.length > 0 && lanes.every((l) => l.state.kind !== 'streaming');
  const exportMarkdown = useCallback(() => {
    const md = renderMarkdownReport(prompt, lanes);
    downloadBlob(md, `compare-${Date.now()}.md`, 'text/markdown');
  }, [prompt, lanes]);
  const exportJson = useCallback(() => {
    const json = JSON.stringify(toJsonReport(prompt, lanes), null, 2);
    downloadBlob(json, `compare-${Date.now()}.json`, 'application/json');
  }, [prompt, lanes]);

  // ───────────────────────── Render ─────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('compare.title')}
        subtitle={t('compare.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('compare.title')}
              content={t('compare.help_page')}
              testId="compare-help"
            />
            {canExport && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={exportMarkdown}
                  data-testid="compare-export-md"
                  title={t('compare.export_md')}
                >
                  <Icon icon={Download} size="sm" />
                  {t('compare.export_md')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={exportJson}
                  data-testid="compare-export-json"
                  title={t('compare.export_json')}
                >
                  <Icon icon={Download} size="sm" />
                  JSON
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-none border-b border-border bg-bg-elev-1/60 px-6 py-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-3">
            <PromptBar
              value={prompt}
              onChange={setPrompt}
              onRun={() => void startRun()}
              onStop={stopAll}
              running={anyStreaming}
              disabled={selectedModels.length === 0}
            />
            <ModelPicker
              models={models}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              max={MAX_LANES}
              disabled={anyStreaming}
            />
            {modelsError && (
              <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
                <Icon icon={AlertCircle} size="sm" className="flex-none" />
                {modelsError}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-4">
            {lanes.length === 0 ? (
              <EmptyPrompt />
            ) : (
              <>
                <div
                  className={cn(
                    'grid gap-3',
                    lanes.length === 1 && 'grid-cols-1',
                    lanes.length === 2 && 'grid-cols-1 md:grid-cols-2',
                    lanes.length === 3 && 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
                    lanes.length >= 4 && 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
                  )}
                >
                  {lanes.map((lane) => (
                    <LanePanel
                      key={lane.laneId}
                      lane={lane}
                      onCancel={() => cancelLane(lane.laneId)}
                    />
                  ))}
                </div>
                <DiffFooter lanes={lanes} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Prompt bar ─────────────────────────

function PromptBar({
  value,
  onChange,
  onRun,
  onStop,
  running,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (running) onStop();
    else onRun();
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl+Enter → run. Plain Enter inserts a newline (unlike chat) —
    // compare prompts are often multi-line, so this matches user intuition.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!running && !disabled) onRun();
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        placeholder={t('compare.prompt_placeholder')}
        className="min-h-[72px] max-h-[200px] flex-1 resize-none rounded-lg border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-gold-500/40 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
        data-testid="compare-prompt-input"
      />
      {running ? (
        <Button
          type="submit"
          variant="secondary"
          className="h-11 px-4"
          data-testid="compare-stop"
          title={t('compare.stop_all')}
        >
          <Icon icon={Square} size="md" fill="currentColor" />
          {t('compare.stop_all')}
        </Button>
      ) : (
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || !value.trim()}
          className="h-11 px-4"
          data-testid="compare-run"
          title={t('compare.run')}
        >
          <Icon icon={Play} size="md" />
          {t('compare.run')}
        </Button>
      )}
    </form>
  );
}

// ───────────────────────── Model picker ─────────────────────────

function ModelPicker({
  models,
  selectedIds,
  onChange,
  max,
  disabled,
}: {
  models: ModelInfo[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  max: number;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const atCap = selectedIds.length >= max;

  function add(id: string) {
    onChange([...selectedIds, id]);
    setOpen(false);
  }
  function remove(id: string) {
    // Removes the FIRST instance only — the user may have picked the same
    // model twice on purpose (rare, but legal).
    const idx = selectedIds.indexOf(id);
    if (idx < 0) return;
    const next = selectedIds.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="compare-model-picker">
      {selectedIds.map((id, i) => {
        const m = models.find((x) => x.id === id);
        const label = m?.display_name ?? id;
        return (
          <span
            key={`${id}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elev-2 px-2.5 py-1 text-xs text-fg"
            data-testid={`compare-model-chip-${id}`}
          >
            <span className="truncate max-w-[160px]">{label}</span>
            <button
              type="button"
              onClick={() => remove(id)}
              disabled={disabled}
              className="text-fg-subtle hover:text-fg disabled:opacity-40"
              title={t('compare.remove_model')}
              aria-label={t('compare.remove_model')}
            >
              <Icon icon={X} size="xs" />
            </button>
          </span>
        );
      })}
      <div className="relative">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen((s) => !s)}
          disabled={disabled || atCap || models.length === 0}
          data-testid="compare-add-model"
          title={
            atCap
              ? t('compare.max_reached', { n: max })
              : t('compare.add_model')
          }
        >
          <Icon icon={Plus} size="sm" />
          {t('compare.add_model')}
          <Icon icon={ChevronDown} size="xs" />
        </Button>
        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-bg-elev-2 shadow-2">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => add(m.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-fg hover:bg-bg-elev-3"
                data-testid={`compare-add-option-${m.id}`}
              >
                <span className="truncate">{m.display_name ?? m.id}</span>
                <span className="text-[10px] text-fg-subtle">{m.provider}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {atCap && (
        <span className="text-[11px] text-fg-subtle">
          {t('compare.max_reached', { n: max })}
        </span>
      )}
    </div>
  );
}

// ───────────────────────── Lane ─────────────────────────

function LanePanel({ lane, onCancel }: { lane: Lane; onCancel: () => void }) {
  const { t } = useTranslation();
  const streaming = lane.state.kind === 'streaming';
  const content =
    lane.state.kind === 'done' || lane.state.kind === 'streaming' || lane.state.kind === 'cancelled'
      ? lane.state.content
      : lane.state.kind === 'error'
      ? lane.state.content
      : '';
  const elapsed =
    lane.state.kind === 'done'
      ? lane.state.finishedAt - lane.state.startedAt
      : lane.state.kind === 'streaming'
      ? Date.now() - lane.state.startedAt
      : null;
  const tokens =
    lane.state.kind === 'done'
      ? (lane.state.summary.prompt_tokens ?? 0) +
        (lane.state.summary.completion_tokens ?? 0)
      : null;

  return (
    <article
      className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3"
      data-testid={`compare-lane-${lane.model.id}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">
            {lane.model.display_name ?? lane.model.id}
          </div>
          <div className="text-[10px] text-fg-subtle">{lane.model.provider}</div>
        </div>
        <div className="flex items-center gap-1">
          {streaming && (
            <>
              <Icon icon={Loader2} size="sm" className="animate-spin text-fg-muted" />
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                data-testid={`compare-lane-cancel-${lane.model.id}`}
                title={t('compare.cancel_lane')}
              >
                <Icon icon={Square} size="xs" fill="currentColor" />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="min-h-[80px] text-sm text-fg">
        {content ? (
          <Markdown>{content}</Markdown>
        ) : streaming ? (
          <span className="text-fg-subtle">{t('compare.waiting')}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </div>

      {/* Footer: per-lane stats. Hidden for `idle`; always rendered for
          terminal states so layouts don't jiggle when one lane
          finishes before another. */}
      {lane.state.kind !== 'idle' && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-fg-subtle">
          {elapsed !== null && (
            <span className="inline-flex items-center gap-1" data-testid={`compare-lane-latency-${lane.model.id}`}>
              <Icon icon={Clock} size="xs" />
              {formatMs(elapsed)}
            </span>
          )}
          {tokens !== null && tokens > 0 && (
            <span className="inline-flex items-center gap-1" data-testid={`compare-lane-tokens-${lane.model.id}`}>
              <Icon icon={Coins} size="xs" />
              {tokens} tok
            </span>
          )}
          {lane.state.kind === 'done' && lane.state.summary.finish_reason && (
            <span className="inline-flex rounded border border-border px-1 text-[10px] uppercase tracking-wider">
              {lane.state.summary.finish_reason}
            </span>
          )}
          {lane.state.kind === 'cancelled' && (
            <span className="text-warning" data-testid={`compare-lane-cancelled-${lane.model.id}`}>
              {t('compare.cancelled')}
            </span>
          )}
          {lane.state.kind === 'error' && (
            <span className="text-danger" data-testid={`compare-lane-error-${lane.model.id}`}>
              {lane.state.message}
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

// ───────────────────────── Diff footer ─────────────────────────

function DiffFooter({ lanes }: { lanes: Lane[] }) {
  const { t } = useTranslation();
  const done = lanes.filter(
    (l): l is Lane & { state: Extract<LaneState, { kind: 'done' }> } =>
      l.state.kind === 'done',
  );
  if (done.length < 2) return null;
  const fastest = done.reduce((a, b) =>
    b.state.finishedAt - b.state.startedAt < a.state.finishedAt - a.state.startedAt ? b : a,
  );
  const mostTokens = done.reduce((a, b) =>
    ((b.state.summary.prompt_tokens ?? 0) + (b.state.summary.completion_tokens ?? 0)) >
    ((a.state.summary.prompt_tokens ?? 0) + (a.state.summary.completion_tokens ?? 0))
      ? b
      : a,
  );

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-[11px] text-fg-muted"
      data-testid="compare-diff-footer"
    >
      <span className="font-medium text-fg">{t('compare.winners')}</span>
      <span className="inline-flex items-center gap-1" data-testid="compare-winner-latency">
        <Icon icon={Clock} size="xs" />
        {t('compare.fastest')}:{' '}
        <code className="text-fg">{fastest.model.display_name ?? fastest.model.id}</code>
        <span className="text-fg-subtle">
          ({formatMs(fastest.state.finishedAt - fastest.state.startedAt)})
        </span>
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon icon={Coins} size="xs" />
        {t('compare.most_tokens')}:{' '}
        <code className="text-fg">{mostTokens.model.display_name ?? mostTokens.model.id}</code>
      </span>
    </div>
  );
}

// ───────────────────────── Empty ─────────────────────────

function EmptyPrompt() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-fg-muted">
      <Icon icon={Columns3} size={32} className="text-fg-subtle" />
      <div className="text-sm font-medium text-fg">{t('compare.empty_title')}</div>
      <div className="max-w-md text-xs">{t('compare.empty_desc')}</div>
    </div>
  );
}

// ───────────────────────── Helpers ─────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderMarkdownReport(prompt: string, lanes: Lane[]): string {
  const header = `# Compare run\n\n**Prompt**\n\n> ${prompt.replace(/\n/g, '\n> ')}\n`;
  const body = lanes
    .map((l) => {
      const title = `## ${l.model.display_name ?? l.model.id} (${l.model.provider})`;
      if (l.state.kind === 'done') {
        const elapsed = l.state.finishedAt - l.state.startedAt;
        const tokens =
          (l.state.summary.prompt_tokens ?? 0) + (l.state.summary.completion_tokens ?? 0);
        return `${title}\n\n- latency: ${formatMs(elapsed)}\n- tokens: ${tokens}\n- finish_reason: ${
          l.state.summary.finish_reason ?? 'n/a'
        }\n\n${l.state.content}\n`;
      }
      if (l.state.kind === 'error') {
        return `${title}\n\n> **error**: ${l.state.message}\n\n${l.state.content}\n`;
      }
      if (l.state.kind === 'cancelled') return `${title}\n\n> cancelled\n\n${l.state.content}\n`;
      return `${title}\n\n> (no output)\n`;
    })
    .join('\n');
  return `${header}\n${body}`;
}

function toJsonReport(prompt: string, lanes: Lane[]) {
  return {
    prompt,
    ran_at: new Date().toISOString(),
    lanes: lanes.map((l) => ({
      model: l.model.id,
      provider: l.model.provider,
      display_name: l.model.display_name,
      state: l.state.kind,
      content:
        l.state.kind === 'done' ||
        l.state.kind === 'streaming' ||
        l.state.kind === 'cancelled' ||
        l.state.kind === 'error'
          ? l.state.content
          : '',
      summary: l.state.kind === 'done' ? l.state.summary : null,
      elapsed_ms:
        l.state.kind === 'done'
          ? l.state.finishedAt - l.state.startedAt
          : null,
      error: l.state.kind === 'error' ? l.state.message : null,
    })),
  };
}

function downloadBlob(data: string, filename: string, mime: string) {
  const blob = new Blob([data], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke; some browsers need a tick to actually fire the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
