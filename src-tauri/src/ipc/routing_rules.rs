//! T6.4 — IPC for routing rules. Thin CRUD over `routing_rules.rs`.

use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::routing_rules::{self, RoutingRule, RoutingRulesFile};
use crate::state::AppState;

#[tauri::command]
pub async fn routing_rule_list(state: State<'_, AppState>) -> IpcResult<RoutingRulesFile> {
    let dir = state.config_dir.clone();
    let rules = tokio::task::spawn_blocking(move || routing_rules::load(&dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("routing_rule_list join: {e}"),
        })?;
    Ok(RoutingRulesFile { rules })
}

#[tauri::command]
pub async fn routing_rule_upsert(
    state: State<'_, AppState>,
    rule: RoutingRule,
) -> IpcResult<RoutingRule> {
    // Normalise + validate before touching disk.
    let id = rule.id.trim().to_string();
    routing_rules::validate_id(&id).map_err(|e| IpcError::NotConfigured { hint: e })?;
    routing_rules::validate_match(&rule.match_)
        .map_err(|e| IpcError::NotConfigured { hint: e })?;

    let normalised = RoutingRule {
        id,
        name: if rule.name.trim().is_empty() {
            rule.id.clone()
        } else {
            rule.name.trim().to_string()
        },
        enabled: rule.enabled,
        match_: rule.match_,
        target_adapter_id: rule.target_adapter_id.trim().to_string(),
    };
    if normalised.target_adapter_id.is_empty() {
        return Err(IpcError::NotConfigured {
            hint: "target_adapter_id cannot be empty".into(),
        });
    }

    let dir = state.config_dir.clone();
    let to_save = normalised.clone();
    let saved = tokio::task::spawn_blocking(move || -> IpcResult<RoutingRule> {
        let list = routing_rules::load(&dir);
        let list = routing_rules::upsert(list, to_save.clone());
        routing_rules::save(&dir, &list).map_err(|e| IpcError::Internal {
            message: format!("save routing_rules: {e}"),
        })?;
        Ok(to_save)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("routing_rule_upsert join: {e}"),
    })??;

    Ok(saved)
}

#[tauri::command]
pub async fn routing_rule_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let id_norm = id.trim().to_string();
    routing_rules::validate_id(&id_norm)
        .map_err(|e| IpcError::NotConfigured { hint: e })?;

    let dir = state.config_dir.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        let list = routing_rules::load(&dir);
        let (list, removed) = routing_rules::delete(list, &id_norm);
        if !removed {
            return Ok(());
        }
        routing_rules::save(&dir, &list).map_err(|e| IpcError::Internal {
            message: format!("save routing_rules: {e}"),
        })?;
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("routing_rule_delete join: {e}"),
    })??;

    Ok(())
}
