import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  schedulerExtractIntent,
  schedulerUpsertJob,
  workflowExtractIntent,
  workflowRun,
} from '@/lib/ipc';
import { useChatStore, type UiSuggestion } from '@/stores/chat';

interface IntentSuggestionsOptions {
  sessionId: string;
  patchMessage: (
    sid: string,
    msgId: string,
    patch: Partial<import('@/stores/chat').UiMessage>,
  ) => void;
}

export function useChatIntentSuggestions({
  sessionId,
  patchMessage,
}: IntentSuggestionsOptions) {
  const { t } = useTranslation();
  const pendingRef = useRef<string>('');

  function patchSuggestionStatus(
    sid: string,
    msgId: string,
    sugId: string,
    status: 'done' | 'error',
    resultText: string,
  ) {
    const sess = useChatStore.getState().sessions[sid];
    const msg = sess?.messages.find((m) => m.id === msgId);
    if (!msg?.suggestions) return;
    patchMessage(sid, msgId, {
      suggestions: msg.suggestions.map((s) =>
        s.id === sugId ? { ...s, status, resultText } : s,
      ),
    });
  }

  const handleSuggestionConfirm = async (sug: UiSuggestion) => {
    const msgId = pendingRef.current;
    if (!msgId) return;
    if (sug.type === 'schedule') {
      try {
        await schedulerUpsertJob({
          name: sug.payload.name as string,
          cron_expression: sug.payload.cron_expression as string,
          prompt: sug.payload.prompt as string,
          enabled: true,
        });
        patchSuggestionStatus(sessionId, msgId, sug.id, 'done', t('suggestion.schedule_created'));
      } catch {
        patchSuggestionStatus(sessionId, msgId, sug.id, 'error', t('suggestion.schedule_error'));
      }
    } else if (sug.type === 'workflow') {
      try {
        await workflowRun(sug.payload.workflow_id as string, (sug.payload.inputs ?? {}) as Record<string, unknown>);
        patchSuggestionStatus(sessionId, msgId, sug.id, 'done', t('suggestion.workflow_running'));
      } catch {
        patchSuggestionStatus(sessionId, msgId, sug.id, 'error', t('suggestion.workflow_error'));
      }
    }
  };

  const handleSuggestionDismiss = (sugId: string) => {
    const msgId = pendingRef.current;
    if (!msgId) return;
    const sess = useChatStore.getState().sessions[sessionId];
    const msg = sess?.messages.find((m) => m.id === msgId);
    if (!msg?.suggestions) return;
    patchMessage(sessionId, msgId, {
      suggestions: msg.suggestions.filter((s) => s.id !== sugId),
    });
  };

  function detectIntents(pendingId: string, userText: string) {
    if (!userText || userText.length <= 2) return;

    if (userText.length > 5) {
      void schedulerExtractIntent(userText)
        .then(async (intent) => {
          if (!intent.detected || intent.confidence < 0.6) return;
          const sugId = `sched-${Date.now()}`;
          patchMessage(sessionId, pendingId, {
            suggestions: [
              ...(useChatStore.getState().sessions[sessionId]?.messages.find((m) => m.id === pendingId)?.suggestions ?? []),
              {
                id: sugId,
                type: 'schedule' as const,
                title: `⏰ ${intent.suggested_name}`,
                subtitle: `Cron: ${intent.cron_expression}`,
                payload: {
                  name: intent.suggested_name,
                  cron_expression: intent.cron_expression,
                  prompt: intent.prompt,
                },
                status: 'pending' as const,
              },
            ],
          });
        })
        .catch(() => {});
    }

    if (userText.length > 3) {
      void workflowExtractIntent(userText)
        .then(async (wintent) => {
          if (!wintent.detected || wintent.confidence < 0.3) return;
          const sugId = `wf-${Date.now()}`;
          patchMessage(sessionId, pendingId, {
            suggestions: [
              ...(useChatStore.getState().sessions[sessionId]?.messages.find((m) => m.id === pendingId)?.suggestions ?? []),
              {
                id: sugId,
                type: 'workflow' as const,
                title: `⚡ ${wintent.workflow_name}`,
                subtitle: t('chat_page.workflow_suggestion_subtitle', { defaultValue: '检测到可执行工作流' }),
                payload: {
                  workflow_id: wintent.workflow_id,
                  inputs: {},
                },
                status: 'pending' as const,
              },
            ],
          });
        })
        .catch(() => {});
    }
  }

  return {
    pendingRef,
    handleSuggestionConfirm,
    handleSuggestionDismiss,
    detectIntents,
  };
}
