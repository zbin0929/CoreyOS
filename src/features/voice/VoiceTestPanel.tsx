import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, Volume2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  voiceRecord,
  voiceRecordStop,
  voiceTranscribe,
  voiceTts,
} from '@/lib/ipc';

import { localizeError } from './providers';

export function VoiceTestPanel() {
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
