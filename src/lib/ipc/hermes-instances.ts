import { invoke } from '@tauri-apps/api/core';

// ───────────────────────── Settings / config ─────────────────────────

export interface GatewayConfigDto {
  base_url: string;
  api_key?: string | null;
  default_model?: string | null;
}

export interface HealthProbe {
  latency_ms: number;
  body: string;
}

// ───────────────────────── Agent registry (T5.5a) ─────────────────────────

/** Per-adapter health snapshot. Mirrors Rust `adapters::Health`. */
export interface AdapterHealth {
  ok: boolean;
  adapter_id: string;
  version: string | null;
  gateway_url: string | null;
  latency_ms: number | null;
  message: string | null;
  /** T5.1 — most recent probe/invocation failure; `null` when clean. */
  last_error?: string | null;
  /** T5.1 — ms since adapter instance was constructed. */
  uptime_ms?: number | null;
}

/** Capability flags for an adapter. Mirrors Rust `adapters::Capabilities`.
 *  `channels` is a list of messenger-channel slugs (empty when the adapter
 *  doesn't integrate with any external messengers). */
export interface AdapterCapabilities {
  streaming: boolean;
  tool_calls: boolean;
  attachments: boolean;
  multiple_sessions: boolean;
  session_search: boolean;
  skills: boolean;
  memory: boolean;
  scheduler: boolean;
  channels: string[];
  logs: boolean;
  terminal: boolean;
  vector_search: boolean;
  trajectory_export: boolean;
  cost_accounting: boolean;
}

/** One row in the agent switcher. Mirrors Rust `ipc::agents::AdapterListEntry`. */
export interface AdapterListEntry {
  id: string;
  name: string;
  is_default: boolean;
  /** T5.5b — live capability snapshot; drives Sidebar nav filtering. */
  capabilities: AdapterCapabilities;
  /** `null` when the probe itself failed; see `health_error`. */
  health: AdapterHealth | null;
  /** Only populated when `health` is `null`. */
  health_error?: string | null;
}

/** List every registered adapter + its live health snapshot in one round trip. */
export function adapterList(): Promise<AdapterListEntry[]> {
  return invoke<AdapterListEntry[]>('adapter_list');
}

/** Current in-memory gateway config (synced with `~/.../gateway.json`). */
export function configGet(): Promise<GatewayConfigDto> {
  return invoke<GatewayConfigDto>('config_get');
}

/** Persist + hot-swap the adapter. Rejects with `IpcError` on invalid URL. */
export function configSet(config: GatewayConfigDto): Promise<void> {
  return invoke<void>('config_set', { config });
}

/**
 * Dry-run a config by hitting `/health`. Does NOT save. Used by the Settings
 * page's "Test" button to give feedback before the user commits.
 */
export function configTest(config: GatewayConfigDto): Promise<HealthProbe> {
  return invoke<HealthProbe>('config_test', { config });
}

// ─────────────── T6.2 · Named Hermes instances ───────────────

/** One user-declared extra Hermes gateway, persisted in
 *  `<app_config_dir>/hermes_instances.json`. Mirrors the Rust
 *  `HermesInstance` DTO 1:1. Registered at boot under
 *  `adapter_id = "hermes:<id>"` alongside the built-in `hermes`
 *  adapter so the AgentSwitcher can route chats to it. */
export interface HermesInstance {
  /** 1..32 chars of `[a-z0-9_-]`. Case-sensitive. Used as the stable
   *  key across renames and embedded in the registered adapter id. */
  id: string;
  /** UI-facing label. Falls back to `id` when empty on the wire. */
  label: string;
  base_url: string;
  api_key?: string | null;
  default_model?: string | null;
  /** T6.5 — id of the sandbox scope this instance's IPC-originated
   *  filesystem ops gate through. `null` or `"default"` resolves to
   *  the always-present default scope. */
  sandbox_scope_id?: string | null;
  /** T8 — optional reference to an `LlmProfile.id`. When set, the
   *  agent is rendered as "uses LLM: <profile label>" and the
   *  base_url / api_key / default_model fields above are populated
   *  from the profile at save time. Omitted/empty on legacy agents
   *  created before T8. */
  llm_profile_id?: string | null;
}

/** T8 — reusable LLM profile. One profile = one `{provider,
 *  base_url, model, api_key_env}` tuple the user has configured, which
 *  multiple agents can point at. Stored in
 *  `<config_dir>/llm_profiles.json` next to `hermes_instances.json`.
 *
 *  `api_key_env` names the `*_API_KEY` entry in `~/.hermes/.env` Hermes
 *  will resolve at request time — the raw key never lives in this
 *  file, keeping it safe for dotfiles commits. */
export interface LlmProfile {
  id: string;
  label: string;
  provider: string;
  base_url: string;
  model: string;
  api_key_env?: string | null;
  vision?: boolean | null;
}

export interface LlmProfilesFile {
  profiles: LlmProfile[];
}

/** List all profiles. Empty array when the file doesn't exist yet. */
export function llmProfileList(): Promise<LlmProfilesFile> {
  return invoke<LlmProfilesFile>('llm_profile_list');
}

/** Create or update (by `id`). Rust-side validate_id / base_url /
 *  model runs and surfaces violations as `IpcError::NotConfigured`. */
export function llmProfileUpsert(profile: LlmProfile): Promise<LlmProfile> {
  return invoke<LlmProfile>('llm_profile_upsert', { profile });
}

/** Delete by id. Rejects with `NotConfigured` if no row matches —
 *  keeps us honest about phantom deletes. Callers should refresh
 *  their list afterwards. */
export function llmProfileDelete(id: string): Promise<void> {
  return invoke<void>('llm_profile_delete', { id });
}

/** Info returned by `llm_profile_ensure_adapter` — enough to pin the
 *  session to the freshly-registered adapter + model in one write. */
export interface LlmProfileAdapterInfo {
  /** `hermes:profile:<profile_id>`. Use this as `session.adapter_id`. */
  adapter_id: string;
  /** The profile's `model` — use this as `session.model`. */
  model: string;
  /** UI label for tooltips/toasts. */
  label: string;
}

/** Materialise an `LlmProfile` as an in-memory Hermes adapter so the
 *  chat can route to it directly. Idempotent — re-registers on repeat
 *  calls so key/base_url changes take effect. */
export function llmProfileEnsureAdapter(profileId: string): Promise<LlmProfileAdapterInfo> {
  return invoke<LlmProfileAdapterInfo>('llm_profile_ensure_adapter', {
    profileId,
  });
}

export interface VisionProbeResult {
  profile_id: string;
  vision: boolean;
  model_id: string;
}

export function llmProfileProbeVision(profileId: string): Promise<VisionProbeResult> {
  return invoke<VisionProbeResult>('llm_profile_probe_vision', { profileId });
}

export interface HermesInstancesFile {
  instances: HermesInstance[];
}

export interface HermesInstanceProbeResult {
  id: string;
  ok: boolean;
  latency_ms: number;
  body: string;
}

/** List extra Hermes instances. Empty array = no file yet (first-run). */
export function hermesInstanceList(): Promise<HermesInstancesFile> {
  return invoke<HermesInstancesFile>('hermes_instance_list');
}

/** Create-or-update by `id`. Validates id + base_url + probes the URL.
 *  Hot-registers the adapter under `hermes:<id>` on success. */
export function hermesInstanceUpsert(instance: HermesInstance): Promise<HermesInstance> {
  return invoke<HermesInstance>('hermes_instance_upsert', { instance });
}

/** Idempotent delete. Unregisters the adapter and persists. */
export function hermesInstanceDelete(id: string): Promise<void> {
  return invoke<void>('hermes_instance_delete', { id });
}

/** Dry-run `/health` against a proposed instance config without
 *  persisting. The result always resolves (never rejects) so the UI
 *  can show red/green alongside an error string. */
export function hermesInstanceTest(
  instance: HermesInstance,
): Promise<HermesInstanceProbeResult> {
  return invoke<HermesInstanceProbeResult>('hermes_instance_test', { instance });
}

// ─────────────── T6.4 · Routing rules ───────────────

/** Predicate evaluated against the composed message text. One of
 *  `'prefix' | 'contains' | 'regex'`. The case-toggle applies to
 *  both `value` and the input text. */
export type RoutingMatch =
  | { kind: 'prefix'; value: string; case_sensitive?: boolean }
  | { kind: 'contains'; value: string; case_sensitive?: boolean }
  | { kind: 'regex'; value: string; case_sensitive?: boolean };

/** One user-declared routing rule. Stored in
 *  `<app_config_dir>/routing_rules.json`. First enabled match in file
 *  order wins; `target_adapter_id` is looked up in the AdapterRegistry
 *  at send time. */
export interface RoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  match: RoutingMatch;
  target_adapter_id: string;
}

export interface RoutingRulesFile {
  rules: RoutingRule[];
}

export function routingRuleList(): Promise<RoutingRulesFile> {
  return invoke<RoutingRulesFile>('routing_rule_list');
}

export function routingRuleUpsert(rule: RoutingRule): Promise<RoutingRule> {
  return invoke<RoutingRule>('routing_rule_upsert', { rule });
}

export function routingRuleDelete(id: string): Promise<void> {
  return invoke<void>('routing_rule_delete', { id });
}

