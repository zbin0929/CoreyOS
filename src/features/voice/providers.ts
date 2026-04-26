/**
 * Voice provider catalog. Pure data + lookup helpers — no React, no
 * IPC. Imported from VoiceRoute for the settings form, the test
 * panel for error localisation, and the audit panel for label
 * lookup.
 */

export interface VoiceProviderTemplate {
  id: string;
  label: string;
  description: string;
  asrEndpoint: string | null;
  ttsEndpoint: string | null;
  needsApiKey: boolean;
  apiKeyName: string | null;
  setupUrl: string | null;
  setupLabel: string | null;
  ttsVoices: string[];
  defaultVoice: string;
  isFree?: boolean;
  isLocal?: boolean;
}

export const VOICE_PROVIDERS: VoiceProviderTemplate[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Whisper ASR + TTS。支持 50+ 种语言，高质量语音合成。',
    asrEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
    ttsEndpoint: 'https://api.openai.com/v1/audio/speech',
    needsApiKey: true,
    apiKeyName: 'OPENAI_API_KEY',
    setupUrl: 'https://platform.openai.com/api-keys',
    setupLabel: 'platform.openai.com',
    ttsVoices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'],
    defaultVoice: 'alloy',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    description: 'GLM-ASR 语音识别 + GLM-TTS 语音合成。国内访问快。',
    asrEndpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions',
    ttsEndpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/speech',
    needsApiKey: true,
    apiKeyName: 'ZHIPUAI_API_KEY',
    setupUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    setupLabel: 'open.bigmodel.cn',
    ttsVoices: ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'],
    defaultVoice: 'tongtong',
  },
  {
    id: 'groq',
    label: 'Groq (免费 ASR)',
    description: '免费 Whisper-large-v3 语音识别，速度极快。仅支持 ASR。',
    asrEndpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    ttsEndpoint: null,
    needsApiKey: true,
    apiKeyName: 'GROQ_API_KEY',
    setupUrl: 'https://console.groq.com/keys',
    setupLabel: 'console.groq.com',
    ttsVoices: [],
    defaultVoice: '',
    isFree: true,
  },
  {
    id: 'edge',
    label: 'Edge TTS (免费)',
    description: '微软 Edge 在线语音合成，完全免费，音质高。仅支持 TTS，需本地启动服务。',
    asrEndpoint: null,
    ttsEndpoint: 'http://localhost:5050/v1/audio/speech',
    needsApiKey: false,
    apiKeyName: null,
    setupUrl: 'https://github.com/travisvn/openai-edge-tts',
    setupLabel: 'openai-edge-tts',
    ttsVoices: [
      'zh-CN-XiaoxiaoNeural',
      'zh-CN-YunyangNeural',
      'zh-CN-YunxiNeural',
      'zh-CN-XiaohanNeural',
      'en-US-AvaNeural',
      'en-US-AndrewNeural',
    ],
    defaultVoice: 'zh-CN-XiaoxiaoNeural',
    isFree: true,
    isLocal: true,
  },
];

export function getProvider(id: string): VoiceProviderTemplate {
  return VOICE_PROVIDERS.find((p) => p.id === id) ?? VOICE_PROVIDERS[0]!;
}

/** Map of provider id → display label, for the audit panel which
 *  doesn't need any of the rest of the template. */
export const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  VOICE_PROVIDERS.map((p) => [p.id, p.label]),
);

/** Translate well-known backend error strings into Chinese for the
 *  test panel. Falls back to the raw string for anything we haven't
 *  catalogued so we never accidentally swallow a useful error. */
export function localizeError(msg: string): string {
  const map: Record<string, string> = {
    'ASR API key not configured': 'ASR API Key 未配置，请先在语音设置中填写 API Key',
    'TTS API key not configured': 'TTS API Key 未配置，请先在语音设置中填写 API Key',
    'No input device found': '未找到麦克风设备，请检查系统设置',
    'no_input_device': '未找到麦克风设备，请检查系统设置',
    'no_audio_captured': '未能捕获到音频，请检查麦克风权限',
  };
  for (const [key, val] of Object.entries(map)) {
    if (msg.includes(key)) return val;
  }
  return msg;
}
