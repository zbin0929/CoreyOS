use serde::Serialize;

use crate::error::{IpcError, IpcResult};
use crate::workflow::store;

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowIntent {
    pub detected: bool,
    pub workflow_id: String,
    pub workflow_name: String,
    pub confidence: f64,
}

#[tauri::command]
pub async fn workflow_extract_intent(message: String) -> IpcResult<WorkflowIntent> {
    let msg = message.clone();
    let result = tokio::task::spawn_blocking(move || {
        let summaries = store::list().map_err(|e| e.to_string())?;
        let lower = msg.to_lowercase();
        let tokens: Vec<&str> = lower.split_whitespace().collect();
        let token_set: std::collections::HashSet<&str> = tokens.iter().copied().collect();

        let mut best: Option<(String, String, f64)> = None;

        for wf in &summaries {
            let lower_name = wf.name.to_lowercase();
            let lower_desc = wf.description.to_lowercase();
            let name_tokens: std::collections::HashSet<&str> =
                lower_name.split_whitespace().collect();
            let desc_tokens: std::collections::HashSet<&str> =
                lower_desc.split_whitespace().collect();

            let name_matches = name_tokens
                .iter()
                .filter(|t| token_set.contains(*t))
                .count();
            let desc_matches = desc_tokens
                .iter()
                .filter(|t| token_set.contains(*t))
                .count();
            let total = name_matches as f64 * 2.0 + desc_matches as f64;
            let max_possible = name_tokens.len() as f64 * 2.0 + desc_tokens.len() as f64;
            let confidence = if max_possible > 0.0 {
                total / max_possible
            } else {
                0.0
            };

            // No per-id keyword boosting. The earlier draft hard-coded
            // synonym lists for the 6 dev-seed demo workflows
            // (ups-tracking, daily-news-digest, …) which meant any
            // user-authored workflow effectively had a worse
            // confidence ceiling than the bundled demos. That's
            // backwards: real user workflows should rank at least as
            // well as templates we ship. We rely solely on the generic
            // jaccard score above; the LLM-side intent flow can do the
            // smarter "what does the user actually want" matching.
            // See `docs/agent/workflow-positioning.md`.
            let boosted = confidence;

            if boosted > 0.2 {
                if let Some((_, _, best_conf)) = &best {
                    if boosted > *best_conf {
                        best = Some((wf.id.clone(), wf.name.clone(), boosted));
                    }
                } else {
                    best = Some((wf.id.clone(), wf.name.clone(), boosted));
                }
            }
        }

        Ok::<Option<(String, String, f64)>, String>(best)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_extract_intent join: {e}"),
    })?
    .map_err(|e| IpcError::Internal { message: e })?;

    match result {
        Some((wf_id, wf_name, confidence)) => Ok(WorkflowIntent {
            detected: true,
            workflow_id: wf_id,
            workflow_name: wf_name,
            confidence: confidence.min(1.0),
        }),
        None => Ok(WorkflowIntent {
            detected: false,
            workflow_id: String::new(),
            workflow_name: String::new(),
            confidence: 0.0,
        }),
    }
}
