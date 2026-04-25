import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  Eye,
  ExternalLink,
  Info,
  Loader2,
  Mic,
  Save,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  voiceGetConfig,
  voiceSetConfig,
  voiceTranscribe,
  voiceTts,
  voiceAuditLog,
  voiceRecord,
  voiceRecordStop,
  type VoiceConfig,
  type VoiceAuditEntry,
} from '@/lib/ipc';

// ───────────────────────── Voice Provider Templates ─────────────────────────

interface VoiceProviderTemplate {
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

const VOICE_PROVIDERS: VoiceProviderTemplate[] = [
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

function getProvider(id: string): VoiceProviderTemplate {
  return VOICE_PROVIDERS.find((p) => p.id === id) ?? VOICE_PROVIDERS[0]!;
}

// ───────────────────────── Main Route ─────────────────────────

export function VoiceRoute() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'settings' | 'test' | 'audit'>('settings');

  const [asrProvider, setAsrProvider] = useState('openai');
  const [asrEndpoint, setAsrEndpoint] = useState('');
  const [asrApiKey, setAsrApiKey] = useState('');
  const [ttsProvider, setTtsProvider] = useState('openai');
  const [ttsEndpoint, setTtsEndpoint] = useState('');
  const [ttsApiKey, setTtsApiKey] = useState('');
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [hotkey, setHotkey] = useState('Meta+Space');

  const [userChangedAsrEndpoint, setUserChangedAsrEndpoint] = useState(false);
  const [userChangedTtsEndpoint, setUserChangedTtsEndpoint] = useState(false);

  const load = useCallback(async () => {
    try {
      const cfg = await voiceGetConfig();
      setConfig(cfg);
      setAsrProvider(cfg.asr_provider);
      setAsrEndpoint(cfg.asr_endpoint ?? getProvider(cfg.asr_provider).asrEndpoint ?? '');
      setAsrApiKey('');
      setTtsProvider(cfg.tts_provider);
      setTtsEndpoint(cfg.tts_endpoint ?? getProvider(cfg.tts_provider).ttsEndpoint ?? '');
      setTtsApiKey('');
      setTtsVoice(cfg.tts_voice);
      setTtsSpeed(cfg.tts_speed);
      setHotkey(cfg.hotkey);
      setUserChangedAsrEndpoint(false);
      setUserChangedTtsEndpoint(false);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAsrProviderChange = useCallback((id: string) => {
    const tpl = getProvider(id);
    setAsrProvider(id);
    if (!userChangedAsrEndpoint && tpl.asrEndpoint) {
      setAsrEndpoint(tpl.asrEndpoint);
    }
    if (tpl.ttsVoices.length > 0 && !tpl.ttsVoices.includes(ttsVoice)) {
      setTtsVoice(tpl.defaultVoice);
    }
  }, [userChangedAsrEndpoint, ttsVoice]);

  const handleTtsProviderChange = useCallback((id: string) => {
    const tpl = getProvider(id);
    setTtsProvider(id);
    if (!userChangedTtsEndpoint && tpl.ttsEndpoint) {
      setTtsEndpoint(tpl.ttsEndpoint);
    }
    if (!tpl.ttsVoices.includes(ttsVoice)) {
      setTtsVoice(tpl.defaultVoice);
    }
  }, [userChangedTtsEndpoint, ttsVoice]);

  const onSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await voiceSetConfig({
        asr_provider: asrProvider,
        asr_endpoint: asrEndpoint || undefined,
        asr_api_key: asrApiKey || undefined,
        tts_provider: ttsProvider,
        tts_endpoint: ttsEndpoint || undefined,
        tts_api_key: ttsApiKey || undefined,
        tts_voice: ttsVoice,
        tts_speed: ttsSpeed,
        hotkey,
      });
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [asrProvider, asrEndpoint, asrApiKey, ttsProvider, ttsEndpoint, ttsApiKey, ttsVoice, ttsSpeed, hotkey, load]);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        <Icon icon={Loader2} size="md" className="animate-spin" />
      </div>
    );
  }

  const asrTpl = getProvider(asrProvider);
  const ttsTpl = getProvider(ttsProvider);
  const ttsVoices = ttsTpl.ttsVoices.length > 0 ? ttsTpl.ttsVoices : [ttsVoice];
  const ttsDisabled = ttsTpl.ttsEndpoint === null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold text-fg">{t('voice.title')}</h2>
        <p className="text-xs text-fg-subtle">{t('voice.subtitle')}</p>
      </div>

      <div className="flex gap-1 border-b border-border px-4 py-1">
        {(['settings', 'test', 'audit'] as const).map((t2) => (
          <button
            key={t2}
            type="button"
            onClick={() => setTab(t2)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition',
              tab === t2 ? 'bg-bg-elev-2 text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {t(`voice.tab_${t2}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}

        {tab === 'settings' && (
          <div className="flex flex-col gap-6">
            {/* ── ASR Section ── */}
            <ProviderCard
              icon={<Icon icon={Mic} size="md" className="text-fg-subtle" />}
              title={t('voice.asr_title')}
              template={asrTpl}
            >
              <Field label={t('voice.provider')}>
                <Select
                  value={asrProvider}
                  onChange={handleAsrProviderChange}
                  options={VOICE_PROVIDERS
                    .filter((p) => p.asrEndpoint !== null)
                    .map((p) => ({
                      value: p.id,
                      label: p.label,
                      hint: p.isFree ? '免费' : undefined,
                    }))}
                  data-testid="voice-asr-provider"
                />
              </Field>
              <Field label={t('voice.asr_endpoint')}>
                <input
                  type="text"
                  value={asrEndpoint}
                  onChange={(e) => {
                    setAsrEndpoint(e.target.value);
                    setUserChangedAsrEndpoint(true);
                  }}
                  placeholder={asrTpl.asrEndpoint ?? t('voice.endpoint_placeholder')}
                  className="input"
                  data-testid="voice-asr-endpoint"
                />
              </Field>
              {asrTpl.needsApiKey && (
                <Field label={t('voice.asr_api_key')}>
                  <input
                    type="password"
                    value={asrApiKey}
                    onChange={(e) => setAsrApiKey(e.target.value)}
                    placeholder={config.asr_api_key_set ? '••••••••' : t('voice.api_key_placeholder')}
                    className="input"
                    data-testid="voice-asr-key"
                  />
                  {asrTpl.apiKeyName && (
                    <span className="text-[10px] text-fg-subtle mt-1">
                      环境变量: <code className="text-fg-muted">{asrTpl.apiKeyName}</code>
                    </span>
                  )}
                </Field>
              )}
            </ProviderCard>

            {/* ── TTS Section ── */}
            <ProviderCard
              icon={<Icon icon={Volume2} size="md" className="text-fg-subtle" />}
              title={t('voice.tts_title')}
              template={ttsTpl}
              disabled={ttsDisabled}
            >
              <Field label={t('voice.provider')}>
                <Select
                  value={ttsProvider}
                  onChange={handleTtsProviderChange}
                  options={VOICE_PROVIDERS
                    .filter((p) => p.ttsEndpoint !== null)
                    .map((p) => ({
                      value: p.id,
                      label: p.label,
                      hint: p.isFree ? '免费' : undefined,
                    }))}
                  data-testid="voice-tts-provider"
                />
              </Field>
              {!ttsDisabled && (
                <>
                  <Field label={t('voice.tts_endpoint')}>
                    <input
                      type="text"
                      value={ttsEndpoint}
                      onChange={(e) => {
                        setTtsEndpoint(e.target.value);
                        setUserChangedTtsEndpoint(true);
                      }}
                      placeholder={ttsTpl.ttsEndpoint ?? t('voice.endpoint_placeholder')}
                      className="input"
                      data-testid="voice-tts-endpoint"
                    />
                  </Field>
                  {ttsTpl.needsApiKey && (
                    <Field label={t('voice.tts_api_key')}>
                      <input
                        type="password"
                        value={ttsApiKey}
                        onChange={(e) => setTtsApiKey(e.target.value)}
                        placeholder={config.tts_api_key_set ? '••••••••' : t('voice.api_key_placeholder')}
                        className="input"
                        data-testid="voice-tts-key"
                      />
                      {ttsTpl.apiKeyName && (
                        <span className="text-[10px] text-fg-subtle mt-1">
                          环境变量: <code className="text-fg-muted">{ttsTpl.apiKeyName}</code>
                        </span>
                      )}
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('voice.tts_voice')}>
                      <Select
                        value={ttsVoice}
                        onChange={setTtsVoice}
                        options={ttsVoices.map((v) => ({ value: v, label: v }))}
                        data-testid="voice-tts-voice"
                      />
                    </Field>
                    <Field label={t('voice.tts_speed')}>
                      <input
                        type="number"
                        value={ttsSpeed}
                        onChange={(e) => setTtsSpeed(parseFloat(e.target.value) || 1.0)}
                        min={0.25}
                        max={4.0}
                        step={0.25}
                        className="input"
                        data-testid="voice-tts-speed"
                      />
                    </Field>
                  </div>
                </>
              )}
              {ttsDisabled && (
                <p className="text-xs text-fg-subtle">{t('voice.tts_not_available')}</p>
              )}
            </ProviderCard>

            {/* ── Hotkey Section ── */}
            <section className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4">
              <Field label={t('voice.hotkey')}>
                <input
                  type="text"
                  value={hotkey}
                  onChange={(e) => setHotkey(e.target.value)}
                  className="input"
                  data-testid="voice-hotkey"
                />
              </Field>
              <p className="text-xs text-fg-subtle">{t('voice.hotkey_hint')}</p>
            </section>

            <div className="flex justify-end">
              <Button
                size="sm"
                variant={saved ? 'secondary' : 'primary'}
                onClick={() => void onSave()}
                disabled={saving}
                data-testid="voice-save"
              >
                <Icon icon={saving ? Loader2 : saved ? Check : Save} size="sm" className={cn(saving && 'animate-spin')} />
                {saving ? t('voice.saving') : saved ? t('voice.saved') : t('voice.save')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'test' && <VoiceTestPanel />}
        {tab === 'audit' && <VoiceAuditPanel />}
      </div>
    </div>
  );
}

// ───────────────────────── Provider Card ─────────────────────────

function ProviderCard({
  icon,
  title,
  template,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  template: VoiceProviderTemplate;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className={cn(
      'flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4',
      disabled && 'opacity-50',
    )}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        {template.isFree && (
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
            免费
          </span>
        )}
        {template.isLocal && (
          <span className="rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
            本地
          </span>
        )}
      </div>
      <p className="text-xs text-fg-subtle">{template.description}</p>
      {template.setupUrl && (
        <a
          href={template.setupUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-fg-subtle transition-colors hover:border-gold-500/40 hover:text-fg"
        >
          <Icon icon={ExternalLink} size="xs" />
          {template.setupLabel ?? t('voice.get_api_key')}
        </a>
      )}
      {template.isLocal && template.id === 'edge' && (
        <div className="flex items-start gap-2 rounded border border-blue-500/30 bg-blue-500/5 p-2 text-xs text-blue-400">
          <Icon icon={Info} size="xs" className="mt-0.5 flex-none" />
          <span>
            启动命令：<code className="rounded bg-blue-500/10 px-1 py-0.5 text-[11px]">docker run -d -p 5050:5050 travisvn/openai-edge-tts:latest</code>
          </span>
        </div>
      )}
      {children}
    </section>
  );
}

// ───────────────────────── Field ─────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-fg-muted">{label}</span>
      {children}
      <style>{`.input{width:100%;border-radius:var(--radius-md,6px);border:1px solid var(--color-border,var(--color-gray-6,#e5e7eb));background:var(--color-bg-elev-1,var(--color-gray-2,#f9fafb));padding:6px 10px;font-size:12px;color:var(--color-fg,var(--color-gray-12,#111827))}.input:focus{outline:none;border-color:var(--color-gold-500,#d4a843);box-shadow:0 0 0 1px var(--color-gold-500,#d4a843)}`}</style>
    </label>
  );
}

// ───────────────────────── Test Panel ─────────────────────────

function VoiceTestPanel() {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState('Hello! 你好！こんにちは！');
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const onStartRecord = useCallback(async () => {
    if (recording) return;
    setRecording(true);
    setResult(null);
    try {
      const base64 = await voiceRecord(120);
      setRecording(false);
      setTranscribing(true);
      try {
        const res = await voiceTranscribe(base64, 'audio/wav');
        setResult(res.text || '(empty)');
      } catch (e) {
        setResult(t('voice.error_asr', { msg: localizeError(ipcErrorMessage(e)) }));
      } finally {
        setTranscribing(false);
      }
    } catch (e) {
      setRecording(false);
      setResult(t('voice.error_mic', { msg: localizeError(ipcErrorMessage(e)) }));
    }
  }, [recording, t]);

  const onStopRecord = useCallback(async () => {
    try {
      await voiceRecordStop();
    } catch {
      // ignore — the record promise will resolve shortly
    }
  }, []);

  const onTts = useCallback(async () => {
    if (playing || !ttsText.trim()) return;
    setPlaying(true);
    setResult(null);
    try {
      const res = await voiceTts(ttsText);
      const audio = new Audio(res.audio_base64);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => {
        setPlaying(false);
        setResult(t('voice.error_playback'));
      };
      void audio.play();
    } catch (e) {
      setPlaying(false);
      setResult(t('voice.error_tts', { msg: localizeError(ipcErrorMessage(e)) }));
    }
  }, [ttsText, playing, t]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4">
        <h3 className="text-sm font-medium text-fg">{t('voice.test_asr')}</h3>
        <p className="text-xs text-fg-subtle">{t('voice.test_asr_hint')}</p>

        {!recording && !transcribing && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void onStartRecord()}
            data-testid="voice-test-record"
          >
            <Icon icon={Mic} size="sm" />
            {t('voice.record_start')}
          </Button>
        )}

        {recording && (
          <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 p-3">
            <div className="flex items-center gap-3">
              <div className="voice-wave flex items-center gap-[3px]">
                {[3, 5, 3, 7, 4, 6, 3, 5, 4, 7, 3, 5].map((h, i) => (
                  <span
                    key={i}
                    className="inline-block w-[3px] rounded-full bg-danger animate-voice-bar"
                    style={{
                      height: `${h * 3}px`,
                      animationDelay: `${i * 0.08}s`,
                    }}
                  />
                ))}
              </div>
              <span className="text-sm font-medium text-danger">
                {t('voice.recording_timer', { sec: elapsed })}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onStopRecord()}
              className="text-danger hover:text-danger"
              data-testid="voice-test-stop"
            >
              <Icon icon={Mic} size="sm" />
              {t('voice.record_stop')}
            </Button>
          </div>
        )}

        {transcribing && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Icon icon={Loader2} size="sm" className="animate-spin" />
            {t('voice.transcribing')}
          </div>
        )}

        {result && (
          <div className="rounded-md border border-border bg-bg-elev-2 p-3 text-sm text-fg" data-testid="voice-test-result">
            {result}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4">
        <h3 className="text-sm font-medium text-fg">{t('voice.test_tts')}</h3>
        <textarea
          value={ttsText}
          onChange={(e) => setTtsText(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40"
          data-testid="voice-test-tts-text"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onTts()}
          disabled={playing}
          data-testid="voice-test-tts-play"
        >
          <Icon icon={playing ? Loader2 : Volume2} size="sm" className={cn(playing && 'animate-spin')} />
          {playing ? t('voice.playing') : t('voice.play')}
        </Button>
      </section>

      <style>{`
        @keyframes voice-bar {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
        .animate-voice-bar {
          animation: voice-bar 0.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function localizeError(msg: string): string {
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

// ───────────────────────── Audit Panel ─────────────────────────

const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  VOICE_PROVIDERS.map((p) => [p.id, p.label]),
);

function VoiceAuditPanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<VoiceAuditEntry[]>([]);

  useEffect(() => {
    void voiceAuditLog(50).then(setEntries).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon icon={Eye} size="md" className="text-fg-subtle" />
        <h3 className="text-sm font-medium text-fg">{t('voice.audit_title')}</h3>
      </div>
      <p className="text-xs text-fg-subtle">{t('voice.audit_desc')}</p>
      {entries.length === 0 ? (
        <div className="text-sm text-fg-muted py-8 text-center">{t('voice.audit_empty')}</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e, i) => (
            <li
              key={i}
              className={cn(
                'flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs',
                e.success ? 'bg-bg-elev-1' : 'bg-danger/5 border-danger/30',
              )}
            >
              <span className={cn('font-mono', e.success ? 'text-fg' : 'text-danger')}>
                {e.event_type}
              </span>
              <span className="text-fg-subtle">{new Date(e.timestamp * 1000).toLocaleString()}</span>
              <span className="text-fg-subtle">{e.duration_ms}ms</span>
              <span className="text-fg-subtle truncate">{PROVIDER_LABELS[e.provider] ?? e.provider}</span>
              <span className={cn('ml-auto text-[10px]', e.success ? 'text-emerald-500' : 'text-danger')}>
                {e.success ? '✓' : '✗'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
