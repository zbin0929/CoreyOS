import { invoke } from '@tauri-apps/api/core';

// ───────────────────────── Runbooks (T4.6) ─────────────────────────

export interface RunbookRow {
  id: string;
  name: string;
  description: string | null;
  /** Raw template string with `{{param}}` placeholders. Substitution is a
   *  frontend concern — `renderRunbook()` in `features/runbooks` does it. */
  template: string;
  /** `null` = usable from any profile. Not currently filtered on. */
  scope_profile: string | null;
  created_at: number;
  updated_at: number;
}

export function runbookList(): Promise<RunbookRow[]> {
  return invoke<RunbookRow[]>('runbook_list');
}

export function runbookUpsert(runbook: RunbookRow): Promise<void> {
  return invoke<void>('runbook_upsert', { runbook });
}

export function runbookDelete(id: string): Promise<void> {
  return invoke<void>('runbook_delete', { id });
}

// ───────────────────────── Budgets (T4.4) ─────────────────────────

export type BudgetScopeKind = 'global' | 'model' | 'profile' | 'adapter' | 'channel';
export type BudgetPeriod = 'day' | 'week' | 'month';
export type BudgetAction = 'notify' | 'block' | 'notify_block';

export interface BudgetRow {
  id: string;
  scope_kind: BudgetScopeKind;
  /** Null for `scope_kind="global"`; a scope identifier otherwise. */
  scope_value: string | null;
  /** Cap in cents. Cost projection lives in the frontend price table. */
  amount_cents: number;
  period: BudgetPeriod;
  action_on_breach: BudgetAction;
  created_at: number;
  updated_at: number;
}

export function budgetList(): Promise<BudgetRow[]> {
  return invoke<BudgetRow[]>('budget_list');
}

export function budgetUpsert(budget: BudgetRow): Promise<void> {
  return invoke<void>('budget_upsert', { budget });
}

export function budgetDelete(id: string): Promise<void> {
  return invoke<void>('budget_delete', { id });
}

// ───────────────────────── Skills (T4.2) ─────────────────────────

export interface SkillSummary {
  /** Relative posix path under `~/.hermes/skills/`, ending in `.md`.
   *  Treat as the stable id. */
  path: string;
  /** Derived name (file stem). */
  name: string;
  /** Parent directory relative to `skills/`. `null` for top-level files. */
  group: string | null;
  size: number;
  updated_at_ms: number;
}

export interface SkillContent {
  path: string;
  body: string;
  updated_at_ms: number;
}

export function skillList(): Promise<SkillSummary[]> {
  return invoke<SkillSummary[]>('skill_list');
}

export function skillGet(path: string): Promise<SkillContent> {
  return invoke<SkillContent>('skill_get', { path });
}

export function skillSave(
  path: string,
  body: string,
  createNew: boolean,
): Promise<SkillContent> {
  return invoke<SkillContent>('skill_save', { path, body, createNew });
}

export function skillDelete(path: string): Promise<void> {
  return invoke<void>('skill_delete', { path });
}

/** v9 — one entry in the per-skill edit history. Body is NOT included
 *  in the list to keep the IPC cheap; fetch the full row via
 *  `skillVersionGet(id)` only when the user actually wants to preview
 *  or restore it. */
export interface SkillVersionSummary {
  id: number;
  size: number;
  /** Unix ms at the moment the snapshot was captured (i.e. just
   *  before the overwrite that triggered it). */
  created_at: number;
}

/** Full snapshot row. Used by the restore / preview flow — restore
 *  passes `body` back into `skillSave(path, body, false)` which itself
 *  captures the current on-disk version into the history before
 *  overwriting, so restore is reversible. */
export interface SkillVersion {
  id: number;
  path: string;
  body: string;
  size: number;
  created_at: number;
}

export function skillVersionList(path: string): Promise<SkillVersionSummary[]> {
  return invoke<SkillVersionSummary[]>('skill_version_list', { path });
}

export function skillVersionGet(id: number): Promise<SkillVersion | null> {
  return invoke<SkillVersion | null>('skill_version_get', { id });
}

// ───────────────────────── Skill hub / CLI (T7.4) ─────────────────────────

/** Captured output of `hermes skills <subcmd>`. `status === -1` means
 *  the CLI couldn't even spawn (not found, permission denied) — when
 *  that's due to the binary being missing, `cli_available` is `false`
 *  and the UI shows an install-Hermes hint. */
export interface HubCommandResult {
  stdout: string;
  stderr: string;
  status: number;
  cli_available: boolean;
}

/** Invoke `hermes skills <args…>`. The first element must be one of:
 *  browse, search, inspect, install, uninstall, list, check, update,
 *  audit. Anything else is rejected server-side so a compromised
 *  frontend can't reach non-skill subcommands. */
export function skillHubExec(args: string[]): Promise<HubCommandResult> {
  return invoke<HubCommandResult>('skill_hub_exec', { args });
}

// ───────────────────────── Memory (T7.3) ─────────────────────────

/** Which of the two Markdown files under `~/.hermes/` is being edited.
 *  Server-side this is an enum; on the wire it's the literal string
 *  `'agent'` (→ `MEMORY.md`) or `'user'` (→ `USER.md`). */
export type MemoryKind = 'agent' | 'user';

export interface MemoryFile {
  kind: MemoryKind;
  /** Absolute path — useful for "Reveal in Finder" + for the capacity
   *  meter tooltip so power users can see where their notes actually
   *  live. */
  path: string;
  content: string;
  /** On-disk byte length (metadata-derived, not `content.length`). */
  bytes: number;
  /** Backend-enforced upper bound. Saves over this reject before the
   *  file is ever touched. UI surfaces this in the capacity meter. */
  max_bytes: number;
  /** `false` on the very first read — lets the UI offer a starter
   *  template instead of a blank page. */
  exists: boolean;
}

/** Read the agent or user memory file. Missing files return an empty
 *  body (NOT an error) — the UI treats "no file yet" as "no notes
 *  yet". Backend caches nothing; each call hits disk. */
export function memoryRead(kind: MemoryKind): Promise<MemoryFile> {
  return invoke<MemoryFile>('memory_read', { kind });
}

/** Atomically replace the file body. Rejects payloads over
 *  `max_bytes` before touching disk. Returns the post-write state so
 *  the UI can refresh the capacity meter without a second round-trip. */
export function memoryWrite(kind: MemoryKind, content: string): Promise<MemoryFile> {
  return invoke<MemoryFile>('memory_write', { kind, content });
}

// ──────────────────── Learning (Phase E) ────────────────────

export interface LearningExtractResult {
  learned: string[];
  skipped_reason: string | null;
}

export function learningExtract(args: {
  userMessage: string;
  assistantMessage: string;
}): Promise<LearningExtractResult> {
  return invoke<LearningExtractResult>('learning_extract', {
    args: { user_message: args.userMessage, assistant_message: args.assistantMessage },
  });
}

export function learningReadLearnings(): Promise<string> {
  return invoke<string>('learning_read_learnings');
}

export function learningWriteLearnings(content: string): Promise<void> {
  return invoke<void>('learning_write_learnings', { content });
}

export function learningIndexMessage(
  messageId: string,
  content: string,
): Promise<void> {
  return invoke<void>('learning_index_message', { messageId, content });
}

export interface SimilarResult {
  message_id: string;
  content: string;
  snippet: string;
}

export function learningSearchSimilar(
  query: string,
  limit?: number,
): Promise<SimilarResult[]> {
  return invoke<SimilarResult[]>('learning_search_similar', { query, limit });
}

export interface PatternDetectionResult {
  pattern_found: boolean;
  pattern_description: string;
  occurrence_count: number;
  suggested_skill_name: string;
}

export function learningDetectPattern(
  query: string,
): Promise<PatternDetectionResult> {
  return invoke<PatternDetectionResult>('learning_detect_pattern', { query });
}

export interface RoutingSuggestion {
  pattern: string;
  suggested_model: string;
  confidence: number;
  reason: string;
}

export function learningSuggestRouting(): Promise<RoutingSuggestion[]> {
  return invoke<RoutingSuggestion[]>('learning_suggest_routing');
}

export interface MemoryCompactResult {
  memory_entries_removed: number;
  learnings_entries_count: number;
}

export function learningCompactMemory(): Promise<MemoryCompactResult> {
  return invoke<MemoryCompactResult>('learning_compact_memory');
}

// ──────────────────── Session search (T7.3b) ────────────────────

export interface SessionSearchHit {
  session_id: string;
  session_title: string | null;
  /** Platform that fed this session (cli / telegram / discord / …). */
  session_source: string;
  role: string;
  /** FTS5 snippet with `>>>match<<<` markers around the hits. */
  snippet: string;
  timestamp_ms: number;
}

/** Run a full-text search over Hermes' session database
 *  (`~/.hermes/state.db`). Empty query returns `[]` without
 *  round-tripping. Missing DB (fresh install) also returns `[]`. */
export function sessionSearch(query: string, limit?: number): Promise<SessionSearchHit[]> {
  return invoke<SessionSearchHit[]>('session_search', { query, limit });
}

// ───────────────────────── MCP servers (T7.1) ─────────────────────────

/** One MCP server entry. `config` is the OPAQUE blob that maps 1:1
 *  to the nested YAML under `mcp_servers.<id>` in
 *  `~/.hermes/config.yaml` — `command/args/env` for stdio, `url/
 *  headers` for http, plus any `tools.{include,exclude,prompts,
 *  resources}` filter. Kept opaque so future upstream fields ride
 *  through without a Corey-side schema bump. */
export interface McpServer {
  id: string;
  config: Record<string, unknown>;
}

export function mcpServerList(): Promise<McpServer[]> {
  return invoke<McpServer[]>('mcp_server_list');
}

/** Upsert one server. The backend rejects empty ids and ids
 *  containing '.' (which would mis-write into nested YAML). */
export function mcpServerUpsert(server: McpServer): Promise<void> {
  return invoke<void>('mcp_server_upsert', { server });
}

export function mcpServerDelete(id: string): Promise<void> {
  return invoke<void>('mcp_server_delete', { id });
}

export interface McpProbeResult {
  id: string;
  reachable: boolean;
  latency_ms: number | null;
  error: string | null;
}

export function mcpServerProbe(id: string): Promise<McpProbeResult> {
  return invoke<McpProbeResult>('mcp_server_probe', { id });
}

// ───────────────────────── PTY (T4.5) ─────────────────────────

/**
 * Spawn a pty-wrapped shell. Output bytes arrive on the `pty:data:<id>`
 * event as a base64-encoded string — the caller handles decoding (and
 * feeding xterm.js). `id` is a caller-generated uuid so the frontend
 * can attach listeners BEFORE the shell races to emit its first byte.
 */
export function ptySpawn(id: string, rows: number, cols: number): Promise<string> {
  return invoke<string>('pty_spawn', { id, rows, cols });
}

/** Send UTF-8 keystrokes to the pty. */
export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke<void>('pty_write', { id, data });
}

/** Resize the pty. Match what xterm.js's fit addon reports. */
export function ptyResize(id: string, rows: number, cols: number): Promise<void> {
  return invoke<void>('pty_resize', { id, rows, cols });
}

/** Kill the pty's child process and drop it from the backend registry. */
export function ptyKill(id: string): Promise<void> {
  return invoke<void>('pty_kill', { id });
}

