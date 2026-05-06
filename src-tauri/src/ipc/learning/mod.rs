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
/// Jaccard similarity threshold for considering a candidate fact a
/// duplicate of something already in MEMORY.md. Lowered from the
/// original 0.65 (token-set match) to 0.45 because we now tokenise
/// CJK input as character bigrams (see `tokenize`), which produces
/// a denser overlap distribution: short Chinese sentences that are
/// semantically equivalent typically land at 0.4-0.7 instead of
/// 0.0-0.2 under whitespace tokenisation.
pub(crate) const SIMILARITY_THRESHOLD: f64 = 0.45;

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

/// Build a token set for Jaccard similarity. Mixes two strategies
/// because the existing whitespace-only tokenisation badly under-
/// counted overlap on Chinese input: "桌面通知已成功发送" and
/// "桌面通知已发送" are different "words" under `split_whitespace`
/// (no boundaries) so the Jaccard score was ~0 and dedup never
/// fired. With bigrams the same pair lands around 0.55 — well over
/// the 0.45 threshold.
///
/// - **CJK characters**: emit every adjacent pair of CJK chars as
///   a bigram token. Single CJK chars are too noisy to match on
///   (almost any sentence shares them).
/// - **ASCII / Latin words**: lowercase + split on whitespace,
///   keep tokens with ≥3 chars (same heuristic as before — drops
///   `the` / `a` / `is` etc. that would otherwise inflate overlap).
///
/// Both kinds go into the same `Vec<String>` so Jaccard treats
/// them uniformly. Empty strings are filtered.
pub(crate) fn tokenize(s: &str) -> Vec<String> {
    let lower = s.to_lowercase();
    let mut out: Vec<String> = lower
        .split_whitespace()
        .filter(|w| w.len() >= 3 && w.chars().all(|c| !is_cjk(c)))
        .map(String::from)
        .collect();

    // CJK bigrams: collect contiguous CJK char runs, then emit
    // every overlapping 2-char window. A pure-ASCII string yields
    // zero CJK tokens and falls back to the whitespace branch above.
    let chars: Vec<char> = lower.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if is_cjk(chars[i]) {
            let start = i;
            while i < chars.len() && is_cjk(chars[i]) {
                i += 1;
            }
            let run: String = chars[start..i].iter().collect();
            if run.chars().count() >= 2 {
                let run_chars: Vec<char> = run.chars().collect();
                for win in run_chars.windows(2) {
                    out.push(win.iter().collect());
                }
            }
        } else {
            i += 1;
        }
    }
    out
}

/// True for CJK Unified Ideographs + Hiragana + Katakana + Hangul.
/// We keep the range narrow on purpose: punctuation / digits /
/// emoji are excluded so they don't dilute the bigram set.
fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x3040..=0x309F   // Hiragana
        | 0x30A0..=0x30FF // Katakana
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x4E00..=0x9FFF // CJK Unified
        | 0xAC00..=0xD7AF // Hangul
        | 0xF900..=0xFAFF // CJK Compatibility
        | 0x20000..=0x2FFFF // CJK Extension B/C/D/E/F
    )
}

pub(crate) fn jaccard(a: &[String], b: &[String]) -> f64 {
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
    let mut seen_exact: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Track bigram token sets of *kept* fact lines so we can also
    // drop semantically-equivalent restatements (e.g. multiple
    // "桌面通知已发送 ✅" / "通知已成功发出" / "已发送 ✅ 通知" in
    // one auto block). Indexed by line content for tracing.
    let mut kept_token_sets: Vec<Vec<String>> = Vec::new();
    let mut deduped = String::new();
    let mut removed = 0usize;

    for line in &lines {
        let trimmed = line.trim();
        let normalized = trimmed.to_lowercase();

        // Headers / blank lines / lines too short to carry semantic
        // meaning pass through unchanged (we don't want to merge two
        // dated `## [auto] 2026-04-27` headers into one — they're
        // structural). Anything that's clearly a fact bullet
        // (starts with `-` and has at least 8 chars of content)
        // goes through both exact and semantic dedup.
        let is_fact_bullet = trimmed.starts_with('-') && trimmed.len() > 4;
        if normalized.is_empty() || normalized.starts_with('#') || !is_fact_bullet {
            deduped.push_str(line);
            deduped.push('\n');
            continue;
        }

        // Stage 1: exact-string dedup (cheap; catches verbatim
        // duplicates like the original implementation).
        if !seen_exact.insert(normalized.clone()) {
            removed += 1;
            continue;
        }

        // Stage 2: semantic dedup — Jaccard similarity over CJK
        // bigrams + ASCII tokens. If this fact's tokens overlap
        // ≥ SIMILARITY_THRESHOLD with any already-kept fact in the
        // same compaction pass, drop it.
        let tokens = tokenize(trimmed);
        let is_dup = !tokens.is_empty()
            && kept_token_sets
                .iter()
                .any(|kept| jaccard(&tokens, kept) >= SIMILARITY_THRESHOLD);
        if is_dup {
            removed += 1;
            continue;
        }

        kept_token_sets.push(tokens);
        deduped.push_str(line);
        deduped.push('\n');
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

pub mod patterns;

#[cfg(test)]
mod tests;
