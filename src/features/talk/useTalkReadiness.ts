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

import type { MicPermission, TalkReadiness } from './talkTypes';

export interface UseTalkReadinessReturn {
  readiness: TalkReadiness;
  localRoute: { stt: boolean; tts: boolean };
  initialMicPermission: MicPermission;
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
  const [initialMicPermission, setInitialMicPermission] = useState<MicPermission>('unknown');

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
  // Triggers the macOS Privacy dialog on first mount. We now also
  // capture the result to show an immediate warning if permission
  // was previously denied — this prevents the confusing "nothing
  // happens when I press space" experience. The 500ms cold-start
  // false-positive concern is addressed by only treating 'denied'
  // as definitive; 'granted' from warmup is ignored (we still
  // rely on actual recording success to confirm).
  useEffect(() => {
    voiceWarmupMic()
      .then((result) => {
        if (result === 'denied') {
          setInitialMicPermission('denied');
        }
      })
      .catch(() => {});
  }, []);

  return { readiness, localRoute, initialMicPermission };
}
