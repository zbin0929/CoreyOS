//! LLM profiles — the *model* half of the agent/model split.
//!
//! Corey's original model story was "one config.yaml value, one LLM".
//! T8 rebuilds it around a richer concept: a **profile** is a named,
//! reusable bundle of `{provider, base_url, model, api_key_env}` that
//! a user can create once and then reference from multiple agents.
//!
//! Example: one `openai-gpt4o` profile plus one `openai-gpt4o-mini`
//! profile, each referenced by a different agent depending on which
//! job the user is doing (deep reasoning vs fast chat). Switching the
//! key or rotating the model id only needs an edit in one place.
//!
//! Persistence lives in `<app_config_dir>/llm_profiles.json` — a sibling
//! of `gateway.json` and `hermes_instances.json`. Ordering is preserved
//! on save so the UI renders rows in a stable order. Id rules mirror
//! [`crate::hermes_instances::validate_id`].

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Filename under `<app_config_dir>`.
const FILE_NAME: &str = "llm_profiles.json";

/// A reusable LLM configuration. Stored as-is on disk; the UI renders
/// these as rows on the LLMs page and as dropdown options in the
/// Agent Wizard.
///
/// A profile is **not** a running agent — an agent references a profile
/// by `id`. The agent is what registers with the adapter registry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmProfile {
    /// URL-safe slug, 1..32 chars of `[a-z0-9_-]`. Used as the stable
    /// key across renames. Also the value referenced by
    /// `HermesInstance.llm_profile_id`.
    pub id: String,

    /// UI-facing label. Falls back to `id` if empty on the wire.
    #[serde(default)]
    pub label: String,

    /// Provider slug — one of `openai` / `anthropic` / `deepseek` /
    /// `google` / `ollama` / `openrouter` / custom. Informational only
    /// (no validation); used to group rows + pick an icon.
    pub provider: String,

    /// OpenAI-compatible endpoint. No trailing slash; normalised on
    /// save to match behaviour of [`crate::hermes_instances`].
    pub base_url: String,

    /// Model id the provider expects (e.g. `gpt-4o`, `deepseek-chat`).
    pub model: String,

    /// Name of the `*_API_KEY` entry in `~/.hermes/.env` this profile
    /// should resolve at request time. `None` for key-less providers
    /// (Ollama, LM Studio). The raw secret never persists here —
    /// keeping it out of `llm_profiles.json` keeps the file safe to
    /// commit to dotfiles repos.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
}

/// Top-level wrapper so we can add fields later without a migration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LlmProfilesFile {
    #[serde(default)]
    pub profiles: Vec<LlmProfile>,
}

/// Resolve `<config_dir>/llm_profiles.json`.
pub fn file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// Read + parse. Missing file → empty list (no error); unparseable
/// file → logged and treated as empty so a corrupt save doesn't break
/// boot.
pub fn load(config_dir: &Path) -> Vec<LlmProfile> {
    let path = file_path(config_dir);
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<LlmProfilesFile>(&raw) {
            Ok(f) => f.profiles,
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "llm_profiles.json parse failed — treating as empty",
                );
                Vec::new()
            }
        },
        Err(_) => Vec::new(),
    }
}

/// Atomic write (`<FILE>.tmp` + rename). Caller is responsible for
/// having validated each row before this point.
pub fn save(config_dir: &Path, profiles: &[LlmProfile]) -> io::Result<PathBuf> {
    fs::create_dir_all(config_dir)?;
    let file = LlmProfilesFile {
        profiles: profiles.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let final_path = file_path(config_dir);
    let tmp_path = config_dir.join(format!("{FILE_NAME}.tmp"));
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &final_path)?;
    Ok(final_path)
}

/// Id rules mirror `hermes_instances::validate_id` so the same
/// frontend affordances apply to both entities.
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

/// `http(s)://…` + non-empty. Same bar as the rest of the codebase.
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

/// Model id must be non-empty. Provider-specific validation (e.g.
/// OpenAI's "no dots") is intentionally skipped — the user knows the
/// shape their upstream expects and we'd be wrong too often.
pub fn validate_model(model: &str) -> Result<(), String> {
    if model.trim().is_empty() {
        return Err("model cannot be empty".into());
    }
    Ok(())
}

/// Upsert (match on `id`). Returns the updated list without mutating
/// the input slice; caller persists via `save`.
pub fn upsert(mut list: Vec<LlmProfile>, incoming: LlmProfile) -> Vec<LlmProfile> {
    if let Some(slot) = list.iter_mut().find(|p| p.id == incoming.id) {
        *slot = incoming;
    } else {
        list.push(incoming);
    }
    list
}

/// Remove by id. Returns the new list and whether a row was dropped.
pub fn delete(list: Vec<LlmProfile>, id: &str) -> (Vec<LlmProfile>, bool) {
    let before = list.len();
    let list: Vec<LlmProfile> = list.into_iter().filter(|p| p.id != id).collect();
    let removed = list.len() != before;
    (list, removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmpdir() -> PathBuf {
        let base = env::temp_dir().join(format!(
            "caduceus-llm-profiles-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn sample() -> LlmProfile {
        LlmProfile {
            id: "openai-gpt4o".into(),
            label: "OpenAI GPT-4o".into(),
            provider: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o".into(),
            api_key_env: Some("OPENAI_API_KEY".into()),
        }
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
            sample(),
            LlmProfile {
                id: "ollama-llama".into(),
                label: "Ollama / Llama 3.2".into(),
                provider: "ollama".into(),
                base_url: "http://localhost:11434/v1".into(),
                model: "llama3.2".into(),
                api_key_env: None,
            },
        ];
        save(&dir, &list).unwrap();
        assert_eq!(load(&dir), list);
    }

    #[test]
    fn load_returns_empty_on_corrupt_file() {
        let dir = tmpdir();
        fs::write(file_path(&dir), "{not json").unwrap();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn validate_id_matches_hermes_instances_rules() {
        assert!(validate_id("openai").is_ok());
        assert!(validate_id("gpt-4o").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id("OpenAI").is_err());
        assert!(validate_id("has space").is_err());
        assert!(validate_id(&"x".repeat(33)).is_err());
    }

    #[test]
    fn validate_base_url_requires_scheme() {
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("https://api.openai.com/v1").is_ok());
        assert!(validate_base_url("").is_err());
        assert!(validate_base_url("api.openai.com").is_err());
    }

    #[test]
    fn validate_model_requires_nonempty() {
        assert!(validate_model("gpt-4o").is_ok());
        assert!(validate_model("").is_err());
        assert!(validate_model("   ").is_err());
    }

    #[test]
    fn upsert_replaces_by_id() {
        let base = vec![sample()];
        let mut changed = sample();
        changed.label = "OpenAI GPT-4o (updated)".into();
        changed.model = "gpt-4o-2024-11-20".into();
        let next = upsert(base, changed.clone());
        assert_eq!(next.len(), 1);
        assert_eq!(next[0], changed);
    }

    #[test]
    fn upsert_appends_new_id() {
        let base = vec![sample()];
        let new = LlmProfile {
            id: "claude".into(),
            label: "Claude Sonnet".into(),
            provider: "anthropic".into(),
            base_url: "https://api.anthropic.com/v1".into(),
            model: "claude-3-5-sonnet-latest".into(),
            api_key_env: Some("ANTHROPIC_API_KEY".into()),
        };
        let next = upsert(base, new.clone());
        assert_eq!(next.len(), 2);
        assert_eq!(next[1], new);
    }

    #[test]
    fn delete_removes_by_id_reporting_result() {
        let base = vec![sample()];
        let (after, removed) = delete(base.clone(), "openai-gpt4o");
        assert!(removed);
        assert!(after.is_empty());

        let (same, removed) = delete(base, "nope");
        assert!(!removed);
        assert_eq!(same.len(), 1);
    }
}
