/**
 * Talk Mode readiness probe + mic-permission warmup.
 *
 * Extracted from `useTalkMode.ts` 2026-05-17 so the central hook
 * doesn't have to interleave boot-time IPC probes with the
 * recording / streaming / playback state machine. Same mount-once
 * semantics as before — both effects fire exactly once, on first
 * mount, and never re-run.
 *
 * What this hook owns:
 *   - `readiness`: cloud STT/TTS configured OR local pack installed
 *   - `localRoute`: which side of the cloud-vs-local routing the
 *     per-turn pipeline should take
 *
 * What this hook does NOT own (still in `useTalkMode`):
 *   - `state` machine transitions — the parent decides whether to
 *     flip to `'unconfigured'` based on the `readiness.ready` flag
 *     we expose. We intentionally don't take a callback here; the
 *     parent already has a one-line `useEffect` that does this
 *     mapping and that's clearer than threading callbacks through.
 *   - `micPermission` — set lazily as a side effect of the first
 *     real recording attempt (see `useTalkMode::pressPtt`). The
 *     warmup useEffect here only **triggers the macOS Privacy
 *     dialog**; we deliberately don't infer permission from its
 *     outcome (CoreAudio cold-start can take >500ms to deliver
 *     the first callback even when permission is granted, and
 *     we don't want the overlay banner to false-positive on a
 *     working mic).
 */

import { useEffect, useState } from 'react';

import { ipcErrorMessage, talkLocalStatus, voiceGetConfig, voiceWarmupMic } from '@/lib/ipc';

import type { TalkReadiness } from './talkTypes';

export interface UseTalkReadinessReturn {
  readiness: TalkReadiness;
  localRoute: { stt: boolean; tts: boolean };
}

export function useTalkReadiness(): UseTalkReadinessReturn {
  const [readiness, setReadiness] = useState<TalkReadiness>({
    ready: false,
    reason: null,
    config: null,
  });
  // Disk-probe of whisper.cpp + sherpa-onnx sidecars. Refreshed on
  // mount + after every successful pack download. When both flip
  // true the talk pipeline routes through `talk_local_*` IPCs
  // instead of the cloud `voice_*` ones — full-offline path.
  const [localRoute, setLocalRoute] = useState({ stt: false, tts: false });

  // ── Readiness probe ─────────────────────────────────────
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
          cfg.tts_provider !== '' && (cfg.tts_provider === 'edge' || cfg.tts_api_key_set);
        const sttOk = local.stt_ready || cloudSttOk;
        const ttsOk = local.tts_ready || cloudTtsOk;
        let reason: string | null = null;
        if (!sttOk && !ttsOk) reason = '尚未配置语音输入与输出';
        else if (!sttOk) reason = '尚未配置语音输入（STT）';
        else if (!ttsOk) reason = '尚未配置语音输出（TTS）';
        const ready = sttOk && ttsOk;
        setReadiness({ ready, reason, config: cfg });
      } catch (e) {
        if (cancelled) return;
        setReadiness({
          ready: false,
          reason: ipcErrorMessage(e),
          config: null,
        });
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Mic permission warmup (macOS) ───────────────────────
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

  return { readiness, localRoute };
}
