//! White-label customization loaded from `~/.hermes/customer.yaml`.
//!
//! See `docs/01-architecture.md` § Pack Architecture → "customer.yaml
//! white-label customization" for the design contract. The short
//! version: a single optional file in the data dir lets a delivered
//! Corey binary present a different brand, hide irrelevant base
//! features, and (later, when the Pack loader lands) preinstall and
//! preconfigure industry packs — all WITHOUT modifying the binary.
//!
//! Loading is best-effort and fail-soft: a missing or malformed yaml
//! is logged once and the app keeps running with default Corey
//! branding. The struct is loaded ONCE at startup and held read-only
//! in `AppState.customer`; v0.2.0 does NOT support hot-reload (you
//! restart the app after editing the file).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Filename Corey looks for inside the Hermes data dir.
pub const CUSTOMER_YAML_FILENAME: &str = "customer.yaml";

/// Top-level customer customization.
///
/// All fields are optional so that a 2-line yaml that only changes
/// the brand name still validates. The hard rule is that
/// `schema_version` must match a value Corey knows how to load —
/// if you bump this, add a migration path in `parse()`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomerConfig {
    /// Schema version. v0.2.0 ships v1. Future bumps must keep
    /// reading old versions per the Pack Architecture iron rule
    /// "manifest schema_version permanently backwards-compatible".
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,

    /// Visual brand overrides. Absent = full default Corey brand.
    #[serde(default)]
    pub brand: BrandConfig,

    /// Navigation-tree overrides.
    #[serde(default)]
    pub navigation: NavigationConfig,
}

impl Default for CustomerConfig {
    /// Hand-rolled `Default` so `schema_version` matches the value
    /// `serde(default = "default_schema_version")` would inject on
    /// deserialisation. Auto-derived `Default` would give `0`,
    /// which `parse()` then rejects as an unsupported schema.
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            brand: BrandConfig::default(),
            navigation: NavigationConfig::default(),
        }
    }
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrandConfig {
    /// Application display name (top-bar text + window title). Empty
    /// or unset = "Corey".
    #[serde(default)]
    pub app_name: Option<String>,

    /// Path (relative to `~/.hermes/` or absolute) to a logo image.
    /// The frontend uses Tauri `convertFileSrc` to load it. PNG / SVG
    /// recommended. Square layout assumed (1:1 aspect ratio).
    #[serde(default)]
    pub logo: Option<String>,

    /// Primary accent colour as a hex string (e.g. `"#FF6B00"`). The
    /// frontend converts this to an HSL triplet and overrides the
    /// `--gold-500` design token at runtime.
    #[serde(default)]
    pub primary_color: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavigationConfig {
    /// Sidebar entries (and their routes) to suppress from the nav
    /// tree. The string MUST match an entry id in
    /// `src/app/nav-config.ts` (e.g. `"analytics"`, `"browser"`,
    /// `"compare"`). Unknown ids are silently ignored — that's
    /// deliberate so a customer.yaml can list ids the current binary
    /// doesn't have without breaking.
    ///
    /// Note (v0.2.0): hidden routes are removed from the sidebar but
    /// remain reachable by typing the URL directly. URL-level
    /// blocking lands in v0.2.1 alongside Pack-level guards.
    #[serde(default)]
    pub hidden_routes: Vec<String>,
}

/// Outcome of attempting to load `customer.yaml` from disk.
#[derive(Debug)]
pub enum LoadOutcome {
    /// File is absent — return default Corey behaviour.
    NotPresent,
    /// File parsed successfully.
    Loaded(CustomerConfig),
    /// File was present but unreadable / unparseable. We log once
    /// and treat it like absence so the app still launches; the
    /// reason is included for the Settings → Help panel to display.
    Invalid(String),
}

/// Read and parse `<hermes_dir>/customer.yaml`. Best-effort: never
/// returns Err; problems are surfaced as `LoadOutcome::Invalid` so
/// the caller can decide whether to log / surface to UI.
pub fn load_from_dir(hermes_dir: &Path) -> LoadOutcome {
    let path = hermes_dir.join(CUSTOMER_YAML_FILENAME);
    if !path.exists() {
        return LoadOutcome::NotPresent;
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            return LoadOutcome::Invalid(format!("read {}: {e}", path.display()));
        }
    };
    parse(&raw)
}

/// Parse a customer.yaml string. Public for tests; production should
/// go through `load_from_dir`.
pub fn parse(raw: &str) -> LoadOutcome {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        // Empty yaml = same as no file. We deliberately don't fail
        // here so a customer.yaml with only top-level comments still
        // works.
        return LoadOutcome::Loaded(CustomerConfig::default());
    }
    match serde_yaml::from_str::<CustomerConfig>(trimmed) {
        Ok(cfg) => {
            if cfg.schema_version == 0 || cfg.schema_version > MAX_KNOWN_SCHEMA_VERSION {
                return LoadOutcome::Invalid(format!(
                    "schema_version {} not supported (this Corey supports up to {MAX_KNOWN_SCHEMA_VERSION}); \
                     update the binary or downgrade the customer.yaml.",
                    cfg.schema_version
                ));
            }
            LoadOutcome::Loaded(cfg)
        }
        Err(e) => LoadOutcome::Invalid(format!("yaml parse error: {e}")),
    }
}

/// Highest schema version this binary knows how to load. Bump only
/// when adding fields that older binaries cannot reasonably ignore.
const MAX_KNOWN_SCHEMA_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn empty_string_yields_default() {
        match parse("") {
            LoadOutcome::Loaded(cfg) => {
                assert_eq!(cfg, CustomerConfig::default());
                assert_eq!(cfg.schema_version, 1);
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn missing_file_yields_not_present() {
        let dir = std::env::temp_dir().join(format!(
            "corey-customer-test-{}-missing",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        match load_from_dir(&dir) {
            LoadOutcome::NotPresent => {}
            other => panic!("expected NotPresent, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn brand_only_yaml_parses() {
        let yaml = r##"
schema_version: 1
brand:
  app_name: "ACME 智能助手"
  primary_color: "#FF6B00"
"##;
        match parse(yaml) {
            LoadOutcome::Loaded(cfg) => {
                assert_eq!(cfg.brand.app_name.as_deref(), Some("ACME 智能助手"));
                assert_eq!(cfg.brand.primary_color.as_deref(), Some("#FF6B00"));
                assert!(cfg.brand.logo.is_none());
                assert!(cfg.navigation.hidden_routes.is_empty());
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn full_yaml_parses() {
        let yaml = r##"
schema_version: 1
brand:
  app_name: "ACME"
  logo: "assets/acme-logo.png"
  primary_color: "#FF6B00"
navigation:
  hidden_routes:
    - analytics
    - browser
    - compare
"##;
        match parse(yaml) {
            LoadOutcome::Loaded(cfg) => {
                assert_eq!(cfg.brand.logo.as_deref(), Some("assets/acme-logo.png"));
                assert_eq!(
                    cfg.navigation.hidden_routes,
                    vec!["analytics", "browser", "compare"]
                );
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn future_schema_version_is_rejected() {
        let yaml = "schema_version: 99\n";
        match parse(yaml) {
            LoadOutcome::Invalid(msg) => assert!(msg.contains("schema_version")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn malformed_yaml_is_invalid() {
        match parse("brand: : :") {
            LoadOutcome::Invalid(msg) => assert!(msg.contains("yaml parse error")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn unknown_fields_are_tolerated() {
        // Forward-compat: a customer.yaml from a newer Corey that
        // adds a field shouldn't break the older binary, as long as
        // schema_version is still 1.
        let yaml = r##"
schema_version: 1
brand:
  app_name: "Hello"
future_field:
  whatever: 42
"##;
        match parse(yaml) {
            LoadOutcome::Loaded(cfg) => {
                assert_eq!(cfg.brand.app_name.as_deref(), Some("Hello"));
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn load_from_dir_reads_and_parses() {
        let dir =
            std::env::temp_dir().join(format!("corey-customer-test-{}-load", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        let path = dir.join(CUSTOMER_YAML_FILENAME);
        fs::write(&path, "schema_version: 1\nbrand:\n  app_name: \"Loaded\"\n")
            .expect("write test customer.yaml");

        match load_from_dir(&dir) {
            LoadOutcome::Loaded(cfg) => {
                assert_eq!(cfg.brand.app_name.as_deref(), Some("Loaded"));
            }
            other => panic!("expected Loaded, got {other:?}"),
        }

        let _ = fs::remove_dir_all(&dir);
    }
}
