//! Pack manifest schema (v1).
//!
//! Single source of truth for what a `~/.hermes/skill-packs/<id>/manifest.yaml`
//! is allowed to contain. Mirrors the schema documented in
//! `docs/01-architecture.md` § Pack Architecture.
//!
//! Design contract (architecture iron rules these types defend):
//!
//! 1. `schema_version` is forward-compatible. v0.2.0 ships v1; future
//!    Corey versions MUST keep accepting v1 manifests indefinitely.
//!    A larger-than-known schema_version is rejected with a clear
//!    error so an old binary never silently misreads a newer Pack.
//!
//! 2. Unknown fields are silently tolerated within a known schema
//!    version. This lets a newer Pack add fields and still load on
//!    an older binary that simply ignores them. Strict-mode parsing
//!    would create a churn nightmare for delivered binaries.
//!
//! 3. Every section is optional except `id` and `version` (the
//!    minimum metadata needed to register the Pack at all). A Pack
//!    with no MCP servers, no views, only Skills is perfectly valid
//!    and useful.
//!
//! 4. Field names match `docs/01-architecture.md` exactly. If you
//!    change a name here, update the doc in the same commit.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Highest manifest schema version this binary knows how to load.
/// Bump only when adding a field that older binaries genuinely
/// cannot ignore (rare). Default for new fields: add to v1 with
/// `#[serde(default)]` so v1 manifests keep working.
pub const MAX_KNOWN_SCHEMA_VERSION: u32 = 1;

/// Top-level Pack manifest. Loaded once when the Pack is enabled
/// and held read-only thereafter (per "skill-packs/ is read-only"
/// iron rule).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackManifest {
    /// Manifest schema version. v0.2.0 ships v1.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,

    /// Stable pack identifier. Lowercase ASCII + underscores. Forms
    /// the URL prefix `/pack/<id>/<view>` and the data dir
    /// `~/.hermes/pack-data/<id>/`.
    pub id: String,

    /// Semver (or anything semver-compatible) string. Compared as a
    /// string for now — proper semver-aware migration logic lives
    /// behind `migrations:` rather than here.
    pub version: String,

    /// Human display name (sidebar group label, store list).
    #[serde(default)]
    pub title: String,

    /// One-line description (Settings → Packs detail panel).
    #[serde(default)]
    pub description: String,

    /// Path to icon (relative to Pack root). Empty = no icon.
    #[serde(default)]
    pub icon: String,

    /// Pack author / vendor display string.
    #[serde(default)]
    pub author: String,

    /// Compatibility constraints. If unmet at load time the Pack
    /// fails to enable with a clear message.
    #[serde(default)]
    pub requires: PackRequires,

    /// License feature gate. The Pack is only loaded if the active
    /// license's `features` array contains this string. Empty =
    /// no license gate (free / built-in pack).
    #[serde(default)]
    pub license_feature: String,

    /// MCP servers to spawn when this Pack is enabled. Each one is
    /// run as a subprocess managed by the Pack lifecycle.
    #[serde(default)]
    pub mcp_servers: Vec<McpServerSpec>,

    /// Hermes-format `.md` skill files to register. Paths relative
    /// to Pack root.
    #[serde(default)]
    pub skills: Vec<String>,

    /// Workflow YAML files to register. Paths relative to Pack root.
    #[serde(default)]
    pub workflows: Vec<String>,

    /// Cron schedules that drive workflows.
    #[serde(default)]
    pub schedules: Vec<ScheduleSpec>,

    /// Views to mount under `/pack/<id>/<view_id>`. Each view is a
    /// composition of one of the basebuilt 12 templates plus a
    /// data source and optional action buttons.
    #[serde(default)]
    pub views: Vec<ViewSpec>,

    /// Per-Pack configuration schema. Drives the "first enable"
    /// form and what `customer.yaml`'s `packs.config.<id>` may
    /// pre-fill.
    #[serde(default)]
    pub config_schema: Vec<ConfigField>,

    /// Persona / SOUL fragments to inject into the system prompt
    /// when this Pack is active. Paths relative to Pack root.
    #[serde(default)]
    pub soul_inject: Vec<String>,

    /// Cross-version data migrations. Run in declared order when an
    /// upgrade lands a new manifest with a higher `version`.
    #[serde(default)]
    pub migrations: Vec<Migration>,
}

fn default_schema_version() -> u32 {
    1
}

/// Compatibility requirements. Empty / default is "no constraints".
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackRequires {
    /// Minimum Corey base version, e.g. `">=0.2.0"`. Empty = any
    /// version that knows about Pack manifests.
    #[serde(default)]
    pub corey: String,

    /// Names of view templates this Pack uses. Pack load fails if
    /// the active binary doesn't ship one of these (e.g. a Pack
    /// using `RadarChart` against a v0.1.x base).
    #[serde(default)]
    pub templates: Vec<String>,
}

/// One MCP server subprocess. Lifecycle: spawned when Pack is
/// enabled, killed when disabled. Crashes are surfaced as Pack
/// errors but do not bring the host app down.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpServerSpec {
    /// Stable server id, used to address it from views and skills.
    pub id: String,

    /// Transport. Currently only `stdio` is supported; sse/ws will
    /// be added when a real Pack needs them.
    #[serde(default = "default_mcp_transport")]
    #[serde(rename = "type")]
    pub transport: String,

    /// Argv. The first element is the binary path, possibly with
    /// `${platform}` template variables (resolved by the loader to
    /// the current OS / arch matching the precompiled binary
    /// shipped under `mcp/<id>/`).
    pub command: Vec<String>,

    /// Environment overrides passed to the subprocess. Values may
    /// reference `${pack_data_dir}` and `${pack_config.<key>}`
    /// templates (resolved by the loader, NOT by serde).
    #[serde(default)]
    pub env: BTreeMap<String, String>,

    /// Whether to auto-start this server when the Pack is enabled.
    /// Defaults to true; false means the user has to invoke it
    /// explicitly from a workflow / skill.
    #[serde(default = "default_true")]
    pub auto_start: bool,

    /// Spawn-to-handshake budget in ms. After this we mark the MCP
    /// as failed and surface in UI. 0 = no timeout.
    #[serde(default = "default_mcp_timeout_ms")]
    pub timeout_ms: u32,
}

fn default_mcp_transport() -> String {
    "stdio".to_string()
}

fn default_true() -> bool {
    true
}

fn default_mcp_timeout_ms() -> u32 {
    30_000
}

/// One cron schedule. Matches what Hermes' cron module already
/// understands; the Pack loader hands each schedule to that module
/// at enable time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScheduleSpec {
    pub id: String,
    /// 5-field cron string (minute hour day-of-month month
    /// day-of-week). Validated by Hermes, not by us.
    pub cron: String,
    /// Workflow id (matches an entry in `workflows:`) to run.
    pub workflow: String,
    #[serde(default)]
    pub description: String,
}

/// One Pack view. The loader picks the matching basebuilt template
/// and renders it with the supplied data source / actions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ViewSpec {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: String,
    /// Sidebar section: `primary`, `tools`, `more`, or `pack`
    /// (default group for Pack views).
    #[serde(default = "default_nav_section")]
    pub nav_section: String,

    /// Template name. MUST match one of the basebuilt 12 templates
    /// (DataTable, MetricsCard, ...) or a future addition.
    pub template: String,

    /// How the template fetches its data. Concrete contents are
    /// template-dependent (e.g. DataTable expects { mcp, method,
    /// columns }). Stored as raw YAML so adding new templates
    /// doesn't require schema changes here.
    #[serde(default)]
    pub data_source: serde_yaml::Value,

    /// Free-form options the renderer interprets per-template.
    /// Examples: `columns:` for DataTable, `metrics:` for
    /// MetricsCard, `layout:` for CompositeDashboard.
    #[serde(default, flatten)]
    pub options: BTreeMap<String, serde_yaml::Value>,

    /// "Decision return" buttons attached to the view. Click →
    /// fire a workflow or skill with the current view context.
    #[serde(default)]
    pub actions: Vec<ActionButton>,
}

fn default_nav_section() -> String {
    "pack".to_string()
}

/// A button rendered alongside a view body. Either `workflow` or
/// `skill` MUST be set; if both are present `workflow` wins.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActionButton {
    pub label: String,
    /// Optional workflow id to launch.
    #[serde(default)]
    pub workflow: String,
    /// Optional skill id to invoke.
    #[serde(default)]
    pub skill: String,
    /// Show "are you sure?" before firing. Use for destructive
    /// actions (pause campaign, delete listing).
    #[serde(default)]
    pub confirm: bool,
}

/// Pack configuration field. The loader generates a form from
/// these on first enable; `customer.yaml`'s `packs.config.<id>`
/// can pre-fill any subset.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigField {
    pub key: String,
    #[serde(default)]
    pub label: String,
    /// `secret | string | number | enum | bool`. Loader-side enum;
    /// kept as a String here to avoid breaking on additions.
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub required: bool,
    /// Default value as raw YAML (string, number, bool, etc).
    #[serde(default)]
    pub default: serde_yaml::Value,
    /// For `enum`-typed fields: the list of allowed values.
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub description: String,
}

/// A migration step from one Pack version to the next. Run by the
/// loader on upgrade BEFORE starting the Pack so config / state
/// is in the new shape by the time MCP servers spawn.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Migration {
    pub from_version: String,
    pub to_version: String,
    /// `old_key -> new_key` renames applied to `pack-data/<id>/config.json`.
    #[serde(default)]
    pub config_renames: BTreeMap<String, String>,
    /// `key -> default_value` to insert when missing.
    #[serde(default)]
    pub config_defaults: BTreeMap<String, serde_yaml::Value>,
}

/// Outcome of attempting to load a manifest.
///
/// `Loaded` is boxed because `PackManifest` is materially larger
/// than a `String`, and clippy's `large_enum_variant` lint balks
/// at the size delta otherwise.
#[derive(Debug)]
pub enum ManifestLoadOutcome {
    /// Parsed and validated.
    Loaded(Box<PackManifest>),
    /// File present but unreadable / unparseable / unsupported
    /// schema version. Carries a reason for UI surfacing.
    Invalid(String),
}

/// Parse a manifest YAML string. Public for tests; the production
/// entry point lives in `pack::mod`.
pub fn parse(raw: &str) -> ManifestLoadOutcome {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return ManifestLoadOutcome::Invalid("manifest is empty".to_string());
    }
    let manifest: PackManifest = match serde_yaml::from_str(trimmed) {
        Ok(m) => m,
        Err(e) => return ManifestLoadOutcome::Invalid(format!("yaml parse error: {e}")),
    };
    if let Err(e) = validate(&manifest) {
        return ManifestLoadOutcome::Invalid(e);
    }
    ManifestLoadOutcome::Loaded(Box::new(manifest))
}

fn validate(m: &PackManifest) -> Result<(), String> {
    if m.schema_version == 0 || m.schema_version > MAX_KNOWN_SCHEMA_VERSION {
        return Err(format!(
            "schema_version {} not supported (this Corey supports up to \
             {MAX_KNOWN_SCHEMA_VERSION}); upgrade the binary or downgrade the manifest.",
            m.schema_version
        ));
    }
    if m.id.trim().is_empty() {
        return Err("manifest.id is required and must not be empty".to_string());
    }
    if !is_safe_id(&m.id) {
        return Err(format!(
            "manifest.id {:?} contains forbidden characters (allow: a-z 0-9 _)",
            m.id
        ));
    }
    if m.version.trim().is_empty() {
        return Err("manifest.version is required and must not be empty".to_string());
    }
    Ok(())
}

/// Pack ids must be filesystem-safe and URL-safe: lowercase ASCII
/// letters, digits, underscore. No slashes, no dots, no spaces.
/// This guarantees `/pack/<id>/...` and `~/.hermes/pack-data/<id>/`
/// can never escape their parents.
fn is_safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_yaml() -> &'static str {
        r#"
schema_version: 1
id: cross_border_ecom
version: "1.0.0"
"#
    }

    #[test]
    fn minimal_manifest_parses() {
        match parse(minimal_yaml()) {
            ManifestLoadOutcome::Loaded(m) => {
                assert_eq!(m.id, "cross_border_ecom");
                assert_eq!(m.version, "1.0.0");
                assert_eq!(m.schema_version, 1);
                assert!(m.mcp_servers.is_empty());
                assert!(m.views.is_empty());
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn empty_manifest_is_rejected() {
        match parse("") {
            ManifestLoadOutcome::Invalid(msg) => assert!(msg.contains("empty")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn missing_id_is_rejected() {
        let yaml = r#"
schema_version: 1
version: "1.0.0"
"#;
        match parse(yaml) {
            ManifestLoadOutcome::Invalid(msg) => assert!(msg.contains("id")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn missing_version_is_rejected() {
        let yaml = r#"
schema_version: 1
id: foo
"#;
        match parse(yaml) {
            ManifestLoadOutcome::Invalid(msg) => assert!(msg.contains("version")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn unsafe_id_is_rejected() {
        for bad in ["Foo", "foo-bar", "foo/bar", "foo.bar", "foo bar"] {
            let yaml = format!("schema_version: 1\nid: \"{bad}\"\nversion: \"1.0.0\"\n");
            match parse(&yaml) {
                ManifestLoadOutcome::Invalid(msg) => {
                    assert!(msg.contains("forbidden characters"), "id={bad} msg={msg}")
                }
                other => panic!("expected Invalid for id={bad}, got {other:?}"),
            }
        }
    }

    #[test]
    fn future_schema_version_is_rejected() {
        let yaml = r#"
schema_version: 99
id: foo
version: "1.0.0"
"#;
        match parse(yaml) {
            ManifestLoadOutcome::Invalid(msg) => assert!(msg.contains("schema_version")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn full_manifest_parses() {
        let yaml = r##"
schema_version: 1
id: cross_border_ecom
version: "1.0.0"
title: 跨境电商
description: 对标麦多AI 9 能力的亚马逊运营 Pack
icon: icon.png
author: CoreyOS

requires:
  corey: ">=0.2.0"
  templates: [DataTable, MetricsCard, RadarChart]

license_feature: cross_border_ecom

mcp_servers:
  - id: amazon-sp
    type: stdio
    command: ["./mcp/amazon-sp/server-${platform}"]
    env:
      MCP_DATA_DIR: "${pack_data_dir}/mcp/amazon-sp"
      AMAZON_REFRESH_TOKEN: "${pack_config.amazon_refresh_token}"
    auto_start: true
    timeout_ms: 30000

skills:
  - skills/profit_calc.md
  - skills/ad_check.md

workflows:
  - workflows/ad_daily_check.yaml

schedules:
  - id: daily-ad-check
    cron: "0 9 * * *"
    workflow: ad_daily_check
    description: 每天 9 点跑广告守卫

views:
  - id: ad-monitor
    title: 广告守卫
    icon: bell
    nav_section: pack
    template: DataTable
    data_source:
      mcp: amazon-sp
      method: list_underperforming_ads
    columns: [campaign, acos, spend, sales]
    actions:
      - label: 否词
        workflow: negate_keyword
      - label: 关停广告
        workflow: pause_campaign
        confirm: true

config_schema:
  - key: amazon_refresh_token
    label: Amazon Refresh Token
    type: secret
    required: true
  - key: marketplace
    label: 默认市场
    type: enum
    options: ["US", "EU", "JP"]
    default: "US"

soul_inject:
  - prompts/soul.md

migrations:
  - from_version: "1.0.0"
    to_version: "1.1.0"
    config_renames:
      amazon_token: amazon_refresh_token
    config_defaults:
      marketplace: "US"
"##;
        match parse(yaml) {
            ManifestLoadOutcome::Loaded(m) => {
                assert_eq!(m.id, "cross_border_ecom");
                assert_eq!(m.title, "跨境电商");
                assert_eq!(m.requires.corey, ">=0.2.0");
                assert_eq!(m.requires.templates.len(), 3);
                assert_eq!(m.license_feature, "cross_border_ecom");
                assert_eq!(m.mcp_servers.len(), 1);
                assert_eq!(m.mcp_servers[0].transport, "stdio");
                assert_eq!(m.mcp_servers[0].timeout_ms, 30_000);
                assert!(m.mcp_servers[0].auto_start);
                assert_eq!(m.skills.len(), 2);
                assert_eq!(m.schedules.len(), 1);
                assert_eq!(m.schedules[0].cron, "0 9 * * *");
                assert_eq!(m.views.len(), 1);
                assert_eq!(m.views[0].template, "DataTable");
                assert_eq!(m.views[0].actions.len(), 2);
                assert!(m.views[0].actions[1].confirm);
                assert_eq!(m.config_schema.len(), 2);
                assert_eq!(m.config_schema[0].field_type, "secret");
                assert_eq!(m.migrations.len(), 1);
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn unknown_fields_are_tolerated() {
        // Forward-compat: a manifest with future fields still loads
        // on this binary as long as schema_version is known.
        let yaml = r#"
schema_version: 1
id: foo
version: "1.0.0"
future_field:
  whatever: 42
"#;
        match parse(yaml) {
            ManifestLoadOutcome::Loaded(m) => assert_eq!(m.id, "foo"),
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn mcp_server_defaults_apply() {
        // Only required fields on the MCP spec; defaults fill the rest.
        let yaml = r#"
schema_version: 1
id: foo
version: "1.0.0"
mcp_servers:
  - id: srv
    command: ["./bin"]
"#;
        match parse(yaml) {
            ManifestLoadOutcome::Loaded(m) => {
                assert_eq!(m.mcp_servers[0].transport, "stdio");
                assert!(m.mcp_servers[0].auto_start);
                assert_eq!(m.mcp_servers[0].timeout_ms, 30_000);
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn view_default_nav_section_is_pack() {
        let yaml = r#"
schema_version: 1
id: foo
version: "1.0.0"
views:
  - id: v1
    title: View One
    template: DataTable
"#;
        match parse(yaml) {
            ManifestLoadOutcome::Loaded(m) => {
                assert_eq!(m.views[0].nav_section, "pack");
            }
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn malformed_yaml_is_invalid() {
        match parse("schema_version: : :") {
            ManifestLoadOutcome::Invalid(msg) => assert!(msg.contains("yaml parse error")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }
}
