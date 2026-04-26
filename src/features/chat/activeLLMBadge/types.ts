import type { LlmProfile, ModelInfo } from '@/lib/ipc';

/**
 * Unified picker row — we merge gateway-reported models (from the
 * default adapter's `/v1/models`) with user-saved LLM profiles
 * (materialised into `hermes:profile:<id>` adapters on demand) so the
 * user never has to think about whether a given option is a "gateway
 * model" vs a "profile". Kind stays on the row so `selectRow` can pick
 * the right IPC path + state flip.
 */
export type PickerRow =
  | { kind: 'model'; m: ModelInfo }
  | { kind: 'profile'; p: LlmProfile };
