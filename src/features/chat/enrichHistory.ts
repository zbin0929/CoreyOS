import type { ChatMessageDto } from '@/lib/ipc';
import {
  learningSearchSimilar,
  knowledgeSearch,
  learningReadLearnings,
  memoryRead,
} from '@/lib/ipc';

// v9: `ragSearch` removed. The Rust-side `rag_search` IPC was a
// Jaccard-on-`messages` keyword fallback misnamed as RAG; it never
// produced semantically useful hits and added a serial IPC roundtrip
// to every chat send. The TF-IDF arm above (`learningSearchSimilar`)
// already covers "find related past conversations", and
// `knowledgeSearch` covers user-uploaded docs — those are the two
// real value adds. When real semantic search lands (Hermes
// `/v1/embeddings`), we'll re-introduce a `semanticSearch` call here
// and feed it into the same `enriched.unshift(...)` flow. Until
// then, dropping this arm shaves ~50–200 ms off every chat send and
// avoids the empty `[Semantically related context]` system block
// that was eating prompt tokens for nothing.

export async function enrichHistoryWithContext(
  history: ChatMessageDto[],
  userText: string,
): Promise<ChatMessageDto[]> {
  const enriched = [...history];

  try {
    const similar = await learningSearchSimilar(userText, 3);
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
