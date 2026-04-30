import { invoke } from '@tauri-apps/api/core';

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

export function packSetEnabled(packId: string, enabled: boolean): Promise<void> {
  return invoke<void>('pack_set_enabled', { packId, enabled });
}

export function packViewsList(): Promise<PackView[]> {
  return invoke<PackView[]>('pack_views_list');
}
