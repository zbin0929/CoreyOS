import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  chatStream,
  hermesApprovalRespond,
  ipcErrorMessage,
  talkLocalStatus,
  talkLocalTranscribe,
  talkLocalTts,
  talkSessionStart,
  talkSessionStatus,
  talkSessionStop,
  talkTtsReference,
  TALK_EVENTS,
  voiceGetConfig,
  voiceOpenMicSettings,
  voicePlayStop,
  voiceRecord,
  voiceRecordStop,
  voiceTranscribe,
  voiceTts,
  voiceWarmupMic,
  type ChatStreamHandle,
  type TalkLevelPayload,
  type TalkPartialTranscriptPayload,
  type TalkSpeechEndPayload,
  type VoiceConfig,
} from '@/lib/ipc';
import { useChatStore } from '@/stores/chat';

/**
 * **Talk Mode v1** — push-to-talk + auto-listening.
 *
 * v1 adds an auto mode that subscribes to the new `talk:*` Tauri
 * events emitted by `crate::talk::session` (cpal mic loop driven
 * by VAD). The PTT path stays as the fallback for users on
 * unconfigured / noisy environments where the energy VAD
 * mis-triggers.
 *
 * **Old v0 docs:**
 *
 * Wires existing voice IPCs (`voice_record` / `voice_transcribe` /
 * `voice_tts`) and `chatStream` (the same helper Composer uses) into
 * a single push-to-talk session. No new Rust code required for v0;
 * sherpa-onnx (MeloTTS) + MLX backends + streaming TTS land in v1.x.
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

/** Talk operation mode. `auto` requires `talk_session_start` to
 *  succeed (mic permission + cpal device available); on failure we
 *  silently fall back to `ptt`. */
export type TalkMode = 'ptt' | 'auto';

export interface TalkReadiness {
  ready: boolean;
  /** Why Talk Mode is not yet usable. Surfaced verbatim in the UI
   *  next to a "Open Voice settings" link so the user has one
   *  obvious next step instead of decoding a backend error string
   *  mid-recording. */
  reason: string | null;
  config: VoiceConfig | null;
}

/** Microphone access status as observed by Talk Mode.
 *
 * - `unknown`  — we haven't probed yet (initial mount, or non-macOS).
 * - `granted`  — `voiceWarmupMic` saw at least one sample.
 * - `denied`   — warmup got 0 samples in 500ms, OR a `voice_record`
 *                call returned `mic_permission_denied`. The overlay
 *                shows a banner with a "Open System Settings" button
 *                wired to {@link UseTalkModeReturn.openMicSettings}.
 *
 * On non-macOS platforms we leave the state as `unknown` and rely
 * on the recorder's existing `no_audio_captured` error path —
 * Linux/Windows don't have a TCC-equivalent we'd usefully poke. */
export type MicPermission = 'unknown' | 'granted' | 'denied';

export interface UseTalkModeReturn {
  state: TalkState;
  mode: TalkMode;
  /** Live RMS from the auto-listening session (0..1). Always 0 in
   *  PTT mode — the recorder doesn't emit a level stream. */
  level: number;
  partialTranscript: string;
  finalTranscript: string;
  reply: string;
  error: string | null;
  readiness: TalkReadiness;
  micPermission: MicPermission;
  setMode: (mode: TalkMode) => void;
  pressPtt: () => void;
  releasePtt: () => void;
  /** Cancel everything in flight AND wipe the on-screen reply +
   *  transcript. Used by the close (X / Esc) buttons because once
   *  the overlay closes, leaving stale state to flash on next
   *  open is worse than wiping. */
  stop: () => void;
  /** Cancel the in-flight LLM stream + TTS playback but **keep**
   *  the visible transcript and reply intact, so the user can
   *  still read what Hermes was about to say. Used by the
   *  「停止生成」/「停止朗读」 button next to the ring. */
  cancelTurn: () => void;
  /** Open macOS System Settings → Privacy & Security → Microphone.
   *  No-op (rejects) on non-macOS. */
  openMicSettings: () => Promise<void>;
}

/**
 * Best-effort Markdown → speech-friendly plain text.
 *
 * Piper (and most CLI TTS engines) treat punctuation literally:
 * `**bold**` becomes "asterisk asterisk bold asterisk asterisk",
 * fenced code blocks are read line-by-line including the ``` , and
 * link syntax `[label](url)` either spells out the URL or goes
 * silent on the brackets. Stripping these before synthesis is the
 * difference between "Hermes 在线播报" and a confused mumble.
 *
 * We intentionally keep this **conservative** — full Markdown→
 * SSML is a rabbit hole; for v1 we only need to handle what
 * Hermes actually emits in chat replies (bold, italics, inline
 * code, fences, list bullets, headings, links).
 */
function stripMarkdownForSpeech(input: string): string {
  return (
    input
      // Fenced code blocks → drop the fences but keep the text
      // (often contains commands the user wants read aloud).
      .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
      .replace(/```/g, '')
      // Inline code: keep contents, drop backticks.
      .replace(/`([^`]+)`/g, '$1')
      // Bold + italic markers (** *** _ __) — drop the marker chars,
      // keep the inner text.
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // Links: `[label](url)` → just the label.
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      // Heading hashes at line start.
      .replace(/^#{1,6}\s+/gm, '')
      // Bullet markers (- * +) at line start → drop, the pause comes
      // from the surrounding newline anyway.
      .replace(/^\s*[-*+]\s+/gm, '')
      // Numbered list markers (1. 2. ...) → keep number, drop dot
      // so Piper doesn't pause oddly.
      .replace(/^\s*(\d+)\.\s+/gm, '$1 ')
      // Emojis + pictographs (`\u{1F300}-\u{1F9FF}` + dingbats etc).
      // The Unicode property `Extended_Pictographic` covers every
      // emoji-like glyph; ZWJ + variation selectors get swept up
      // alongside so a sequence like 👨‍👩‍👧 doesn't leave fragment
      // chars behind. Without this, macOS `say` reads "huo3" for
      // 🔥 and Piper's phonemizer produces dead-air. Either way:
      // hearing "fire-emoji" mid-sentence is jarring UX.
      .replace(/\p{Extended_Pictographic}/gu, '')
      // ZWJ / variation selector / keycap glue — strip individually,
      // not via a character class (eslint flags combining marks
      // inside `[…]`).
      .replace(/\u{200D}/gu, '')
      .replace(/\u{FE0F}/gu, '')
      .replace(/\u{20E3}/gu, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[：；、，,]/g, ' ')
      .replace(/。/g, '.')
      .replace(/？/g, '?')
      .replace(/！/g, '!')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export function useTalkMode(): UseTalkModeReturn {
  const [state, setState] = useState<TalkState>('idle');
  // Default to push-to-talk. We tried defaulting to auto VAD to
  // mirror ChatGPT Voice / OpenClaw, but the energy-VAD threshold
  // we ship is hand-tuned for a quiet room with a built-in mic;
  // on USB mics, AirPods, or noisy environments it either
  // over-triggers (cuts you off mid-sentence) or under-triggers
  // (sits at "我在听" forever even when you've stopped talking).
  // PTT is unambiguous: hold to record, release to send. Users
  // who explicitly want hands-free can flip the toggle in the
  // overlay footer.
  const [mode, setModeState] = useState<TalkMode>('ptt');
  const [level, setLevel] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<TalkReadiness>({
    ready: false,
    reason: null,
    config: null,
  });
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown');
  // Disk-probe of whisper.cpp + sherpa-onnx sidecars. Refreshed on
  // mount + after every successful pack download. When both flip
  // true the talk pipeline routes through `talk_local_*` IPCs
  // instead of the cloud `voice_*` ones — full-offline path.
  const [localRoute, setLocalRoute] = useState({ stt: false, tts: false });

  // Recorder promise; resolves when voice_record_stop fires.
  const recordingPromiseRef = useRef<Promise<string> | null>(null);
  // Audio element so we can cancel mid-playback on interrupt.
  // Used only for the WebView <audio> path; native playback
  // (sherpa-onnx → afplay) is tracked via `nativePlaybackActiveRef`.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // True while a Rust-side `voice_play_wav_native` child is
  // playing. cancelInFlight() flips this off + calls voicePlayStop()
  // to SIGTERM the player so a barge-in interrupt cuts the AI's
  // voice within ~50ms.
  const nativePlaybackActiveRef = useRef(false);
  // Ref-mirror of `state` so the auto-VAD listeners (registered
  // once in a boot effect) can read the current state without
  // re-binding every transition. Mirrored via a `useEffect` below
  // — keeping setState pristine (callers may still pass updater
  // functions) and avoiding the bug where wrapping setState
  // breaks `setState(prev => next)` call sites.
  const stateRef = useRef<TalkState>(state);
  // Echo cooldown timestamp: when state transitions FROM speaking
  // we keep the auto-VAD muted for ECHO_COOLDOWN_MS. Without this,
  // the moment afplay returns we flip to 'idle' / 'listening', but
  // the speaker's last-100ms-of-AI-voice is still in the room and
  // the mic catches it → fake speechStart → fake "user said". This
  // is the cheap stand-in for proper acoustic echo cancellation.
  const echoCooldownUntilRef = useRef<number>(0);
  const streamingTranscriptRef = useRef<string>('');
  // chatStream handle so we can cancel mid-stream on interrupt.
  const streamHandleRef = useRef<ChatStreamHandle | null>(null);
  // Per-turn barge-in hook installed by `processWavBase64` while
  // sentence-streaming TTS is in flight. cancelInFlight() invokes
  // this so the per-turn local closures can drain their sentence
  // queue without us hoisting the queue into hook-level state.
  const cancelHookRef = useRef<(() => void) | null>(null);

  // ── Readiness probe ───────────────────────────────────
  // Talk Mode requires either:
  //  (a) cloud STT + cloud TTS providers configured, OR
  //  (b) the local voice pack installed (whisper-cli + sherpa-onnx).
  // We check both and treat the union as "ready". Local takes
  // precedence in the per-turn pipeline so users who installed
  // the pack get the offline path automatically.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const [cfg, local] = await Promise.all([
          voiceGetConfig(),
          talkLocalStatus().catch(() => ({ stt_ready: false, tts_ready: false })),
        ]);
        if (cancelled) return;
        setLocalRoute({ stt: local.stt_ready, tts: local.tts_ready });
        const cloudSttOk = cfg.asr_provider !== '' && cfg.asr_api_key_set;
        const cloudTtsOk =
          cfg.tts_provider !== '' &&
          (cfg.tts_provider === 'edge' || cfg.tts_api_key_set);
        const sttOk = local.stt_ready || cloudSttOk;
        const ttsOk = local.tts_ready || cloudTtsOk;
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

  // ── Mic permission warmup (macOS) ─────────────────────
  // Fire-and-forget on mount: the act of opening cpal *itself*
  // is what triggers the macOS Privacy dialog, regardless of
  // whether we wait for samples. Earlier we plumbed the warmup
  // result into `micPermission` to drive a pre-emptive banner —
  // that turned out to false-positive on real users (CoreAudio
  // cold-start can take >500ms to deliver the first callback
  // even when permission is granted, e.g. coming back from
  // sleep, switching default device, or first launch after
  // boot). The dropped reads then made the banner say "denied"
  // even though the next PTT press recorded fine. Now we keep
  // the warmup purely as a dialog-trigger and rely on actual
  // recording outcomes to set `micPermission` — granted on
  // success, denied on `mic_permission_denied` error. That
  // matches user mental model ("if it's working, no warning").
  useEffect(() => {
    void voiceWarmupMic().catch(() => {});
  }, []);

  const reset = useCallback(() => {
    setPartialTranscript('');
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
    // Always fire voicePlayStop, regardless of nativePlaybackActiveRef.
    // The ref races: a worker that just finished `talkLocalTts` and
    // is about to flip the ref to true won't have flipped it yet
    // when the user clicks stop, so the conditional version would
    // skip stopping playback that's about to start ~ms later. The
    // Rust side treats stop-with-nothing-active as a no-op, so
    // unconditional firing has no downside.
    nativePlaybackActiveRef.current = false;
    void voicePlayStop().catch(() => {});
    if (cancelHookRef.current) {
      cancelHookRef.current();
      cancelHookRef.current = null;
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

  /** Run a single utterance through the cloud STT → chatStream →
   *  TTS pipeline. Shared by `releasePtt` (PTT path) and the
   *  auto-listening `talk:speech-end` handler. Sets `state`,
   *  `finalTranscript`, `reply`, persists into the active chat
   *  session, and plays the reply through a single `<audio>`
   *  element we can cancel on interrupt. */
  const processWavBase64 = useCallback(
    async (wavBase64: string, preTranscribed?: string) => {
    setState('thinking');
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
        )
          ?.trim() ?? ''
      );
      // whisper.cpp emits `[BLANK_AUDIO]`, `[Music]`, `[Sound]` and
      // similar bracket-tagged sentinels when its silence detector
      // can't find speech in the clip. If we forwarded these to the
      // LLM verbatim, the model would treat them as user input and
      // hallucinate a reply (tested: gpt-4o-mini reads `[BLANK_AUDIO]`
      // as a request for a self-introduction). Catch the most common
      // forms and short-circuit back to idle with a friendly hint
      // surfaced via `error` so the user knows the recording was
      // empty rather than thinking Talk Mode broke.
      const isWhisperSentinel =
        /^\s*\[\s*(blank[_\s]*audio|music|sound|silence|noise|inaudible)\s*\]\s*$/i.test(
          rawText,
        ) || rawText === '';
      const text = isWhisperSentinel ? '' : rawText;
      // Don't surface the raw whisper sentinel in the "你说" panel
      // — it's confusing UX. Clear the transcript box on a sentinel
      // so the user sees only the inline "没听清" hint instead.
      setFinalTranscript(text);
      if (!text) {
        if (isWhisperSentinel && rawText !== '') {
          setError('没听清，请说大声一点再试一次');
          setTimeout(() => setError(null), 3000);
        }
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
      // Cap Talk Mode history at the last N user+assistant turns so
      // long sessions don't balloon prompt_tokens and slow first-
      // delta latency. Without this, after ~30 voice turns we were
      // sending 19 k+ tokens per request → 1.5-2 s TTFT just on
      // model thinking, and the model would lose the thread of the
      // current question entirely (answers become non-sequiturs).
      // 20 messages = ~10 turns, which is enough conversational
      // context for follow-ups while keeping prompts under 4k
      // tokens for typical Mandarin replies.
      const TALK_HISTORY_LIMIT = 20;
      // Talk-mode-specific system prompt. Without this the model
      // inherits whatever tone the typed-chat history was using
      // (often emoji-heavy, bullet-list, Markdown-formatted —
      // none of which work for TTS) and answers like a written
      // chatbot. The instructions tell it to speak naturally,
      // skip the formatting, and stay short. This DOES NOT get
      // persisted into the chat session; it lives only inside
      // each turn's request, so the typed-chat panel keeps its
      // original prompt-free behaviour.
      const TALK_SYSTEM_PROMPT = [
        '你正在通过语音和用户实时对话。回复将被朗读出来，所以请：',
        '1. 用自然、口语化、简短的中文，每次回复控制在 1-2 句话；',
        '2. 不要使用 emoji、表情符号、星号 ** ** 加粗、Markdown 列表（- / 1.）、链接、代码块；',
        '3. 不要用拟声词或网络流行语（"哈哈"、"嘛"、"哟"、"上活"、"冲" 等），保持专业但温暖的语气；',
        '4. 直接回答用户的问题，不要绕弯、不要反问"对不对"、不要刻意撒娇；',
        '5. 如果信息不够，就直接说"这个我不太确定"或"我需要再了解一下"，不要瞎编。',
      ].join('\n');
      const history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: TALK_SYSTEM_PROMPT },
      ];
      if (sessionId) {
        // Re-fetch the store state instead of reading the
        // stale `chatStore` snapshot we captured before the
        // `appendMessage` call above — without this, the
        // history we send to the LLM is missing the *current*
        // user turn we just appended, which Hermes / OpenAI
        // reject with 400 "No user message found in messages".
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
      // ── Sentence-level streaming TTS ──────────────────────
      // Architecture (v1.1.1):
      //
      //   LLM stream chunk
      //        │
      //        ▼
      //   enqueueSentences()         splits on every clause-level
      //        │                     punct (comma/colon/semicolon
      //        ▼                     /period/newline)
      //   per-sentence synth ── ── ── kicked off IMMEDIATELY,
      //        │                     parallelised across N=∞
      //        │                     pending sentences
      //        ▼
      //   pending: Promise<Tts>[]   FIFO of in-flight synth promises
      //        │
      //        ▼
      //   speakNext worker          shifts a promise, awaits, plays;
      //                             gated by INITIAL_BUFFER so we
      //                             only start playback once enough
      //                             clips are queued (or LLM done)
      //
      // Why this shape (vs the old 1-deep prefetch):
      //
      // The old design synthesised at most 1 sentence ahead. With
      // sherpa-onnx CLI taking ~800 ms cold-start per spawn and
      // VITS clips often playing for only ~500 ms, the 1-deep
      // pipeline guaranteed a 300 ms gap between every clip. For
      // a sub-split sentence with 8 sub-clauses, that's 2.4 s of
      // accumulated dead air per turn.
      //
      // Unbounded parallel synthesis on M1 16 GB is fine — sherpa
      // CLI peaks ~600 MB resident per process, and even 8 in
      // flight doesn't push us into swap. If we ever ship to M1
      // 8 GB we'll add a semaphore here.
      //
      // INITIAL_BUFFER trades ~400 ms of first-clip latency for
      // smooth back-to-back playback. Without it, the very first
      // clip plays immediately while the LLM is still streaming,
      // and clip 2 lags because its synth hadn't even started.
      type Tts = { audio_base64: string; mime: string };
      const pending: Array<Promise<Tts | null>> = [];
      let queueWorkerActive = false;
      let bargeInRequested = false;
      const MAX_CONCURRENT_SYNTH = 2;
      let synthRunning = 0;
      const synthQueue: Array<() => void> = [];
      const acquireSynth = (): Promise<void> =>
        new Promise((resolve) => {
          if (synthRunning < MAX_CONCURRENT_SYNTH) {
            synthRunning++;
            resolve();
          } else {
            synthQueue.push(() => {
              synthRunning++;
              resolve();
            });
          }
        });
      const releaseSynth = () => {
        synthRunning--;
        const next = synthQueue.shift();
        if (next) next();
      };
      // Mutated via the closure-bound setter below so eslint's
      // `prefer-const` is happy: the value flips exactly once,
      // when the LLM stream's `onDone` fires, releasing the
      // INITIAL_BUFFER gate so a short final reply still plays
      // even when fewer than 2 clauses were queued.
      const streamFlags = { llmDone: false };
      const INITIAL_BUFFER = 0;
      const synthesize = async (text: string): Promise<Tts | null> => {
        await acquireSynth();
        try {
          if (localRoute.tts) {
            return await talkLocalTts(text);
          }
          const r = await voiceTts(text);
          return { ...r, mime: 'audio/mpeg' };
        } catch (e) {
          // Surface the failure so we can diagnose silent drops
          // (e.g. "the last clip never played" turning out to be
          // a sherpa exit code 1 on a tricky character sequence).
          // Per-clip failure remains non-fatal — `null` flows
          // through to the worker which `continue`s past it.
          console.warn('[talk.tts] synth failed', {
            text: text.slice(0, 40),
            error: String(e),
          });
          return null;
        } finally {
          releaseSynth();
        }
      };
      // Polling worker. Stays alive for the entire turn — sleeps
      // briefly when the queue is empty but LLM still streaming,
      // exits only when LLM done AND queue drained (or barge-in).
      // This is race-free unlike the previous "exit when pending=0,
      // restart on next enqueue" design, which had a window where
      // the trailing clip arrived between the while-condition check
      // and queueWorkerActive=false, then sat unplayed because the
      // restart speakNext call hit the queueWorkerActive guard.
      let audioCtxRef: AudioContext | null = null;
      let currentSourceRef: AudioBufferSourceNode | null = null;
      const getOrCreateAudioContext = (): AudioContext => {
        if (!audioCtxRef || audioCtxRef.state === 'closed') {
          audioCtxRef = new AudioContext();
        }
        if (audioCtxRef.state === 'suspended') {
          void audioCtxRef.resume();
        }
        return audioCtxRef;
      };

      const POLL_INTERVAL_MS = 30;
      const speakNext = async (): Promise<void> => {
        if (queueWorkerActive) return;
        queueWorkerActive = true;
        try {
          while (!bargeInRequested) {
            // Drained AND LLM finished → truly done.
            if (pending.length === 0) {
              if (streamFlags.llmDone) break;
              await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
              continue;
            }
            // Initial buffer gate: hold the very first clip until
            // a few are queued (smooths over the LLM's variable
            // first-token latency vs sherpa's 800 ms cold-start).
            // Once the gate releases for this turn we never re-arm
            // it — subsequent clips ride on already-warm pipeline.
            if (!streamFlags.llmDone && pending.length < INITIAL_BUFFER) {
              await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
              continue;
            }
            const next = pending.shift()!;
            const tts = await next;
            if (bargeInRequested) break;
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
              currentSourceRef = source;
              await new Promise<void>((resolve) => {
                source.onended = () => {
                  currentSourceRef = null;
                  resolve();
                };
                source.start();
              });
            } catch (e) {
              console.warn('[talk.tts] playback failed', String(e));
            }
          }
        } finally {
          queueWorkerActive = false;
        }
      };

      const enqueueSentence = (raw: string) => {
        const speakable = stripMarkdownForSpeech(raw).trim();
        if (!speakable) return;
        // Kick off synth IMMEDIATELY — the promise lives in the
        // pending queue, the worker will await it in order. This
        // is what unlocks parallel synth across queued sentences.
        pending.push(synthesize(speakable));
        void speakNext();
      };

      const enqueueSentences = (buffer: string): string => {
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
      };

      // Track barge-in by hooking cancelInFlight: when the user
      // interrupts, drain the queue and tell the worker to stop.
      // We don't `await` the in-flight synth Promises — they'll
      // resolve naturally and their results get GC'd since
      // `pending` no longer holds them. sherpa CLI children that
      // are still running will exit on their own; orphaned WAVs
      // are swept by `talk_local_tts`'s startup cleanup.
      const onCancel = () => {
        bargeInRequested = true;
        pending.length = 0;
        if (currentSourceRef) {
          try { currentSourceRef.stop(); } catch { /* already stopped */ }
          currentSourceRef = null;
        }
        if (audioCtxRef && audioCtxRef.state !== 'closed') {
          audioCtxRef.close().catch(() => {});
          audioCtxRef = null;
        }
      };
      cancelHookRef.current = onCancel;

      let acc = '';
      let pendingForTts = '';
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
              // First delta arrived → flip state from "thinking"
              // (waiting for first token) to a streaming-aware
              // label so the user knows progress is happening.
              // We keep state === 'thinking' until TTS actually
              // starts (worker dequeues the first sentence) so
              // the ring colour matches the audio state.
              pendingForTts += chunk;
              pendingForTts = enqueueSentences(pendingForTts);
            },
            onDone: () => {
              if (!settled) {
                settled = true;
                // Flush whatever's left in the buffer as one final
                // clause. Even a single trailing word should be
                // spoken so the user hears the whole reply.
                if (pendingForTts.trim().length > 0) {
                  enqueueSentence(pendingForTts);
                  pendingForTts = '';
                }
                // Release the INITIAL_BUFFER gate — if the whole
                // reply was shorter than the buffer threshold,
                // speakNext was held back; flipping this lets it
                // drain whatever's queued.
                streamFlags.llmDone = true;
                void speakNext();
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
              const sid = approval._session_id ?? '';
              console.info(
                '[talk.approval] auto-approving command:',
                approval.command,
              );
              void hermesApprovalRespond(sid, 'session');
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
        cancelHookRef.current = null;
        return;
      }

      // Persist assistant reply so the session shows the full
      // round-trip when the user closes the overlay.
      if (sessionId) {
        chatStore.appendMessage(sessionId, {
          id: `talk-a-${Date.now()}`,
          role: 'assistant',
          content: replyText,
          createdAt: Date.now(),
        });
      }

      // Reflect "speaking" once first sentence is being spoken
      // (the worker is already running asynchronously). State
      // returns to idle when the worker drains naturally.
      setState('speaking');

      // Wait until the queue worker drains (or barge-in fires)
      // so we don't return from processWavBase64 while audio is
      // still queued. Polls every 100ms — cheap and keeps the
      // outer state machine in sync without adding more refs.
      while (
        !bargeInRequested &&
        (queueWorkerActive || pending.length > 0)
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }
      cancelHookRef.current = null;
      setState('idle');
    } catch (e) {
      setError(ipcErrorMessage(e));
      setState('error');
      setTimeout(() => {
        setState('idle');
        setError(null);
      }, 4000);
    }
  }, [localRoute.stt, localRoute.tts]);

  const releasePtt = useCallback(async () => {
    if (state !== 'listening') return;
    try {
      await voiceRecordStop();
      const wavBase64 = await (recordingPromiseRef.current ?? Promise.resolve(''));
      recordingPromiseRef.current = null;
      await processWavBase64(wavBase64);
    } catch (e) {
      // Permission-related errors get a sticky banner (not the
      // 4-second auto-dismiss) because the user has to leave
      // the app to fix them. The recovery banner in the overlay
      // pulls from `micPermission`, so we just flip the state
      // here and skip the timed reset that would hide the
      // recovery UI before the user could read it.
      const msg = ipcErrorMessage(e);
      const isPermission =
        msg.includes('mic_permission_denied') || msg.includes('no_audio_captured');
      setError(msg);
      setState('error');
      if (isPermission) {
        setMicPermission('denied');
        setTimeout(() => {
          setState('idle');
          // Note: leave `error` set so the banner stays visible.
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

  // Cancel everything in-flight but leave reply / transcript on
  // screen so the user can still read the half-done answer when
  // they hit the inline 「停止」 button. cancelInFlight kills the
  // LLM stream + native TTS process; we do NOT call reset() here.
  const cancelTurn = useCallback(() => {
    cancelInFlight();
    setState('idle');
  }, [cancelInFlight]);

  const stop = useCallback(() => {
    cancelInFlight();
    reset();
    setState('idle');
  }, [cancelInFlight, reset]);

  /** Switch between push-to-talk and auto-listening. Auto mode
   *  spins up a long-running mic session in Rust; on failure we
   *  surface the error and revert to PTT so the user is never
   *  stranded with a silent overlay. */
  const setMode = useCallback(
    (next: TalkMode) => {
      if (next === mode) return;
      cancelInFlight();
      setModeState(next);
      // Effect below reacts to the state change.
    },
    [cancelInFlight, mode],
  );

  // ── Auto-listening session lifecycle ─────────────────────────
  // When `mode === 'auto'` AND readiness is OK, open the cpal
  // session, attach event listeners, and hand each `speech-end`
  // WAV to `processWavBase64`. `speech-start` interrupts any TTS
  // that's still playing so the user can talk over the AI without
  // waiting for it to finish (the "interrupt-on-speech" hook
  // requirement from the B-8 plan).
  useEffect(() => {
    if (mode !== 'auto') return;
    if (!readiness.ready) return;

    let cancelled = false;
    const unlistens: UnlistenFn[] = [];
    let started = false;

    const teardown = async () => {
      cancelled = true;
      // Run unlistens before stopping the session so we don't
      // miss a final teardown event.
      await Promise.allSettled(unlistens.map((u) => Promise.resolve(u())));
      unlistens.length = 0;
      if (started) {
        try {
          await talkSessionStop();
        } catch {
          /* idempotent */
        }
      }
    };

    const boot = async () => {
      try {
        // If a previous renderer left a session running (HMR / route
        // change), stop it first — cpal can't multi-open the mic.
        try {
          const s = await talkSessionStatus();
          if (s.active) await talkSessionStop();
        } catch {
          /* ignore probe failures */
        }

        unlistens.push(
          await listen(TALK_EVENTS.speechStart, () => {
            if (cancelled) return;
            // Echo guard: when the AI is mid-reply, OR within
            // ~1.5 s of finishing (speaker buffer flush + room
            // reverb window), the mic captures Corey's own TTS
            // output through the speakers and we'd mistakenly
            // treat it as a barge-in. v1 sidesteps echo loops
            // by ignoring auto-VAD events for the entire
            // speaking phase plus a short cooldown.
            const s = stateRef.current;
            if (s === 'speaking' || s === 'thinking') return;
            if (Date.now() < echoCooldownUntilRef.current) return;
            cancelInFlight();
            setLevel(0);
            setPartialTranscript('');
            setState('listening');
          }),
        );
        unlistens.push(
          await listen<TalkSpeechEndPayload>(TALK_EVENTS.speechEnd, (e) => {
            if (cancelled) return;
            const s = stateRef.current;
            if (s === 'speaking' || s === 'thinking') return;
            if (Date.now() < echoCooldownUntilRef.current) return;
            setPartialTranscript('');
            const streamingText = streamingTranscriptRef.current;
            streamingTranscriptRef.current = '';
            if (streamingText) {
              void processWavBase64('', streamingText);
            } else {
              void processWavBase64(e.payload.wav_base64);
            }
          }),
        );
        unlistens.push(
          await listen<TalkLevelPayload>(TALK_EVENTS.level, (e) => {
            if (cancelled) return;
            setLevel(e.payload.rms);
          }),
        );
        unlistens.push(
          await listen<{ message: string }>(TALK_EVENTS.error, (e) => {
            if (cancelled) return;
            setError(e.payload.message);
            setState('error');
          }),
        );
        unlistens.push(
          await listen<TalkPartialTranscriptPayload>(TALK_EVENTS.partialTranscript, (e) => {
            if (cancelled) return;
            const s = stateRef.current;
            if (s === 'speaking' || s === 'thinking') return;
            if (Date.now() < echoCooldownUntilRef.current) return;
            setPartialTranscript(e.payload.text);
            if (e.payload.is_final) {
              streamingTranscriptRef.current = e.payload.text;
              setFinalTranscript(e.payload.text);
            }
          }),
        );

        await talkSessionStart();
        started = true;
        if (!cancelled) setState('listening');
      } catch (e) {
        if (cancelled) return;
        // Mic permission denied / no input device. Surface the
        // reason and silently fall back to PTT — the user can still
        // hold Space to drive a turn.
        setError(ipcErrorMessage(e));
        setModeState('ptt');
      }
    };

    void boot();
    return () => {
      void teardown();
    };
  }, [cancelInFlight, mode, processWavBase64, readiness.ready]);

  useEffect(() => {
    return () => {
      cancelInFlight();
    };
  }, [cancelInFlight]);

  // Keep stateRef in sync — listeners registered in the auto-VAD
  // boot effect read this without needing fresh closures. Also
  // arms the echo cooldown timer on speaking→other transitions.
  useEffect(() => {
    const prev = stateRef.current;
    stateRef.current = state;
    if (prev === 'speaking' && state !== 'speaking') {
      // 1500 ms is empirically enough on built-in MacBook
      // speakers to cover afplay buffer flush + room reverb;
      // longer hurts conversational latency, shorter lets
      // tail audio leak through. If users in noisy rooms or
      // with reverberant speakers report missed barge-ins,
      // we'll lift this into a setting.
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
  };
}
