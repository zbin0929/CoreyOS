//! T6.4 — rules-based routing.
//!
//! Persists a user-ordered list of "if the composed text matches X,
//! send the turn to adapter Y" rules to
//! `<app_config_dir>/routing_rules.json`. The backend is pure file
//! I/O — the resolver itself lives on the frontend so it runs on
//! every composer keystroke without an IPC roundtrip (see
//! `src/features/chat/routing.ts`).
//!
//! Why JSON not SQLite: the list is small (< 100 rows in any realistic
//! install), never joined, edited as a whole from one Settings panel,
//! and benefits from being human-diffable in the config dir. Matches
//! the T6.2 (`hermes_instances.json`) / T6.8 (`hermes_cron/jobs.json`)
//! precedent.
//!
//! File shape:
//! ```json
//! {
//!   "rules": [
//!     {
//!       "id": "code-prefix",
//!       "name": "Code prefix → Claude Code",
//!       "enabled": true,
//!       "match": { "kind": "prefix", "value": "/code ", "case_sensitive": false },
//!       "target_adapter_id": "claude_code"
//!     }
//!   ]
//! }
//! ```
//!
//! Evaluation order is the order in the file. First enabled match wins.
//! A pure rearrange at the IPC layer (via upsert-to-top or a future
//! reorder command) is how users change priority.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "routing_rules.json";

/// Match predicate on the composed text. Keep this enum small — every
/// variant is a potential footgun if users can write their own regex.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RoutingMatch {
    /// `text.trim_start().starts_with(value)` (after the case toggle).
    /// The common case — `/code `, `/translate `, `:ask` etc.
    Prefix {
        value: String,
        #[serde(default)]
        case_sensitive: bool,
    },
    /// `text.contains(value)`. Useful for keyword hints inside long
    /// prompts (e.g. "refactor" → code adapter).
    Contains {
        value: String,
        #[serde(default)]
        case_sensitive: bool,
    },
    /// Regex anchored by the user — we don't auto-anchor. Compiled
    /// per-evaluation by the frontend (Rust backend never executes it
    /// so there's no RE2 / catastrophic-backtracking risk on this side).
    Regex {
        value: String,
        #[serde(default)]
        case_sensitive: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutingRule {
    /// Stable slug, 1..64 chars of `[a-z0-9_-]`. Frozen after save so
    /// the rule's referents (history, changelog entries) don't break
    /// on rename. Users change the human-readable `name` instead.
    pub id: String,
    /// Display label shown in Settings + the Composer pill.
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(rename = "match")]
    pub match_: RoutingMatch,
    /// Registry key (e.g. `"hermes"`, `"hermes:work"`, `"claude_code"`).
    /// We don't validate it exists at save time — the user may register
    /// the target instance later. The frontend resolver just returns
    /// `None` for a rule pointing at a missing adapter, and the UI
    /// surfaces it as a warning.
    pub target_adapter_id: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RoutingRulesFile {
    #[serde(default)]
    pub rules: Vec<RoutingRule>,
}

pub fn file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// Missing → empty. Corrupt → logged + empty (same tolerance as T6.2).
pub fn load(config_dir: &Path) -> Vec<RoutingRule> {
    let path = file_path(config_dir);
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<RoutingRulesFile>(&raw) {
            Ok(f) => f.rules,
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "routing_rules.json parse failed — treating as empty",
                );
                Vec::new()
            }
        },
        Err(_) => Vec::new(),
    }
}

pub fn save(config_dir: &Path, rules: &[RoutingRule]) -> io::Result<PathBuf> {
    fs::create_dir_all(config_dir)?;
    let file = RoutingRulesFile {
        rules: rules.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let final_path = file_path(config_dir);
    let tmp_path = config_dir.join(format!("{FILE_NAME}.tmp"));
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &final_path)?;
    Ok(final_path)
}

pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("id cannot be empty".into());
    }
    if id.len() > 64 {
        return Err("id must be ≤ 64 characters".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err("id may only contain lowercase letters, digits, '-' or '_'".into());
    }
    Ok(())
}

pub fn validate_match(m: &RoutingMatch) -> Result<(), String> {
    match m {
        RoutingMatch::Prefix { value, .. } | RoutingMatch::Contains { value, .. } => {
            if value.is_empty() {
                return Err("match value cannot be empty".into());
            }
        }
        RoutingMatch::Regex { value, .. } => {
            if value.is_empty() {
                return Err("regex pattern cannot be empty".into());
            }
            // The backend does not execute the regex — pattern shape
            // errors surface on the frontend at resolve-time. Still,
            // we reject patterns that are obviously nonsense so a save
            // can't land something that will never match.
            if value.len() > 512 {
                return Err("regex pattern must be ≤ 512 characters".into());
            }
        }
    }
    Ok(())
}

pub fn upsert(mut list: Vec<RoutingRule>, incoming: RoutingRule) -> Vec<RoutingRule> {
    if let Some(slot) = list.iter_mut().find(|r| r.id == incoming.id) {
        *slot = incoming;
    } else {
        list.push(incoming);
    }
    list
}

pub fn delete(list: Vec<RoutingRule>, id: &str) -> (Vec<RoutingRule>, bool) {
    let before = list.len();
    let list: Vec<RoutingRule> = list.into_iter().filter(|r| r.id != id).collect();
    let removed = list.len() != before;
    (list, removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmpdir() -> PathBuf {
        let base = env::temp_dir().join(format!(
            "caduceus-routing-rules-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn load_missing_returns_empty() {
        assert!(load(&tmpdir()).is_empty());
    }

    #[test]
    fn save_then_load_roundtrips_all_variants() {
        let dir = tmpdir();
        let rules = vec![
            RoutingRule {
                id: "code".into(),
                name: "Code prefix".into(),
                enabled: true,
                match_: RoutingMatch::Prefix {
                    value: "/code ".into(),
                    case_sensitive: false,
                },
                target_adapter_id: "claude_code".into(),
            },
            RoutingRule {
                id: "kw".into(),
                name: "Refactor keyword".into(),
                enabled: false,
                match_: RoutingMatch::Contains {
                    value: "refactor".into(),
                    case_sensitive: false,
                },
                target_adapter_id: "aider".into(),
            },
            RoutingRule {
                id: "re".into(),
                name: "Regex route".into(),
                enabled: true,
                match_: RoutingMatch::Regex {
                    value: "^\\d{4}-\\d{2}-\\d{2}".into(),
                    case_sensitive: true,
                },
                target_adapter_id: "hermes:work".into(),
            },
        ];
        save(&dir, &rules).unwrap();
        assert_eq!(load(&dir), rules);
    }

    #[test]
    fn load_tolerates_corrupt_file() {
        let dir = tmpdir();
        fs::write(file_path(&dir), "not { json").unwrap();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn validate_id_rules() {
        assert!(validate_id("code").is_ok());
        assert!(validate_id("code-prefix_01").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id("Code").is_err());
        assert!(validate_id("x x").is_err());
        assert!(validate_id(&"x".repeat(65)).is_err());
    }

    #[test]
    fn validate_match_rejects_empty_values() {
        assert!(validate_match(&RoutingMatch::Prefix {
            value: "".into(),
            case_sensitive: false
        })
        .is_err());
        assert!(validate_match(&RoutingMatch::Contains {
            value: "".into(),
            case_sensitive: false
        })
        .is_err());
        assert!(validate_match(&RoutingMatch::Regex {
            value: "".into(),
            case_sensitive: false
        })
        .is_err());
        assert!(validate_match(&RoutingMatch::Prefix {
            value: "/x".into(),
            case_sensitive: false
        })
        .is_ok());
    }

    #[test]
    fn upsert_replaces_by_id_preserves_order() {
        let rules = vec![
            RoutingRule {
                id: "a".into(),
                name: "A".into(),
                enabled: true,
                match_: RoutingMatch::Prefix {
                    value: "/a".into(),
                    case_sensitive: false,
                },
                target_adapter_id: "x".into(),
            },
            RoutingRule {
                id: "b".into(),
                name: "B".into(),
                enabled: true,
                match_: RoutingMatch::Prefix {
                    value: "/b".into(),
                    case_sensitive: false,
                },
                target_adapter_id: "y".into(),
            },
        ];
        let updated = upsert(
            rules,
            RoutingRule {
                id: "a".into(),
                name: "A-renamed".into(),
                enabled: false,
                match_: RoutingMatch::Prefix {
                    value: "/aa".into(),
                    case_sensitive: true,
                },
                target_adapter_id: "z".into(),
            },
        );
        assert_eq!(updated[0].id, "a");
        assert_eq!(updated[0].name, "A-renamed");
        assert!(!updated[0].enabled);
        assert_eq!(updated[0].target_adapter_id, "z");
        assert_eq!(updated[1].id, "b");
    }

    #[test]
    fn delete_returns_removed_flag() {
        let rules = vec![RoutingRule {
            id: "a".into(),
            name: "A".into(),
            enabled: true,
            match_: RoutingMatch::Prefix {
                value: "/a".into(),
                case_sensitive: false,
            },
            target_adapter_id: "x".into(),
        }];
        let (next, removed) = delete(rules.clone(), "a");
        assert!(removed);
        assert!(next.is_empty());
        let (same, removed) = delete(rules, "missing");
        assert!(!removed);
        assert_eq!(same.len(), 1);
    }
}
