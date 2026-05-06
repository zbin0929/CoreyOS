import { invoke } from '@tauri-apps/api/core';

/**
 * Mirrors `src-tauri/src/vision_proxy/mod.rs::VisionProxyConfig`.
 *
 * Snake_case field names match the Rust serde defaults — no camelCase
 * remapping anywhere in the chain.
 */
export interface VisionProxyConfig {
  enabled: boolean;
  model: string;
  base_url: string;
  api_key: string;
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
