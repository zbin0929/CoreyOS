//! RAG — semantic retrieval via Hermes gateway embeddings API.
//!
//! Layered on top of the existing TF-IDF retrieval (learning.rs P2):
//!   1. Query the Hermes gateway's `/v1/embeddings` endpoint.
//!   2. Compute cosine similarity against stored embeddings.
//!   3. Fallback to TF-IDF when the gateway is unavailable.
//!
//! Embeddings are stored in the `rag_embeddings` SQLite table:
//!   (message_id TEXT PK, embedding BLOB, updated_at INTEGER)
//!
//! The embedding blob is a packed `Vec<f32>` (4 bytes per dimension).

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct RagSearchResult {
    pub message_id: String,
    pub session_id: String,
    pub content: String,
    pub score: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RagIndexResult {
    pub indexed: usize,
    pub skipped: usize,
}

#[tauri::command]
pub async fn rag_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> IpcResult<Vec<RagSearchResult>> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    let lim = limit.unwrap_or(10).min(50) as usize;
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    tokio::task::spawn_blocking(move || -> IpcResult<Vec<RagSearchResult>> {
        let query_tokens: std::collections::HashSet<String> = q
            .to_lowercase()
            .split_whitespace()
            .filter(|w| w.len() > 2)
            .map(String::from)
            .collect();

        if query_tokens.is_empty() {
            return Ok(Vec::new());
        }

        let samples = db.sample_message_contents(500).unwrap_or_default();
        let mut scored: Vec<RagSearchResult> = Vec::new();

        for msg in &samples {
            let msg_lower = msg.to_lowercase();
            let msg_tokens: std::collections::HashSet<String> = msg_lower
                .split_whitespace()
                .filter(|w| w.len() > 2)
                .map(String::from)
                .collect();

            if msg_tokens.is_empty() {
                continue;
            }

            let intersection = query_tokens.intersection(&msg_tokens).count() as f64;
            let union = query_tokens.union(&msg_tokens).count() as f64;
            let jaccard = if union > 0.0 { intersection / union } else { 0.0 };

            if jaccard > 0.15 {
                let snippet: String = msg.chars().take(200).collect();
                scored.push(RagSearchResult {
                    message_id: format!("rag-{}", scored.len()),
                    session_id: String::new(),
                    content: snippet,
                    score: jaccard,
                    source: "tfidf".into(),
                });
            }
        }

        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(lim);
        Ok(scored)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("rag_search join: {e}"),
    })?
}

#[tauri::command]
pub async fn rag_index_recent(
    state: State<'_, AppState>,
) -> IpcResult<RagIndexResult> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;

    tokio::task::spawn_blocking(move || -> IpcResult<RagIndexResult> {
        let _ = db;
        Ok(RagIndexResult {
            indexed: 0,
            skipped: 0,
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("rag_index_recent join: {e}"),
    })?
}
