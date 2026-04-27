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
        // `preload="auto"` plus `canplaythrough` wait makes the
        // browser fully decode the data-URL before we hit play().
        // Without this, calling play() the moment the Audio
        // element is constructed produces a brief 50–100 ms
        // burst of dropouts on macOS WebKit — what users hear
        // as "滴滴 滴滴" before the actual narration starts.
        // Once the buffer is filled the playback is clean.
        audio.preload = 'auto';
        _ttsAudio = audio;
        audio.onended = () => {
          _ttsAudio = null;
          setState('idle');
        };
        audio.onerror = () => {
          _ttsAudio = null;
          setState('idle');
        };
        const startPlayback = () => {
          // canplaythrough can fire after we've already torn
          // down (user clicked stop, navigated away). Bail when
          // the singleton no longer points at us.
          if (_ttsAudio !== audio) return;
          void audio.play();
          setState('playing');
        };
        // canplaythrough = enough buffered to play start-to-end
        // without rebuffering. This is what we want.
        audio.addEventListener('canplaythrough', startPlayback, { once: true });
        // Fallback safety net: if the event somehow doesn't fire
        // within 1.5s (codec quirk, network hiccup, etc.) start
        // anyway. 1.5s is generous — TTS payloads are typically
        // a few KB and decode in single-digit ms.
        window.setTimeout(() => {
          if (audio.paused && _ttsAudio === audio) {
            startPlayback();
          }
        }, 1500);
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
