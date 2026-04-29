import {
  dbMessageSetUsage,
  ipcErrorMessage,
  type ChatMessageDto,
  type ChatStreamDone,
  type ChatStreamHandle,
  type ChatToolProgress,
  type ChatApprovalRequest,
} from '@/lib/ipc';
import {
  useChatStore,
  type UiAttachment,
  type UiMessage,
} from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';

type StreamCallbacks = {
  onDelta: (chunk: string) => void;
  onReasoning: (chunk: string) => void;
  onTool: (progress: ChatToolProgress) => void;
  onApproval: (approval: ChatApprovalRequest) => void;
  onDone: (summary: ChatStreamDone) => void;
  onError: (err: unknown) => void;
};

export function buildStreamCallbacks(
  sessionId: string,
  targetId: string,
  patchMessage: (sid: string, mid: string, patch: Partial<UiMessage>) => void,
  appendToolCall: (
    sid: string,
    mid: string,
    tc: { id: string; tool: string; emoji?: string | null; label?: string | null; at: number },
  ) => void,
  setSending: (v: boolean) => void,
  streamRef: React.MutableRefObject<ChatStreamHandle | null>,
  pendingRef: React.MutableRefObject<string | null>,
  onStreamDone?: (pendingId: string, userText: string, summary: ChatStreamDone) => void,
  onApproval?: (approval: ChatApprovalRequest) => void,
): StreamCallbacks {
  return {
    onDelta(chunk) {
      const sess = useChatStore.getState().sessions[sessionId];
      const current = sess?.messages.find((m) => m.id === targetId);
      patchMessage(sessionId, targetId, {
        content: (current?.content ?? '') + chunk,
        pending: false,
      });
    },
    onReasoning(chunk) {
      const sess = useChatStore.getState().sessions[sessionId];
      const current = sess?.messages.find((m) => m.id === targetId);
      patchMessage(sessionId, targetId, {
        reasoning: (current?.reasoning ?? '') + chunk,
        pending: false,
      });
    },
    onTool(progress) {
      appendToolCall(sessionId, targetId, {
        id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        tool: progress.tool,
        emoji: progress.emoji,
        label: progress.label,
        at: Date.now(),
      });
      const sess = useChatStore.getState().sessions[sessionId];
      const current = sess?.messages.find((m) => m.id === targetId);
      if (current?.pending) {
        patchMessage(sessionId, targetId, { pending: false });
      }
    },
    onApproval(approval) {
      if (onApproval) onApproval(approval);
    },
    onDone(summary) {
      patchMessage(sessionId, targetId, { pending: false });
      setSending(false);
      streamRef.current = null;
      pendingRef.current = null;
      if (summary.prompt_tokens !== null || summary.completion_tokens !== null) {
        useChatStore.getState().setLastTokenUsage({
          prompt: summary.prompt_tokens ?? 0,
          completion: summary.completion_tokens ?? 0,
        });
      }
      if (onStreamDone) {
        onStreamDone(targetId, '', summary);
      } else if (
        summary.prompt_tokens !== null ||
        summary.completion_tokens !== null
      ) {
        void dbMessageSetUsage({
          messageId: targetId,
          promptTokens: summary.prompt_tokens,
          completionTokens: summary.completion_tokens,
        }).catch(() => {});
      }
    },
    onError(err) {
      patchMessage(sessionId, targetId, {
        content: '',
        pending: false,
        error: ipcErrorMessage(err),
      });
      setSending(false);
      streamRef.current = null;
      pendingRef.current = null;
    },
  };
}

export function resolveAdapterId(
  sessionId: string,
  _messages: UiMessage[],
  _text: string,
): string | undefined {
  const sess = useChatStore.getState().sessions[sessionId];
  const profilePin = sess?.llmProfileId ?? null;
  return (
    profilePin
      ? `hermes:profile:${profilePin}`
      : useAgentsStore.getState().activeId
  ) ?? undefined;
}

export function toDto(
  role: 'user' | 'assistant',
  content: string,
  atts: UiAttachment[] | undefined,
): ChatMessageDto {
  return atts && atts.length > 0
    ? {
        role,
        content,
        attachments: atts.map((a) => ({
          path: a.path,
          mime: a.mime,
          name: a.name,
        })),
      }
    : { role, content };
}
