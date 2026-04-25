//! Phase E · P0 — Self-learning: auto-extract knowledge from conversations.
//!
//! After each chat turn completes, the frontend can call
//! `learning_extract` to ask the LLM whether anything in that exchange
//! is worth remembering. If so, the extracted facts are appended to
//! `~/.hermes/MEMORY.md` under a dated `## [auto]` section.
//!
//! The design mirrors `generateTitle` — a lightweight `chatSend` round-
//! trip with a specialised system prompt. Deduplication is string-based
//! (Jaccard similarity over whitespace-split tokens) to avoid pulling
//! in an embedding dependency at this stage.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::fs_atomic;
use crate::state::AppState;

const MEMORY_FILE: &str = "MEMORY.md";
const LEARNINGS_FILE: &str = "LEARNINGS.md";
const MAX_FACTS_PER_TURN: usize = 3;
const MAX_FACT_CHARS: usize = 120;
const SIMILARITY_THRESHOLD: f64 = 0.65;

#[derive(Debug, Deserialize)]
pub struct LearningExtractArgs {
    pub user_message: String,
    pub assistant_message: String,
}

#[derive(Debug, Serialize)]
pub struct LearningExtractResult {
    pub learned: Vec<String>,
    pub skipped_reason: Option<String>,
}

/// Ask the LLM to extract memorable facts from a conversation turn.
/// Returns extracted facts (0–3) that pass dedup against MEMORY.md.
#[tauri::command]
pub async fn learning_extract(
    state: State<'_, AppState>,
    args: LearningExtractArgs,
) -> IpcResult<LearningExtractResult> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;

    let system_prompt = format!(
        "You are a knowledge extraction assistant. Given a user message and an assistant reply, \
         extract facts worth remembering about the USER (preferences, context, corrections, \
         important decisions). Rules:\n\
         - Output up to {MAX_FACTS_PER_TURN} facts, one per line, prefixed with '- '.\n\
         - Each fact must be ≤{MAX_FACT_CHARS} characters.\n\
         - Only extract USER-related facts, not general knowledge.\n\
         - If nothing is worth remembering, output exactly 'NONE'.\n\
         - Write in the same language the user used.\n\
         - Be specific: 'prefers TypeScript over JavaScript' not 'has preferences'.\n\
         - Do NOT repeat information the user likely already knows about themselves."
    );

    let user_content = format!(
        "USER:\n{}\n\nASSISTANT:\n{}",
        truncate_str(&args.user_message, 1500),
        truncate_str(&args.assistant_message, 1500),
    );

    let turn = crate::adapters::ChatTurn {
        messages: vec![
            crate::adapters::ChatMessageDto {
                role: "system".into(),
                content: system_prompt,
                attachments: vec![],
            },
            crate::adapters::ChatMessageDto {
                role: "user".into(),
                content: user_content,
                attachments: vec![],
            },
        ],
        model: None,
        cwd: None,
        model_supports_vision: None,
    };

    let reply = match adapter.chat_once(turn).await {
        Ok(content) => content,
        Err(_) => {
            return Ok(LearningExtractResult {
                learned: vec![],
                skipped_reason: Some("LLM call failed".into()),
            })
        }
    };

    let raw = reply.trim();
    if raw.eq_ignore_ascii_case("NONE") || raw.is_empty() {
        return Ok(LearningExtractResult {
            learned: vec![],
            skipped_reason: Some("Nothing worth remembering".into()),
        });
    }

    let mut candidates: Vec<String> = raw
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim().trim_start_matches("- ").trim();
            if trimmed.is_empty() || trimmed.len() > MAX_FACT_CHARS {
                return None;
            }
            Some(trimmed.to_string())
        })
        .take(MAX_FACTS_PER_TURN)
        .collect();

    if candidates.is_empty() {
        return Ok(LearningExtractResult {
            learned: vec![],
            skipped_reason: Some("No parseable facts".into()),
        });
    }

    let memory_path = resolve_memory_path()?;
    let existing: String = std::fs::read_to_string(&memory_path).unwrap_or_default();

    let existing_tokens = tokenize(&existing);
    candidates.retain(|fact| {
        let fact_tokens = tokenize(fact);
        if fact_tokens.is_empty() {
            return false;
        }
        let sim = jaccard(&fact_tokens, &existing_tokens);
        sim < SIMILARITY_THRESHOLD
    });

    if candidates.is_empty() {
        return Ok(LearningExtractResult {
            learned: vec![],
            skipped_reason: Some("All facts already known (dedup)".into()),
        });
    }

    let section = format_auto_section(&candidates);
    let new_content = if existing.is_empty() {
        section
    } else if existing.ends_with('\n') {
        format!("{}{}", existing, section)
    } else {
        format!("{}\n{}", existing, section)
    };

    let new_bytes = new_content.len() as u64;
    if new_bytes > crate::ipc::memory::MEMORY_MAX_BYTES {
        return Ok(LearningExtractResult {
            learned: vec![],
            skipped_reason: Some("MEMORY.md would exceed size limit".into()),
        });
    }

    fs_atomic::atomic_write(&memory_path, new_content.as_bytes(), None).map_err(|e| {
        IpcError::Internal {
            message: format!("learning write: {e}"),
        }
    })?;

    Ok(LearningExtractResult {
        learned: candidates,
        skipped_reason: None,
    })
}

/// Read the contents of LEARNINGS.md. Returns empty string if missing.
#[tauri::command]
pub async fn learning_read_learnings() -> IpcResult<String> {
    let path = resolve_learnings_path()?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::new()),
    }
}

/// Write LEARNINGS.md (used by P1 feedback learning).
#[tauri::command]
pub async fn learning_write_learnings(content: String) -> IpcResult<()> {
    let path = resolve_learnings_path()?;
    fs_atomic::atomic_write(&path, content.as_bytes(), None).map_err(|e| IpcError::Internal {
        message: format!("learning_write_learnings: {e}"),
    })
}

fn resolve_memory_path() -> IpcResult<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| IpcError::Internal {
            message: "neither $HOME nor %USERPROFILE% set".into(),
        })?;
    Ok(PathBuf::from(home).join(".hermes").join(MEMORY_FILE))
}

fn resolve_learnings_path() -> IpcResult<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| IpcError::Internal {
            message: "neither $HOME nor %USERPROFILE% set".into(),
        })?;
    Ok(PathBuf::from(home).join(".hermes").join(LEARNINGS_FILE))
}

fn format_auto_section(facts: &[String]) -> String {
    use chrono::Local;
    let date = Local::now().format("%Y-%m-%d").to_string();
    let mut out = format!("\n## [auto] {date}\n");
    for fact in facts {
        out.push_str(&format!("- {fact}\n"));
    }
    out
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

fn tokenize(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(String::from)
        .collect()
}

fn jaccard(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let set_a: std::collections::HashSet<_> = a.iter().collect();
    let set_b: std::collections::HashSet<_> = b.iter().collect();
    let intersection = set_a.intersection(&set_b).count() as f64;
    let union = set_a.union(&set_b).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

/// Compute and store a TF-IDF embedding for a message.
/// Called by the frontend after a user message is persisted.
#[tauri::command]
pub async fn learning_index_message(
    state: State<'_, AppState>,
    message_id: String,
    content: String,
) -> IpcResult<()> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        let samples = db.sample_message_contents(200).unwrap_or_default();
        let total = samples.len().max(1);
        let df = crate::tfidf::collect_doc_freqs(&samples);
        let vec = crate::tfidf::compute_tfidf(&content, &df, total);
        let json = vec.to_json();
        db.upsert_embedding(&message_id, &json)
            .map_err(|e| IpcError::Internal {
                message: format!("upsert_embedding: {e}"),
            })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("learning_index_message join: {e}"),
    })?
}

#[derive(Debug, Serialize)]
pub struct SimilarResult {
    pub message_id: String,
    pub content: String,
    pub snippet: String,
}

/// Search for messages similar to the given query text.
/// Returns top-k results ranked by cosine similarity.
#[tauri::command]
pub async fn learning_search_similar(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> IpcResult<Vec<SimilarResult>> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    let k = limit.unwrap_or(5);
    tokio::task::spawn_blocking(move || -> IpcResult<Vec<SimilarResult>> {
        let samples = db.sample_message_contents(200).unwrap_or_default();
        let total = samples.len().max(1);
        let df = crate::tfidf::collect_doc_freqs(&samples);
        let query_vec = crate::tfidf::compute_tfidf(&query, &df, total);
        let json = query_vec.to_json();
        let rows = db
            .search_similar_messages(&json, k)
            .map_err(|e| IpcError::Internal {
                message: format!("search_similar: {e}"),
            })?;
        Ok(rows
            .into_iter()
            .map(|(id, content, snippet)| SimilarResult {
                message_id: id,
                content,
                snippet,
            })
            .collect())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("learning_search_similar join: {e}"),
    })?
}

// ──────────────────── P3: Auto Skill Generation ────────────────────

#[derive(Debug, Serialize)]
pub struct PatternDetectionResult {
    pub pattern_found: bool,
    pub pattern_description: String,
    pub occurrence_count: usize,
    pub suggested_skill_name: String,
}

/// P3 — Detect repeated task patterns across conversation history.
/// Returns a pattern description if the query matches ≥3 similar prior queries.
#[tauri::command]
pub async fn learning_detect_pattern(
    state: State<'_, AppState>,
    query: String,
) -> IpcResult<PatternDetectionResult> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    let query_lower = query.to_lowercase();
    let query_tokens: std::collections::HashSet<String> = query_lower
        .split_whitespace()
        .filter(|w| w.len() > 3)
        .map(String::from)
        .collect();

    if query_tokens.len() < 2 {
        return Ok(PatternDetectionResult {
            pattern_found: false,
            pattern_description: String::new(),
            occurrence_count: 0,
            suggested_skill_name: String::new(),
        });
    }

    tokio::task::spawn_blocking(move || -> IpcResult<PatternDetectionResult> {
        let samples = db.sample_message_contents(500).unwrap_or_default();
        let mut match_count = 0usize;
        let mut best_match = String::new();

        for msg in &samples {
            let msg_lower = msg.to_lowercase();
            let msg_tokens: std::collections::HashSet<String> = msg_lower
                .split_whitespace()
                .filter(|w| w.len() > 3)
                .map(String::from)
                .collect();
            let intersection = query_tokens.intersection(&msg_tokens).count();
            let union = query_tokens.union(&msg_tokens).count();
            if union == 0 {
                continue;
            }
            let sim = intersection as f64 / union as f64;
            if sim > 0.5 {
                match_count += 1;
                if best_match.is_empty() {
                    best_match = msg.chars().take(80).collect();
                }
            }
        }

        if match_count >= 3 {
            let name_tokens: Vec<&str> = query_lower.split_whitespace().take(3).collect();
            let raw_name = name_tokens.join("-");
            let suggested_name: String = raw_name
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-')
                .collect();
            Ok(PatternDetectionResult {
                pattern_found: true,
                pattern_description: best_match,
                occurrence_count: match_count,
                suggested_skill_name: format!("auto-{}", suggested_name),
            })
        } else {
            Ok(PatternDetectionResult {
                pattern_found: false,
                pattern_description: String::new(),
                occurrence_count: match_count,
                suggested_skill_name: String::new(),
            })
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("learning_detect_pattern join: {e}"),
    })?
}

// ──────────────────── P4: Adaptive Evolution ────────────────────

#[derive(Debug, Serialize)]
pub struct RoutingSuggestion {
    pub pattern: String,
    pub suggested_model: String,
    pub confidence: f64,
    pub reason: String,
}

/// P4-E1 — Suggest routing rules based on observed model-switch patterns.
/// Scans recent messages for model-switch-after-pattern correlations.
#[tauri::command]
pub async fn learning_suggest_routing(
    state: State<'_, AppState>,
) -> IpcResult<Vec<RoutingSuggestion>> {
    let db = state.db.clone().ok_or_else(|| IpcError::Internal {
        message: "DB not initialized".into(),
    })?;
    tokio::task::spawn_blocking(move || -> IpcResult<Vec<RoutingSuggestion>> {
        let samples = db.sample_message_contents(100).unwrap_or_default();
        if samples.len() < 5 {
            return Ok(vec![]);
        }
        let mut keyword_counts: HashMap<String, usize> = HashMap::new();
        for msg in &samples {
            for word in msg.to_lowercase().split_whitespace() {
                if word.len() > 4 {
                    *keyword_counts.entry(word.to_string()).or_insert(0) += 1;
                }
            }
        }
        let mut suggestions = Vec::new();
        for (keyword, count) in &keyword_counts {
            if *count >= 3 {
                suggestions.push(RoutingSuggestion {
                    pattern: keyword.clone(),
                    suggested_model: String::new(),
                    confidence: (*count as f64 / samples.len() as f64).min(1.0),
                    reason: format!(
                        "'{}' appeared {} times in recent conversations",
                        keyword, count
                    ),
                });
            }
        }
        suggestions.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        suggestions.truncate(5);
        Ok(suggestions)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("learning_suggest_routing join: {e}"),
    })?
}

/// P4-E2 — Compact MEMORY.md and LEARNINGS.md by deduplicating
/// and summarizing entries. Returns the compacted content.
#[tauri::command]
pub async fn learning_compact_memory() -> IpcResult<MemoryCompactResult> {
    let memory_path = resolve_memory_path()?;
    let memory_path_clone = memory_path.clone();
    let learnings_path = resolve_learnings_path()?;

    let memory_content = tokio::task::spawn_blocking(move || {
        std::fs::read_to_string(&memory_path).unwrap_or_default()
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("read memory: {e}"),
    })?;

    let lines: Vec<&str> = memory_content.lines().collect();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut deduped = String::new();
    let mut removed = 0usize;

    for line in &lines {
        let normalized = line.trim().to_lowercase();
        if normalized.is_empty() || normalized.starts_with('#') {
            deduped.push_str(line);
            deduped.push('\n');
            continue;
        }
        if seen.insert(normalized) {
            deduped.push_str(line);
            deduped.push('\n');
        } else {
            removed += 1;
        }
    }

    if removed > 0 {
        if let Err(e) = fs_atomic::atomic_write(&memory_path_clone, deduped.as_bytes(), None) {
            tracing::warn!("learning_compact_memory write failed: {e}");
        }
    }

    let learnings_content = tokio::task::spawn_blocking(move || {
        std::fs::read_to_string(&learnings_path).unwrap_or_default()
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("read learnings: {e}"),
    })?;

    Ok(MemoryCompactResult {
        memory_entries_removed: removed,
        learnings_entries_count: learnings_content
            .lines()
            .filter(|l| l.starts_with('-'))
            .count(),
    })
}

#[derive(Debug, Serialize)]
pub struct MemoryCompactResult {
    pub memory_entries_removed: usize,
    pub learnings_entries_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jaccard_identical_strings() {
        let a = tokenize("user prefers TypeScript over JavaScript");
        let b = tokenize("user prefers TypeScript over JavaScript");
        assert!(jaccard(&a, &b) > 0.99);
    }

    #[test]
    fn jaccard_completely_different() {
        let a = tokenize("user prefers TypeScript over JavaScript");
        let b = tokenize("the weather is sunny today");
        assert!(jaccard(&a, &b) < 0.1);
    }

    #[test]
    fn jaccard_partial_overlap() {
        let a = tokenize("user prefers TypeScript");
        let b = tokenize("user prefers Rust language");
        let sim = jaccard(&a, &b);
        assert!(sim > 0.1 && sim < 0.8);
    }

    #[test]
    fn truncate_preserves_char_boundary() {
        let s = "你好世界这是一段中文文本";
        let truncated = truncate_str(s, 10);
        assert!(truncated.ends_with('…'));
    }

    #[test]
    fn format_auto_section_structure() {
        let facts = vec!["prefers dark mode".into(), "uses VS Code".into()];
        let section = format_auto_section(&facts);
        assert!(section.contains("## [auto]"));
        assert!(section.contains("- prefers dark mode"));
        assert!(section.contains("- uses VS Code"));
    }
}
