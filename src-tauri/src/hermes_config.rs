//! Read/write integration with `~/.hermes/config.yaml`.
//!
//! We care only about the `model` section (which LLM the Hermes agent is
//! using under the hood). Everything else in that file is preserved as
//! opaque YAML — we round-trip through `serde_yaml::Value` so users can
//! keep hand-crafted fields (fallback_providers, auxiliary.*, etc.) without
//! us silently dropping them.
//!
//! **Important:** Hermes does NOT hot-reload `config.yaml`. Changes to the
//! model section take effect only after `hermes gateway restart`. Surfacing
//! that to the user is the frontend's job.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::changelog;
use crate::fs_atomic;

const HERMES_DIR: &str = ".hermes";
const CONFIG_FILE: &str = "config.yaml";
const ENV_FILE: &str = ".env";

/// The subset of Hermes config we understand + expose in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HermesModelSection {
    /// Model id (e.g. `deepseek-reasoner`).
    #[serde(default)]
    pub default: Option<String>,
    /// Provider slug (e.g. `deepseek`, `openai`, `anthropic`, `openrouter`).
    #[serde(default)]
    pub provider: Option<String>,
    /// Optional base URL override — for OpenAI-compatible custom endpoints.
    #[serde(default)]
    pub base_url: Option<String>,
}

/// Aggregated view for the LLMs page.
#[derive(Debug, Clone, Serialize)]
pub struct HermesConfigView {
    /// Absolute path we read from, for display + error messages.
    pub config_path: String,
    /// `true` if the file existed and was parseable.
    pub present: bool,
    /// Current `model.*` values.
    pub model: HermesModelSection,
    /// API-key env vars detected in `~/.hermes/.env`. We return the KEY NAMES
    /// only, never the values — so the UI can show "DEEPSEEK_API_KEY ✓ set"
    /// without exposing secrets over IPC.
    pub env_keys_present: Vec<String>,
}

/// Resolve `~/.hermes/`. Pure std, no `dirs` crate needed.
fn hermes_dir() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "$HOME not set"))?;
    Ok(PathBuf::from(home).join(HERMES_DIR))
}

fn config_path() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(CONFIG_FILE))
}

fn env_path() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(ENV_FILE))
}

/// Full snapshot suitable for the UI.
pub fn read_view() -> io::Result<HermesConfigView> {
    let config_path = config_path()?;
    let path_str = config_path.to_string_lossy().to_string();

    let (present, model) = match fs::read_to_string(&config_path) {
        Ok(raw) => {
            let root: Value = serde_yaml::from_str(&raw).unwrap_or(Value::Null);
            let model = extract_model(&root);
            (true, model)
        }
        Err(_) => (false, HermesModelSection::default()),
    };

    let env_keys_present = read_env_key_names().unwrap_or_default();

    Ok(HermesConfigView {
        config_path: path_str,
        present,
        model,
        env_keys_present,
    })
}

fn extract_model(root: &Value) -> HermesModelSection {
    let Some(map) = root.as_mapping() else {
        return HermesModelSection::default();
    };
    let Some(model) = map
        .get(Value::String("model".into()))
        .and_then(|v| v.as_mapping())
    else {
        return HermesModelSection::default();
    };
    HermesModelSection {
        default: model
            .get(Value::String("default".into()))
            .and_then(Value::as_str)
            .map(str::to_owned),
        provider: model
            .get(Value::String("provider".into()))
            .and_then(Value::as_str)
            .map(str::to_owned),
        base_url: model
            .get(Value::String("base_url".into()))
            .and_then(Value::as_str)
            .map(str::to_owned),
    }
}

/// Write just the `model` subsection. All other fields in the YAML are
/// preserved verbatim. Missing or empty string fields are REMOVED from the
/// YAML (so `base_url: ""` doesn't stay polluting the file after the user
/// clears it).
///
/// `journal_path`, when provided, receives one `hermes.config.model` entry
/// with the before/after model sections. Pass `None` in contexts where a
/// journal isn't available (tests, early boot).
pub fn write_model(new_model: &HermesModelSection, journal_path: Option<&Path>) -> io::Result<()> {
    let config_path = config_path()?;
    let raw = fs::read_to_string(&config_path).unwrap_or_default();

    // Capture before-state for the journal entry (cheap; small mapping).
    let before_model = if raw.trim().is_empty() {
        HermesModelSection::default()
    } else {
        serde_yaml::from_str::<Value>(&raw)
            .map(|v| extract_model(&v))
            .unwrap_or_default()
    };

    let mut root: Value = if raw.trim().is_empty() {
        Value::Mapping(Mapping::new())
    } else {
        serde_yaml::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    };

    // Ensure root is a mapping (Hermes config always is).
    if !matches!(root, Value::Mapping(_)) {
        root = Value::Mapping(Mapping::new());
    }

    let root_map = root.as_mapping_mut().expect("root is mapping");
    let model_key = Value::String("model".into());

    let mut model_map = root_map
        .get(model_key.clone())
        .and_then(Value::as_mapping)
        .cloned()
        .unwrap_or_else(Mapping::new);

    set_or_remove(&mut model_map, "default", new_model.default.as_deref());
    set_or_remove(&mut model_map, "provider", new_model.provider.as_deref());
    set_or_remove(&mut model_map, "base_url", new_model.base_url.as_deref());

    root_map.insert(model_key, Value::Mapping(model_map));

    let serialized =
        serde_yaml::to_string(&root).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs_atomic::atomic_write(&config_path, serialized.as_bytes(), None)?;

    if let Some(jp) = journal_path {
        let summary = summarize_model_diff(&before_model, new_model);
        let _ = changelog::append(
            jp,
            "hermes.config.model",
            Some(serde_json::to_value(&before_model).unwrap_or(serde_json::Value::Null)),
            Some(serde_json::to_value(new_model).unwrap_or(serde_json::Value::Null)),
            summary,
        );
    }
    Ok(())
}

fn summarize_model_diff(before: &HermesModelSection, after: &HermesModelSection) -> String {
    let mut parts = Vec::new();
    if before.default != after.default {
        parts.push(format!(
            "default: {} → {}",
            before.default.as_deref().unwrap_or("∅"),
            after.default.as_deref().unwrap_or("∅")
        ));
    }
    if before.provider != after.provider {
        parts.push(format!(
            "provider: {} → {}",
            before.provider.as_deref().unwrap_or("∅"),
            after.provider.as_deref().unwrap_or("∅")
        ));
    }
    if before.base_url != after.base_url {
        parts.push(format!(
            "base_url: {} → {}",
            before.base_url.as_deref().unwrap_or("∅"),
            after.base_url.as_deref().unwrap_or("∅")
        ));
    }
    if parts.is_empty() {
        "no-op".to_string()
    } else {
        parts.join(", ")
    }
}

fn set_or_remove(map: &mut Mapping, key: &str, value: Option<&str>) {
    let k = Value::String(key.into());
    match value {
        Some(v) if !v.is_empty() => {
            map.insert(k, Value::String(v.to_string()));
        }
        _ => {
            map.remove(k);
        }
    }
}

/// Read the raw value of a single `*_API_KEY` from `~/.hermes/.env`.
///
/// Returns `Ok(None)` if the file is missing, the key is absent, or the
/// value is empty. Values never leave the process unless the caller (a
/// Rust-side consumer) explicitly forwards them — the IPC boundary only
/// ever surfaces derived booleans (`env_keys_present`).
pub fn read_env_value(key: &str) -> io::Result<Option<String>> {
    if !is_allowed_env_key(key) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("refusing to read non-API-key env var: {key}"),
        ));
    }
    let path = env_path()?;
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    for line in raw.lines() {
        if !line_matches_key(line, key) {
            continue;
        }
        let Some((_, value)) = line.split_once('=') else {
            continue;
        };
        let val = value.trim().trim_matches('"').trim_matches('\'');
        if val.is_empty() {
            return Ok(None);
        }
        return Ok(Some(val.to_string()));
    }
    Ok(None)
}

/// Parse `.env` and return the KEYS of any `*_API_KEY=nonempty` lines.
/// We deliberately drop the values — the UI never needs them, and passing
/// secrets over IPC is an anti-pattern.
fn read_env_key_names() -> io::Result<Vec<String>> {
    let path = env_path()?;
    let raw = fs::read_to_string(&path)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            if !key.ends_with("_API_KEY") {
                continue;
            }
            // Treat unquoted empty and pure whitespace as unset.
            let val = value.trim().trim_matches('"').trim_matches('\'');
            if !val.is_empty() {
                out.push(key.to_string());
            }
        }
    }
    Ok(out)
}

/// Upsert or delete a key in `~/.hermes/.env`, preserving every other line
/// (comments, blanks, order). If `value` is `None` or empty, the existing
/// line is removed. If the key doesn't exist yet, it's appended at the end.
///
/// Only `*_API_KEY` names are permitted to avoid accidental corruption of
/// non-secret config via this endpoint.
pub fn write_env_key(
    key: &str,
    value: Option<&str>,
    journal_path: Option<&Path>,
) -> io::Result<()> {
    if !is_allowed_env_key(key) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("refusing to write non-API-key env var: {key}"),
        ));
    }

    let path = env_path()?;
    let raw = fs::read_to_string(&path).unwrap_or_default();
    let was_present = raw.lines().any(|l| line_matches_key(l, key));

    let mut out = String::with_capacity(raw.len() + 64);
    let mut found = false;
    let should_delete = value.map(str::is_empty).unwrap_or(true);
    let target_value = value.unwrap_or("");

    for line in raw.lines() {
        if line_matches_key(line, key) {
            found = true;
            if !should_delete {
                out.push_str(key);
                out.push('=');
                out.push_str(target_value);
                out.push('\n');
            }
            // else: skip, effectively deleting the line
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }

    while out.ends_with("\n\n") {
        out.pop();
    }

    if !found && !should_delete {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(key);
        out.push('=');
        out.push_str(target_value);
        out.push('\n');
    }

    // 0o600 so api keys are owner-only. `atomic_write` applies perms to the
    // tmp file BEFORE rename, closing the window where the final file briefly
    // had default perms.
    fs_atomic::atomic_write(&path, out.as_bytes(), Some(0o600))?;

    if let Some(jp) = journal_path {
        let summary = if should_delete {
            format!("env: -{key}")
        } else if was_present {
            format!("env: {key} (updated)")
        } else {
            format!("env: +{key}")
        };
        // before/after record PRESENCE only — never secret values.
        let _ = changelog::append(
            jp,
            "hermes.env.key",
            Some(serde_json::json!({ "key": key, "present": was_present })),
            Some(serde_json::json!({ "key": key, "present": !should_delete })),
            summary,
        );
    }
    Ok(())
}

/// Write a set of YAML fields into `~/.hermes/config.yaml` under a
/// dotted root (e.g. `channels.telegram`). Missing intermediate
/// mappings are created; every other field in the document is
/// preserved verbatim.
///
/// `updates` is keyed by dotted path RELATIVE to `root`; values are
/// JSON (from the IPC layer) and are round-tripped through
/// `serde_yaml::Value` so YAML-native types (sequences, nested
/// mappings) survive unchanged.
///
/// A JSON `null` deletes the field (and removes now-empty ancestor
/// mappings up to but not including `root` itself).
///
/// Phase 3 · T3.2 — the write counterpart to the read-only walker in
/// `ipc::channels::walk_dotted`.
pub fn write_channel_yaml_fields(
    root: &str,
    updates: &std::collections::HashMap<String, serde_json::Value>,
    journal_path: Option<&Path>,
) -> io::Result<()> {
    if updates.is_empty() {
        return Ok(());
    }

    let config_path = config_path()?;
    let raw = fs::read_to_string(&config_path).unwrap_or_default();

    let mut doc: Value = if raw.trim().is_empty() {
        Value::Mapping(Mapping::new())
    } else {
        serde_yaml::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    };
    if !matches!(doc, Value::Mapping(_)) {
        doc = Value::Mapping(Mapping::new());
    }

    // Capture before-state for the journal: one mapping keyed by
    // relative path, values serialized to JSON for diff display.
    let mut before = serde_json::Map::new();
    let mut after = serde_json::Map::new();
    for (rel_path, new_val) in updates {
        let full = if root.is_empty() {
            rel_path.clone()
        } else {
            format!("{}.{}", root, rel_path)
        };
        let prev = walk_get(&doc, &full).cloned();
        before.insert(
            rel_path.clone(),
            prev.map(yaml_to_json_value)
                .unwrap_or(serde_json::Value::Null),
        );
        after.insert(rel_path.clone(), new_val.clone());

        let yaml_val = json_to_yaml_value(new_val);
        if matches!(yaml_val, Value::Null) {
            walk_remove(&mut doc, &full);
        } else {
            walk_set(&mut doc, &full, yaml_val);
        }
    }

    let serialized =
        serde_yaml::to_string(&doc).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs_atomic::atomic_write(&config_path, serialized.as_bytes(), None)?;

    if let Some(jp) = journal_path {
        let summary = format!("channel yaml: {} ({} field(s))", root, updates.len());
        let _ = changelog::append(
            jp,
            "hermes.channel.yaml",
            Some(serde_json::json!({ "root": root, "fields": before })),
            Some(serde_json::json!({ "root": root, "fields": after })),
            summary,
        );
    }
    Ok(())
}

fn walk_get<'a>(doc: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = doc;
    for seg in path.split('.') {
        cur = cur.as_mapping()?.get(Value::String(seg.into()))?;
    }
    Some(cur)
}

fn walk_set(doc: &mut Value, path: &str, value: Value) {
    let segs: Vec<&str> = path.split('.').collect();
    if segs.is_empty() {
        return;
    }
    // Ensure every intermediate level is a mapping.
    let mut cur: &mut Value = doc;
    for seg in &segs[..segs.len() - 1] {
        if !matches!(cur, Value::Mapping(_)) {
            *cur = Value::Mapping(Mapping::new());
        }
        let map = cur.as_mapping_mut().expect("is mapping");
        let key = Value::String((*seg).into());
        if !matches!(map.get(&key), Some(Value::Mapping(_))) {
            map.insert(key.clone(), Value::Mapping(Mapping::new()));
        }
        cur = map.get_mut(&key).expect("just inserted");
    }
    if !matches!(cur, Value::Mapping(_)) {
        *cur = Value::Mapping(Mapping::new());
    }
    let map = cur.as_mapping_mut().expect("is mapping");
    map.insert(Value::String((*segs.last().unwrap()).to_string()), value);
}

fn walk_remove(doc: &mut Value, path: &str) {
    let segs: Vec<&str> = path.split('.').collect();
    if segs.is_empty() {
        return;
    }
    let mut cur = doc;
    for seg in &segs[..segs.len() - 1] {
        let Some(map) = cur.as_mapping_mut() else {
            return;
        };
        let key = Value::String((*seg).into());
        let Some(next) = map.get_mut(&key) else {
            return;
        };
        cur = next;
    }
    if let Some(map) = cur.as_mapping_mut() {
        map.remove(Value::String(segs.last().unwrap().to_string()));
    }
}

/// YAML → JSON (mirror of `ipc::channels::yaml_to_json` but local —
/// avoid a crate-internal import cycle).
fn yaml_to_json_value(v: Value) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Bool(b) => serde_json::Value::Bool(b),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                serde_json::Value::from(u)
            } else if let Some(i) = n.as_i64() {
                serde_json::Value::from(i)
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        Value::String(s) => serde_json::Value::String(s),
        Value::Sequence(seq) => {
            serde_json::Value::Array(seq.into_iter().map(yaml_to_json_value).collect())
        }
        Value::Mapping(m) => {
            let mut o = serde_json::Map::new();
            for (k, v) in m {
                if let Value::String(sk) = k {
                    o.insert(sk, yaml_to_json_value(v));
                }
            }
            serde_json::Value::Object(o)
        }
        Value::Tagged(t) => yaml_to_json_value(t.value),
    }
}

/// JSON → YAML. Numbers round-trip via serde_yaml's own conversion
/// so int/float distinction is preserved.
fn json_to_yaml_value(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(i.into())
            } else if let Some(u) = n.as_u64() {
                Value::Number(u.into())
            } else if let Some(f) = n.as_f64() {
                Value::Number(f.into())
            } else {
                Value::Null
            }
        }
        serde_json::Value::String(s) => Value::String(s.clone()),
        serde_json::Value::Array(arr) => {
            Value::Sequence(arr.iter().map(json_to_yaml_value).collect())
        }
        serde_json::Value::Object(o) => {
            let mut m = Mapping::new();
            for (k, v) in o {
                m.insert(Value::String(k.clone()), json_to_yaml_value(v));
            }
            Value::Mapping(m)
        }
    }
}

fn is_allowed_env_key(key: &str) -> bool {
    if key.is_empty() {
        return false;
    }
    let shape_ok = key
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    if !shape_ok {
        return false;
    }
    // Original rule: any `*_API_KEY` name (model providers — Phase 2).
    if key.ends_with("_API_KEY") {
        return true;
    }
    // Phase 3: any env name declared by a channel spec. Keeps the
    // allowlist tight — we never let the UI write arbitrary env vars.
    crate::channels::allowed_channel_env_keys()
        .iter()
        .any(|s| s == key)
}

/// Returns `true` when `line` (after trimming leading whitespace, ignoring
/// comments) assigns `key`. Handles `  KEY=value`, `KEY =value`, etc.
fn line_matches_key(line: &str, key: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with('#') {
        return false;
    }
    let Some(eq) = trimmed.find('=') else {
        return false;
    };
    trimmed[..eq].trim() == key
}

/// Shell out to `hermes gateway restart`. Tries `$PATH` first, then falls back
/// to `~/.local/bin/hermes` (where Hermes installs by default on macOS). The
/// command is synchronous — callers should run this off the Tokio runtime's
/// main thread (i.e. via `spawn_blocking` or in an async IPC handler).
pub fn gateway_restart() -> io::Result<String> {
    let binary = resolve_hermes_binary()?;
    let output = std::process::Command::new(&binary)
        .args(["gateway", "restart"])
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Err(io::Error::other(format!(
            "hermes gateway restart failed (status {:?}): {}{}",
            output.status.code(),
            stderr,
            stdout
        )));
    }
    Ok(if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    })
}

fn resolve_hermes_binary() -> io::Result<PathBuf> {
    // 1) $PATH lookup. `which` is portable but we avoid spawning; just walk.
    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join("hermes");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // 2) Fallback to the canonical install path.
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(home).join(".local/bin/hermes");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "hermes CLI not found in $PATH or ~/.local/bin/. Install Hermes or add it to PATH.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_model_parses_standard_layout() {
        let yaml = r#"
model:
  default: deepseek-reasoner
  provider: deepseek
  base_url: https://api.deepseek.com/v1
unrelated: keep_me
"#;
        let root: Value = serde_yaml::from_str(yaml).unwrap();
        let m = extract_model(&root);
        assert_eq!(m.default.as_deref(), Some("deepseek-reasoner"));
        assert_eq!(m.provider.as_deref(), Some("deepseek"));
        assert_eq!(m.base_url.as_deref(), Some("https://api.deepseek.com/v1"));
    }

    #[test]
    fn set_or_remove_clears_empty() {
        let k = || Value::String("k".into());
        let mut m = Mapping::new();
        m.insert(k(), Value::String("old".into()));
        set_or_remove(&mut m, "k", None);
        assert!(m.get(k()).is_none());

        set_or_remove(&mut m, "k", Some("new"));
        assert_eq!(m.get(k()).and_then(Value::as_str), Some("new"));

        set_or_remove(&mut m, "k", Some(""));
        assert!(m.get(k()).is_none());
    }

    #[test]
    fn env_keys_only_returns_nonempty_api_keys() {
        // Write a fake .env into a temp HOME.
        let tmp = std::env::temp_dir().join(format!("caduceus-hermes-env-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join(".hermes")).unwrap();
        let env_file = tmp.join(".hermes/.env");
        std::fs::write(
            &env_file,
            r#"
# comment
DEEPSEEK_API_KEY=sk-abc
OPENAI_API_KEY=
ANTHROPIC_API_KEY="sk-xyz"
NOT_A_KEY=hello
"#,
        )
        .unwrap();

        // Temporarily point HOME at our tempdir.
        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &tmp);

        let keys = read_env_key_names().unwrap();
        assert!(keys.contains(&"DEEPSEEK_API_KEY".to_string()));
        assert!(keys.contains(&"ANTHROPIC_API_KEY".to_string()));
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"NOT_A_KEY".to_string()));

        // Restore.
        if let Some(v) = original_home {
            std::env::set_var("HOME", v);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    fn is_allowed_env_key_gates_non_api_keys() {
        assert!(is_allowed_env_key("OPENAI_API_KEY"));
        assert!(is_allowed_env_key("FOO_BAR_API_KEY"));
        assert!(!is_allowed_env_key("OPENAI_KEY"));
        assert!(!is_allowed_env_key("API_SERVER_ENABLED"));
        assert!(!is_allowed_env_key("openai_api_key")); // lowercase rejected
        assert!(!is_allowed_env_key(""));
        assert!(!is_allowed_env_key("EVIL $() _API_KEY"));
    }

    #[test]
    fn walk_set_creates_missing_intermediate_mappings() {
        let mut doc = Value::Mapping(Mapping::new());
        walk_set(
            &mut doc,
            "channels.telegram.mention_required",
            Value::Bool(true),
        );
        walk_set(&mut doc, "channels.telegram.reactions", Value::Bool(false));

        let telegram = doc
            .as_mapping()
            .unwrap()
            .get(Value::String("channels".into()))
            .unwrap()
            .as_mapping()
            .unwrap()
            .get(Value::String("telegram".into()))
            .unwrap()
            .as_mapping()
            .unwrap();
        assert_eq!(
            telegram.get(Value::String("mention_required".into())),
            Some(&Value::Bool(true)),
        );
        assert_eq!(
            telegram.get(Value::String("reactions".into())),
            Some(&Value::Bool(false)),
        );
    }

    #[test]
    fn walk_remove_clears_leaf_without_touching_siblings() {
        let mut doc: Value = serde_yaml::from_str(
            "channels:\n  telegram:\n    mention_required: true\n    reactions: false\n",
        )
        .unwrap();
        walk_remove(&mut doc, "channels.telegram.reactions");
        let telegram = doc
            .as_mapping()
            .unwrap()
            .get(Value::String("channels".into()))
            .unwrap()
            .as_mapping()
            .unwrap()
            .get(Value::String("telegram".into()))
            .unwrap()
            .as_mapping()
            .unwrap();
        assert!(telegram.get(Value::String("reactions".into())).is_none());
        assert_eq!(
            telegram.get(Value::String("mention_required".into())),
            Some(&Value::Bool(true)),
        );
    }

    #[test]
    fn json_to_yaml_preserves_scalars_lists_and_nested_objects() {
        let j = serde_json::json!({
            "a": true,
            "b": 42,
            "c": "hi",
            "d": [1, "two", false],
            "e": { "nested": "ok" }
        });
        let y = json_to_yaml_value(&j);
        let m = y.as_mapping().unwrap();
        assert_eq!(m.get(Value::String("a".into())), Some(&Value::Bool(true)));
        assert_eq!(
            m.get(Value::String("c".into())).and_then(Value::as_str),
            Some("hi"),
        );
        let d = m
            .get(Value::String("d".into()))
            .unwrap()
            .as_sequence()
            .unwrap();
        assert_eq!(d.len(), 3);
    }

    #[test]
    fn write_channel_yaml_fields_round_trips_through_disk() {
        let tmp = std::env::temp_dir().join(format!(
            "caduceus-hermes-yaml-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir_all(tmp.join(".hermes")).unwrap();
        // Seed a yaml file with an unrelated field so we can assert it survives.
        std::fs::write(
            tmp.join(".hermes/config.yaml"),
            "model:\n  default: gpt-4o\n",
        )
        .unwrap();

        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &tmp);

        let mut updates = std::collections::HashMap::new();
        updates.insert("mention_required".to_string(), serde_json::json!(true));
        updates.insert("free_chats".to_string(), serde_json::json!(["one", "two"]));
        write_channel_yaml_fields("channels.telegram", &updates, None).unwrap();

        let raw = std::fs::read_to_string(tmp.join(".hermes/config.yaml")).unwrap();
        let parsed: Value = serde_yaml::from_str(&raw).unwrap();
        let tg = parsed
            .as_mapping()
            .unwrap()
            .get(Value::String("channels".into()))
            .unwrap()
            .as_mapping()
            .unwrap()
            .get(Value::String("telegram".into()))
            .unwrap()
            .as_mapping()
            .unwrap();
        assert_eq!(
            tg.get(Value::String("mention_required".into())),
            Some(&Value::Bool(true)),
        );
        let fc = tg.get(Value::String("free_chats".into())).unwrap();
        assert_eq!(fc.as_sequence().unwrap().len(), 2);
        // unrelated field survives
        assert!(parsed
            .as_mapping()
            .unwrap()
            .get(Value::String("model".into()))
            .is_some());

        // Delete semantic: JSON null removes the field.
        let mut del = std::collections::HashMap::new();
        del.insert("mention_required".to_string(), serde_json::Value::Null);
        write_channel_yaml_fields("channels.telegram", &del, None).unwrap();
        let raw2 = std::fs::read_to_string(tmp.join(".hermes/config.yaml")).unwrap();
        let parsed2: Value = serde_yaml::from_str(&raw2).unwrap();
        let tg2 = parsed2
            .as_mapping()
            .unwrap()
            .get(Value::String("channels".into()))
            .unwrap()
            .as_mapping()
            .unwrap()
            .get(Value::String("telegram".into()))
            .unwrap()
            .as_mapping()
            .unwrap();
        assert!(tg2.get(Value::String("mention_required".into())).is_none());

        if let Some(v) = original_home {
            std::env::set_var("HOME", v);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    fn line_matches_key_handles_whitespace_and_comments() {
        assert!(line_matches_key("OPENAI_API_KEY=sk-x", "OPENAI_API_KEY"));
        assert!(line_matches_key("  OPENAI_API_KEY=sk-x", "OPENAI_API_KEY"));
        assert!(line_matches_key("OPENAI_API_KEY =sk-x", "OPENAI_API_KEY"));
        assert!(!line_matches_key("# OPENAI_API_KEY=sk-x", "OPENAI_API_KEY"));
        assert!(!line_matches_key(
            "OPENAI_API_KEY_V2=sk-x",
            "OPENAI_API_KEY"
        ));
        assert!(!line_matches_key("other line", "OPENAI_API_KEY"));
    }
}
