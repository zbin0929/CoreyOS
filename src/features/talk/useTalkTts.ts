/**
 * Sentence-level streaming TTS engine for Talk Mode.
 *
 * Architecture (v1.1.1):
 *
 *   LLM stream chunk
 *        │
 *        ▼
 *   enqueueSentences()         splits on every clause-level
 *        │                     punct (comma/colon/semicolon
 *        ▼                     /period/newline)
 *   per-sentence synth ── ── ── kicked off IMMEDIATELY,
 *        │                     parallelised across N=2
 *        │                     pending sentences
 *        ▼
 *   pending: Promise<Tts>[]   FIFO of in-flight synth promises
 *        │
 *        ▼
 *   speakNext worker          shifts a promise, awaits, plays;
 *                             gated by INITIAL_BUFFER so we
 *                             only start playback once enough
 *                             clips are queued (or LLM done)
 */
import { useCallback, useRef } from 'react';

import {
  talkLocalTts,
  talkTtsReference,
  voiceTts,
} from '@/lib/ipc';

import { stripMarkdownForSpeech } from './speechCleanup';

export interface TtsRoute {
  tts: boolean;
}

export interface UseTalkTtsReturn {
  /** Feed a chunk of LLM output; returns leftover buffer. */
  enqueueSentences: (buffer: string) => string;
  /** Flush any remaining buffer as final sentence. */
  flushBuffer: (buffer: string) => void;
  /** Signal LLM stream is done; releases initial buffer gate. */
  markLlmDone: () => void;
  /** Wait until queue drains or barge-in. */
  waitUntilDrained: () => Promise<void>;
  /** Cancel all pending TTS and stop playback. */
  cancel: () => void;
  /** Reset for next turn. */
  reset: () => void;
}

type Tts = { audio_base64: string; mime: string };

const MAX_CONCURRENT_SYNTH = 2;
const POLL_INTERVAL_MS = 30;
const INITIAL_BUFFER = 0;

export function useTalkTts(localRoute: TtsRoute): UseTalkTtsReturn {
  const pendingRef = useRef<Array<Promise<Tts | null>>>([]);
  const queueWorkerActiveRef = useRef(false);
  const bargeInRequestedRef = useRef(false);
  const llmDoneRef = useRef(false);
  const synthRunningRef = useRef(0);
  const synthQueueRef = useRef<Array<() => void>>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const acquireSynth = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (synthRunningRef.current < MAX_CONCURRENT_SYNTH) {
        synthRunningRef.current++;
        resolve();
      } else {
        synthQueueRef.current.push(() => {
          synthRunningRef.current++;
          resolve();
        });
      }
    });
  }, []);

  const releaseSynth = useCallback(() => {
    synthRunningRef.current--;
    const next = synthQueueRef.current.shift();
    if (next) next();
  }, []);

  const getOrCreateAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const synthesize = useCallback(
    async (text: string): Promise<Tts | null> => {
      await acquireSynth();
      try {
        if (localRoute.tts) {
          return await talkLocalTts(text);
        }
        const r = await voiceTts(text);
        return { ...r, mime: 'audio/mpeg' };
      } catch (e) {
        console.warn('[talk.tts] synth failed', {
          text: text.slice(0, 40),
          error: String(e),
        });
        return null;
      } finally {
        releaseSynth();
      }
    },
    [acquireSynth, localRoute.tts, releaseSynth],
  );

  const speakNext = useCallback(async (): Promise<void> => {
    if (queueWorkerActiveRef.current) return;
    queueWorkerActiveRef.current = true;
    try {
      while (!bargeInRequestedRef.current) {
        if (pendingRef.current.length === 0) {
          if (llmDoneRef.current) break;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        if (!llmDoneRef.current && pendingRef.current.length < INITIAL_BUFFER) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        const next = pendingRef.current.shift()!;
        const tts = await next;
        if (bargeInRequestedRef.current) break;
        if (!tts) {
          console.warn('[talk.tts] skipping clip with null synth result');
          continue;
        }
        try {
          talkTtsReference(tts.audio_base64).catch(() => {});
          const audioCtx = getOrCreateAudioContext();
          const binaryStr = atob(tts.audio_base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          currentSourceRef.current = source;
          await new Promise<void>((resolve) => {
            source.onended = () => {
              currentSourceRef.current = null;
              resolve();
            };
            source.start();
          });
        } catch (e) {
          console.warn('[talk.tts] playback failed', String(e));
        }
      }
    } finally {
      queueWorkerActiveRef.current = false;
    }
  }, [getOrCreateAudioContext]);

  const enqueueSentence = useCallback(
    (raw: string) => {
      const speakable = stripMarkdownForSpeech(raw).trim();
      if (!speakable) return;
      pendingRef.current.push(synthesize(speakable));
      void speakNext();
    },
    [speakNext, synthesize],
  );

  const enqueueSentences = useCallback(
    (buffer: string): string => {
      const re = /[.!?。！？,，、；：;:]+["')\]」』]?\s*|\n{2,}/g;
      let lastEnd = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(buffer)) !== null) {
        const segStart = lastEnd;
        const segEnd = m.index + m[0].length;
        const isTerminal = /[.!?。！？]/.test(m[0]);
        const segLen = segEnd - segStart;
        if (isTerminal || segLen >= 10) {
          lastEnd = segEnd;
        }
      }
      if (lastEnd === 0) {
        if (buffer.length >= 40) {
          const mid = buffer.lastIndexOf(' ', 40);
          const cut = mid > 10 ? mid + 1 : 40;
          for (const s of buffer.slice(0, cut).split(/\s+/).filter((x: string) => x.trim())) {
            enqueueSentence(s);
          }
          return buffer.slice(cut);
        }
        return buffer;
      }
      const ready = buffer.slice(0, lastEnd);
      const rest = buffer.slice(lastEnd);
      const raw = ready.split(re).filter((s) => s.trim().length > 0);
      for (const s of raw) enqueueSentence(s);
      return rest;
    },
    [enqueueSentence],
  );

  const flushBuffer = useCallback(
    (buffer: string) => {
      if (buffer.trim().length > 0) {
        enqueueSentence(buffer);
      }
    },
    [enqueueSentence],
  );

  const markLlmDone = useCallback(() => {
    llmDoneRef.current = true;
    void speakNext();
  }, [speakNext]);

  const waitUntilDrained = useCallback(async () => {
    while (
      !bargeInRequestedRef.current &&
      (queueWorkerActiveRef.current || pendingRef.current.length > 0)
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }, []);

  const cancel = useCallback(() => {
    bargeInRequestedRef.current = true;
    pendingRef.current.length = 0;
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      currentSourceRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = [];
    queueWorkerActiveRef.current = false;
    bargeInRequestedRef.current = false;
    llmDoneRef.current = false;
    synthRunningRef.current = 0;
    synthQueueRef.current = [];
  }, []);

  return {
    enqueueSentences,
    flushBuffer,
    markLlmDone,
    waitUntilDrained,
    cancel,
    reset,
  };
}
