/**
 * Catalog of Hermes-instance provider templates used by the Agent
 * Wizard. Each entry gives the wizard enough to pre-fill every field
 * a new Hermes instance needs: the OpenAI-compatible endpoint, the
 * env-var name users typically set the API key under, a handful of
 * suggested model ids, and a one-line description.
 *
 * These are hints, not a schema check — the user can still edit every
 * field after the wizard closes. The goal is to reduce the
 * "where do I get the base URL" cognitive load on first use.
 *
 * Adding a provider: just append an entry. The wizard reads them in
 * order for the picker.
 */

export interface ProviderTemplate {
  /** Stable id used in data-testid + picker keys. */
  id: string;
  /** UI label (translated via the t() call site). */
  label: string;
  /** Short pitch shown beneath the label in the picker. */
  description: string;
  /** `base_url` pre-filled into the new instance. Users can override. */
  baseUrl: string;
  /**
   * `*_API_KEY` name the provider's SDK / docs use. Populated into
   * Hermes's .env so nothing literal crosses IPC boundaries.
   * `null` for key-less providers (Ollama / any local gateway).
   */
  envKey: string | null;
  /**
   * Suggested models shown in the dropdown BEFORE a live `/v1/models`
   * probe lands. Keep to a tight, curated list — we use these to seed
   * the picker so it doesn't look empty on slow networks.
   * The live probe overrides this once it returns.
   */
  suggestedModels: string[];
  /** Hint about where to get an API key / install the backend. */
  setupUrl: string;
  /**
   * `true` for providers whose endpoint is only reachable from the
   * user's own machine (Ollama, LM Studio, …). Unlocks the "detect
   * running locally" affordance in the wizard.
   */
  isLocal?: boolean;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Official OpenAI API. GPT-4o + reasoning models.',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
    setupUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Claude 3.5 Sonnet, Opus, Haiku via Anthropic API.',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    suggestedModels: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
    ],
    setupUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'deepseek-chat + deepseek-reasoner. Cheap and capable.',
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    setupUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    description: 'Gemini 2.0 Flash + 1.5 Pro via the OpenAI-compat shim.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GOOGLE_API_KEY',
    suggestedModels: [
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    setupUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    description: 'Runs models on your machine. No API key, no cloud.',
    baseUrl: 'http://localhost:11434/v1',
    envKey: null,
    suggestedModels: ['llama3.2', 'qwen2.5', 'mistral'],
    setupUrl: 'https://ollama.com/download',
    isLocal: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'One API key, 100+ models (Claude, GPT, Gemini, …).',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    suggestedModels: [
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'google/gemini-pro-1.5',
      'deepseek/deepseek-chat',
    ],
    setupUrl: 'https://openrouter.ai/keys',
  },
];

export function findTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((p) => p.id === id);
}
