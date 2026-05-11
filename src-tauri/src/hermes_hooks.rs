//! Corey ↔ Hermes pre_tool_call hook management.
//!
//! Ensures Corey's hard-guard Python script (``file-ops-guard.py``) is
//! installed under ``~/.hermes/corey-guards/`` and registered in the
//! ``hooks.pre_tool_call`` list of ``~/.hermes/config.yaml``. Without
//! registration the script sits dormant on disk; Hermes only spawns
//! scripts that are in the config block.
//!
//! # Why this exists (2026-05-11 incident)
//!
//! We shipped the guard script to a customer machine manually months
//! ago but never automated registration. The LLM ran
//! ``python -c "os.remove('~/Desktop/test.md')"`` and the file was
//! deleted — Hermes' DANGEROUS_PATTERNS caught the shell ``rm`` form
//! but the code-execution bypass sailed through because our guard,
//! which DOES know how to block ``os.remove`` inside ``code_execution``
//! tool calls, was never registered.
//!
//! Root cause: ``~/.hermes/config.yaml`` had
//! ``hooks.pre_tool_call: '[]'`` (a YAML *string*, not a list). Hermes'
//! ``_parse_hooks_block`` in ``agent/shell_hooks.py`` checks
//! ``isinstance(entries, list)`` and warn-and-skips on the string
//! form — so the hook chain was empty for every tool call.
//!
//! This module fixes it end-to-end:
//!
//! 1. ``seed_guards_script`` — copies the bundled ``file-ops-guard.py``
//!    (sourced from ``src-tauri/assets/corey-guards/`` via
//!    ``include_str!``) to ``~/.hermes/corey-guards/file-ops-guard.py``
//!    on every Corey boot, making it executable. Overwrites older
//!    versions (gated by ``GUARD_VERSION = "N"`` in the script header).
//!
//! 2. ``ensure_hook_registered`` — parses ``~/.hermes/config.yaml`` as
//!    ``serde_yaml::Value``, normalises ``hooks.pre_tool_call`` into a
//!    proper sequence, appends the corey-guards entry if absent, and
//!    sets ``hooks_auto_accept: true`` so Hermes doesn't block waiting
//!    for a TTY prompt on background/non-interactive channels (cron,
//!    WhatsApp, etc.). Idempotent — safe to run every boot.
//!
//! Both operations use [`crate::fs_atomic::atomic_write`] (per HD-8).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_yaml::{Mapping, Value};

use crate::fs_atomic;

/// Bundled copy of Corey's hard-guard Python script. The guard header
/// encodes ``GUARD_VERSION = "N"`` which we parse out to decide whether
/// to overwrite an older installed copy.
const GUARD_SCRIPT_SRC: &str = include_str!("../assets/corey-guards/file-ops-guard.py");

/// Relative path (under the Hermes data dir) where the guard script
/// lives. Chosen to match the pre-existing manual install location so
/// customers who set it up by hand don't get a duplicate in a
/// different folder.
const GUARD_REL_PATH: &str = "corey-guards/file-ops-guard.py";

/// Key under ``hooks:`` we register on. Matches Hermes'
/// ``_DEFAULT_PAYLOADS`` canonical event name.
const HOOK_EVENT: &str = "pre_tool_call";

/// Default subprocess timeout for the guard. Matches Hermes'
/// ``DEFAULT_TIMEOUT_SECONDS``. We pick 30 s rather than the 60 s
/// default because the guard does at most a regex scan + (rarely) a
/// dialog prompt — anything slower is a bug.
const GUARD_TIMEOUT_SECS: u64 = 30;

/// Outcome of a reconcile step — for logging and tests.
#[derive(Debug, PartialEq, Eq)]
pub enum ScriptOutcome {
    /// Script wasn't present; installed for the first time.
    Installed,
    /// Installed copy was older (or version-less); overwritten.
    Upgraded { from: Option<String>, to: String },
    /// Same version already present; no write performed.
    Unchanged,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigOutcome {
    /// config.yaml didn't exist; created with just our hook registered.
    /// In practice Hermes always creates this file on first run, so
    /// this branch is mostly defensive.
    CreatedFile,
    /// ``hooks:`` block or ``pre_tool_call`` list was missing; added.
    AppendedHookSection,
    /// ``hooks.pre_tool_call`` was the buggy string ``'[]'`` (or any
    /// other non-list shape); normalised into a real list with our
    /// entry inside.
    NormalisedMalformedList,
    /// Proper list existed but didn't contain our entry; appended it.
    AppendedEntry,
    /// Proper list existed with our entry already; no write performed.
    Unchanged,
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/// Install (or upgrade) the Corey guard script under ``hermes_dir``.
pub fn seed_guards_script(hermes_dir: &Path) -> io::Result<ScriptOutcome> {
    let target = hermes_dir.join(GUARD_REL_PATH);
    seed_guards_script_to(&target, GUARD_SCRIPT_SRC)
}

/// Ensure the guard script is registered in ``<hermes_dir>/config.yaml``
/// under ``hooks.pre_tool_call``, and that ``hooks_auto_accept: true``
/// so Hermes doesn't hang on a TTY prompt.
pub fn ensure_hook_registered(hermes_dir: &Path) -> io::Result<ConfigOutcome> {
    let config_path = hermes_dir.join("config.yaml");
    let guard_path = hermes_dir.join(GUARD_REL_PATH);
    let command = guard_command_for_platform(&guard_path);
    ensure_hook_registered_in(&config_path, &command)
}

/// Build the `command:` string the guard registration writes into
/// `config.yaml`. Hermes runs hooks via `subprocess.run(shlex.split(cmd))`.
///
/// - **macOS / Linux**: bare path. The script's `#!/usr/bin/env python3`
///   shebang + `+x` bit (set in [`seed_guards_script_to`]) make the
///   kernel pick the right interpreter automatically.
/// - **Windows**: NTFS has no `+x` bit and `CreateProcess` does **not**
///   honour Unix shebangs. A bare `.py` path was the v0.2.12 escape
///   that let the agent delete files while the guard sat dormant on
///   disk. We prefer the **absolute** path to the Hermes venv
///   `python.exe` (installed by `bootstrap-windows.ps1` at
///   `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe`) —
///   that's robust against `PATH` propagation lag (user installs
///   Hermes, hasn't re-logged-in yet, Corey-spawned subprocess
///   inherits stale PATH that doesn't include venv → bare `python`
///   would fail and the guard would sit dormant). Fall back to bare
///   `python` only when the venv binary isn't where we expect.
pub(crate) fn guard_command_for_platform(guard_path: &Path) -> String {
    if cfg!(target_os = "windows") {
        // shlex.split on Windows respects double-quotes for spaces.
        let python = find_hermes_venv_python()
            .map(|p| format!("\"{}\"", p.display()))
            .unwrap_or_else(|| "python".to_string());
        format!("{python} \"{}\"", guard_path.display())
    } else {
        guard_path.to_string_lossy().to_string()
    }
}

/// Resolve the Hermes venv `python.exe` so guard hooks don't depend on
/// PATH propagation timing. Returns `None` outside Windows or when the
/// venv layout doesn't match what `bootstrap-windows.ps1` installs.
#[cfg(target_os = "windows")]
fn find_hermes_venv_python() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let candidate = base
        .join("hermes")
        .join("hermes-agent")
        .join("venv")
        .join("Scripts")
        .join("python.exe");
    candidate.exists().then_some(candidate)
}

#[cfg(not(target_os = "windows"))]
fn find_hermes_venv_python() -> Option<PathBuf> {
    None
}

// ---------------------------------------------------------------------
// Script seeding internals
// ---------------------------------------------------------------------

/// Extract the ``GUARD_VERSION = "..."`` literal from a script body.
/// Returns ``None`` for scripts without the marker (legacy copies that
/// the user installed before we added the version gate).
fn parse_guard_version(body: &str) -> Option<String> {
    for line in body.lines() {
        let line = line.trim();
        // Match ``GUARD_VERSION = "X"`` / ``GUARD_VERSION="X"`` /
        // single-quoted variants.
        let prefix = "GUARD_VERSION";
        if let Some(rest) = line.strip_prefix(prefix) {
            let rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=');
            let quoted = rest.trim();
            let unquoted = quoted
                .trim_start_matches('"')
                .trim_start_matches('\'')
                .split(['"', '\''])
                .next()
                .unwrap_or("");
            if !unquoted.is_empty() {
                return Some(unquoted.to_string());
            }
        }
    }
    None
}

pub(crate) fn seed_guards_script_to(target: &Path, bundled_src: &str) -> io::Result<ScriptOutcome> {
    let bundled_version = parse_guard_version(bundled_src).unwrap_or_else(|| "unknown".to_string());

    let outcome = match fs::read_to_string(target) {
        Ok(existing) => {
            if existing == bundled_src {
                return Ok(ScriptOutcome::Unchanged);
            }
            let from = parse_guard_version(&existing);
            ScriptOutcome::Upgraded {
                from,
                to: bundled_version.clone(),
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => ScriptOutcome::Installed,
        Err(e) => return Err(e),
    };

    // 0o755: world-readable + owner-executable. Hermes spawns the
    // script via shlex.split + subprocess.run — it needs the execute
    // bit set or spawn fails with EACCES.
    fs_atomic::atomic_write(target, bundled_src.as_bytes(), Some(0o755))?;
    Ok(outcome)
}

// ---------------------------------------------------------------------
// Config reconciliation internals
// ---------------------------------------------------------------------

pub(crate) fn ensure_hook_registered_in(
    config_path: &Path,
    guard_command: &str,
) -> io::Result<ConfigOutcome> {
    // Case A: file doesn't exist yet. Create a minimal config with
    // just our hook. Hermes will fill the rest on its next boot.
    let source = match fs::read_to_string(config_path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let minimal = build_minimal_config(guard_command);
            fs_atomic::atomic_write(config_path, minimal.as_bytes(), Some(0o600))?;
            return Ok(ConfigOutcome::CreatedFile);
        }
        Err(e) => return Err(e),
    };

    let mut root: Value =
        serde_yaml::from_str(&source).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let mapping = root.as_mapping_mut().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "config.yaml root is not a mapping",
        )
    })?;

    // Snapshot pre-mutation state of ``hooks_auto_accept`` so we can
    // distinguish "already true, nothing to do" from "was false/missing,
    // we flipped it". A flip mandates a write even if the hook entry
    // itself is already present.
    let auto_accept_was_already_true = mapping
        .get(Value::String("hooks_auto_accept".into()))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Always ensure hooks_auto_accept is true. Without this, Hermes
    // prompts the user on the TTY the first time each hook fires —
    // which deadlocks on WhatsApp / cron / headless channels.
    mapping.insert(Value::String("hooks_auto_accept".into()), Value::Bool(true));

    // Navigate / create hooks mapping.
    let hooks_key = Value::String("hooks".into());
    let hooks_is_mapping = matches!(
        mapping.get(&hooks_key),
        Some(v) if v.as_mapping().is_some()
    );
    if !hooks_is_mapping {
        mapping.insert(hooks_key.clone(), Value::Mapping(Mapping::new()));
    }
    let hooks = mapping
        .get_mut(&hooks_key)
        .and_then(|v| v.as_mapping_mut())
        .expect("just inserted a mapping");

    let event_key = Value::String(HOOK_EVENT.into());
    let event_value = hooks.get(&event_key).cloned();

    // Compute the desired "this corey entry".
    let corey_entry = build_corey_entry(guard_command);

    let (new_list, base_outcome) = match event_value {
        None => (
            vec![corey_entry.clone()],
            ConfigOutcome::AppendedHookSection,
        ),
        Some(Value::Sequence(seq)) => {
            // Proper list already. Check if corey entry is present.
            let has_corey = seq.iter().any(|e| entry_matches_command(e, guard_command));
            if has_corey && auto_accept_was_already_true {
                // Fully in-sync — no write needed.
                return Ok(ConfigOutcome::Unchanged);
            }
            if has_corey {
                // Entry present but we had to flip auto_accept;
                // persist that change.
                let serialised = serde_yaml::to_string(&root).map_err(io::Error::other)?;
                fs_atomic::atomic_write(config_path, serialised.as_bytes(), Some(0o600))?;
                return Ok(ConfigOutcome::AppendedHookSection);
            }
            let mut new_list = seq;
            new_list.push(corey_entry.clone());
            (new_list, ConfigOutcome::AppendedEntry)
        }
        Some(Value::Null) => (
            vec![corey_entry.clone()],
            ConfigOutcome::AppendedHookSection,
        ),
        Some(_) => {
            // Malformed shape (string '[]' / bool / etc). Normalise.
            (
                vec![corey_entry.clone()],
                ConfigOutcome::NormalisedMalformedList,
            )
        }
    };

    hooks.insert(event_key, Value::Sequence(new_list));

    let serialised = serde_yaml::to_string(&root).map_err(io::Error::other)?;

    // Cheap defence: if round-trip produced byte-identical source and
    // we thought we changed something, that's a bug in our diff logic
    // — log and fall through. (serde_yaml often changes quoting /
    // ordering, so this is theoretical.)
    if serialised == source {
        return Ok(ConfigOutcome::Unchanged);
    }

    fs_atomic::atomic_write(config_path, serialised.as_bytes(), Some(0o600))?;
    Ok(base_outcome)
}

fn build_corey_entry(command: &str) -> Value {
    let mut m = Mapping::new();
    m.insert(
        Value::String("command".into()),
        Value::String(command.into()),
    );
    m.insert(
        Value::String("timeout".into()),
        Value::Number(GUARD_TIMEOUT_SECS.into()),
    );
    // Note: we intentionally OMIT the ``matcher`` key. Our guard
    // internally dispatches by tool_name (STRUCTURED_TOOLS /
    // SHELL_TOOLS / CODE_TOOLS sets). A matcher here would shadow
    // that dispatch and we'd lose coverage of any tool not listed in
    // the regex.
    Value::Mapping(m)
}

fn entry_matches_command(entry: &Value, command: &str) -> bool {
    entry
        .as_mapping()
        .and_then(|m| m.get(Value::String("command".into())))
        .and_then(|v| v.as_str())
        .map(|c| c == command)
        .unwrap_or(false)
}

fn build_minimal_config(guard_command: &str) -> String {
    format!(
        "hooks:\n  {event}:\n    - command: {command}\n      timeout: {timeout}\nhooks_auto_accept: true\n",
        event = HOOK_EVENT,
        command = guard_command,
        timeout = GUARD_TIMEOUT_SECS,
    )
}

// ---------------------------------------------------------------------
// Cheap observational helpers (used by Settings UI via IPC later)
// ---------------------------------------------------------------------

/// Parse just the presence / shape of the guard registration without
/// mutating anything. Used by the security-status IPC to give the UI
/// a truthy answer without touching disk.
pub fn is_hook_registered(hermes_dir: &Path) -> io::Result<bool> {
    let config_path = hermes_dir.join("config.yaml");
    let guard_command = hermes_dir
        .join(GUARD_REL_PATH)
        .to_string_lossy()
        .to_string();

    let source = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    let root: Value =
        serde_yaml::from_str(&source).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let list = root
        .get("hooks")
        .and_then(|v| v.get(HOOK_EVENT))
        .and_then(|v| v.as_sequence());

    let Some(list) = list else { return Ok(false) };
    Ok(list
        .iter()
        .any(|e| entry_matches_command(e, &guard_command)))
}

/// Is ``hooks_auto_accept`` present and ``true``?
pub fn is_auto_accept_enabled(hermes_dir: &Path) -> io::Result<bool> {
    let config_path = hermes_dir.join("config.yaml");
    let source = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    let root: Value =
        serde_yaml::from_str(&source).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    Ok(root
        .get("hooks_auto_accept")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

/// Path to the guard log file. Unconditional — may not exist yet.
pub fn guard_log_path(hermes_dir: &Path) -> PathBuf {
    hermes_dir.join("corey-guards").join("guard.log")
}

/// Count recent FIRED + BLOCK entries in the guard log. Returns
/// ``(fired_count, block_count)``. Any I/O failure silently returns
/// ``(0, 0)`` — this is a best-effort diagnostic, not a contract.
pub fn count_recent_guard_events(hermes_dir: &Path, lookback_lines: usize) -> (usize, usize) {
    let path = guard_log_path(hermes_dir);
    let Ok(contents) = fs::read_to_string(&path) else {
        return (0, 0);
    };
    // Look back at the tail of the file. `lookback_lines` covers the
    // "last 24 h" rough estimate — tuning is the UI's problem.
    let mut fired = 0usize;
    let mut blocks = 0usize;
    let lines: Vec<&str> = contents.lines().collect();
    let start = lines.len().saturating_sub(lookback_lines);
    for line in &lines[start..] {
        if line.contains("FIRED") {
            fired += 1;
        }
        if line.contains("BLOCK") {
            blocks += 1;
        }
    }
    (fired, blocks)
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "corey-hermes-hooks-test-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("create test dir");
        d
    }

    // -----------------------------------------------------------------
    // Script seeding
    // -----------------------------------------------------------------

    #[test]
    fn guard_version_parsing() {
        assert_eq!(
            parse_guard_version("GUARD_VERSION = \"2\"\n"),
            Some("2".into())
        );
        assert_eq!(
            parse_guard_version("  GUARD_VERSION=\"10\"\n"),
            Some("10".into())
        );
        assert_eq!(
            parse_guard_version("GUARD_VERSION = '3a'  # bump on change"),
            Some("3a".into())
        );
        assert_eq!(parse_guard_version("no marker here"), None);
    }

    #[test]
    fn seed_script_installs_when_missing() {
        let dir = temp_dir("seed-installs");
        let target = dir.join("guard.py");
        let body = "#!/usr/bin/env python3\nGUARD_VERSION = \"2\"\n";
        let outcome = seed_guards_script_to(&target, body).expect("test");
        assert_eq!(outcome, ScriptOutcome::Installed);

        let read = fs::read_to_string(&target).expect("test");
        assert_eq!(read, body);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn seed_script_unchanged_when_identical() {
        let dir = temp_dir("seed-unchanged");
        let target = dir.join("guard.py");
        let body = "#!/usr/bin/env python3\nGUARD_VERSION = \"2\"\n";
        fs::write(&target, body).expect("test");
        let outcome = seed_guards_script_to(&target, body).expect("test");
        assert_eq!(outcome, ScriptOutcome::Unchanged);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn seed_script_upgrades_when_content_differs() {
        let dir = temp_dir("seed-upgrade");
        let target = dir.join("guard.py");
        let old = "#!/usr/bin/env python3\nGUARD_VERSION = \"1\"\n# old logic";
        let new = "#!/usr/bin/env python3\nGUARD_VERSION = \"2\"\n# new logic";
        fs::write(&target, old).expect("test");
        let outcome = seed_guards_script_to(&target, new).expect("test");
        match outcome {
            ScriptOutcome::Upgraded { from, to } => {
                assert_eq!(from.as_deref(), Some("1"));
                assert_eq!(to, "2");
            }
            other => panic!("expected Upgraded, got {other:?}"),
        }
        let read = fs::read_to_string(&target).expect("test");
        assert_eq!(read, new);
        let _ = fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------
    // config.yaml reconciliation
    // -----------------------------------------------------------------

    #[test]
    fn reconcile_creates_config_when_missing() {
        let dir = temp_dir("cfg-create");
        let cfg = dir.join("config.yaml");
        let outcome = ensure_hook_registered_in(&cfg, "/path/to/guard.py").expect("test");
        assert_eq!(outcome, ConfigOutcome::CreatedFile);

        let read = fs::read_to_string(&cfg).expect("test");
        assert!(read.contains("pre_tool_call"));
        assert!(read.contains("/path/to/guard.py"));
        assert!(read.contains("hooks_auto_accept: true"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_normalises_the_string_bug_we_saw_in_prod() {
        // This is the EXACT state we found on the user's machine on
        // 2026-05-11 — a value that YAML parsed as the string "[]"
        // instead of an empty list. Hermes warn-and-skipped it, so
        // hooks silently didn't register. Regression guard.
        let dir = temp_dir("cfg-normalise-string-list");
        let cfg = dir.join("config.yaml");
        fs::write(
            &cfg,
            "model:\n  default: foo\nhooks:\n  pre_tool_call: '[]'\n",
        )
        .expect("test");

        let outcome = ensure_hook_registered_in(&cfg, "/guard.py").expect("test");
        assert_eq!(outcome, ConfigOutcome::NormalisedMalformedList);

        let read = fs::read_to_string(&cfg).expect("test");
        // Other keys preserved.
        assert!(read.contains("model"));
        assert!(read.contains("foo"));
        // pre_tool_call is now a real list with our entry.
        let root: Value = serde_yaml::from_str(&read).expect("test");
        let list = root
            .get("hooks")
            .expect("test")
            .get("pre_tool_call")
            .expect("test")
            .as_sequence()
            .expect("pre_tool_call should now be a real sequence");
        assert_eq!(list.len(), 1);
        assert_eq!(
            list[0]
                .as_mapping()
                .expect("test")
                .get(Value::String("command".into()))
                .expect("test")
                .as_str()
                .expect("test"),
            "/guard.py"
        );
        // hooks_auto_accept enforced.
        assert_eq!(
            root.get("hooks_auto_accept").expect("test").as_bool(),
            Some(true)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_appends_when_hooks_has_other_entries() {
        let dir = temp_dir("cfg-append");
        let cfg = dir.join("config.yaml");
        fs::write(
            &cfg,
            "hooks:\n  pre_tool_call:\n    - command: /other/hook.sh\n      timeout: 60\n",
        )
        .expect("test");

        let outcome = ensure_hook_registered_in(&cfg, "/corey/guard.py").expect("test");
        assert_eq!(outcome, ConfigOutcome::AppendedEntry);

        let read = fs::read_to_string(&cfg).expect("test");
        let root: Value = serde_yaml::from_str(&read).expect("test");
        let list = root
            .get("hooks")
            .expect("test")
            .get("pre_tool_call")
            .expect("test")
            .as_sequence()
            .expect("test");
        assert_eq!(list.len(), 2, "original entry + corey entry");
        let commands: Vec<&str> = list
            .iter()
            .filter_map(|e| e.as_mapping())
            .filter_map(|m| m.get(Value::String("command".into())))
            .filter_map(|v| v.as_str())
            .collect();
        assert!(commands.contains(&"/other/hook.sh"));
        assert!(commands.contains(&"/corey/guard.py"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_is_idempotent_when_entry_already_present() {
        let dir = temp_dir("cfg-idempotent");
        let cfg = dir.join("config.yaml");

        // First reconcile: adds the entry.
        let first = ensure_hook_registered_in(&cfg, "/guard.py").expect("test");
        assert_eq!(first, ConfigOutcome::CreatedFile);
        let after_first_mtime = fs::metadata(&cfg).expect("test").modified().expect("test");

        // Second reconcile: entry already there → Unchanged.
        std::thread::sleep(std::time::Duration::from_millis(10));
        let second = ensure_hook_registered_in(&cfg, "/guard.py").expect("test");
        assert_eq!(second, ConfigOutcome::Unchanged);
        let after_second_mtime = fs::metadata(&cfg).expect("test").modified().expect("test");
        assert_eq!(
            after_first_mtime, after_second_mtime,
            "idempotent reconcile must not rewrite the file"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_always_enables_auto_accept() {
        let dir = temp_dir("cfg-auto-accept");
        let cfg = dir.join("config.yaml");
        // User config that has hooks_auto_accept: false explicitly.
        fs::write(
            &cfg,
            "hooks:\n  pre_tool_call:\n    - command: /guard.py\n      timeout: 30\nhooks_auto_accept: false\n",
        )
        .expect("test");

        let outcome = ensure_hook_registered_in(&cfg, "/guard.py").expect("test");
        // Our entry is present, BUT we flipped hooks_auto_accept.
        // The conservative version of the code writes on any change,
        // so this should not be Unchanged.
        assert_ne!(
            outcome,
            ConfigOutcome::Unchanged,
            "must rewrite when hooks_auto_accept was wrong"
        );

        let root: Value =
            serde_yaml::from_str(&fs::read_to_string(&cfg).expect("test")).expect("test");
        assert_eq!(
            root.get("hooks_auto_accept").expect("test").as_bool(),
            Some(true)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_hook_registered_reports_truthfully() {
        let dir = temp_dir("is-registered");
        let cfg_dir = dir.clone();
        let cfg = dir.join("config.yaml");

        // Not registered yet.
        assert!(!is_hook_registered(&cfg_dir).expect("test"));

        // After reconcile with a fake guard path matching the canonical
        // layout, should report true.
        fs::create_dir_all(dir.join("corey-guards")).expect("test");
        let guard_path = dir.join(GUARD_REL_PATH);
        fs::write(&guard_path, "placeholder").expect("test");

        let outcome = ensure_hook_registered_in(&cfg, &guard_path.to_string_lossy()).expect("test");
        assert_eq!(outcome, ConfigOutcome::CreatedFile);

        assert!(is_hook_registered(&cfg_dir).expect("test"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn count_recent_guard_events_handles_missing_log() {
        let dir = temp_dir("log-missing");
        let (fired, blocked) = count_recent_guard_events(&dir, 1000);
        assert_eq!((fired, blocked), (0, 0));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn count_recent_guard_events_reads_tail() {
        let dir = temp_dir("log-tail");
        fs::create_dir_all(dir.join("corey-guards")).expect("test");
        let log = dir.join("corey-guards/guard.log");
        let mut s = String::new();
        for i in 0..20 {
            s.push_str(&format!("2026-01-01T00:00:{i:02}Z FIRED tool='terminal'\n"));
        }
        s.push_str("2026-01-01T00:00:21Z BLOCK Corey guard: terminal blocked ...\n");
        s.push_str("2026-01-01T00:00:22Z ALLOW clean\n");
        fs::write(&log, s).expect("test");

        let (fired, blocked) = count_recent_guard_events(&dir, 1000);
        assert_eq!(fired, 20);
        assert_eq!(blocked, 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
