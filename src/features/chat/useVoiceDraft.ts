import { useState } from 'react';

import { voiceRecord, voiceRecordStop, voiceTranscribe } from '@/lib/ipc';

/**
 * Small companion hook that owns the record → transcribe → merge-into-draft
 * loop for the composer's microphone affordance. Split out of
 * `useChatSend` so the orchestration hook stays focused on send/retry/stop
 * state and keyboard routing.
 *
 * Contract:
 *  · `onVoiceStart` is idempotent while a recording is in progress.
 *  · `onVoiceStop` is fire-and-forget; errors are swallowed because
 *    voice is an optional affordance — we never block the composer.
 *  · Transcribed text is appended with a leading space when the
 *    composer already has a draft (matches the pre-extraction
 *    behaviour preserved from `useChatSend`).
 */
export function useVoiceDraft({
  setDraft,
}: {
  setDraft: (updater: (previous: string) => string) => void;
}) {
  const [voiceRecording, setVoiceRecording] = useState(false);

  function onVoiceStart() {
    if (voiceRecording) return;
    setVoiceRecording(true);
    void (async () => {
      try {
        const base64 = await voiceRecord(120);
        setVoiceRecording(false);
        try {
          const res = await voiceTranscribe(base64, 'audio/wav');
          if (res.text) {
            setDraft((d) => (d ? `${d} ${res.text}` : res.text));
          }
        } catch {
          /* non-critical */
        }
      } catch {
        setVoiceRecording(false);
      }
    })();
  }

  function onVoiceStop() {
    void voiceRecordStop().catch(() => {});
  }

  return { voiceRecording, onVoiceStart, onVoiceStop };
}
