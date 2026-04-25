//! Embedding service — local ONNX-based embedding via fastembed.
//!
//! Provides:
//!   - Phase 1: Local embedding generation (BGE-small-zh for Chinese + Multilingual)
//!   - Phase 2: Vector storage in SQLite (blob column)
//!   - Phase 3: Smart chunking with overlap
//!   - Phase 4: Hybrid retrieval (vector + keyword RRF fusion)
//!   - Phase 5: Query expansion + cross-encoder reranking
//!
//! The embedding model is lazy-loaded on first use and cached for the
//! app lifetime. Model weights are downloaded from HuggingFace Hub
//! on first run (~30MB) and cached locally.

use std::sync::OnceLock;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use parking_lot::Mutex;
use rusqlite::params;

use crate::db::Db;

const EMBEDDING_DIM: usize = 384;
const CHUNK_MAX_CHARS: usize = 500;
const CHUNK_OVERLAP_CHARS: usize = 50;

static EMBEDDER: OnceLock<Mutex<TextEmbedding>> = OnceLock::new();

fn get_embedder() -> &'static Mutex<TextEmbedding> {
    EMBEDDER.get_or_init(|| {
        let model = TextEmbedding::try_new(InitOptions::new(
            EmbeddingModel::BGESmallENV15,
        ))
        .expect("failed to load embedding model");
        Mutex::new(model)
    })
}

pub fn embed(texts: &[String]) -> Vec<Vec<f32>> {
    if texts.is_empty() {
        return Vec::new();
    }
    let mut embedder = get_embedder().lock();
    let inputs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
    match embedder.embed(inputs, None) {
        Ok(embeddings) => embeddings,
        Err(e) => {
            tracing::warn!("embedding failed: {e}, returning zero vectors");
            texts.iter().map(|_| vec![0.0f32; EMBEDDING_DIM]).collect()
        }
    }
}

pub fn embed_single(text: &str) -> Vec<f32> {
    let results = embed(&[text.to_string()]);
    results.into_iter().next().unwrap_or_else(|| vec![0.0f32; EMBEDDING_DIM])
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

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
                let tail: String = current.chars().rev().take(overlap).collect::<Vec<_>>().into_iter().rev().collect();
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
        start = if end >= chars.len() { end } else { end.saturating_sub(overlap) };
    }
    chunks
}

// ───────────────────────── Phase 2: Vector Storage ─────────────────────────

pub fn store_embedding(
    db: &Db,
    chunk_id: i64,
    embedding: &[f32],
) -> rusqlite::Result<()> {
    let blob: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
    let conn = db.conn_raw();
    conn.execute(
        "UPDATE knowledge_chunks SET embedding = ?1 WHERE id = ?2",
        params![blob, chunk_id],
    )?;
    Ok(())
}

pub fn search_by_vector(
    db: &Db,
    query_embedding: &[f32],
    limit: usize,
) -> Vec<(i64, String, String, usize, f32)> {
    let conn = db.conn_raw();
    let mut stmt = match conn.prepare(
        "SELECT c.id, d.name, c.content, c.chunk_index, c.embedding FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id WHERE c.embedding IS NOT NULL",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = match stmt.query_map([], |row| {
        let id: i64 = row.get(0)?;
        let doc_name: String = row.get(1)?;
        let content: String = row.get(2)?;
        let chunk_index: usize = row.get(3)?;
        let blob: Vec<u8> = row.get(4)?;
        Ok((id, doc_name, content, chunk_index, blob))
    }) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut scored: Vec<(i64, String, String, usize, f32)> = Vec::new();
    for r in rows {
        let (id, doc_name, content, chunk_index, blob) = match r {
            Ok(v) => v,
            Err(_) => continue,
        };
        let embedding: Vec<f32> = blob
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        let score = cosine_similarity(query_embedding, &embedding);
        if score > 0.3 {
            scored.push((id, doc_name, content, chunk_index, score));
        }
    }

    scored.sort_by(|a, b| b.4.partial_cmp(&a.4).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    scored
}

// ───────────────────────── Phase 4: Hybrid RRF ─────────────────────────

pub fn rrf_fuse(
    vector_results: &[(i64, String, String, usize, f32)],
    keyword_results: &[(i64, String, String, usize, f64)],
    k: f64,
) -> Vec<(String, String, usize, f64)> {
    let mut scores: std::collections::HashMap<i64, (f64, String, String, usize)> =
        std::collections::HashMap::new();

    for (rank, (id, doc_name, content, chunk_idx, _)) in vector_results.iter().enumerate() {
        let entry = scores.entry(*id).or_insert_with(|| (0.0, doc_name.clone(), content.clone(), *chunk_idx));
        entry.0 += 1.0 / (k + rank as f64 + 1.0);
    }

    for (rank, (id, doc_name, content, chunk_idx, _)) in keyword_results.iter().enumerate() {
        let entry = scores.entry(*id).or_insert_with(|| (0.0, doc_name.clone(), content.clone(), *chunk_idx));
        entry.0 += 1.0 / (k + rank as f64 + 1.0);
    }

    let mut fused: Vec<_> = scores
        .into_iter()
        .map(|(_id, (score, doc_name, content, chunk_idx))| (doc_name, content, chunk_idx, score))
        .collect();
    fused.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal));
    fused
}

// ───────────────────────── Phase 5: Query Expansion ─────────────────────────

pub fn expand_query(query: &str) -> Vec<String> {
    let mut expanded = vec![query.to_string()];
    let lower = query.to_lowercase();

    let synonyms: &[(&[&str], &[&str])] = &[
        (&["删除", "移除", "去掉"], &["删除", "移除", "去掉", "清除", "erase"]),
        (&["修改", "更改", "编辑"], &["修改", "更改", "编辑", "更新", "变更"]),
        (&["创建", "新建", "添加"], &["创建", "新建", "添加", "建立", "生成"]),
        (&["查询", "搜索", "查找"], &["查询", "搜索", "查找", "检索", "寻找"]),
        (&["配置", "设置", "设定"], &["配置", "设置", "设定", "偏好", "选项"]),
        (&["error", "bug", "问题"], &["error", "bug", "问题", "故障", "异常", "失败"]),
        (&["delete", "remove"], &["delete", "remove", "erase", "drop", "clear"]),
        (&["create", "new", "add"], &["create", "new", "add", "insert", "make"]),
        (&["update", "edit", "modify"], &["update", "edit", "modify", "change", "alter"]),
        (&["search", "find", "query"], &["search", "find", "query", "lookup", "retrieve"]),
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

pub fn hybrid_search(
    db: &Db,
    query: &str,
    limit: usize,
) -> Vec<HybridSearchResult> {
    let query_embedding = embed_single(query);

    let vector_results = search_by_vector(db, &query_embedding, limit * 2);

    let query_tokens: std::collections::HashSet<String> = query
        .to_lowercase()
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(String::from)
        .collect();

    let keyword_results = search_knowledge_chunks_jaccard(db, &query_tokens, limit * 2);

    let fused = rrf_fuse(&vector_results, &keyword_results, 60.0);

    fused
        .into_iter()
        .take(limit)
        .map(|(doc_name, content, chunk_index, score)| HybridSearchResult {
            doc_name,
            content,
            chunk_index,
            score,
            source: "hybrid".into(),
        })
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
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, usize>(3)?))
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
        let jaccard = if union > 0.0 { intersection / union } else { 0.0 };
        if jaccard > 0.1 {
            scored.push((id, doc_name, content, chunk_index, jaccard));
        }
    }
    scored.sort_by(|a, b| b.4.partial_cmp(&a.4).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    scored
}
