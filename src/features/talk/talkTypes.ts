/**
 * Public type contracts for Talk Mode.
 *
 * Extracted from `useTalkMode.ts` 2026-05-17 so consumers
 * (`TalkModeOverlay`, `TalkModeInline`) can import the type
 * surface without pulling in the 1000-line hook implementation.
 */

import type { ChatApprovalRequest, VoiceConfig } from '@/lib/ipc';

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
  pendingApproval: ChatApprovalRequest | null;
  setPendingApproval: (a: ChatApprovalRequest | null) => void;
}
