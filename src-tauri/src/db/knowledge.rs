//! Phase 12 — local knowledge base (docs + chunks + embeddings).
//!
//! Tables are created lazily on first use (`ensure_knowledge_tables_inner`)
//! so older DBs don't need a dedicated `PRAGMA user_version` bump — the
//! knowledge feature was added after v11 landed and is self-installing.

use rusqlite::params;
use std::collections::HashSet;

use super::Db;

impl Db {
    fn ensure_knowledge_tables_inner(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS knowledge_docs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                filename TEXT NOT NULL,
                chunk_count INTEGER NOT NULL,
                total_chars INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding BLOB
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
            "#,
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn ensure_knowledge_tables(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        Self::ensure_knowledge_tables_inner(&conn)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_knowledge_doc(
        &self,
        id: &str,
        name: &str,
        filename: &str,
        chunk_count: usize,
        total_chars: usize,
        created_at: i64,
        chunks: &[String],
    ) -> rusqlite::Result<Vec<i64>> {
        let conn = self.conn.lock();
        Self::ensure_knowledge_tables_inner(&conn)?;
        conn.execute(
            "INSERT INTO knowledge_docs (id, name, filename, chunk_count, total_chars, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, filename, chunk_count, total_chars, created_at],
        )?;
        let mut chunk_ids = Vec::with_capacity(chunks.len());
        for (i, chunk) in chunks.iter().enumerate() {
            conn.execute(
                "INSERT INTO knowledge_chunks (doc_id, chunk_index, content) VALUES (?1, ?2, ?3)",
                params![id, i, chunk],
            )?;
            chunk_ids.push(conn.last_insert_rowid());
        }
        Ok(chunk_ids)
    }

    pub fn list_knowledge_docs(
        &self,
    ) -> rusqlite::Result<Vec<crate::ipc::knowledge::KnowledgeDoc>> {
        let conn = self.conn.lock();
        Self::ensure_knowledge_tables_inner(&conn)?;
        let mut stmt = conn.prepare(
            "SELECT id, name, filename, chunk_count, total_chars, created_at FROM knowledge_docs ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(crate::ipc::knowledge::KnowledgeDoc {
                id: row.get(0)?,
                name: row.get(1)?,
                filename: row.get(2)?,
                chunk_count: row.get(3)?,
                total_chars: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn delete_knowledge_doc(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        Self::ensure_knowledge_tables_inner(&conn)?;
        conn.execute("DELETE FROM knowledge_docs WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn search_knowledge_chunks(
        &self,
        query_tokens: &HashSet<String>,
        limit: usize,
    ) -> rusqlite::Result<Vec<crate::ipc::knowledge::KnowledgeSearchHit>> {
        let conn = self.conn.lock();
        Self::ensure_knowledge_tables_inner(&conn)?;
        let mut stmt = conn.prepare(
            "SELECT c.doc_id, d.name, c.chunk_index, c.content FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, usize>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;

        let mut scored: Vec<crate::ipc::knowledge::KnowledgeSearchHit> = Vec::new();
        for r in rows {
            let (doc_id, doc_name, chunk_index, content) = r?;
            let chunk_tokens: HashSet<String> = content
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
                let snippet: String = content.chars().take(300).collect();
                scored.push(crate::ipc::knowledge::KnowledgeSearchHit {
                    doc_id,
                    doc_name,
                    chunk_index,
                    content: snippet,
                    score: jaccard,
                });
            }
        }
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(limit);
        Ok(scored)
    }
}
