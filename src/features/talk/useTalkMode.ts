import { useCallback, useEffect, useRef, useState } from 'react';

import {
  chatStream,
  ipcErrorMessage,
  packActiveSouls,
  talkLocalTranscribe,
  voiceOpenMicSettings,
  voicePlayStop,
  voiceRecord,
  voiceRecordStop,
  voiceTranscribe,
  type ChatStreamHandle,
  type ChatApprovalRequest,
} from '@/lib/ipc';
import { llmProfileEnsureAdapter, llmProfileList } from '@/lib/ipc/hermes-instances';
import { useAppStatusStore } from '@/stores/appStatus';
import { useChatStore } from '@/stores/chat';

import type { TalkState, TalkMode, MicPermission, UseTalkModeReturn } from './talkTypes';
export type {
  TalkState,
  TalkMode,
  TalkReadiness,
  MicPermission,
  UseTalkModeReturn,
} from './talkTypes';
import { useTalkReadiness } from './useTalkReadiness';
import { useTalkTts } from './useTalkTts';
import { useTalkAutoMode } from './useTalkAutoMode';

/**
 * **Talk Mode v1** — push-to-talk + auto-listening.
 *
 * State machine:
 *
 * ```
 *   idle  ──► listening ──► thinking ──► speaking
 *     ▲                                    │
 *     └────────────────────────────────────┘
 * ```
 */
export function useTalkMode(): UseTalkModeReturn {
  const [state, setState] = useState<TalkState>('idle');
  const [mode, setModeState] = useState<TalkMode>('ptt');
  const [level, setLevel] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { readiness, localRoute } = useTalkReadiness();
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown');
  const [pendingApproval, setPendingApproval] = useState<ChatApprovalRequest | null>(null);

  const recordingPromiseRef = useRef<Promise<string> | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const nativePlaybackActiveRef = useRef(false);
  const stateRef = useRef<TalkState>(state);
  const echoCooldownUntilRef = useRef<number>(0);
  const streamingTranscriptRef = useRef<string>('');
  const streamHandleRef = useRef<ChatStreamHandle | null>(null);

  const tts = useTalkTts(localRoute);

  useEffect(() => {
    setState((cur) => {
      if (!readiness.ready) return cur === 'unconfigured' ? cur : 'unconfigured';
      return cur === 'unconfigured' ? 'idle' : cur;
    });
  }, [readiness.ready]);

  const reset = useCallback(() => {
    setPartialTranscript('');
    setFinalTranscript('');
    setReply('');
    setError(null);
    tts.reset();
  }, [tts]);

  const cancelInFlight = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
    nativePlaybackActiveRef.current = false;
    void voicePlayStop().catch(() => {});
    tts.cancel();
    if (streamHandleRef.current) {
      void streamHandleRef.current.cancel().catch(() => {});
      streamHandleRef.current = null;
    }
    if (recordingPromiseRef.current) {
      void voiceRecordStop().catch(() => {});
      recordingPromiseRef.current = null;
    }
  }, [tts]);

  const pressPtt = useCallback(() => {
    if (state === 'unconfigured') return;
    if (state === 'listening' || state === 'thinking') return;
    cancelInFlight();
    reset();
    setState('listening');
    recordingPromiseRef.current = voiceRecord(60);
  }, [cancelInFlight, reset, state]);

  const processWavBase64 = useCallback(
    async (wavBase64: string, preTranscribed?: string) => {
      setState('thinking');
      tts.reset();
      try {
        if (!wavBase64 && !preTranscribed) {
          setState('idle');
          return;
        }
        setMicPermission('granted');

        const rawText = preTranscribed?.trim() ?? (
          (
            localRoute.stt
              ? (await talkLocalTranscribe(wavBase64)).text
              : (await voiceTranscribe(wavBase64, 'audio/wav')).text
          )?.trim() ?? ''
        );

        const isWhisperSentinel =
          /^\s*\[\s*(blank[_\s]*audio|music|sound|silence|noise|inaudible)\s*\]\s*$/i.test(
            rawText,
          ) || rawText === '';
        const text = isWhisperSentinel ? '' : rawText;
        setFinalTranscript(text);

        if (!text) {
          if (isWhisperSentinel && rawText !== '') {
            setError('没听清，请说大声一点再试一次');
            setTimeout(() => setError(null), 3000);
          }
          setState('idle');
          return;
        }

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

        const TALK_HISTORY_LIMIT = 20;
        const TALK_SYSTEM_PROMPT = [
          '你正在通过语音和用户实时对话。回复将被朗读出来，所以请：',
          '1. 用自然、口语化、简短的中文，每次回复控制在 1-2 句话；',
          '2. 不要使用 emoji、表情符号、星号 ** ** 加粗、Markdown 列表（- / 1.）、链接、代码块；',
          '3. 不要用拟声词或网络流行语（"哈哈"、"嘛"、"哟"、"上活"、"冲" 等），保持专业但温暖的语气；',
          '4. 直接回答用户的问题，不要绕弯、不要反问"对不对"、不要刻意撒娇；',
          '5. 如果信息不够，就直接说"这个我不太确定"或"我需要再了解一下"，不要瞎编。',
        ].join('\n');

        let packSoulSystem: string | null = null;
        try {
          const souls = await packActiveSouls();
          if (souls.length > 0) {
            packSoulSystem = `[Industry role definition]\n${souls
              .map((s) => `## ${s.packTitle}\n${s.content}`)
              .join('\n\n')}`;
          }
        } catch {
          // pack souls IPC may fail in dev / fixture mode; ignore
        }

        const history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: TALK_SYSTEM_PROMPT },
        ];
        if (packSoulSystem) {
          history.push({ role: 'system', content: packSoulSystem });
        }
        if (sessionId) {
          const past = (useChatStore.getState().sessions[sessionId]?.messages ?? [])
            .slice(-TALK_HISTORY_LIMIT)
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }));
          history.push(...past);
        } else {
          history.push({ role: 'user', content: text });
        }

        let talkAdapterId: string | undefined;
        let talkModelOverride: string | undefined;
        try {
          const currentModel = useAppStatusStore.getState().currentModel;
          if (currentModel) {
            const list = await llmProfileList();
            const match = list.profiles.find((p) => p.model === currentModel);
            if (match) {
              await llmProfileEnsureAdapter(match.id);
              talkAdapterId = `hermes:profile:${match.id}`;
              talkModelOverride = match.model;
            }
          }
        } catch {
          // best-effort; fall back to the bare hermes adapter
        }

        let acc = '';
        let pendingForTts = '';
        const replyText = await new Promise<string>((resolve, reject) => {
          let settled = false;
          chatStream(
            {
              messages: history,
              adapter_id: talkAdapterId,
              model: talkModelOverride,
            },
            {
              onDelta: (chunk) => {
                acc += chunk;
                setReply(acc);
                pendingForTts += chunk;
                pendingForTts = tts.enqueueSentences(pendingForTts);
              },
              onDone: () => {
                if (!settled) {
                  settled = true;
                  tts.flushBuffer(pendingForTts);
                  pendingForTts = '';
                  tts.markLlmDone();
                  resolve(acc);
                }
              },
              onError: (err) => {
                if (!settled) {
                  settled = true;
                  reject(err);
                }
              },
              onApproval: (approval) => {
                setPendingApproval(approval);
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

        if (sessionId) {
          chatStore.appendMessage(sessionId, {
            id: `talk-a-${Date.now()}`,
            role: 'assistant',
            content: replyText,
            createdAt: Date.now(),
          });
        }

        setState('speaking');
        await tts.waitUntilDrained();
        setState('idle');
      } catch (e) {
        setError(ipcErrorMessage(e));
        setState('error');
        setTimeout(() => {
          setState('idle');
          setError(null);
        }, 4000);
      }
    },
    [localRoute.stt, tts],
  );

  const releasePtt = useCallback(async () => {
    if (state !== 'listening') return;
    try {
      await voiceRecordStop();
      const wavBase64 = await (recordingPromiseRef.current ?? Promise.resolve(''));
      recordingPromiseRef.current = null;
      await processWavBase64(wavBase64);
    } catch (e) {
      const msg = ipcErrorMessage(e);
      const isPermission =
        msg.includes('mic_permission_denied') || msg.includes('no_audio_captured');
      setError(msg);
      setState('error');
      if (isPermission) {
        setMicPermission('denied');
        setTimeout(() => {
          setState('idle');
        }, 1500);
      } else {
        setTimeout(() => {
          setState('idle');
          setError(null);
        }, 4000);
      }
    }
  }, [processWavBase64, state]);

  const openMicSettings = useCallback(async () => {
    try {
      await voiceOpenMicSettings();
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  const cancelTurn = useCallback(() => {
    cancelInFlight();
    setState('idle');
  }, [cancelInFlight]);

  const stop = useCallback(() => {
    cancelInFlight();
    reset();
    setState('idle');
  }, [cancelInFlight, reset]);

  const setMode = useCallback(
    (next: TalkMode) => {
      if (next === mode) return;
      cancelInFlight();
      setModeState(next);
    },
    [cancelInFlight, mode],
  );

  useTalkAutoMode({
    enabled: mode === 'auto',
    readiness,
    stateRef,
    echoCooldownUntilRef,
    streamingTranscriptRef,
    onSpeechStart: useCallback(() => {
      cancelInFlight();
      setLevel(0);
      setPartialTranscript('');
      setState('listening');
    }, [cancelInFlight]),
    onSpeechEnd: useCallback(
      (wavBase64: string, preTranscribed?: string) => {
        setPartialTranscript('');
        void processWavBase64(wavBase64, preTranscribed);
      },
      [processWavBase64],
    ),
    onLevel: setLevel,
    onPartialTranscript: useCallback((text: string, isFinal: boolean) => {
      setPartialTranscript(text);
      if (isFinal) {
        setFinalTranscript(text);
      }
    }, []),
    onError: useCallback((message: string) => {
      setError(message);
      setState('error');
    }, []),
    onReady: useCallback(() => {
      setState('listening');
    }, []),
    onFallbackToPtt: useCallback(() => {
      setModeState('ptt');
    }, []),
  });

  useEffect(() => {
    return () => {
      cancelInFlight();
    };
  }, [cancelInFlight]);

  useEffect(() => {
    const prev = stateRef.current;
    stateRef.current = state;
    if (prev === 'speaking' && state !== 'speaking') {
      echoCooldownUntilRef.current = Date.now() + 300;
    }
  }, [state]);

  return {
    state,
    mode,
    level,
    partialTranscript,
    finalTranscript,
    reply,
    error,
    readiness,
    micPermission,
    setMode,
    pressPtt,
    releasePtt,
    stop,
    cancelTurn,
    openMicSettings,
    pendingApproval,
    setPendingApproval,
  };
}
