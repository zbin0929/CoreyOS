import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, StopCircle, Volume2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { voiceTts } from '@/lib/ipc';

/**
 * Module-singleton audio handle so a second TtsButton can stop the
 * one already playing. Two buttons can't sensibly play in parallel —
 * pressing play on a different bubble cancels the prior playback.
 */
let _ttsAudio: HTMLAudioElement | null = null;

export function TtsButton({ content }: { content: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');

  const onClick = useCallback(() => {
    if (state === 'playing') {
      _ttsAudio?.pause();
      _ttsAudio = null;
      setState('idle');
      return;
    }
    if (state === 'loading') return;
    setState('loading');
    void voiceTts(content)
      .then((res) => {
        const audio = new Audio(res.audio_base64);
        _ttsAudio = audio;
        audio.onended = () => {
          _ttsAudio = null;
          setState('idle');
        };
        audio.onerror = () => {
          _ttsAudio = null;
          setState('idle');
        };
        void audio.play();
        setState('playing');
      })
      .catch(() => setState('idle'));
  }, [content, state]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'transition-colors',
        state === 'playing' ? 'text-gold-500 hover:text-gold-400' : state === 'loading' ? 'text-fg-muted' : 'text-fg-subtle hover:text-fg',
      )}
      aria-label={state === 'playing' ? t('chat_page.tts_stop') : t('chat_page.tts_play')}
      title={state === 'playing' ? t('chat_page.tts_stop') : t('chat_page.tts_play')}
    >
      <Icon
        icon={state === 'playing' ? StopCircle : state === 'loading' ? Loader2 : Volume2}
        size="xs"
        className={cn(state === 'loading' && 'animate-spin')}
      />
    </button>
  );
}
