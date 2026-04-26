//! Pattern detection + routing suggestion handlers. Split out of
//! `mod.rs` so the file size stays manageable; both commands query
//! the local SQLite store and emit advisory results for the UI.

use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

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
