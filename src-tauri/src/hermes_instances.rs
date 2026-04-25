//! T6.2 — named Hermes instances.
//!
//! The original Corey build supports ONE Hermes gateway URL, stored in
//! `<app_config_dir>/gateway.json` and consumed at startup to register
//! the built-in `hermes` adapter. T6.2 extends this with a sidecar
//! file `<app_config_dir>/hermes_instances.json` listing additional
//! instances (each a `{ id, label, base_url, api_key, default_model }`
//! tuple). At boot we walk the list and register one extra
//! `HermesAdapter` per entry under `adapter_id = "hermes:{id}"`.
//!
//! The primary `gateway.json` is left untouched — existing users boot
//! with exactly the behaviour they had before T6.2. Extra instances
//! show up in the AgentSwitcher next to the built-in `hermes` adapter
//! and route via the existing `adapter_id` chat path (T5.5b).
//!
//! File shape (JSON):
//! ```json
//! {
//!   "instances": [
//!     { "id": "work", "label": "Work laptop", "base_url": "http://10.0.0.2:8642",
//!       "api_key": "…", "default_model": "deepseek-chat" }
//!   ]
//! }
//! ```
//!
//! Id rules: 1..32 chars, `[a-z0-9_-]`. Enforced on write by
//! `validate_id`; the IPC layer surfaces violations as `IpcError`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Filename under `<app_config_dir>` (same directory that holds
/// `gateway.json`).
const FILE_NAME: &str = "hermes_instances.json";

/// Wire + on-disk shape of one named instance. Ordering in the file is
/// preserved on save so the UI can render them in a stable order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HermesInstance {
    /// URL-safe slug, 1..32 chars of `[a-z0-9_-]`. Used as the
    /// registry suffix (`hermes:<id>`) and as the stable key across
    /// renames.
    pub id: String,
    /// Human-friendly label shown in the AgentSwitcher. Defaults to
    /// `id` if empty on the wire; we keep them separate so a later
    /// rename-without-resetting-history is possible.
    #[serde(default)]
    pub label: String,
    /// Hermes gateway base URL. No trailing slash; normalised on save.
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    /// T6.5 — sandbox scope id this instance runs under. `None`
    /// (or `Some("default")`) resolves to the always-present default
    /// scope. Persisted verbatim; no runtime validation at load time
    /// because a scope may exist or not depending on load order —
    /// callers handle `UnknownScope` if the id is stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox_scope_id: Option<String>,

    /// T8 — optional reference to an [`crate::llm_profiles::LlmProfile`]
    /// by id. When set, `base_url` / `api_key` / `default_model` are
    /// resolved from the profile at *registration* time rather than
    /// stored inline. Old rows (pre-T8) leave this `None` and keep
    /// using their inline fields, so upgrading doesn't break any
    /// existing agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_profile_id: Option<String>,
}

/// Top-level wrapper so we can add fields later without a migration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HermesInstancesFile {
    #[serde(default)]
    pub instances: Vec<HermesInstance>,
}

/// Resolve `<config_dir>/hermes_instances.json`.
pub fn file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// Read + parse. Missing file → empty list (no error); unparseable
/// file → logged and treated as empty so a corrupt save doesn't break
/// boot.
pub fn load(config_dir: &Path) -> Vec<HermesInstance> {
    let path = file_path(config_dir);
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<HermesInstancesFile>(&raw) {
            Ok(f) => f.instances,
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "hermes_instances.json parse failed — treating as empty",
                );
                Vec::new()
            }
        },
        Err(_) => Vec::new(),
    }
}

/// Atomic write (`<FILE>.tmp` + rename). Creates the directory if
/// absent. Caller is responsible for having validated ids + urls
/// before this point — `save` does NOT re-validate because it's also
/// used to persist a list the caller just mutated.
pub fn save(config_dir: &Path, instances: &[HermesInstance]) -> io::Result<PathBuf> {
    fs::create_dir_all(config_dir)?;
    let file = HermesInstancesFile {
        instances: instances.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let final_path = file_path(config_dir);
    let tmp_path = config_dir.join(format!("{FILE_NAME}.tmp"));
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &final_path)?;
    Ok(final_path)
}

/// Adapter-registry key for a named instance. Kept here (not inlined
/// at every call site) so a future rename of the scheme is a
/// one-line change.
pub fn adapter_id_for(id: &str) -> String {
    format!("hermes:{id}")
}

/// Validate an instance id. Err message is user-friendly so IPC can
/// surface it directly.
pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("id cannot be empty".into());
    }
    if id.len() > 32 {
        return Err("id must be ≤ 32 characters".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err("id may only contain lowercase letters, digits, '-' or '_'".into());
    }
    Ok(())
}

/// Validate a base URL. Same ruleset as `ipc::config::config_set` so
/// behaviour matches the primary gateway.
pub fn validate_base_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("base_url cannot be empty".into());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }
    Ok(())
}

/// Upsert (match on `id`). Returns the updated list without mutating
/// the input slice; caller persists via `save`.
pub fn upsert(mut list: Vec<HermesInstance>, incoming: HermesInstance) -> Vec<HermesInstance> {
    if let Some(slot) = list.iter_mut().find(|i| i.id == incoming.id) {
        *slot = incoming;
    } else {
        list.push(incoming);
    }
    list
}

/// Remove by id. Returns the new list and whether a row was dropped.
pub fn delete(list: Vec<HermesInstance>, id: &str) -> (Vec<HermesInstance>, bool) {
    let before = list.len();
    let list: Vec<HermesInstance> = list.into_iter().filter(|i| i.id != id).collect();
    let removed = list.len() != before;
    (list, removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmpdir() -> PathBuf {
        let base = env::temp_dir().join(format!(
            "caduceus-hermes-instances-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tmpdir();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn save_then_load_roundtrips_all_fields() {
        let dir = tmpdir();
        let list = vec![
            HermesInstance {
                id: "work".into(),
                label: "Work laptop".into(),
                llm_profile_id: None,
                base_url: "http://10.0.0.2:8642".into(),
                api_key: Some("sk-xxx".into()),
                default_model: Some("deepseek-chat".into()),
                sandbox_scope_id: None,
            },
            HermesInstance {
                id: "home".into(),
                label: "Home desktop".into(),
                llm_profile_id: None,
                base_url: "http://192.168.1.10:8642".into(),
                api_key: None,
                default_model: None,
                sandbox_scope_id: None,
            },
        ];
        save(&dir, &list).unwrap();
        let reloaded = load(&dir);
        assert_eq!(reloaded, list);
    }

    #[test]
    fn load_returns_empty_on_corrupt_file() {
        let dir = tmpdir();
        fs::write(file_path(&dir), "{not json").unwrap();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn validate_id_accepts_slug_and_rejects_bad() {
        assert!(validate_id("work").is_ok());
        assert!(validate_id("home-1").is_ok());
        assert!(validate_id("a_b").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id("Work").is_err()); // uppercase
        assert!(validate_id("bad space").is_err());
        assert!(validate_id(&"x".repeat(33)).is_err());
    }

    #[test]
    fn validate_base_url_requires_scheme() {
        assert!(validate_base_url("http://127.0.0.1:8642").is_ok());
        assert!(validate_base_url("https://hermes.example.com").is_ok());
        assert!(validate_base_url("").is_err());
        assert!(validate_base_url("   ").is_err());
        assert!(validate_base_url("127.0.0.1:8642").is_err());
    }

    #[test]
    fn upsert_replaces_by_id_and_preserves_order() {
        let base = vec![
            HermesInstance {
                id: "a".into(),
                label: "A".into(),
                llm_profile_id: None,
                base_url: "http://a".into(),
                api_key: None,
                default_model: None,
                sandbox_scope_id: None,
            },
            HermesInstance {
                id: "b".into(),
                label: "B".into(),
                llm_profile_id: None,
                base_url: "http://b".into(),
                api_key: None,
                default_model: None,
                sandbox_scope_id: None,
            },
        ];
        let updated = upsert(
            base,
            HermesInstance {
                id: "a".into(),
                label: "A (renamed)".into(),
                llm_profile_id: None,
                base_url: "http://a2".into(),
                api_key: None,
                default_model: None,
                sandbox_scope_id: None,
            },
        );
        assert_eq!(updated[0].id, "a");
        assert_eq!(updated[0].label, "A (renamed)");
        assert_eq!(updated[0].base_url, "http://a2");
        assert_eq!(updated[1].id, "b");
    }

    #[test]
    fn delete_removes_row_and_reports() {
        let base = vec![
            HermesInstance {
                id: "a".into(),
                label: "".into(),
                llm_profile_id: None,
                base_url: "http://a".into(),
                api_key: None,
                default_model: None,
                sandbox_scope_id: None,
            },
            HermesInstance {
                id: "b".into(),
                label: "".into(),
                llm_profile_id: None,
                base_url: "http://b".into(),
                api_key: None,
                default_model: None,
                sandbox_scope_id: None,
            },
        ];
        let (next, removed) = delete(base.clone(), "a");
        assert!(removed);
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "b");

        let (same, removed) = delete(base, "nope");
        assert!(!removed);
        assert_eq!(same.len(), 2);
    }

    #[test]
    fn adapter_id_for_uses_namespaced_slug() {
        assert_eq!(adapter_id_for("work"), "hermes:work");
    }

    // ───────────────────────── Wizard contract ─────────────────────────
    //
    // The Agent Wizard on Settings posts a JSON payload shaped exactly
    // like `HermesInstance` minus `sandbox_scope_id`. Regression-test
    // the end-to-end path (deserialize → validate → upsert → save →
    // load) so a future frontend tweak — say omitting a field, or
    // capitalising the id — gets caught here instead of by a user.

    /// Mirror `ipc::hermes_instance_upsert` without needing a live
    /// Tauri `AppState`. Kept to the exact same ordering: validate id,
    /// validate base_url, normalise, upsert, save.
    fn wizard_save(dir: &std::path::Path, payload: &str) -> Result<HermesInstance, String> {
        let inst: HermesInstance =
            serde_json::from_str(payload).map_err(|e| format!("deserialize: {e}"))?;
        let id = inst.id.trim().to_string();
        validate_id(&id)?;
        let base_url = inst.base_url.trim_end_matches('/').to_string();
        validate_base_url(&base_url)?;
        let normalised = HermesInstance {
            id: id.clone(),
            label: if inst.label.trim().is_empty() {
                id.clone()
            } else {
                inst.label.trim().to_string()
            },
            base_url,
            api_key: inst.api_key.filter(|s| !s.is_empty()),
            default_model: inst.default_model.filter(|s| !s.is_empty()),
            sandbox_scope_id: inst.sandbox_scope_id.filter(|s| !s.is_empty()),
            llm_profile_id: inst.llm_profile_id.filter(|s| !s.is_empty()),
        };
        let list = load(dir);
        let list = upsert(list, normalised.clone());
        save(dir, &list).map_err(|e| format!("save: {e}"))?;
        Ok(normalised)
    }

    #[test]
    fn wizard_deepseek_payload_persists_and_roundtrips() {
        let dir = tmpdir();
        // Exact JSON shape the wizard's save() builds. No
        // sandbox_scope_id — serde_default should land it as None.
        let payload = r#"{
            "id": "deepseek",
            "label": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "sk-test",
            "default_model": "deepseek-chat"
        }"#;
        let saved = wizard_save(&dir, payload).expect("wizard save should succeed");
        assert_eq!(saved.id, "deepseek");
        assert_eq!(saved.label, "DeepSeek");
        assert_eq!(saved.base_url, "https://api.deepseek.com/v1");
        assert_eq!(saved.api_key.as_deref(), Some("sk-test"));
        assert_eq!(saved.default_model.as_deref(), Some("deepseek-chat"));
        assert!(saved.sandbox_scope_id.is_none());

        // Reopen — simulates a restart — and confirm the row survived.
        let rows = load(&dir);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], saved);
    }

    #[test]
    fn wizard_ollama_payload_with_null_key_persists() {
        let dir = tmpdir();
        // Ollama template: no api_key, no env var. Frontend sends
        // api_key as the JSON literal `null`.
        let payload = r#"{
            "id": "ollama",
            "label": "Ollama (local)",
            "base_url": "http://localhost:11434/v1",
            "api_key": null,
            "default_model": "llama3.2"
        }"#;
        let saved = wizard_save(&dir, payload).expect("ollama wizard save should succeed");
        assert!(saved.api_key.is_none());
        assert_eq!(saved.default_model.as_deref(), Some("llama3.2"));
        assert_eq!(load(&dir), vec![saved]);
    }

    #[test]
    fn wizard_rejects_uppercase_id_with_user_friendly_error() {
        // Most-common user mistake: they edit the auto-generated id
        // to something like "DeepSeek" with a capital D.
        let dir = tmpdir();
        let payload = r#"{
            "id": "DeepSeek",
            "label": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": null,
            "default_model": null
        }"#;
        let err = wizard_save(&dir, payload).expect_err("uppercase id must fail");
        assert!(
            err.contains("lowercase") || err.contains("[a-z0-9_-]"),
            "expected validate_id error, got: {err}"
        );
        // Nothing should have been persisted.
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn wizard_rejects_empty_id() {
        let dir = tmpdir();
        let payload = r#"{
            "id": "",
            "label": "",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-x",
            "default_model": null
        }"#;
        let err = wizard_save(&dir, payload).expect_err("empty id must fail");
        assert!(err.contains("empty"), "got: {err}");
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn wizard_upsert_replaces_existing_id() {
        // When a user re-runs the wizard with the same id, the
        // existing row is overwritten rather than duplicated —
        // critical for "I mis-typed my API key, let me fix it".
        let dir = tmpdir();
        let first = r#"{
            "id": "openai",
            "label": "OpenAI",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-old",
            "default_model": "gpt-4o"
        }"#;
        wizard_save(&dir, first).unwrap();

        let second = r#"{
            "id": "openai",
            "label": "OpenAI prod",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-new",
            "default_model": "gpt-4o-mini"
        }"#;
        wizard_save(&dir, second).unwrap();

        let rows = load(&dir);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].api_key.as_deref(), Some("sk-new"));
        assert_eq!(rows[0].label, "OpenAI prod");
        assert_eq!(rows[0].default_model.as_deref(), Some("gpt-4o-mini"));
    }

    #[test]
    fn wizard_strips_trailing_slash_from_base_url() {
        let dir = tmpdir();
        let payload = r#"{
            "id": "router",
            "label": "OpenRouter",
            "base_url": "https://openrouter.ai/api/v1/",
            "api_key": "sk-x",
            "default_model": null
        }"#;
        let saved = wizard_save(&dir, payload).unwrap();
        assert_eq!(saved.base_url, "https://openrouter.ai/api/v1");
    }
}
