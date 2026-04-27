//! Embedding service (DEFERRED — vector path removed).
//!
//! ## What changed and why
//!
//! Previously this module embedded local ONNX (`fastembed` + BGE-Small)
//! and exposed a five-phase RAG pipeline (embed → store → chunk →
//! hybrid → rerank). In practice:
//!
//!   1. The BGE-Small download is the first thing in this module to
//!      touch the network, and HuggingFace Hub is unreachable from
//!      mainland China without an explicit `HF_ENDPOINT` mirror — so
//!      every domestic developer / user experienced a permanent
//!      "warn: BGE-Small ONNX init failed; falling back to zero
//!      vectors" boot and the vector path silently degraded to junk.
//!   2. The downstream `rag.rs::rag_search` IPC was already a Jaccard
//!      keyword fallback; calling it `rag` was misleading.
//!   3. `enrichHistory.ts` dispatched the IPC on every chat turn,
//!      adding latency for zero quality return.
//!   4. The 30 MB ONNX runtime + `ort` C++ chain bloated every
//!      release build for a feature that doesn't actually work.
//!
//! Decision (v9 audit): drop the local embedder + `fastembed` dep,
//! keep the public surface small but stable, and route real semantic
//! search through Hermes' `/v1/embeddings` endpoint when (and only
//! when) we wire that path in v10.
//!
//! ## What still works
//!
//!   - `chunk_text_smart` — pure-text paragraph chunking (no model).
//!   - `expand_query` — bilingual synonym expansion (no model).
//!   - `hybrid_search` — Jaccard keyword overlap against
//!     `knowledge_chunks`. The "hybrid" name is preserved for now so
//!     `knowledge_search` IPC keeps compiling, but the vector branch
//!     is gone — it's a keyword search dressed in the old API.
//!
//! ## What's gone (compared to v8)
//!
//!   - `fastembed::TextEmbedding` and the BGE-Small model
//!   - `embed` / `embed_single` (callers now skip embedding entirely)
//!   - `store_embedding` / `search_by_vector` / `rrf_fuse` /
//!     `cosine_similarity` — all dead without vectors
//!   - `EMBEDDING_DIM` constant
//!
//! The SQLite `knowledge_chunks.embedding` BLOB column is left in the
//! schema for forward-compat. New uploads write `NULL` there;
//! `search_by_vector` is gone so old non-NULL rows are simply
//! ignored.
//!
//! ## Re-enabling vectors later
//!
//! Add a Hermes `/v1/embeddings` client (e.g. `deepseek-embedding`)
//! and reintroduce `embed`/`store_embedding`/`search_by_vector` —
//! exactly the four functions removed in this commit. The chunking
//! and expansion code is intentionally left untouched so the wiring
//! is small.

use crate::db::Db;

const CHUNK_MAX_CHARS: usize = 500;
const CHUNK_OVERLAP_CHARS: usize = 50;

// ───────────────────────── Phase 3: Smart Chunking ─────────────────────────

pub fn chunk_smart(text: &str, max_chars: usize, overlap: usize) -> Vec<String> {
    let paragraphs: Vec<&str> = text
        .split("\n\n")
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    if paragraphs.is_empty() {
        if text.trim().is_empty() {
            return Vec::new();
        }
        return chunk_with_overlap(text.trim(), max_chars, overlap);
    }

    let mut chunks = Vec::new();
    let mut current = String::new();

    for para in &paragraphs {
        if current.len() + para.len() + 2 > max_chars && !current.is_empty() {
            chunks.push(current.trim().to_string());
            if overlap > 0 && current.len() > overlap {
                let tail: String = current
                    .chars()
                    .rev()
                    .take(overlap)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                current = tail;
            } else {
                current.clear();
            }
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(para);
    }
    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    if chunks.is_empty() {
        chunks.push(text.trim().to_string());
    }
    chunks
}

fn chunk_with_overlap(text: &str, max_chars: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + max_chars).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        chunks.push(chunk);
        start = if end >= chars.len() {
            end
        } else {
            end.saturating_sub(overlap)
        };
    }
    chunks
}

// ───────────────────────── Phase 5: Query Expansion ─────────────────────────

pub fn expand_query(query: &str) -> Vec<String> {
    let mut expanded = vec![query.to_string()];
    let lower = query.to_lowercase();

    let synonyms: &[(&[&str], &[&str])] = &[
        (
            &["删除", "移除", "去掉"],
            &["删除", "移除", "去掉", "清除", "erase"],
        ),
        (
            &["修改", "更改", "编辑"],
            &["修改", "更改", "编辑", "更新", "变更"],
        ),
        (
            &["创建", "新建", "添加"],
            &["创建", "新建", "添加", "建立", "生成"],
        ),
        (
            &["查询", "搜索", "查找"],
            &["查询", "搜索", "查找", "检索", "寻找"],
        ),
        (
            &["配置", "设置", "设定"],
            &["配置", "设置", "设定", "偏好", "选项"],
        ),
        (
            &["error", "bug", "问题"],
            &["error", "bug", "问题", "故障", "异常", "失败"],
        ),
        (
            &["delete", "remove"],
            &["delete", "remove", "erase", "drop", "clear"],
        ),
        (
            &["create", "new", "add"],
            &["create", "new", "add", "insert", "make"],
        ),
        (
            &["update", "edit", "modify"],
            &["update", "edit", "modify", "change", "alter"],
        ),
        (
            &["search", "find", "query"],
            &["search", "find", "query", "lookup", "retrieve"],
        ),
    ];

    for (triggers, expansions) in synonyms {
        if triggers.iter().any(|t| lower.contains(t)) {
            expanded.push(expansions.join(" "));
        }
    }

    expanded
}

// ───────────────────────── Public API ─────────────────────────

pub fn chunk_text_smart(text: &str) -> Vec<String> {
    chunk_smart(text, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS)
}

#[derive(Debug, Clone)]
pub struct HybridSearchResult {
    pub doc_name: String,
    pub content: String,
    pub chunk_index: usize,
    pub score: f64,
    #[allow(dead_code)]
    pub source: String,
}

/// Search knowledge chunks. Despite the legacy "hybrid_search" name,
/// this is now a pure Jaccard token-overlap search — the vector arm
/// was removed when we dropped the local ONNX embedder. Keeping the
/// name avoids a churn in `knowledge_search` and the public API; when
/// the Hermes `/v1/embeddings` route lands, this function will fan
/// out to both arms again and the RRF fusion will come back.
pub fn hybrid_search(db: &Db, query: &str, limit: usize) -> Vec<HybridSearchResult> {
    let query_tokens: std::collections::HashSet<String> = query
        .to_lowercase()
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(String::from)
        .collect();

    if query_tokens.is_empty() {
        return Vec::new();
    }

    search_knowledge_chunks_jaccard(db, &query_tokens, limit)
        .into_iter()
        .map(
            |(_, doc_name, content, chunk_index, score)| HybridSearchResult {
                doc_name,
                content,
                chunk_index,
                score,
                source: "keyword".into(),
            },
        )
        .collect()
}

fn search_knowledge_chunks_jaccard(
    db: &Db,
    query_tokens: &std::collections::HashSet<String>,
    limit: usize,
) -> Vec<(i64, String, String, usize, f64)> {
    let conn = db.conn_raw();
    let mut stmt = match conn.prepare(
        "SELECT c.id, d.name, c.content, c.chunk_index FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = match stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, usize>(3)?,
        ))
    }) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut scored = Vec::new();
    for r in rows {
        let (id, doc_name, content, chunk_index) = match r {
            Ok(v) => v,
            Err(_) => continue,
        };
        let chunk_tokens: std::collections::HashSet<String> = content
            .to_lowercase()
            .split_whitespace()
            .filter(|w| w.len() > 2)
            .map(String::from)
            .collect();
        if chunk_tokens.is_empty() {
            continue;
        }
        let intersection = query_tokens.intersection(&chunk_tokens).count() as f64;
        let union = query_tokens.union(&chunk_tokens).count() as f64;
        let jaccard = if union > 0.0 {
            intersection / union
        } else {
            0.0
        };
        if jaccard > 0.1 {
            scored.push((id, doc_name, content, chunk_index, jaccard));
        }
    }
    scored.sort_by(|a, b| b.4.partial_cmp(&a.4).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    scored
}
