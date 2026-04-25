import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Eye,
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
  type VoiceConfig,
  type VoiceAuditEntry,
} from '@/lib/ipc';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  zhipu: 'Zhipu (智谱)',
  groq: 'Groq',
  edge: 'Edge TTS (免费)',
};

export function VoiceRoute() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const load = useCallback(async () => {
    try {
      const cfg = await voiceGetConfig();
      setConfig(cfg);
      setAsrProvider(cfg.asr_provider);
      setAsrEndpoint(cfg.asr_endpoint ?? '');
      setAsrApiKey('');
      setTtsProvider(cfg.tts_provider);
      setTtsEndpoint(cfg.tts_endpoint ?? '');
      setTtsApiKey('');
      setTtsVoice(cfg.tts_voice);
      setTtsSpeed(cfg.tts_speed);
      setHotkey(cfg.hotkey);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = useCallback(async () => {
    setSaving(true);
    setError(null);
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

  const ttsVoices = config.tts_voices.length > 0 ? config.tts_voices : [ttsVoice];
  const ttsDisabled = ttsProvider === 'groq';

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
            <section className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4">
              <div className="flex items-center gap-2">
                <Icon icon={Mic} size="md" className="text-fg-subtle" />
                <h3 className="text-sm font-medium text-fg">{t('voice.asr_title')}</h3>
              </div>
              <p className="text-xs text-fg-subtle">{t('voice.asr_desc')}</p>
              <Field label={t('voice.provider')}>
                <Select
                  value={asrProvider}
                  onChange={setAsrProvider}
                  options={config.available_asr_providers.map((p) => ({
                    value: p,
                    label: PROVIDER_LABELS[p] ?? p,
                  }))}
                  data-testid="voice-asr-provider"
                />
              </Field>
              <Field label={t('voice.asr_endpoint')}>
                <input
                  type="text"
                  value={asrEndpoint}
                  onChange={(e) => setAsrEndpoint(e.target.value)}
                  placeholder={t('voice.endpoint_auto')}
                  className="input"
                  data-testid="voice-asr-endpoint"
                />
              </Field>
              <p className="text-[11px] text-fg-subtle">{t('voice.endpoint_hint')}</p>
              <Field label={t('voice.asr_api_key')}>
                <input
                  type="password"
                  value={asrApiKey}
                  onChange={(e) => setAsrApiKey(e.target.value)}
                  placeholder={config.asr_api_key_set ? '••••••••' : t('voice.api_key_placeholder')}
                  className="input"
                  data-testid="voice-asr-key"
                />
              </Field>
            </section>

            <section className={cn(
              'flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4',
              ttsDisabled && 'opacity-50',
            )}>
              <div className="flex items-center gap-2">
                <Icon icon={Volume2} size="md" className="text-fg-subtle" />
                <h3 className="text-sm font-medium text-fg">{t('voice.tts_title')}</h3>
              </div>
              <p className="text-xs text-fg-subtle">{t('voice.tts_desc')}</p>
              <Field label={t('voice.provider')}>
                <Select
                  value={ttsProvider}
                  onChange={setTtsProvider}
                  options={config.available_tts_providers.map((p) => ({
                    value: p,
                    label: PROVIDER_LABELS[p] ?? p,
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
                      onChange={(e) => setTtsEndpoint(e.target.value)}
                      placeholder={t('voice.endpoint_auto')}
                      className="input"
                      data-testid="voice-tts-endpoint"
                    />
                  </Field>
                  <p className="text-[11px] text-fg-subtle">{t('voice.endpoint_hint')}</p>
                  <Field label={t('voice.tts_api_key')}>
                    <input
                      type="password"
                      value={ttsApiKey}
                      onChange={(e) => setTtsApiKey(e.target.value)}
                      placeholder={config.tts_api_key_set ? '••••••••' : t('voice.api_key_placeholder')}
                      className="input"
                      data-testid="voice-tts-key"
                    />
                  </Field>
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
            </section>

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
                variant="primary"
                onClick={() => void onSave()}
                disabled={saving}
                data-testid="voice-save"
              >
                <Icon icon={saving ? Loader2 : Save} size="sm" className={cn(saving && 'animate-spin')} />
                {saving ? t('voice.saving') : t('voice.save')}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-fg-muted">{label}</span>
      {children}
      <style>{`.input{width:100%;border-radius:var(--radius-md,6px);border:1px solid var(--color-border,var(--color-gray-6,#e5e7eb));background:var(--color-bg-elev-1,var(--color-gray-2,#f9fafb));padding:6px 10px;font-size:12px;color:var(--color-fg,var(--color-gray-12,#111827))}.input:focus{outline:none;border-color:var(--color-gold-500,#d4a843);box-shadow:0 0 0 1px var(--color-gold-500,#d4a843)}`}</style>
    </label>
  );
}

function VoiceTestPanel() {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState('Hello! 你好！こんにちは！');
  const [playing, setPlaying] = useState(false);

  const onRecord = useCallback(async () => {
    if (recording) return;
    setRecording(true);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1] ?? '';
            const res = await voiceTranscribe(base64, 'audio/webm');
            setResult(res.text || '(empty)');
          };
          reader.readAsDataURL(blob);
        } catch (e) {
          setResult(`Error: ${ipcErrorMessage(e)}`);
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      await new Promise((r) => setTimeout(r, 5000));
      recorder.stop();
    } catch (e) {
      setRecording(false);
      setResult(`Mic error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [recording]);

  const onTts = useCallback(async () => {
    if (playing || !ttsText.trim()) return;
    setPlaying(true);
    try {
      const res = await voiceTts(ttsText);
      const audio = new Audio(`file://${res.audio_path}`);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      void audio.play();
    } catch {
      setPlaying(false);
    }
  }, [ttsText, playing]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4">
        <h3 className="text-sm font-medium text-fg">{t('voice.test_asr')}</h3>
        <p className="text-xs text-fg-subtle">{t('voice.test_asr_hint')}</p>
        <Button
          size="sm"
          variant={recording ? 'ghost' : 'primary'}
          onClick={() => void onRecord()}
          disabled={recording || transcribing}
          data-testid="voice-test-record"
        >
          <Icon icon={recording || transcribing ? Loader2 : Mic} size="sm" className={cn((recording || transcribing) && 'animate-spin')} />
          {recording ? t('voice.recording') : transcribing ? t('voice.transcribing') : t('voice.record_5s')}
        </Button>
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
          className="input"
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
    </div>
  );
}

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
