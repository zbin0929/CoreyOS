import type { DbSessionWithMessages } from '@/lib/ipc';

import type { ChatSession, UiAttachment, UiMessage, UiToolCall } from './chatTypes';

/** Fire-and-forget DB write. Logs to console on failure — data loss is
 *  acceptable here since zustand is the hot source of truth while the app
 *  is open; the DB is for persistence across restarts. */
export function fireWrite(p: Promise<unknown>, label: string): void {
  p.catch((e) => {
    console.error(`db write failed [${label}]:`, e);
  });
}

/** Serialize one hydrated SQL row into our zustand schema. */
export function sessionFromDb(s: DbSessionWithMessages): ChatSession {
  return {
    id: s.id,
    title: s.title,
    model: s.model,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    adapterId: s.adapter_id,
    llmProfileId: s.llm_profile_id ?? null,
    messages: s.messages.map((m) => ({
      id: m.id,
      role: (m.role === 'user' ? 'user' : 'assistant') as UiMessage['role'],
      content: m.content,
      error: m.error ?? undefined,
      feedback: m.feedback ?? null,
      createdAt: m.created_at,
      toolCalls:
        m.tool_calls.length > 0
          ? m.tool_calls.map<UiToolCall>((t) => ({
              id: t.id,
              tool: t.tool,
              emoji: t.emoji,
              label: t.label,
              at: t.at,
            }))
          : undefined,
      attachments:
        m.attachments && m.attachments.length > 0
          ? m.attachments.map<UiAttachment>((a) => ({
              id: a.id,
              name: a.name,
              mime: a.mime,
              size: a.size,
              path: a.path,
              createdAt: a.created_at,
            }))
          : undefined,
    })),
  };
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fallback heuristic title from the first user message — used until the LLM
 * title generator returns (async, see ipc.ts `generateTitle`).
 * Keeps it short and stops at the first sentence/clause boundary.
 */
export function deriveTitle(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return 'New chat';
  const normalized = firstUser.content.trim().replace(/\s+/g, ' ');
  // Split on common sentence enders (EN + CN).
  const match = normalized.match(/^[^.!?。！？\n]{1,30}/);
  const head = match ? match[0] : normalized.slice(0, 30);
  return head.length < normalized.length ? head + '…' : head;
}
