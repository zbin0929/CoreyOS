import { invoke } from '@tauri-apps/api/core';
import type { IpcError } from './_errors';

// ───────────────────────── Menu ─────────────────────────

/** Tell Rust which locale to rebuild the native menubar in. Called from
 *  `useMenuEvents` on boot + whenever the user switches languages in
 *  Settings. Non-Tauri contexts (Storybook / Playwright without the
 *  mock) safely noop. */
export function menuSetLocale(lang: string): Promise<void> {
  return invoke<void>('menu_set_locale', { lang });
}

// ───────────────────────── Scheduler ─────────────────────────

export interface SchedulerJob {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  adapter_id: string;
  enabled: boolean;
  last_run_at: number | null;
  last_run_ok: boolean | null;
  last_run_error: string | null;
  created_at: number;
  updated_at: number;
  workdir?: string;
  context_from?: string;
}

export interface SchedulerJobUpsert {
  id?: string;
  name: string;
  cron_expression: string;
  prompt: string;
  adapter_id?: string;
  enabled?: boolean;
  workdir?: string;
  context_from?: string;
}

export interface SchedulerValidateResult {
  ok: boolean;
  error?: string;
  next_fire_at?: number;
  /** T6.8: `true` when the expression parsed as classic cron;
   *  `false` means Hermes-extended syntax (`"every 2h"`, `"30m"`,
   *  ISO timestamp) and `next_fire_at` will be absent — Hermes
   *  evaluates those at runtime. */
  is_cron?: boolean;
}

/** T6.8: one run output surfaced by `scheduler_list_runs`. Mirrors the
 *  Rust `RunInfo` in `src-tauri/src/hermes_cron.rs`. Runs live under
 *  `~/.hermes/cron/output/{job_id}/` — Hermes writes them; we only
 *  read. `preview` is the first ~400 chars of the markdown body. */
export interface SchedulerRunInfo {
  job_id: string;
  name: string;
  modified_at: number;
  size_bytes: number;
  preview: string;
}

export function schedulerListJobs(): Promise<SchedulerJob[]> {
  return invoke<SchedulerJob[]>('scheduler_list_jobs');
}

export function schedulerUpsertJob(args: SchedulerJobUpsert): Promise<SchedulerJob> {
  return invoke<SchedulerJob>('scheduler_upsert_job', { args });
}

export function schedulerDeleteJob(id: string): Promise<void> {
  return invoke<void>('scheduler_delete_job', { id });
}

export function schedulerValidateCron(expression: string): Promise<SchedulerValidateResult> {
  return invoke<SchedulerValidateResult>('scheduler_validate_cron', { expression });
}

/** T6.8: fetch the most-recent run outputs for a job. Returns up to
 *  `MAX_RUNS_PER_JOB` (Rust-side constant, currently 20) entries
 *  newest-first. Cheap read; the UI calls it lazily when the Runs
 *  drawer opens on a given card. */
export function schedulerListRuns(jobId: string): Promise<SchedulerRunInfo[]> {
  return invoke<SchedulerRunInfo[]>('scheduler_list_runs', { jobId });
}

export interface SchedulerIntent {
  detected: boolean;
  cron_expression: string;
  suggested_name: string;
  prompt: string;
  confidence: number;
}

export function schedulerExtractIntent(message: string): Promise<SchedulerIntent> {
  return invoke<SchedulerIntent>('scheduler_extract_intent', { message });
}

// ───────────────────────── Download Center ─────────────────────────

export interface DownloadTask {
  id: string;
  url: string;
  target_path: string;
  filename: string;
  label: string;
  status: DownloadStatus;
  downloaded: number;
  total: number;
  speed_bps: number;
}

export type DownloadStatus =
  | { kind: 'pending' }
  | { kind: 'downloading' }
  | { kind: 'completed' }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

export interface DownloadStartRequest {
  url: string;
  target_path: string;
  label: string;
}

export function downloadStart(req: DownloadStartRequest): Promise<string> {
  return invoke<string>('download_start', { req });
}

export function downloadCancel(taskId: string): Promise<void> {
  return invoke<void>('download_cancel', { taskId });
}

export function downloadList(): Promise<DownloadTask[]> {
  return invoke<DownloadTask[]>('download_list');
}

export function downloadClearCompleted(): Promise<void> {
  return invoke<void>('download_clear_completed');
}

// ───────────────────────── Knowledge base ─────────────────────────
//
// `ragSearch` / `ragIndexRecent` / `RagSearchResult` / `RagIndexResult`
// were removed in v9. See `src-tauri/src/ipc/embedding.rs` for the
// rationale; the short version is that the Rust-side `rag_search`
// was a Jaccard fallback misnamed as RAG, the local ONNX embedder
// (BGE-Small via fastembed) failed silently behind the GFW, and the
// downstream call site (`enrichHistory.ts`) added a serial IPC
// roundtrip per chat send for zero quality return. Real semantic
// search will land again as a fresh export here once we wire Hermes'
// `/v1/embeddings` endpoint.

export interface KnowledgeDoc {
  id: string;
  name: string;
  filename: string;
  chunk_count: number;
  total_chars: number;
  created_at: number;
}

export function knowledgeUpload(name: string, filename: string, content: string): Promise<KnowledgeDoc> {
  return invoke<KnowledgeDoc>('knowledge_upload', { name, filename, content });
}

export function knowledgeList(): Promise<KnowledgeDoc[]> {
  return invoke<KnowledgeDoc[]>('knowledge_list');
}

export function knowledgeDelete(id: string): Promise<void> {
  return invoke<void>('knowledge_delete', { id });
}

export interface KnowledgeSearchHit {
  doc_id: string;
  doc_name: string;
  chunk_index: number;
  content: string;
  score: number;
}

export function knowledgeSearch(query: string, limit?: number): Promise<KnowledgeSearchHit[]> {
  return invoke<KnowledgeSearchHit[]>('knowledge_search', { query, limit });
}

export interface ModelFileStatus {
  name: string;
  exists: boolean;
  size_bytes: number;
  download_url: string;
}

export interface RagStatus {
  model_installed: boolean;
  model_dir: string;
  files: ModelFileStatus[];
}

export function ragStatus(): Promise<RagStatus> {
  return invoke<RagStatus>('rag_status');
}

export function ragDownloadModel(): Promise<void> {
  return invoke<void>('rag_download_model');
}

export function ragImportOfflineZip(zipPath: string): Promise<void> {
  return invoke<void>('rag_import_offline_zip', { zipPath });
}

// ───────────────────────── Voice ─────────────────────────

export interface VoiceTranscribeResult {
  text: string;
  language: string | null;
  duration_ms: number | null;
}

export function voiceTranscribe(audioBase64: string, mime: string): Promise<VoiceTranscribeResult> {
  return invoke<VoiceTranscribeResult>('voice_transcribe', { audioBase64, mime });
}

export interface VoiceTtsResult {
  audio_path: string;
  audio_base64: string;
  duration_ms: number | null;
}

export function voiceTts(text: string): Promise<VoiceTtsResult> {
  return invoke<VoiceTtsResult>('voice_tts', { text });
}

export interface VoiceConfig {
  asr_provider: string;
  tts_provider: string;
  asr_endpoint: string | null;
  asr_api_key_set: boolean;
  tts_endpoint: string | null;
  tts_api_key_set: boolean;
  tts_voice: string;
  tts_speed: number;
  hotkey: string;
  available_asr_providers: string[];
  available_tts_providers: string[];
  asr_voices: string[];
  tts_voices: string[];
}

export function voiceGetConfig(): Promise<VoiceConfig> {
  return invoke<VoiceConfig>('voice_get_config');
}

export interface VoiceConfigUpdate {
  asr_provider?: string;
  asr_endpoint?: string;
  asr_api_key?: string;
  tts_provider?: string;
  tts_endpoint?: string;
  tts_api_key?: string;
  tts_voice?: string;
  tts_speed?: number;
  hotkey?: string;
}

export function voiceSetConfig(args: VoiceConfigUpdate): Promise<void> {
  return invoke<void>('voice_set_config', { args });
}

export interface VoiceAuditEntry {
  event_type: string;
  timestamp: number;
  provider: string;
  duration_ms: number;
  success: boolean;
}

export function voiceAuditLog(limit?: number): Promise<VoiceAuditEntry[]> {
  return invoke<VoiceAuditEntry[]>('voice_audit_log', { limit });
}

export function voiceRecord(durationSecs?: number): Promise<string> {
  return invoke<string>('voice_record', { durationSecs });
}

export function voiceRecordStop(): Promise<void> {
  return invoke<void>('voice_record_stop');
}

/**
 * Open the macOS System Settings panel pinned to Privacy & Security
 * → Microphone, so the user can grant the running binary mic access
 * with one click. macOS-only — on other platforms the IPC rejects.
 */
export function voiceOpenMicSettings(): Promise<void> {
  return invoke<void>('voice_open_mic_settings');
}

/**
 * Touch the input device once for ~500ms. On macOS this triggers
 * the Privacy permission dialog if the user has never been asked,
 * so the dialog appears when the Talk overlay opens rather than
 * mid-PTT-press. Returns `'granted'` if a sample arrived in that
 * window, `'denied'` otherwise.
 */
export function voiceWarmupMic(): Promise<'granted' | 'denied'> {
  return invoke<'granted' | 'denied'>('voice_warmup_mic');
}

/**
 * Play a base64-encoded WAV via the platform's native CLI player
 * (macOS `afplay`, Linux `aplay`, Windows PowerShell SoundPlayer).
 * Bypasses the WebView `<audio>` element which silently fails on
 * Tauri 2 + macOS in some configurations. The IPC returns as soon
 * as the player is spawned; call {@link voicePlayStop} to cancel
 * mid-playback (e.g. user interrupts in auto-listen mode).
 */
export function voicePlayWavNative(audioBase64: string): Promise<void> {
  return invoke<void>('voice_play_wav_native', { audioBase64 });
}

/** Stop whatever {@link voicePlayWavNative} is currently playing. */
export function voicePlayStop(): Promise<void> {
  return invoke<void>('voice_play_stop');
}

// ───────────────────────── Talk Mode v1 ─────────────────────────

export interface TalkSessionStarted {
  sample_rate: number;
  frame_size: number;
}

export interface TalkSessionStatus {
  active: boolean;
}

export interface TalkSpeechEndPayload {
  wav_base64: string;
  sample_rate: number;
  duration_ms: number;
}

export interface TalkLevelPayload {
  rms: number;
  speaking: boolean;
}

export interface TalkErrorPayload {
  message: string;
}

/** Tauri event names emitted by `crate::talk::session`. */
export const TALK_EVENTS = {
  level: 'talk:level',
  speechStart: 'talk:speech-start',
  speechEnd: 'talk:speech-end',
  error: 'talk:error',
  partialTranscript: 'talk:partial-transcript',
} as const;

export interface TalkPartialTranscriptPayload {
  text: string;
  is_final: boolean;
}

export function talkSessionStart(): Promise<TalkSessionStarted> {
  return invoke<TalkSessionStarted>('talk_session_start');
}

export function talkSessionStop(): Promise<void> {
  return invoke<void>('talk_session_stop');
}

export function talkSessionStatus(): Promise<TalkSessionStatus> {
  return invoke<TalkSessionStatus>('talk_session_status');
}

// Local voice pack (silero-vad / whisper-base / sherpa-onnx MeloTTS zh_en).

export interface TalkModelFileStatus {
  id: string;
  label: string;
  kind: 'model' | 'binary';
  filename: string;
  target_path: string;
  exists: boolean;
  size_bytes: number;
  min_size_bytes: number;
  mirror_count: number;
}

export interface TalkModelsStatus {
  ready: boolean;
  models_dir: string;
  bin_dir: string;
  files: TalkModelFileStatus[];
}

export interface TalkModelsDownloadResult {
  used_mirrors: [string, string][];
}

export interface TalkModelsImportResult {
  imported: number;
}

export function talkModelsStatus(): Promise<TalkModelsStatus> {
  return invoke<TalkModelsStatus>('talk_models_status');
}

export function talkModelsDownload(): Promise<TalkModelsDownloadResult> {
  return invoke<TalkModelsDownloadResult>('talk_models_download');
}

export function talkModelsImportZip(zipPath: string): Promise<TalkModelsImportResult> {
  return invoke<TalkModelsImportResult>('talk_models_import_zip', { zipPath });
}

// Local STT/TTS routes — used when `talkLocalStatus().stt_ready` /
// `tts_ready` is true (i.e. whisper-cli + sherpa-onnx-offline-tts
// sidecars + models are installed).

export interface TalkLocalReadiness {
  stt_ready: boolean;
  tts_ready: boolean;
}

export interface TalkLocalTranscribeResult {
  text: string;
}

export interface TalkLocalTtsResult {
  audio_base64: string;
  mime: string;
}

export function talkLocalStatus(): Promise<TalkLocalReadiness> {
  return invoke<TalkLocalReadiness>('talk_local_status');
}

export function talkLocalTranscribe(wavBase64: string): Promise<TalkLocalTranscribeResult> {
  return invoke<TalkLocalTranscribeResult>('talk_local_transcribe', { wavBase64 });
}

export function talkLocalTts(text: string): Promise<TalkLocalTtsResult> {
  return invoke<TalkLocalTtsResult>('talk_local_tts', { text });
}

export function talkTtsReference(audioBase64: string): Promise<void> {
  return invoke('talk_tts_reference', { audioBase64 });
}

// ───────────────────────── Sandbox ─────────────────────────

export type SandboxAccessMode = 'read' | 'read_write';
export type SandboxMode = 'dev_allow' | 'enforced';

export interface SandboxRoot {
  path: string;
  label: string;
  mode: SandboxAccessMode;
}

export interface SandboxStateDto {
  mode: SandboxMode;
  roots: SandboxRoot[];
  session_grants: string[];
  config_path: string;
}

export function sandboxGetState(): Promise<SandboxStateDto> {
  return invoke<SandboxStateDto>('sandbox_get_state');
}

export function sandboxAddRoot(args: {
  path: string;
  label: string;
  mode: SandboxAccessMode;
}): Promise<SandboxRoot> {
  return invoke<SandboxRoot>('sandbox_add_root', { args });
}

export function sandboxRemoveRoot(path: string): Promise<void> {
  return invoke<void>('sandbox_remove_root', { args: { path } });
}

export function sandboxGrantOnce(path: string): Promise<{ canonical: string }> {
  return invoke<{ canonical: string }>('sandbox_grant_once', { args: { path } });
}

export function sandboxSetEnforced(): Promise<void> {
  return invoke<void>('sandbox_set_enforced');
}

export function sandboxClearSessionGrants(): Promise<void> {
  return invoke<void>('sandbox_clear_session_grants');
}

// ───────────────────────── T6.5 — sandbox scopes ─────────────────────────

/** A named root collection. The scope with id `"default"` is always
 *  present and is what every legacy caller (AppState's single
 *  `sandbox_*` IPCs, IPC-originated file ops without an adapter_id
 *  context) resolves to. Per-agent scoping opts in by pointing a
 *  `HermesInstance.sandbox_scope_id` at a non-default id. */
export interface SandboxScope {
  id: string;
  label: string;
  roots: SandboxRoot[];
}

export function sandboxScopeList(): Promise<SandboxScope[]> {
  return invoke<SandboxScope[]>('sandbox_scope_list');
}

/** Create-or-replace by id. The `default` scope is upsertable but
 *  never removable. Backend enforces the id slug regex
 *  (`[a-z0-9_-]{1,32}`); errors surface as plain internal errors. */
export function sandboxScopeUpsert(args: {
  id: string;
  label: string;
  roots: Array<{ path: string; label: string; mode: SandboxAccessMode }>;
}): Promise<SandboxScope> {
  return invoke<SandboxScope>('sandbox_scope_upsert', { args });
}

/** Idempotent delete. Backend refuses to delete the `default` scope. */
export function sandboxScopeDelete(id: string): Promise<void> {
  return invoke<void>('sandbox_scope_delete', { args: { id } });
}

/** Narrow an unknown rejection into a SandboxConsentRequired payload. */
export function asSandboxConsentRequired(e: unknown): { path: string } | null {
  if (e && typeof e === 'object' && 'kind' in e) {
    const err = e as IpcError;
    if (err.kind === 'sandbox_consent_required' && typeof err.path === 'string') {
      return { path: err.path };
    }
  }
  return null;
}

// ───────────────────────── Workflow ─────────────────────────

export interface WorkflowTrigger {
  type: 'manual' | 'cron';
  expression?: string;
}

export interface WorkflowInput {
  name: string;
  label: string;
  type: string;
  default?: string;
  required: boolean;
  options?: string[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  type:
    | 'agent'
    | 'tool'
    | 'browser'
    | 'parallel'
    | 'branch'
    | 'loop'
    | 'approval'
    | 'workflow';
  after: string[];
  agent_id?: string;
  prompt?: string;
  skills?: string[];
  model?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  branches?: WorkflowStep[];
  conditions?: { expression: string; goto: string }[];
  max_iterations?: number;
  body?: WorkflowStep[];
  exit_condition?: string;
  after_done?: string;
  timeout_minutes?: number;
  approval_message?: string;
  output_format?: string;
  browser_profile?: string;
  /**
   * **B-10.6 sub-workflow**. When `type === 'workflow'`, names the
   * child workflow def to invoke. Required for sub-workflow steps;
   * ignored otherwise. The engine renders `workflow_inputs`
   * against the parent's RunContext, drives the child to
   * completion synchronously, and exposes the child's per-step
   * outputs under `outputs.<step_id>` for downstream templates.
   */
  workflow_id?: string;
  /**
   * Inputs map passed to the child workflow (B-10.6). String
   * leaves are template-rendered against the parent context;
   * non-strings pass through unchanged.
   */
  workflow_inputs?: Record<string, unknown>;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  version: number;
  trigger: WorkflowTrigger;
  inputs: WorkflowInput[];
  steps: WorkflowStep[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  trigger_type: string;
  step_count: number;
  updated_at_ms: number;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
}

export function workflowList(): Promise<WorkflowSummary[]> {
  return invoke('workflow_list');
}

export function workflowGet(id: string): Promise<WorkflowDef> {
  return invoke('workflow_get', { id });
}

export function workflowSave(def: WorkflowDef): Promise<WorkflowDef> {
  return invoke('workflow_save', { def });
}

export function workflowDelete(id: string): Promise<boolean> {
  return invoke('workflow_delete', { id });
}

export function workflowValidate(def: WorkflowDef): Promise<WorkflowValidationResult> {
  return invoke('workflow_validate', { def });
}

export function workflowRun(id: string, inputs: Record<string, unknown>): Promise<string> {
  return invoke('workflow_run', { id, inputs });
}

export function workflowRunStatus(runId: string): Promise<WorkflowRunResult | null> {
  return invoke('workflow_run_status', { runId });
}

/**
 * Manually stop an in-flight workflow run.
 *
 * Honor cadence: cancellation lands at the next step boundary. An
 * in-flight 30-second `chat_stream` finishes its current call before
 * the engine exits — we don't abort mid-stream because hermes still
 * bills for the partial response. Worst case: one extra agent step
 * runs after the click; usually that's <30 s.
 *
 * For paused (awaiting-approval) and pending runs the IPC flips
 * status synchronously, so the UI sees `cancelled` on the next poll.
 */
export function workflowRunCancel(runId: string): Promise<boolean> {
  return invoke('workflow_run_cancel', { runId });
}

export function workflowActiveRuns(): Promise<WorkflowRunResult[]> {
  return invoke('workflow_active_runs');
}

export interface HermesOneshotResult {
  stdout: string;
  stderr: string;
  status: number;
  cli_available: boolean;
}

export function hermesOneshot(prompt: string): Promise<HermesOneshotResult> {
  return invoke<HermesOneshotResult>('hermes_oneshot', { prompt });
}

/**
 * MRU-first list of every persisted workflow run (terminal + active),
 * optionally filtered to one workflow id. Used by the History view.
 *
 * `step_count` / `completed_count` / `failed_count` are precomputed
 * by the DB layer so the UI can render "5/6 done" without a second
 * round-trip per row.
 */
export interface WorkflowRunSummary {
  id: string;
  workflow_id: string;
  status: string;
  error?: string;
  started_at: number;
  updated_at: number;
  step_count: number;
  completed_count: number;
  failed_count: number;
}

export function workflowHistoryList(
  workflowId?: string,
  limit?: number,
): Promise<WorkflowRunSummary[]> {
  return invoke('workflow_history_list', {
    workflowId: workflowId ?? null,
    limit: limit ?? null,
  });
}

/** Fetch one full historical run (header + every step's persisted
 *  state). Returns `null` when `runId` is unknown — used by the
 *  "view past audit trail" affordance in History. */
export function workflowRunGet(runId: string): Promise<WorkflowRunResult | null> {
  return invoke('workflow_run_get', { runId });
}

/** Hard-delete a run + its step rows from the audit trail. Also
 *  evicts the active-runs map so a paused-and-trashed run doesn't
 *  resurrect on the next poll. */
export function workflowRunDelete(runId: string): Promise<boolean> {
  return invoke('workflow_run_delete', { runId });
}

export interface WorkflowIntent {
  detected: boolean;
  workflow_id: string;
  workflow_name: string;
  confidence: number;
}

export function workflowExtractIntent(message: string): Promise<WorkflowIntent> {
  return invoke<WorkflowIntent>('workflow_extract_intent', { message });
}

/**
 * **B-10.7 webhook trigger**. Read or lazily generate the bearer
 * token used to authenticate `POST /webhook/<workflow_id>` calls
 * against the local MCP server (bound 127.0.0.1 only). Surface in
 * Settings → Advanced so users can copy it into cron / IFTTT / IM
 * bot integrations. The token persists across restarts in
 * `~/.hermes/.corey-webhook-token`.
 */
export function webhookTokenGet(): Promise<string> {
  return invoke<string>('webhook_token_get');
}

/**
 * Force-rotate the webhook token. Returns the new value. Anyone
 * holding the previous token loses access on the next request.
 */
export function webhookTokenRotate(): Promise<string> {
  return invoke<string>('webhook_token_rotate');
}

/**
 * Bound port of the local MCP / webhook listener. `null` if the
 * listener hasn't finished binding yet — UI should re-poll.
 */
export function webhookListenerPort(): Promise<number | null> {
  return invoke<number | null>('webhook_listener_port');
}

export function workflowApprove(
  runId: string,
  stepId: string,
  approved: boolean,
  feedback?: string,
): Promise<boolean> {
  // ApproveParams on the Rust side uses snake_case fields (it's a
  // plain Deserialize struct without a rename_all attribute), so we
  // send the body in snake_case to match. Tauri's automatic
  // camelCase→snake_case conversion only applies to the
  // top-level command args, NOT to nested struct fields.
  return invoke('workflow_approve', {
    params: {
      run_id: runId,
      step_id: stepId,
      approved,
      feedback,
    },
  });
}

export interface WorkflowStepRun {
  step_id: string;
  /**
   * `awaiting_approval` was added when the engine learned to actually
   * pause on `approval` steps (previously they auto-approved silently).
   * UI shows an Approve / Reject affordance only in that state; calling
   * `workflow_approve` flips it to `completed` (or `failed` on reject)
   * and resumes the run.
   */
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'awaiting_approval';
  output?: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
}

export interface BrowserLLMConfig {
  model: string;
  api_key: string;
  base_url: string;
  /** Optional env-var name the runner resolves the real key from at
   *  launch. When set we don't need `api_key` stored in the JSON file
   *  (plaintext secret), and the Settings UI can drive the whole thing
   *  from an `LlmProfile` picker. */
  api_key_env?: string | null;
}

export function browserConfigGet(): Promise<BrowserLLMConfig> {
  return invoke('browser_config_get');
}

export function browserConfigSet(config: BrowserLLMConfig): Promise<void> {
  return invoke('browser_config_set', { config });
}

export interface BrowserDiagResult {
  node_available: boolean;
  node_version: string | null;
  runner_found: boolean;
  runner_path: string | null;
  browser_config_set: boolean;
  browser_model_set: boolean;
}

export function browserDiagnose(): Promise<BrowserDiagResult> {
  return invoke('browser_diagnose');
}

// ──────────────────────── Workflow conversational generation ────────────────────────

/** Output of `workflowGenerate`. The editor consumes `workflow`
 *  directly; `raw_yaml` is exposed so the user can copy-paste the
 *  source document if they want to share or hand-edit further. */
export interface WorkflowGenerateResult {
  workflow: WorkflowDef;
  raw_yaml: string;
}

/** Ask the default LLM adapter to author a workflow from a plain-
 *  language description. Throws an IpcError when the model returns
 *  malformed YAML or a doc that fails validation — the caller
 *  surfaces the error message verbatim, since it usually points at
 *  what to rephrase. */
export function workflowGenerate(
  prompt: string,
  locale?: string,
): Promise<WorkflowGenerateResult> {
  return invoke('workflow_generate', { args: { prompt, locale } });
}

export interface WorkflowRunResult {
  id: string;
  workflow_id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  inputs: Record<string, unknown>;
  step_runs: Record<string, WorkflowStepRun>;
  error?: string;
}

// ───────────────────────── Gateway Sessions ─────────────────────────

export interface GatewaySession {
  id: string;
  title: string;
  model: string | null;
  source: string | null;
  messageCount: number;
  startedAt: number | null;
  lastActivity: number | null;
}

export interface GatewayMessage {
  role: string;
  content: string;
  timestamp: number;
  tokenCount: number | null;
}

export function gatewaySessionsList(): Promise<GatewaySession[]> {
  return invoke<GatewaySession[]>('gateway_sessions_list');
}

export function gatewaySessionMessages(
  sessionId: string,
): Promise<GatewayMessage[]> {
  return invoke<GatewayMessage[]>('gateway_session_messages', { sessionId });
}

export function gatewaySourceMessages(
  source: string,
): Promise<GatewayMessage[]> {
  return invoke<GatewayMessage[]>('gateway_source_messages', { source });
}
