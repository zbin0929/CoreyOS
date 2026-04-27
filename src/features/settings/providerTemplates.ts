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
  // ───────── Domestic (CN) providers ─────────
  // All use their vendor's official OpenAI-compatible endpoint. Users
  // sign up on the vendor console, generate an API key, paste it here.
  // Model ids are the vendor's current public list — the live
  // /v1/models probe overrides these once the user hits Discover.
  {
    id: 'qwen',
    label: '通义千问 (Qwen / 阿里百炼)',
    description: 'Qwen 系列：qwen-max / qwen-plus / qwen-turbo。阿里云百炼 OpenAI 兼容接口。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envKey: 'DASHSCOPE_API_KEY',
    suggestedModels: [
      'qwen-max',
      'qwen-plus',
      'qwen-turbo',
      'qwen-long',
      'qwen2.5-72b-instruct',
    ],
    setupUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    description: 'GLM-4 系列：plus / air / flash。智谱 AI 开放平台。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    envKey: 'ZHIPUAI_API_KEY',
    suggestedModels: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4'],
    setupUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    description: 'Moonshot Kimi：8k / 32k / 128k 长上下文。',
    baseUrl: 'https://api.moonshot.cn/v1',
    envKey: 'MOONSHOT_API_KEY',
    suggestedModels: [
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
      'kimi-k2-0905-preview',
    ],
    setupUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    description: '01.AI Yi 系列：large / medium / spark / vision。',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    envKey: 'YI_API_KEY',
    suggestedModels: ['yi-large', 'yi-medium', 'yi-spark', 'yi-vision'],
    setupUrl: 'https://platform.lingyiwanwu.com/apikeys',
  },
  {
    id: 'baichuan',
    label: '百川 Baichuan',
    description: 'Baichuan4 / Baichuan3-Turbo 系列。',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    envKey: 'BAICHUAN_API_KEY',
    suggestedModels: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan2-Turbo'],
    setupUrl: 'https://platform.baichuan-ai.com/console/apikey',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    description: 'Hunyuan turbo / standard / lite。腾讯云 OpenAI 兼容接口。',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    envKey: 'HUNYUAN_API_KEY',
    suggestedModels: [
      'hunyuan-turbo',
      'hunyuan-standard',
      'hunyuan-lite',
      'hunyuan-pro',
    ],
    setupUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
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
    id: 'nvidia',
    label: 'NVIDIA NIM',
    description: 'NVIDIA AI 平台，提供 GLM-5、DeepSeek、MiniMax 等多种模型，OpenAI 兼容接口。',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    envKey: 'NVIDIA_API_KEY',
    suggestedModels: [
      'z-ai/glm-5.1',
      'deepseek-ai/deepseek-v3.2',
      'minimaxai/minimax-m2.7',
      'meta/llama-3.3-70b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
    ],
    setupUrl: 'https://build.nvidia.com/',
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
  // Catch-all for any OpenAI-compatible endpoint not on this list:
  // self-hosted vLLM / TGI, third-party proxies, internal corporate
  // gateways, new providers we haven't added a template for yet, etc.
  // Empty `baseUrl` + `suggestedModels` means the wizard won't pre-fill
  // anything — the user types both fields themselves. `envKey` defaults
  // to `CUSTOM_API_KEY` so the .env entry has a sensible name; users
  // can still override it on the LLMs page after the profile is saved.
  {
    id: 'custom',
    label: '自定义 / Custom',
    description:
      '任意 OpenAI 兼容接口。手动填写 base URL + 模型名 —— 适合自建 vLLM、第三方代理、企业内网网关。',
    baseUrl: '',
    envKey: 'CUSTOM_API_KEY',
    suggestedModels: [],
    setupUrl: 'https://platform.openai.com/docs/api-reference',
  },
];

export function findTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((p) => p.id === id);
}
