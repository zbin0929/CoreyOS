//! Template variable resolution for Pack manifest strings.
//!
//! A Pack `manifest.yaml` may embed template variables in any
//! string field (most commonly `mcp_servers[].command` and
//! `mcp_servers[].env` values). The Pack loader expands them at
//! enable time so the actual subprocess sees concrete paths.
//!
//! Supported variables:
//!
//! - `${platform}` — OS+arch slug picking the right precompiled
//!   MCP binary. Values: `darwin-arm64`, `darwin-x64`,
//!   `windows-x64.exe`, `linux-x64`. The trailing `.exe` is
//!   intentionally part of the slug on Windows so a manifest can
//!   write `command: ["./mcp/srv/server-${platform}"]` without
//!   per-OS forking.
//!
//! - `${pack_data_dir}` — absolute path to
//!   `~/.hermes/pack-data/<id>/`. Pack MCP servers are expected
//!   to write all runtime state under this dir (per architecture
//!   iron rule: `pack-data/` is the only writable location).
//!
//! - `${pack_config.<key>}` — value from the Pack's persisted
//!   config (`pack-data/<id>/config.json`), or the empty string
//!   if the key is absent. Used to inject API keys / tokens
//!   without baking them into the manifest.
//!
//! Unknown `${...}` references are LEFT AS-IS rather than removed.
//! That's deliberate: a typo in `${pack_config.amazon_taken}`
//! should fail loudly when the MCP fails to start, not silently
//! become an empty string the user can't trace. Stage 3b's
//! validator will warn on unknown variables before spawn.

use std::collections::BTreeMap;
use std::path::PathBuf;

/// Context for resolving template variables. Constructed once per
/// Pack at enable time and passed by reference to every string
/// that needs expansion.
#[derive(Debug, Clone)]
pub struct TemplateContext {
    /// Platform slug — see module docs. Use [`current_platform`]
    /// to derive at runtime.
    pub platform: String,
    /// Absolute path to `~/.hermes/pack-data/<id>/`.
    pub pack_data_dir: PathBuf,
    /// Snapshot of the Pack's `config.json` at enable time.
    pub pack_config: BTreeMap<String, String>,
}

impl TemplateContext {
    /// Build a context with the platform slug auto-derived. Tests
    /// can call `TemplateContext { platform: "...", ... }` directly
    /// if they need to pin a non-host platform.
    #[allow(dead_code)] // wired in stage 3b
    pub fn new(pack_data_dir: PathBuf, pack_config: BTreeMap<String, String>) -> Self {
        Self {
            platform: current_platform().to_string(),
            pack_data_dir,
            pack_config,
        }
    }
}

/// Return the platform slug for the running host. Stable strings;
/// don't change them without bumping a manifest schema field —
/// Pack folder layouts depend on these names.
pub fn current_platform() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-x64"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x64.exe"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x64"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
    )))]
    {
        // Fallback: explicit "unknown" slug so a Pack tested on
        // an unsupported platform fails loudly (file-not-found
        // when looking for `server-unknown`) instead of silently
        // running the wrong binary.
        "unknown"
    }
}

/// Resolve all `${...}` template variables in `input` against
/// `ctx`. Allocates a new `String` only if any substitution
/// happens; the no-template happy path returns `input` cloned.
///
/// This is a single-pass scan — substitution outputs are NOT
/// re-scanned, so a config value containing `${platform}` won't
/// itself be expanded. That's by design: it bounds the
/// substitution to one level and prevents accidental loops.
pub fn resolve(input: &str, ctx: &TemplateContext) -> String {
    if !input.contains("${") {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Find the next `${`.
        if i + 1 < bytes.len() && bytes[i] == b'$' && bytes[i + 1] == b'{' {
            // Find the matching `}`.
            if let Some(end_offset) = bytes[i + 2..].iter().position(|&c| c == b'}') {
                let var_start = i + 2;
                let var_end = var_start + end_offset;
                // Extract var as &str — we know `${` and `}` are
                // ASCII, so var_start..var_end are valid UTF-8
                // boundaries iff the bytes between them are.
                if let Ok(var) = std::str::from_utf8(&bytes[var_start..var_end]) {
                    if let Some(value) = lookup(var, ctx) {
                        out.push_str(&value);
                        i = var_end + 1; // skip past `}`
                        continue;
                    }
                    // Unknown var: leave the literal `${var}` in
                    // place (see module docs).
                    out.push('$');
                    out.push('{');
                    out.push_str(var);
                    out.push('}');
                    i = var_end + 1;
                    continue;
                }
                // Non-UTF-8 inside braces — copy literally.
                out.push(bytes[i] as char);
                i += 1;
                continue;
            }
            // Unmatched `${` — copy the rest literally and exit.
            out.push_str(&input[i..]);
            return out;
        }
        // Push one byte. Safe because we only check for ASCII
        // markers and copy through other bytes via the original
        // string slice for any non-ASCII run.
        let next_dollar = input[i..].find("${").map(|d| i + d).unwrap_or(bytes.len());
        out.push_str(&input[i..next_dollar]);
        i = next_dollar;
    }
    out
}

fn lookup(var: &str, ctx: &TemplateContext) -> Option<String> {
    match var {
        "platform" => Some(ctx.platform.clone()),
        "pack_data_dir" => Some(ctx.pack_data_dir.to_string_lossy().into_owned()),
        v if v.starts_with("pack_config.") => {
            let key = &v["pack_config.".len()..];
            // Missing key resolves to empty string. Manifest
            // authors should mark required keys via
            // `config_schema[].required` so the Pack loader
            // refuses to enable until they're populated, rather
            // than relying on this fallback.
            Some(ctx.pack_config.get(key).cloned().unwrap_or_default())
        }
        _ => None,
    }
}

/// Convenience wrapper: resolve every value in an env BTreeMap
/// using the same context.
#[allow(dead_code)] // wired in stage 3b
pub fn resolve_env(
    env: &BTreeMap<String, String>,
    ctx: &TemplateContext,
) -> BTreeMap<String, String> {
    env.iter()
        .map(|(k, v)| (k.clone(), resolve(v, ctx)))
        .collect()
}

/// Convenience wrapper: resolve every element of a command argv.
#[allow(dead_code)] // wired in stage 3b
pub fn resolve_argv(argv: &[String], ctx: &TemplateContext) -> Vec<String> {
    argv.iter().map(|s| resolve(s, ctx)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> TemplateContext {
        let mut config = BTreeMap::new();
        config.insert("amazon_token".to_string(), "tok-123".to_string());
        config.insert("marketplace".to_string(), "US".to_string());
        TemplateContext {
            platform: "darwin-arm64".to_string(),
            pack_data_dir: PathBuf::from("/abs/.hermes/pack-data/foo"),
            pack_config: config,
        }
    }

    #[test]
    fn no_template_returns_unchanged() {
        assert_eq!(resolve("hello world", &ctx()), "hello world");
        assert_eq!(resolve("", &ctx()), "");
        // No '${' means we hit the fast path.
        assert_eq!(resolve("$LITERAL", &ctx()), "$LITERAL");
    }

    #[test]
    fn platform_substitutes() {
        assert_eq!(
            resolve("./mcp/srv/server-${platform}", &ctx()),
            "./mcp/srv/server-darwin-arm64"
        );
    }

    #[test]
    fn pack_data_dir_substitutes() {
        assert_eq!(
            resolve("${pack_data_dir}/cache", &ctx()),
            "/abs/.hermes/pack-data/foo/cache"
        );
    }

    #[test]
    fn pack_config_substitutes_known_key() {
        assert_eq!(resolve("${pack_config.amazon_token}", &ctx()), "tok-123");
    }

    #[test]
    fn pack_config_unknown_key_yields_empty() {
        assert_eq!(resolve("X${pack_config.missing}Y", &ctx()), "XY");
    }

    #[test]
    fn unknown_variable_left_as_is() {
        assert_eq!(
            resolve("foo-${unknown_var}-bar", &ctx()),
            "foo-${unknown_var}-bar"
        );
    }

    #[test]
    fn multiple_substitutions_in_one_string() {
        assert_eq!(
            resolve("${pack_data_dir}/${platform}/log", &ctx()),
            "/abs/.hermes/pack-data/foo/darwin-arm64/log"
        );
    }

    #[test]
    fn unmatched_brace_passes_through() {
        // Garbage in, predictable out — don't crash on a
        // half-typed manifest.
        assert_eq!(resolve("${platform", &ctx()), "${platform");
        assert_eq!(resolve("hello ${ no end", &ctx()), "hello ${ no end");
    }

    #[test]
    fn substitution_outputs_not_re_scanned() {
        // If a config value happens to contain `${platform}`, we
        // do NOT expand it — bounds the substitution to one pass.
        let mut ctx = ctx();
        ctx.pack_config
            .insert("trick".to_string(), "${platform}".to_string());
        assert_eq!(resolve("${pack_config.trick}", &ctx), "${platform}");
    }

    #[test]
    fn resolve_env_maps_all_values() {
        let mut env = BTreeMap::new();
        env.insert("DATA".to_string(), "${pack_data_dir}/x".to_string());
        env.insert(
            "TOKEN".to_string(),
            "${pack_config.amazon_token}".to_string(),
        );
        env.insert("LITERAL".to_string(), "no-template".to_string());
        let out = resolve_env(&env, &ctx());
        assert_eq!(out["DATA"], "/abs/.hermes/pack-data/foo/x");
        assert_eq!(out["TOKEN"], "tok-123");
        assert_eq!(out["LITERAL"], "no-template");
    }

    #[test]
    fn resolve_argv_maps_all_elements() {
        let argv = vec![
            "./mcp/srv/server-${platform}".to_string(),
            "--data".to_string(),
            "${pack_data_dir}/state".to_string(),
        ];
        let out = resolve_argv(&argv, &ctx());
        assert_eq!(out[0], "./mcp/srv/server-darwin-arm64");
        assert_eq!(out[1], "--data");
        assert_eq!(out[2], "/abs/.hermes/pack-data/foo/state");
    }

    #[test]
    fn current_platform_is_one_of_known_values() {
        let p = current_platform();
        assert!(
            matches!(
                p,
                "darwin-arm64" | "darwin-x64" | "windows-x64.exe" | "linux-x64" | "unknown"
            ),
            "unexpected platform slug: {p}"
        );
    }
}
