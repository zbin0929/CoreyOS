import { invoke } from '@tauri-apps/api/core';

/**
 * Mirrors `src-tauri/src/vision_proxy/mod.rs::VisionProxyConfig`.
 *
 * Snake_case field names match the Rust serde defaults — no camelCase
 * remapping anywhere in the chain.
 */
export interface VisionProxyConfig {
  enabled: boolean;
  /**
   * Preferred mode: id of an LLM profile from Settings → Models.
   * Non-empty value wins over the inline fields below; the
   * profile's `model` / `base_url` / `api_key_env` are resolved
   * at call time so the user keeps a single source of truth.
   */
  llm_profile_id: string;
  /** Manual override — ignored when `llm_profile_id` is set. */
  model: string;
  /** Manual override — ignored when `llm_profile_id` is set. */
  base_url: string;
  /** Manual override — ignored when `llm_profile_id` is set. */
  api_key: string;
  /** Manual override — ignored when `llm_profile_id` is set. */
  api_key_env?: string | null;
  prompt: string;
}

export function visionProxyGet(): Promise<VisionProxyConfig> {
  return invoke<VisionProxyConfig>('vision_proxy_get');
}

export function visionProxySet(config: VisionProxyConfig): Promise<void> {
  return invoke<void>('vision_proxy_set', { config });
}

export function visionProxyClearCache(): Promise<number> {
  return invoke<number>('vision_proxy_clear_cache');
}
