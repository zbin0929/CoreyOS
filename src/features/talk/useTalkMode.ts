import { useCallback, useEffect, useRef, useState } from 'react';

import {
  chatStream,
  ipcErrorMessage,
  voiceGetConfig,
  voiceRecord,
  voiceRecordStop,
  voiceTranscribe,
  voiceTts,
  type ChatStreamHandle,
  type VoiceConfig,
} from '@/lib/ipc';
import { useChatStore } from '@/stores/chat';

/**
 * **Talk Mode v0** — minimum viable voice loop.
 *
 * Wires existing voice IPCs (`voice_record` / `voice_transcribe` /
 * `voice_tts`) and `chatStream` (the same helper Composer uses) into
 * a single push-to-talk session. No new Rust code required for v0;
 * Piper / MLX backends + streaming TTS land in v0.4.1.
 *
 * State machine:
 *
 * ```
 *   idle  ──► listening ──► thinking ──► speaking
 *     ▲                                    │
 *     └────────────────────────────────────┘
 * ```
 *
 * Push-to-talk: pressing Space transitions `idle → listening`,
 * releasing transitions `listening → thinking`. While speaking, a
 * Space press cancels playback and returns to listening (the
 * `interruptOnSpeech` requirement from B-8 — implemented minimally
 * as "user pressed PTT" rather than full continuous VAD).
 *
 * What's deliberately NOT in v0 (deferred):
 * - Continuous VAD (push-to-talk only).
 * - Streaming TTS (one-shot voice_tts → audio element playback).
 * - Voice Directives parsing.
 * - Persisting Talk Mode turns into the chat store as a session.
 * - MCP tool result speaking — tool calls happen inside chatStream
 *   transparently, but if the assistant chooses to spin up a tool
 *   for 30s we just speak the final assistant text.
 */

export type TalkState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'unconfigured';

export interface TalkReadiness {
  ready: boolean;
  /** Why Talk Mode is not yet usable. Surfaced verbatim in the UI
   *  next to a "Open Voice settings" link so the user has one
   *  obvious next step instead of decoding a backend error string
   *  mid-recording. */
  reason: string | null;
  config: VoiceConfig | null;
}

export interface UseTalkModeReturn {
  state: TalkState;
  finalTranscript: string;
  reply: string;
  error: string | null;
  readiness: TalkReadiness;
  pressPtt: () => void;
  releasePtt: () => void;
  stop: () => void;
}

export function useTalkMode(): UseTalkModeReturn {
  const [state, setState] = useState<TalkState>('idle');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<TalkReadiness>({
    ready: false,
    reason: null,
    config: null,
  });

  // Recorder promise; resolves when voice_record_stop fires.
  const recordingPromiseRef = useRef<Promise<string> | null>(null);
  // Audio element so we can cancel mid-playback on interrupt.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // chatStream handle so we can cancel mid-stream on interrupt.
  const streamHandleRef = useRef<ChatStreamHandle | null>(null);

  // ── Readiness probe ─────────────────────────────────────────────
  // Talk Mode requires both an STT provider (recorded audio →
  // transcript) AND a TTS provider (reply → audio). Edge TTS is the
  // only provider that doesn't need an API key, so we treat
  // `tts_provider === 'edge'` as configured-without-key. Everything
  // else demands an api-key-set flag from the backend.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const cfg = await voiceGetConfig();
        if (cancelled) return;
        const sttOk = cfg.asr_provider !== '' && cfg.asr_api_key_set;
        const ttsOk =
          cfg.tts_provider !== '' &&
          (cfg.tts_provider === 'edge' || cfg.tts_api_key_set);
        let reason: string | null = null;
        if (!sttOk && !ttsOk) reason = '尚未配置语音输入与输出';
        else if (!sttOk) reason = '尚未配置语音输入（STT）';
        else if (!ttsOk) reason = '尚未配置语音输出（TTS）';
        const ready = sttOk && ttsOk;
        setReadiness({ ready, reason, config: cfg });
        setState((cur) => {
          if (!ready) return 'unconfigured';
          if (cur === 'unconfigured') return 'idle';
          return cur;
        });
      } catch (e) {
        if (cancelled) return;
        setReadiness({
          ready: false,
          reason: ipcErrorMessage(e),
          config: null,
        });
        setState('unconfigured');
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const reset = useCallback(() => {
    setFinalTranscript('');
    setReply('');
    setError(null);
  }, []);

  const cancelInFlight = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
    if (streamHandleRef.current) {
      void streamHandleRef.current.cancel().catch(() => {});
      streamHandleRef.current = null;
    }
    if (recordingPromiseRef.current) {
      void voiceRecordStop().catch(() => {});
      recordingPromiseRef.current = null;
    }
  }, []);

  const pressPtt = useCallback(() => {
    if (state === 'unconfigured') return;
    if (state === 'listening' || state === 'thinking') return;
    cancelInFlight();
    reset();
    setState('listening');
    // 60s upper bound matches the recorder's default — a real talk
    // turn rarely exceeds 30 s; the cap stops a stuck mic from
    // lingering forever if `releasePtt` somehow doesn't fire.
    recordingPromiseRef.current = voiceRecord(60);
  }, [cancelInFlight, reset, state]);

  const releasePtt = useCallback(async () => {
    if (state !== 'listening') return;
    setState('thinking');
    try {
      await voiceRecordStop();
      const wavBase64 = await (recordingPromiseRef.current ?? Promise.resolve(''));
      recordingPromiseRef.current = null;
      if (!wavBase64) {
        setState('idle');
        return;
      }
      const transcribed = await voiceTranscribe(wavBase64, 'audio/wav');
      const text = transcribed.text?.trim() ?? '';
      setFinalTranscript(text);
      if (!text) {
        setState('idle');
        return;
      }

      // Persist into the active chat session if there is one. We only
      // append; we don't `submit()` (that would re-trigger the chat
      // pipeline). The actual LLM call happens via chatStream below
      // — UiMessage rows are written purely so the user can scroll
      // back through Talk Mode history once they exit.
      const chatStore = useChatStore.getState();
      const sessionId = chatStore.currentId;
      const baseTs = Date.now();
      if (sessionId) {
        chatStore.appendMessage(sessionId, {
          id: `talk-u-${baseTs}`,
          role: 'user',
          content: text,
          createdAt: baseTs,
        });
      }

      // Stream the chat turn. We pass the active session's history
      // so the LLM has context — Talk Mode is meant to feel like
      // typing into the same conversation, not a fresh thread.
      // Hermes gateway + adapter + MCP tool pipeline runs identically
      // to typed chat; we just don't speak tool-call narration,
      // only the final assistant text.
      const history = sessionId
        ? (chatStore.sessions[sessionId]?.messages ?? []).map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))
        : [{ role: 'user' as const, content: text }];
      let acc = '';
      const replyText = await new Promise<string>((resolve, reject) => {
        let settled = false;
        chatStream(
          {
            messages: history,
          },
          {
            onDelta: (chunk) => {
              acc += chunk;
              setReply(acc);
            },
            onDone: () => {
              if (!settled) {
                settled = true;
                resolve(acc);
              }
            },
            onError: (err) => {
              if (!settled) {
                settled = true;
                reject(err);
              }
            },
          },
        )
          .then((handle) => {
            streamHandleRef.current = handle;
          })
          .catch((err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
      });
      streamHandleRef.current = null;

      if (!replyText.trim()) {
        setState('idle');
        return;
      }

      // Persist assistant reply so the session shows the full
      // round-trip when the user closes the overlay. We use a
      // distinct id prefix so future analytics can tell Talk Mode
      // turns apart from typed turns if needed.
      if (sessionId) {
        chatStore.appendMessage(sessionId, {
          id: `talk-a-${Date.now()}`,
          role: 'assistant',
          content: replyText,
          createdAt: Date.now(),
        });
      }

      // Speak. voice_tts is one-shot for now. Most providers return
      // mp3 (`audio/mpeg`); Zhipu wraps PCM in a WAV header. We
      // default to `audio/mpeg` because the WAV path also plays
      // fine when the browser sniffs the magic bytes — the
      // `data:` URL `mime` is a hint, not a contract.
      setState('speaking');
      const ttsResult = await voiceTts(replyText);
      const audio = new Audio(`data:audio/mpeg;base64,${ttsResult.audio_base64}`);
      audioElRef.current = audio;
      audio.onended = () => {
        if (audioElRef.current === audio) {
          audioElRef.current = null;
        }
        setState('idle');
      };
      audio.onerror = () => {
        if (audioElRef.current === audio) {
          audioElRef.current = null;
        }
        // Soft-fail: if playback errors (codec mismatch / muted
        // device), drop straight back to idle so the user can
        // try the next turn rather than getting stuck.
        setState('idle');
      };
      await audio.play();
    } catch (e) {
      setError(ipcErrorMessage(e));
      setState('error');
      setTimeout(() => {
        setState('idle');
        setError(null);
      }, 4000);
    }
  }, [state]);

  const stop = useCallback(() => {
    cancelInFlight();
    reset();
    setState('idle');
  }, [cancelInFlight, reset]);

  useEffect(() => {
    return () => {
      cancelInFlight();
    };
  }, [cancelInFlight]);

  return {
    state,
    finalTranscript,
    reply,
    error,
    readiness,
    pressPtt,
    releasePtt,
    stop,
  };
}
