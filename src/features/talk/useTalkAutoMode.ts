/**
 * Auto-listening mode for Talk Mode.
 *
 * When `enabled === true` AND readiness is OK, opens a cpal mic session,
 * attaches event listeners, and hands each `speech-end` WAV to the
 * provided `onSpeechEnd` callback. `speech-start` calls `onSpeechStart`
 * so the parent can interrupt any TTS that's still playing.
 */
import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  talkSessionStart,
  talkSessionStatus,
  talkSessionStop,
  TALK_EVENTS,
  type TalkLevelPayload,
  type TalkPartialTranscriptPayload,
  type TalkSpeechEndPayload,
} from '@/lib/ipc';

import type { TalkState, TalkReadiness } from './talkTypes';

export interface UseTalkAutoModeOptions {
  enabled: boolean;
  readiness: TalkReadiness;
  stateRef: React.MutableRefObject<TalkState>;
  echoCooldownUntilRef: React.MutableRefObject<number>;
  streamingTranscriptRef: React.MutableRefObject<string>;
  onSpeechStart: () => void;
  onSpeechEnd: (wavBase64: string, preTranscribed?: string) => void;
  onLevel: (rms: number) => void;
  onPartialTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onReady: () => void;
  onFallbackToPtt: () => void;
}

export function useTalkAutoMode(options: UseTalkAutoModeOptions): void {
  const {
    enabled,
    readiness,
    stateRef,
    echoCooldownUntilRef,
    streamingTranscriptRef,
    onSpeechStart,
    onSpeechEnd,
    onLevel,
    onPartialTranscript,
    onError,
    onReady,
    onFallbackToPtt,
  } = options;

  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (!readiness.ready) return;

    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    const teardown = async () => {
      cancelled = true;
      await Promise.allSettled(unlistens.map((u) => Promise.resolve(u())));
      unlistens.length = 0;
      if (startedRef.current) {
        try {
          await talkSessionStop();
        } catch {
          /* idempotent */
        }
        startedRef.current = false;
      }
    };

    const boot = async () => {
      try {
        try {
          const s = await talkSessionStatus();
          if (s.active) await talkSessionStop();
        } catch {
          /* ignore probe failures */
        }

        unlistens.push(
          await listen(TALK_EVENTS.speechStart, () => {
            if (cancelled) return;
            const s = stateRef.current;
            if (s === 'speaking' || s === 'thinking') return;
            if (Date.now() < echoCooldownUntilRef.current) return;
            onSpeechStart();
          }),
        );

        unlistens.push(
          await listen<TalkSpeechEndPayload>(TALK_EVENTS.speechEnd, (e) => {
            if (cancelled) return;
            const s = stateRef.current;
            if (s === 'speaking' || s === 'thinking') return;
            if (Date.now() < echoCooldownUntilRef.current) return;
            const streamingText = streamingTranscriptRef.current;
            streamingTranscriptRef.current = '';
            if (streamingText) {
              onSpeechEnd('', streamingText);
            } else {
              onSpeechEnd(e.payload.wav_base64);
            }
          }),
        );

        unlistens.push(
          await listen<TalkLevelPayload>(TALK_EVENTS.level, (e) => {
            if (cancelled) return;
            onLevel(e.payload.rms);
          }),
        );

        unlistens.push(
          await listen<{ message: string }>(TALK_EVENTS.error, (e) => {
            if (cancelled) return;
            onError(e.payload.message);
          }),
        );

        unlistens.push(
          await listen<TalkPartialTranscriptPayload>(TALK_EVENTS.partialTranscript, (e) => {
            if (cancelled) return;
            const s = stateRef.current;
            if (s === 'speaking' || s === 'thinking') return;
            if (Date.now() < echoCooldownUntilRef.current) return;
            onPartialTranscript(e.payload.text, e.payload.is_final);
            if (e.payload.is_final) {
              streamingTranscriptRef.current = e.payload.text;
            }
          }),
        );

        await talkSessionStart();
        startedRef.current = true;
        if (!cancelled) onReady();
      } catch {
        if (cancelled) return;
        onFallbackToPtt();
      }
    };

    void boot();
    return () => {
      void teardown();
    };
  }, [
    enabled,
    readiness.ready,
    stateRef,
    echoCooldownUntilRef,
    streamingTranscriptRef,
    onSpeechStart,
    onSpeechEnd,
    onLevel,
    onPartialTranscript,
    onError,
    onReady,
    onFallbackToPtt,
  ]);
}
