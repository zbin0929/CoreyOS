/**
 * Known providers with the env var convention Hermes expects. Used to suggest
 * which API key the user needs and to populate the provider dropdown. This is
 * a starter list — user can type any custom slug.
 */
export const PROVIDER_CATALOG: Array<{
  slug: string;
  label: string;
  envKey: string;
  baseUrl?: string;
  sampleModels: string[];
}> = [
  {
    slug: 'deepseek',
    label: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    // Keep `deepseek-reasoner` at index 0 — it's still the most
    // popular pick and the Models page uses `[0]` as the input
    // placeholder. Putting v4-* first changed the placeholder
    // and broke the e2e Models→Logs spec which targets the
    // input by placeholder regex.
    sampleModels: ['deepseek-reasoner', 'deepseek-chat', 'deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  {
    slug: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    sampleModels: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
  },
  {
    slug: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    sampleModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  },
  {
    slug: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    sampleModels: ['anthropic/claude-sonnet-4', 'google/gemini-2.0-flash-thinking-exp'],
  },
  {
    slug: 'zai',
    label: 'Z.AI (GLM)',
    envKey: 'ZAI_API_KEY',
    sampleModels: ['glm-4.6', 'glm-4.5'],
  },
  {
    slug: 'kimi-coding',
    label: 'Kimi / Moonshot',
    envKey: 'KIMI_API_KEY',
    sampleModels: ['kimi-k2-0905-preview', 'moonshot-v1-auto'],
  },
  {
    slug: 'minimax',
    label: 'MiniMax',
    envKey: 'MINIMAX_API_KEY',
    sampleModels: ['MiniMax-M1', 'abab6.5s-chat'],
  },
];
