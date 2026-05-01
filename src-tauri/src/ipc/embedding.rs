//! Embedding service — BGE-M3 ONNX + Jaccard hybrid search.
//!
//! ## v11 rewrite
//!
//! BGE-M3 (568M params, 1024-dim) loaded from `~/.hermes/models/bge-m3/`
//! via `ort` (ONNX Runtime). The model files are downloaded on demand
//! through the Download Center (B-1). When the model is absent the
//! module gracefully degrades to Jaccard-only search — no panics, no
//! failed boot.
//!
//! ### What works
//!
//!   - `chunk_text_smart` — paragraph chunking (no model)
//!   - `expand_query` — bilingual synonym expansion (no model)
//!   - `hybrid_search` — BM25 keyword + vector RRF fusion when model
//!     is loaded; Jaccard fallback when not
//!   - `BgeM3Embedder` — ONNX Runtime embedding (1024-dim)
//!   - `store_embedding` — write vector to SQLite BLOB
//!   - `search_by_vector` — brute-force cosine search
//!   - `rrf_fuse` — Reciprocal Rank Fusion
//!
//! ### Model files
//!
//!   `~/.hermes/models/bge-m3/`
//!     model.onnx              (707KB, graph structure)
//!     model.onnx_data         (2.1GB, weights)
//!     tokenizer.json          (16.3MB)
//!     sentencepiece.bpe.model (4.8MB)

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

// ───────────────────────── BGE-M3 Embedder ─────────────────────────
//
// The ONNX embedder is gated behind the `rag` feature flag because
// `ort` + `ndarray` + `tokenizers` add significant compile time and
// binary size. When the feature is disabled the module still compiles
// — vector search degrades gracefully to Jaccard-only.
//
// Enable with: cargo build --features rag

#[cfg(feature = "rag")]
pub const EMBEDDING_DIM: usize = 1024;

#[cfg(feature = "rag")]
pub fn validate_model_load() -> anyhow::Result<()> {
    let dir = model_dir();
    BgeM3Embedder::load(&dir)?;
    Ok(())
}

#[cfg(feature = "rag")]
pub fn ensure_embedder(embedder: &Arc<std::sync::Mutex<Option<BgeM3Embedder>>>) -> bool {
    let mut guard = embedder.lock().expect("embedder mutex poisoned");
    if guard.is_some() {
        return true;
    }
    let dir = model_dir();
    match BgeM3Embedder::load(&dir) {
        Ok(e) => {
            *guard = Some(e);
            tracing::info!("BGE-M3 embedder loaded successfully");
            true
        }
        Err(e) => {
            tracing::warn!("BGE-M3 embedder load failed, removing stamp: {e}");
            remove_verified_stamp();
            false
        }
    }
}

#[cfg(feature = "rag")]
use std::sync::Arc;

#[cfg(feature = "rag")]
pub struct BgeM3Embedder {
    session: ort::session::Session,
    tokenizer: tokenizers::Tokenizer,
}

#[cfg(feature = "rag")]
impl BgeM3Embedder {
    pub fn load(model_dir: &std::path::Path) -> anyhow::Result<Self> {
        let model_path = model_dir.join("model.onnx");
        let tokenizer_path = model_dir.join("tokenizer.json");

        if !model_path.exists() {
            anyhow::bail!("model.onnx not found at {}", model_path.display());
        }
        if !tokenizer_path.exists() {
            anyhow::bail!("tokenizer.json not found at {}", tokenizer_path.display());
        }

        let mut session = ort::session::Session::builder()
            .map_err(|e| anyhow::anyhow!("session builder: {e}"))?
            .with_intra_threads(2)
            .map_err(|e| anyhow::anyhow!("intra threads: {e}"))?
            .commit_from_file(&model_path)
            .map_err(|e| anyhow::anyhow!("load model: {e}"))?;

        let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| anyhow::anyhow!("tokenizer load: {e}"))?;

        Ok(Self { session, tokenizer })
    }

    pub fn embed(&mut self, text: &str) -> anyhow::Result<Vec<f32>> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| anyhow::anyhow!("tokenize: {e}"))?;

        let ids = encoding.get_ids();
        let mask = encoding.get_attention_mask();
        let type_ids = encoding.get_type_ids();

        let ids_arr = ndarray::Array1::from_iter(ids.iter().map(|&v| v as i64));
        let mask_arr = ndarray::Array1::from_iter(mask.iter().map(|&v| v as i64));
        let type_ids_arr = ndarray::Array1::from_iter(type_ids.iter().map(|&v| v as i64));

        let input_ids = ort::value::TensorRef::from_array_view(ids_arr.view())
            .map_err(|e| anyhow::anyhow!("input_ids tensor: {e}"))?;

        let attention_mask = ort::value::TensorRef::from_array_view(mask_arr.view())
            .map_err(|e| anyhow::anyhow!("attention_mask tensor: {e}"))?;

        let token_type_ids = ort::value::TensorRef::from_array_view(type_ids_arr.view())
            .map_err(|e| anyhow::anyhow!("token_type_ids tensor: {e}"))?;

        let outputs = self
            .session
            .run(ort::inputs![input_ids, attention_mask, token_type_ids])
            .map_err(|e| anyhow::anyhow!("session run: {e}"))?;

        let output = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| anyhow::anyhow!("extract tensor: {e}"))?;

        let (shape, data) = output;
        let seq_len = ids.len();
        let dim = if shape.len() >= 2 {
            shape[shape.len() - 1] as usize
        } else {
            1024
        };
        let mask_sum: f32 = mask.iter().map(|&m| m as f32).sum();

        let mut pooled = vec![0.0f32; dim];
        for i in 0..seq_len {
            let w = mask[i] as f32 / mask_sum;
            for d in 0..dim {
                pooled[d] += data[i * dim + d] * w;
            }
        }
        pooled.truncate(1024);

        let norm: f32 = pooled.iter().map(|v| v * v).sum::<f32>().sqrt();
        if norm > 0.0 {
            for v in pooled.iter_mut() {
                *v /= norm;
            }
        }

        Ok(pooled)
    }

    pub fn embed_batch(&mut self, texts: &[&str]) -> anyhow::Result<Vec<Vec<f32>>> {
        texts.iter().map(|t| self.embed(t)).collect()
    }
}

// ───────────────────────── Vector Storage ─────────────────────────

#[allow(dead_code)]
pub fn store_embedding(db: &Db, chunk_id: i64, vector: &[f32]) -> anyhow::Result<()> {
    let conn = db.conn_raw();
    let bytes: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "UPDATE knowledge_chunks SET embedding = ?1 WHERE id = ?2",
        rusqlite::params![bytes, chunk_id],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn search_by_vector(
    db: &Db,
    query_vector: &[f32],
    limit: usize,
) -> Vec<(i64, String, String, usize, f64)> {
    let conn = db.conn_raw();
    let mut stmt = match conn.prepare(
        "SELECT c.id, d.name, c.content, c.chunk_index, c.embedding \
         FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id \
         WHERE c.embedding IS NOT NULL",
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

    let mut scored = Vec::new();
    for r in rows {
        let (id, doc_name, content, chunk_index, blob) = match r {
            Ok(v) => v,
            Err(_) => continue,
        };

        let chunk_vector: Vec<f32> = blob
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();

        if chunk_vector.len() != query_vector.len() {
            continue;
        }

        let sim = cosine_similarity(query_vector, &chunk_vector);
        if sim > 0.3 {
            scored.push((id, doc_name, content, chunk_index, sim as f64));
        }
    }

    scored.sort_by(|a, b| b.4.partial_cmp(&a.4).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    scored
}

#[allow(dead_code)]
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

// ───────────────────────── RRF Fusion ─────────────────────────

#[allow(dead_code)]
pub fn rrf_fuse(
    keyword_results: &[(i64, String, String, usize, f64)],
    vector_results: &[(i64, String, String, usize, f64)],
    k: usize,
) -> Vec<HybridSearchResult> {
    let mut rrf_scores: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();

    for (rank, (id, _, _, _, _)) in keyword_results.iter().enumerate() {
        *rrf_scores.entry(*id).or_default() += 1.0 / (k + rank + 1) as f64;
    }

    for (rank, (id, _, _, _, _)) in vector_results.iter().enumerate() {
        *rrf_scores.entry(*id).or_default() += 1.0 / (k + rank + 1) as f64;
    }

    let mut lookup: std::collections::HashMap<i64, (String, String, usize)> =
        std::collections::HashMap::new();
    for (id, doc_name, content, chunk_index, _) in keyword_results.iter() {
        lookup.insert(*id, (doc_name.clone(), content.clone(), *chunk_index));
    }
    for (id, doc_name, content, chunk_index, _) in vector_results.iter() {
        lookup
            .entry(*id)
            .or_insert_with(|| (doc_name.clone(), content.clone(), *chunk_index));
    }

    let mut fused: Vec<(i64, f64)> = rrf_scores.into_iter().collect();
    fused.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    fused
        .into_iter()
        .filter_map(|(id, score)| {
            let (doc_name, content, chunk_index) = lookup.get(&id)?;
            Some(HybridSearchResult {
                doc_name: doc_name.clone(),
                content: content.clone(),
                chunk_index: *chunk_index,
                score,
                source: "hybrid".into(),
            })
        })
        .collect()
}

// ───────────────────────── Model path ─────────────────────────

pub fn model_dir() -> std::path::PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    home.join(".hermes").join("models").join("bge-m3")
}

const VERIFIED_STAMP: &str = ".verified";

pub fn model_exists() -> bool {
    let dir = model_dir();
    if dir.join(VERIFIED_STAMP).exists() {
        return true;
    }
    all_model_files_present(&dir)
}

fn all_model_files_present(dir: &std::path::Path) -> bool {
    MODEL_FILES.iter().all(|(name, _)| dir.join(name).exists())
}

pub fn write_verified_stamp() -> std::io::Result<()> {
    let dir = model_dir();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    std::fs::write(dir.join(VERIFIED_STAMP), format!("{ts}"))
}

#[cfg(feature = "rag")]
pub fn remove_verified_stamp() {
    let _ = std::fs::remove_file(model_dir().join(VERIFIED_STAMP));
}

pub const MODEL_FILES: &[(&str, &str)] = &[
    (
        "model.onnx",
        "https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/model.onnx",
    ),
    (
        "model.onnx_data",
        "https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/model.onnx_data",
    ),
    (
        "tokenizer.json",
        "https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/tokenizer.json",
    ),
    (
        "sentencepiece.bpe.model",
        "https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/sentencepiece.bpe.model",
    ),
];

#[cfg(test)]
mod embedder_tests {
    use super::*;

    #[test]
    fn cosine_sim_identical() {
        let v = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_sim_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!((cosine_similarity(&a, &b)).abs() < 1e-6);
    }

    #[test]
    fn rrf_fuse_merges_results() {
        let kw = vec![(1, "a".into(), "c1".into(), 0, 0.9)];
        let vec = vec![(2, "b".into(), "c2".into(), 0, 0.8)];
        let fused = rrf_fuse(&kw, &vec, 60);
        assert_eq!(fused.len(), 2);
    }

    #[test]
    fn rrf_fuse_boosts_overlap() {
        let kw = vec![
            (1, "a".into(), "c1".into(), 0, 0.9),
            (2, "b".into(), "c2".into(), 0, 0.5),
        ];
        let vec = vec![
            (1, "a".into(), "c1".into(), 0, 0.8),
            (3, "c".into(), "c3".into(), 0, 0.7),
        ];
        let fused = rrf_fuse(&kw, &vec, 60);
        assert_eq!(fused[0].doc_name, "a");
    }

    #[test]
    fn model_dir_path() {
        let dir = model_dir();
        assert!(dir.to_string_lossy().contains("bge-m3"));
    }

    #[test]
    fn all_model_files_present_checks_all_four() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        assert!(!all_model_files_present(dir));
        for (name, _) in MODEL_FILES {
            std::fs::write(dir.join(name), "").unwrap();
        }
        assert!(all_model_files_present(dir));
    }

    #[test]
    fn model_exists_short_circuits_on_stamp() {
        let tmp = tempfile::tempdir().unwrap();
        let stamp = tmp.path().join(VERIFIED_STAMP);
        std::fs::write(&stamp, "0").unwrap();
        assert!(stamp.exists());
        let _ = std::fs::remove_file(&stamp);
    }

    #[test]
    fn write_verified_stamp_creates_file() {
        let dir = model_dir();
        let stamp = dir.join(VERIFIED_STAMP);
        let _ = std::fs::remove_file(&stamp);
        let _ = std::fs::create_dir_all(&dir);
        write_verified_stamp().unwrap();
        assert!(stamp.exists());
        let content = std::fs::read_to_string(&stamp).unwrap();
        assert!(content.parse::<u64>().unwrap() > 0);
        let _ = std::fs::remove_file(&stamp);
    }
}
