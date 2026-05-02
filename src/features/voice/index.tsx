import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, Mic, Save, Volume2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  voiceGetConfig,
  voiceSetConfig,
  type VoiceConfig,
} from '@/lib/ipc';

import { Field, ProviderCard } from './ProviderCard';
import { VoiceAuditPanel } from './VoiceAuditPanel';
import { VoiceTestPanel } from './VoiceTestPanel';
import { VOICE_PROVIDERS, getProvider } from './providers';

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
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="text-lg font-semibold text-fg">{t('voice.title')}</h2>
        <p className="text-xs text-fg-subtle">{t('voice.subtitle')}</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border/60 bg-bg-elev-1/80 px-4 py-2 backdrop-blur-sm">
        <div className="inline-flex rounded-lg border border-border bg-bg-elev-2/60 p-0.5">
          {(['settings', 'test', 'audit'] as const).map((t2) => (
            <button
              key={t2}
              type="button"
              onClick={() => setTab(t2)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                tab === t2 ? 'bg-bg-elev-1 text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              {t(`voice.tab_${t2}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}

        {tab === 'settings' && (
          <div className="flex flex-col gap-6">
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
    </div>
  );
}
