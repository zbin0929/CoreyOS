import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Download } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  chatStream,
  ipcErrorMessage,
  llmProfileList,
  type ChatMessageDto,
  type ChatStreamHandle,
  type LlmProfile,
  type ModelInfo,
} from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';

import { DiffFooter, EmptyPrompt, LanePanel } from './LanePanel';
import { ModelPicker } from './ModelPicker';
import { PromptBar } from './PromptBar';
import { downloadBlob, renderMarkdownReport, toJsonReport } from './reports';
import type { Lane, LaneState } from './types';

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
 * Subcomponents live in sibling files (PromptBar / ModelPicker /
 * LanePanel + DiffFooter + EmptyPrompt) and pure helpers in `reports.ts`.
 */

const MAX_LANES = 4;

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

  // ───────────────────────── LLM Profile list fetch ─────────────────────────
  // Compare's job is "same prompt → multiple LLMs side-by-side", which only
  // makes sense across DIFFERENT models (deepseek-v4 vs glm-5.1 vs minimax).
  // The single active adapter's `/v1/models` doesn't help — Hermes-as-default
  // means it only advertises hermes-agent, so all lanes would be the same
  // backend.
  //
  // We pull from `llm_profile_list` instead. Each profile is a saved
  // `{provider, base_url, model, api_key_env}` bundle that registers itself
  // as `hermes:profile:<id>` adapter. Picking three profiles → three lanes
  // → three different LLM houses replying to one prompt.
  //
  // Each profile is materialised as a synthetic ModelInfo so the existing
  // ModelPicker / LanePanel renderers don't need a rewrite.
  const profilesRef = useRef<Map<string, LlmProfile>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const view = await llmProfileList();
        if (cancelled) return;
        // Index by id for the chatStream → adapter_id lookup later.
        const map = new Map<string, LlmProfile>();
        for (const p of view.profiles) map.set(p.id, p);
        profilesRef.current = map;
        const synthetic: ModelInfo[] = view.profiles.map((p) => ({
          // Compose a stable surface id that doesn't collide if two
          // profiles target the same backing model name. The `profile:`
          // prefix is only seen by the picker; chatStream gets the real
          // model name out of `profilesRef`.
          id: `profile:${p.id}`,
          provider: p.provider,
          display_name: profileDisplay(p),
          context_window: 0,
          is_default: false,
          capabilities: { vision: !!p.vision, tool_use: true, reasoning: false },
        }));
        setModels(synthetic);
        const first = synthetic[0];
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
          // The synthetic id is `profile:<id>` — strip and resolve
          // back to the actual LLM Profile so we can route through
          // its dedicated adapter (`hermes:profile:<id>`) and use
          // its real model name on the wire. Falling back to the
          // active adapter / lane.model.id keeps things working in
          // the unlikely case the user picked something not in the
          // ref (e.g. profile deleted between picker render and
          // run click).
          const profileId = lane.model.id.startsWith('profile:')
            ? lane.model.id.slice('profile:'.length)
            : null;
          const profile = profileId ? profilesRef.current.get(profileId) : null;
          const wireAdapterId = profile
            ? `hermes:profile:${profile.id}`
            : activeAdapterId;
          const wireModel = profile?.model ?? lane.model.id;
          const handle = await chatStream(
            { messages: [msg], model: wireModel, adapter_id: wireAdapterId },
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
            {!modelsError && models.length === 0 && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-fg-muted">
                <Icon icon={AlertCircle} size="sm" className="flex-none text-amber-500" />
                <span>
                  {t('compare.no_profiles_hint', {
                    defaultValue:
                      '还没有任何 LLM Profile。先去 Settings → Models 创建至少 2 个不同 provider 的 profile，才能横向对比。',
                  })}
                </span>
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
                  {lanes.map((lane) => {
                    const doneLanes = lanes.filter((l): l is Lane & { state: Extract<LaneState, { kind: 'done' }> } => l.state.kind === 'done');
                    const fastestId = doneLanes.length >= 2
                      ? doneLanes.reduce((a, b) =>
                          (b.state.finishedAt - b.state.startedAt) < (a.state.finishedAt - a.state.startedAt) ? b : a,
                        ).laneId
                      : null;
                    const fewestTokensId = doneLanes.length >= 2
                      ? doneLanes.reduce((a, b) =>
                          ((b.state.summary.prompt_tokens ?? 0) + (b.state.summary.completion_tokens ?? 0)) <
                          ((a.state.summary.prompt_tokens ?? 0) + (a.state.summary.completion_tokens ?? 0))
                            ? b : a,
                        ).laneId
                      : null;
                    return (
                      <LanePanel
                        key={lane.laneId}
                        lane={lane}
                        onCancel={() => cancelLane(lane.laneId)}
                        isFastest={lane.laneId === fastestId}
                        isFewestTokens={lane.laneId === fewestTokensId}
                      />
                    );
                  })}
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

/** Pretty label for the picker chip. "label · model" when both are
 *  set, falling back to id so we always have *something* to show. */
function profileDisplay(p: LlmProfile): string {
  const lbl = (p.label || p.id).trim();
  const m = (p.model || '').trim();
  return m ? `${lbl} · ${m}` : lbl;
}
