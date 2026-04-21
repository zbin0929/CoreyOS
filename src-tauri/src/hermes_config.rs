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
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

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
pub fn write_model(new_model: &HermesModelSection) -> io::Result<()> {
    let config_path = config_path()?;
    let raw = fs::read_to_string(&config_path).unwrap_or_default();
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

    // Atomic write: tmp file + rename. Preserves file perms on *nix.
    let serialized =
        serde_yaml::to_string(&root).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let tmp = config_path.with_extension("yaml.caduceus.tmp");
    fs::write(&tmp, serialized)?;
    fs::rename(&tmp, &config_path)?;
    Ok(())
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
pub fn write_env_key(key: &str, value: Option<&str>) -> io::Result<()> {
    if !is_allowed_env_key(key) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("refusing to write non-API-key env var: {key}"),
        ));
    }

    let path = env_path()?;
    let raw = fs::read_to_string(&path).unwrap_or_default();
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

    // Trim trailing newlines to avoid accumulating blanks over many edits.
    while out.ends_with("\n\n") {
        out.pop();
    }

    if !found && !should_delete {
        // Append, with a separating newline if the file didn't end with one.
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(key);
        out.push('=');
        out.push_str(target_value);
        out.push('\n');
    }

    // Atomic write via tmp + rename. Also tighten perms to 0600 on Unix
    // since this file now carries secrets.
    let tmp = path.with_extension("env.caduceus.tmp");
    fs::write(&tmp, &out)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&tmp, &path)?;
    Ok(())
}

fn is_allowed_env_key(key: &str) -> bool {
    !key.is_empty()
        && key.ends_with("_API_KEY")
        && key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
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
