//! Knowledge base — document upload, chunking, and retrieval.
//!
//! Users upload documents (text, markdown, JSON). We split them into
//! chunks, store on disk under `~/.hermes/knowledge/{doc_id}/`, and
//! index chunks in SQLite for Jaccard similarity search. The chat
//! send flow queries this on every message to inject relevant context.

use std::fs;
use std::io;
use std::path::PathBuf;

use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::db::Db;
use crate::error::{IpcError, IpcResult};
use crate::fs_atomic;
use crate::ipc::embedding;
use crate::state::AppState;

const _CHUNK_SIZE: usize = 500;

#[derive(Debug, Clone, Serialize)]
pub struct KnowledgeDoc {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub chunk_count: usize,
    pub total_chars: usize,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct KnowledgeSearchHit {
    pub doc_id: String,
    pub doc_name: String,
    pub chunk_index: usize,
    pub content: String,
    pub score: f64,
}

fn knowledge_dir() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no HOME"))?;
    Ok(PathBuf::from(home).join(".hermes").join("knowledge"))
}

fn doc_dir(id: &str) -> io::Result<PathBuf> {
    Ok(knowledge_dir()?.join(id))
}

#[cfg(test)]
fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n") {
        let trimmed = paragraph.trim();
        if trimmed.is_empty() {
            continue;
        }
        if current.len() + trimmed.len() + 2 > max_chars && !current.is_empty() {
            chunks.push(current.trim().to_string());
            current.clear();
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(trimmed);
    }
    if !current.is_empty() {
        chunks.push(current.trim().to_string());
    }

    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.trim().to_string());
    }
    chunks
}

fn db_err(e: rusqlite::Error) -> IpcError {
    IpcError::Internal {
        message: format!("db: {e}"),
    }
}

fn io_err(e: io::Error) -> IpcError {
    IpcError::Internal {
        message: format!("io: {e}"),
    }
}

#[tauri::command]
pub async fn knowledge_upload(
    state: State<'_, AppState>,
    name: String,
    filename: String,
    content: String,
) -> IpcResult<KnowledgeDoc> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let total_chars = content.len();
    let chunks = embedding::chunk_text_smart(&content);
    let chunk_count = chunks.len();

    let id_clone = id.clone();
    let name_clone = name.clone();
    let filename_clone = filename.clone();

    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        let dir = doc_dir(&id_clone).map_err(io_err)?;
        fs::create_dir_all(&dir).map_err(io_err)?;
        fs_atomic::atomic_write(&dir.join("original.txt"), content.as_bytes(), None)
            .map_err(io_err)?;

        // Insert document + chunks. The DB still has an `embedding`
        // BLOB column on `knowledge_chunks`, but we deliberately leave
        // it NULL — the local ONNX embedder was removed (see
        // `embedding.rs` module docs); when the Hermes /v1/embeddings
        // route lands we'll backfill in a separate IPC. Returning the
        // chunk_ids is no longer necessary for embedding writes.
        let _chunk_ids = db
            .insert_knowledge_doc(
                &id_clone,
                &name_clone,
                &filename_clone,
                chunk_count,
                total_chars,
                now,
                &chunks,
            )
            .map_err(db_err)?;

        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("knowledge_upload join: {e}"),
    })??;

    Ok(KnowledgeDoc {
        id,
        name,
        filename,
        chunk_count,
        total_chars,
        created_at: now,
    })
}

#[tauri::command]
pub async fn knowledge_list(state: State<'_, AppState>) -> IpcResult<Vec<KnowledgeDoc>> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;

    tokio::task::spawn_blocking(move || -> IpcResult<Vec<KnowledgeDoc>> {
        db.list_knowledge_docs().map_err(db_err)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("knowledge_list join: {e}"),
    })?
}

#[tauri::command]
pub async fn knowledge_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    let id_clone = id.clone();

    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        db.delete_knowledge_doc(&id_clone).map_err(db_err)?;
        let dir = doc_dir(&id_clone).map_err(io_err)?;
        let _ = fs::remove_dir_all(dir);
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("knowledge_delete join: {e}"),
    })?
}

#[tauri::command]
pub async fn knowledge_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> IpcResult<Vec<KnowledgeSearchHit>> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    let lim = limit.unwrap_or(5).min(20) as usize;
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    #[cfg(feature = "rag")]
    let embedder_arc = state.embedder.clone();

    tokio::task::spawn_blocking(move || -> IpcResult<Vec<KnowledgeSearchHit>> {
        let q = query.trim().to_string();
        if q.is_empty() {
            return Ok(Vec::new());
        }

        let expanded = embedding::expand_query(&q);
        let full_query = expanded.join(" ");

        let keyword_results = search_knowledge_chunks_jaccard_raw(&db, &full_query, lim);

        #[cfg(feature = "rag")]
        {
            let mut guard = embedder_arc.lock();
            if let Some(ref mut embedder) = *guard {
                match embedder.embed(&q) {
                    Ok(query_vec) => {
                        let vector_results = embedding::search_by_vector(&db, &query_vec, lim);
                        if !vector_results.is_empty() {
                            let fused = embedding::rrf_fuse(&keyword_results, &vector_results, 60);
                            return Ok(fused
                                .into_iter()
                                .map(|r| KnowledgeSearchHit {
                                    doc_id: String::new(),
                                    doc_name: r.doc_name,
                                    chunk_index: r.chunk_index,
                                    content: r.content.chars().take(300).collect(),
                                    score: r.score,
                                })
                                .collect());
                        }
                    }
                    Err(e) => {
                        tracing::warn!("embed failed, falling back to keyword: {e}");
                    }
                }
            }
        }

        let results = keyword_results;
        Ok(results
            .into_iter()
            .map(
                |(_, doc_name, content, chunk_index, score)| KnowledgeSearchHit {
                    doc_id: String::new(),
                    doc_name,
                    chunk_index,
                    content: content.chars().take(300).collect(),
                    score,
                },
            )
            .collect())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("knowledge_search join: {e}"),
    })?
}

fn search_knowledge_chunks_jaccard_raw(
    db: &Db,
    query: &str,
    limit: usize,
) -> Vec<(i64, String, String, usize, f64)> {
    let query_tokens: std::collections::HashSet<String> = query
        .to_lowercase()
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(String::from)
        .collect();

    if query_tokens.is_empty() {
        return Vec::new();
    }

    embedding::hybrid_search(db, query, limit)
        .into_iter()
        .map(|r| (0i64, r.doc_name, r.content, r.chunk_index, r.score))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_accumulates_paragraphs() {
        let text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
        let chunks = chunk_text(text, 100);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].contains("First"));
        assert!(chunks[0].contains("Third"));
    }

    #[test]
    fn chunk_text_splits_when_exceeds_max() {
        let text = "A".repeat(60) + "\n\n" + &"B".repeat(60);
        let chunks = chunk_text(&text, 100);
        assert!(chunks.len() >= 2);
    }

    #[test]
    fn chunk_text_empty_input() {
        let chunks = chunk_text("", 500);
        assert!(chunks.is_empty());
    }

    #[test]
    fn chunk_text_single_short_text() {
        let chunks = chunk_text("Hello world", 500);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "Hello world");
    }
}

// ───────────────────────── RAG Status ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct RagStatus {
    pub model_installed: bool,
    pub model_dir: String,
    pub files: Vec<ModelFileStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelFileStatus {
    pub name: String,
    pub exists: bool,
    pub size_bytes: u64,
    pub download_url: String,
}

#[tauri::command]
pub fn rag_status() -> IpcResult<RagStatus> {
    let dir = embedding::model_dir();
    let dir_str = dir.to_string_lossy().to_string();

    let files: Vec<ModelFileStatus> = embedding::MODEL_FILES
        .iter()
        .map(|(name, url)| {
            let path = dir.join(name);
            let meta = std::fs::metadata(&path).ok();
            ModelFileStatus {
                name: name.to_string(),
                exists: path.exists(),
                size_bytes: meta.map(|m| m.len()).unwrap_or(0),
                download_url: url.to_string(),
            }
        })
        .collect();

    Ok(RagStatus {
        model_installed: embedding::model_exists(),
        model_dir: dir_str,
        files,
    })
}

#[tauri::command]
pub async fn rag_download_model(app: AppHandle, state: State<'_, AppState>) -> IpcResult<()> {
    let dir = embedding::model_dir();
    std::fs::create_dir_all(&dir).map_err(|e| IpcError::Internal {
        message: format!("create model dir: {e}"),
    })?;

    for (name, url) in embedding::MODEL_FILES {
        let target = dir.join(name);
        if target.exists() {
            if let Ok(meta) = std::fs::metadata(&target) {
                if meta.len() > 0 {
                    continue;
                }
            }
        }
        let req = crate::ipc::download::DownloadStartRequest {
            url: url.to_string(),
            target_path: target.to_string_lossy().to_string(),
            label: format!("BGE-M3: {name}"),
        };
        crate::ipc::download::download_start(app.clone(), state.clone(), req)
            .await
            .map_err(|e| IpcError::Internal {
                message: format!("download {name}: {e:?}"),
            })?;
    }

    Ok(())
}
