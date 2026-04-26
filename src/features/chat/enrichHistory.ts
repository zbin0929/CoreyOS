import type { ChatMessageDto } from '@/lib/ipc';
import {
  learningSearchSimilar,
  ragSearch,
  knowledgeSearch,
  learningReadLearnings,
  memoryRead,
} from '@/lib/ipc';

export async function enrichHistoryWithContext(
  history: ChatMessageDto[],
  userText: string,
): Promise<ChatMessageDto[]> {
  const enriched = [...history];

  let tfidfHitCount = 0;
  try {
    const similar = await learningSearchSimilar(userText, 3);
    tfidfHitCount = similar.length;
    if (similar.length > 0) {
      const contextParts = similar
        .map((r) => r.content.slice(0, 200).replace(/\n/g, ' '))
        .join('\n');
      enriched.unshift({
        role: 'system',
        content: `[Relevant past conversations]\n${contextParts}`,
      });
    }
  } catch {
    // non-critical — proceed without TF-IDF context
  }

  if (tfidfHitCount === 0) {
    try {
      const ragResults = await ragSearch(userText, 5);
      if (ragResults.length > 0) {
        const ragContext = ragResults
          .filter((r) => r.score > 0.1)
          .map((r) => r.content.slice(0, 200).replace(/\n/g, ' '))
          .join('\n');
        if (ragContext.length > 0) {
          enriched.unshift({
            role: 'system',
            content: `[Semantically related context]\n${ragContext}`,
          });
        }
      }
    } catch {
      // non-critical — proceed without RAG context
    }
  }

  try {
    const kbResults = await knowledgeSearch(userText, 3);
    if (kbResults.length > 0) {
      const kbContext = kbResults
        .map((r) => `[${r.doc_name}]\n${r.content}`)
        .join('\n\n');
      enriched.unshift({
        role: 'system',
        content: `[Knowledge base]\n${kbContext}`,
      });
    }
  } catch {
    // non-critical — proceed without knowledge base context
  }

  try {
    const learnings = await learningReadLearnings();
    if (learnings && learnings.length > 10) {
      enriched.unshift({
        role: 'system',
        content: `[User feedback patterns — follow preferred, avoid avoided]\n${learnings.slice(0, 800)}`,
      });
    }
  } catch {
    // non-critical — proceed without learnings
  }

  try {
    const mem = await memoryRead('user');
    if (mem.content && mem.content.trim().length > 5) {
      enriched.unshift({
        role: 'system',
        content: `[User preferences]\n${mem.content.slice(0, 600)}`,
      });
    }
  } catch {
    // non-critical — proceed without user profile
  }

  return enriched;
}
