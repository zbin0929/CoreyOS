import { useCallback } from 'react';
import {
  dbMessageSetUsage,
  generateTitle,
  learningExtract,
  learningDetectPattern,
  skillSave,
} from '@/lib/ipc';
import { useChatStore } from '@/stores/chat';

interface PostSendEffectsOptions {
  sessionId: string;
  renameSession: (id: string, title: string) => void;
  detectIntents: (pendingId: string, userText: string) => void;
}

export function usePostSendEffects({
  sessionId,
  renameSession,
  detectIntents,
}: PostSendEffectsOptions) {
  return useCallback(
    (pendingId: string, userText: string, summary: { prompt_tokens: number | null; completion_tokens: number | null }) => {
      if (summary.prompt_tokens !== null || summary.completion_tokens !== null) {
        void dbMessageSetUsage({
          messageId: pendingId,
          promptTokens: summary.prompt_tokens,
          completionTokens: summary.completion_tokens,
        }).catch(() => {});
      }

      const sess = useChatStore.getState().sessions[sessionId];
      if (!sess) return;
      const userCount = sess.messages.filter((m) => m.role === 'user').length;
      const firstAssistant = sess.messages.find((m) => m.id === pendingId)?.content;

      if (userCount === 1 && firstAssistant && firstAssistant.length > 0) {
        void generateTitle(userText, firstAssistant).then((title) => {
          if (title) renameSession(sessionId, title);
        });
      }

      if (firstAssistant && firstAssistant.length > 0 && userText.length > 0) {
        // D — throttle the extract so MEMORY.md doesn't fill with
        // restatements of trivial turns. Two gates:
        //   1. **Length floor** — skip if either side is too short
        //      to carry a fact ("ok thanks" / "你好" round-trips).
        //   2. **Time-based cooldown** — skip if we extracted in
        //      the last 10 minutes; one fact per ~10-min window
        //      is plenty for a normal session.
        // The user can still force an extract via the dialog by
        // asking the agent directly ("remember that ..." → goes
        // through the new `append_memory` MCP tool, not this
        // auto-pipeline).
        const MIN_USER_CHARS = 20;
        const MIN_ASSISTANT_CHARS = 80;
        const COOLDOWN_MS = 10 * 60 * 1000;
        const lastAt = useChatStore.getState().lastLearningAt ?? 0;
        const tooShort =
          userText.length < MIN_USER_CHARS ||
          firstAssistant.length < MIN_ASSISTANT_CHARS;
        const cooling = Date.now() - lastAt < COOLDOWN_MS;
        if (!tooShort && !cooling) {
          void learningExtract({
            userMessage: userText,
            assistantMessage: firstAssistant,
          }).then(() => {
            useChatStore.setState({ lastLearningAt: Date.now() });
          }).catch(() => {});
        }

        void learningDetectPattern(userText)
          .then(async (result) => {
            if (!result.pattern_found) return;
            const body = `# Auto-detected Skill: ${result.suggested_skill_name}\n\n`
              + `Detected from ${result.occurrence_count} similar requests.\n\n`
              + `## Pattern\n${result.pattern_description}\n\n`
              + `## Usage\nDescribe your request in natural language.\n`;
            const path = `auto/${result.suggested_skill_name}.md`;
            try {
              await skillSave(path, body, true);
            } catch {
              // already exists — skip
            }
          })
          .catch(() => {});

        detectIntents(pendingId, userText);
      }
    },
    [sessionId, renameSession, detectIntents],
  );
}
