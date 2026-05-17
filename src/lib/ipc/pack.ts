import { invoke } from '@tauri-apps/api/core';
import type { WorkflowSummary } from './runtime';

/**
 * Wire types for the Pack subsystem (`crate::ipc::pack`).
 * Mirrors the camelCase serde rename so `PackListEntry.dirName`
 * etc. line up 1:1 with the Rust DTO.
 */
export interface PackListEntry {
  dirName: string;
  manifestId: string;
  title: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  error: string | null;
  healthy: boolean;
  licenseGated: boolean;
}

export interface PackAction {
  label: string;
  workflow: string;
  skill: string;
  confirm: boolean;
}

export interface PackView {
  packId: string;
  packTitle: string;
  viewId: string;
  title: string;
  icon: string;
  navSection: string;
  /** Template name. MUST match one of the basebuilt 12 view
   *  templates. Unknown values render as a "missing template"
   *  placeholder rather than crashing. */
  template: string;
  /** Free-form data source descriptor; concrete shape depends on
   *  the template. */
  dataSource: unknown;
  /** Free-form template options (columns, metrics, layout, ...) */
  options: unknown;
  actions: PackAction[];
}

export function packList(): Promise<PackListEntry[]> {
  return invoke<PackListEntry[]>('pack_list');
}

export function packRescan(): Promise<PackListEntry[]> {
  return invoke<PackListEntry[]>('pack_rescan');
}

export function packSetEnabled(packId: string, enabled: boolean): Promise<void> {
  return invoke<void>('pack_set_enabled', { packId, enabled });
}

export interface PackSoulEntry {
  packId: string;
  packTitle: string;
  content: string;
}

export function packActiveSouls(): Promise<PackSoulEntry[]> {
  return invoke<PackSoulEntry[]>('pack_active_souls');
}

export function packViewsList(): Promise<PackView[]> {
  return invoke<PackView[]>('pack_views_list');
}

/**
 * Fetch the rendered payload for one Pack view, resolving its
 * `data_source` directive on the backend. Returns `{}` when the
 * view has no data source declared (templates render their own
 * "no data" state).
 */
export function packViewData(
  packId: string,
  viewId: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return invoke<unknown>('pack_view_data', { packId, viewId, params: params ?? {} });
}

/**
 * Recursive Pack config schema field. Mirrors the Rust IPC DTO
 * `crate::ipc::pack::config::PackConfigSchema`. The recursive
 * fields (`fields` / `item` / `showIf` / `preview` / array bounds /
 * `width`) drive the v0.3.0 `SchemaConfig` template; pre-v0.3.0
 * flat-schema Packs receive empty defaults for them and still
 * render correctly via the legacy `PackConfig` template.
 */
export interface PackConfigSchemaField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  secret: boolean;
  description: string;
  help: string;
  group: string;
  validation: string;
  placeholder: string;
  default: unknown;
  options: string[];
  /** Sub-schema for `type: nested`. */
  fields: PackConfigSchemaField[];
  /** Sub-schema for `type: array` items. */
  item: PackConfigSchemaField[];
  /** Optional showIf expression (eq / ne / and / or / not). */
  showIf: string;
  /** Mustache-style preview / computed template. */
  preview: string;
  /** Array length lower bound; 0 = unlimited. */
  minItems: number;
  /** Array length upper bound; 0 = unlimited. */
  maxItems: number;
  /** Array "+ Add" button label. Empty = frontend default. */
  addLabel: string;
  /** Width hint: `""` / `"full"` / `"half"` / `"small"`. */
  width: string;
}

export function packConfigSchema(packId: string): Promise<PackConfigSchemaField[]> {
  return invoke<PackConfigSchemaField[]>('pack_config_schema', { packId });
}

export function packConfigGet(packId: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('pack_config_get', { packId });
}

export function packConfigSet(packId: string, config: Record<string, unknown>): Promise<void> {
  return invoke<void>('pack_config_set', { packId, config });
}

export function packExchangeRateConfigGet(packId: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('pack_exchange_rate_config_get', { packId });
}

export function packExchangeRateConfigSet(packId: string, config: Record<string, unknown>): Promise<void> {
  return invoke<void>('pack_exchange_rate_config_set', { packId, config });
}

export function packZoneConfigGet(packId: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('pack_zone_config_get', { packId });
}

export function packZoneConfigSet(packId: string, config: Record<string, unknown>): Promise<void> {
  return invoke<void>('pack_zone_config_set', { packId, config });
}

export function packWorkflowsList(): Promise<WorkflowSummary[]> {
  return invoke<WorkflowSummary[]>('pack_workflows_list');
}

export function packImportZip(zipPath: string): Promise<string> {
  return invoke<string>('pack_import_zip', { zipPath });
}

export function packUninstall(packId: string): Promise<void> {
  return invoke<void>('pack_uninstall', { packId });
}
