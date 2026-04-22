//! Static catalog of the 8 messaging channels Hermes supports
//! (Telegram, Discord, Slack, WhatsApp, Matrix, Feishu, WeChat, WeCom).
//!
//! Phase 3 · T3.1 — the schema that drives everything downstream:
//!   - Rust side: env-key allowlist extension so `hermes_env_set_key` can
//!     store channel tokens without a separate code path per channel.
//!   - Frontend side: drives form rendering (label, input kind, masking
//!     rules) via `hermes_channel_list`.
//!
//! The catalog is a `Lazy<Vec<ChannelSpec>>` built at first access, keyed
//! by the channel's stable slug (`telegram`, `discord`, …). Slugs never
//! change — frontend code, changelog entries, and the WeChat QR flow all
//! reference them.
//!
//! What this module is NOT:
//!   - No actual write path. `write_env_key` / `write_channel_yaml`
//!     (landing with T3.2) consume the spec for validation but the
//!     spec itself is pure data.
//!   - No live status probing. Hermes exposes per-channel health on its
//!     own schedule; see T3.4.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

/// How a yaml field should be rendered + validated in the form.
/// Kept intentionally small — forms should fall back to a plain text input
/// if a channel's field doesn't fit one of these kinds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FieldKind {
    /// A `true`/`false` toggle (checkbox).
    Bool,
    /// Free-text string (single-line input).
    String,
    /// An ordered list of strings (chip input / textarea, one per line).
    /// Used for allow/deny lists, mention patterns, etc.
    StringList,
}

/// One field within a channel's `config.yaml` sub-tree. `path` is dotted
/// relative to the channel's root (e.g. `channels.telegram` → `path =
/// "mention_required"` → full path `channels.telegram.mention_required`).
/// The frontend never assembles the full path itself; it uses whatever
/// the backend returns from `hermes_channel_list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct YamlFieldSpec {
    /// Relative dotted path. Single-segment is fine.
    pub path: String,
    pub kind: FieldKind,
    /// i18n key for the UI label (frontend resolves through `useTranslation`).
    /// We keep it as a plain slug rather than hardcoding Hermes's YAML key
    /// so we can rename fields on the UI side without breaking Hermes.
    pub label_key: String,
    /// Optional default the UI shows when the field is unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_bool: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_string: Option<String>,
}

/// One env var (stored in `~/.hermes/.env`) a channel needs to operate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnvKeySpec {
    /// Env var name, UPPERCASE with underscores (e.g. `TELEGRAM_BOT_TOKEN`).
    pub name: String,
    /// `true` if the channel is unusable without this key set. Drives
    /// the "Not configured" pill in the UI.
    pub required: bool,
    /// Optional i18n key for a hint rendered under the input (e.g.
    /// "@BotFather → `/newbot`" for Telegram). Empty means no hint.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub hint_key: String,
}

/// A single channel's complete schema. One of these per row in
/// `channel_specs()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelSpec {
    /// Stable slug — `telegram`, `discord`, …
    pub id: &'static str,
    /// Plain display name; matches the Hermes UI labeling.
    pub display_name: &'static str,
    /// Dotted prefix for this channel's sub-tree in `config.yaml`
    /// (e.g. `channels.telegram`). Empty when the channel has no yaml
    /// footprint (WeChat is credentials-only).
    pub yaml_root: &'static str,
    pub env_keys: Vec<EnvKeySpec>,
    pub yaml_fields: Vec<YamlFieldSpec>,
    /// `true` if Hermes hot-reloads config changes for this channel; if
    /// `false`, the UI must surface a "restart gateway?" prompt after
    /// a save. Conservatively start at `false` for everything — we don't
    /// have runtime evidence yet — and flip on channel-by-channel.
    pub hot_reloadable: bool,
    /// Set for WeChat so the UI can render a QR scanner instead of a
    /// plain form. Reserved for T3.3.
    pub has_qr_login: bool,
}

/// Build the static catalog. Order matters: the frontend renders cards
/// in this order. Kept deliberately close to the Phase 3 doc's table so
/// a `diff` between doc and code is readable.
fn build_specs() -> Vec<ChannelSpec> {
    vec![
        // ── Telegram ──────────────────────────────────────────────────
        ChannelSpec {
            id: "telegram",
            display_name: "Telegram",
            yaml_root: "channels.telegram",
            env_keys: vec![EnvKeySpec {
                name: "TELEGRAM_BOT_TOKEN".into(),
                required: true,
                hint_key: "channels.telegram.hint_token".into(),
            }],
            yaml_fields: vec![
                YamlFieldSpec {
                    path: "mention_required".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.mention_required".into(),
                    default_bool: Some(true),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "reactions".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.reactions".into(),
                    default_bool: Some(true),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "free_chats".into(),
                    kind: FieldKind::StringList,
                    label_key: "channels.telegram.free_chats".into(),
                    default_bool: None,
                    default_string: None,
                },
            ],
            hot_reloadable: false,
            has_qr_login: false,
        },
        // ── Discord ──────────────────────────────────────────────────
        ChannelSpec {
            id: "discord",
            display_name: "Discord",
            yaml_root: "channels.discord",
            env_keys: vec![EnvKeySpec {
                name: "DISCORD_BOT_TOKEN".into(),
                required: true,
                hint_key: "channels.discord.hint_token".into(),
            }],
            yaml_fields: vec![
                YamlFieldSpec {
                    path: "mention_required".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.mention_required".into(),
                    default_bool: Some(true),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "auto_thread".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.auto_thread".into(),
                    default_bool: Some(false),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "reactions".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.reactions".into(),
                    default_bool: Some(true),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "allow_channels".into(),
                    kind: FieldKind::StringList,
                    label_key: "channels.discord.allow_channels".into(),
                    default_bool: None,
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "ignore_channels".into(),
                    kind: FieldKind::StringList,
                    label_key: "channels.discord.ignore_channels".into(),
                    default_bool: None,
                    default_string: None,
                },
            ],
            hot_reloadable: false,
            has_qr_login: false,
        },
        // ── Slack ────────────────────────────────────────────────────
        ChannelSpec {
            id: "slack",
            display_name: "Slack",
            yaml_root: "channels.slack",
            env_keys: vec![EnvKeySpec {
                name: "SLACK_BOT_TOKEN".into(),
                required: true,
                hint_key: "channels.slack.hint_token".into(),
            }],
            yaml_fields: vec![
                YamlFieldSpec {
                    path: "mention_required".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.mention_required".into(),
                    default_bool: Some(true),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "handle_bot_messages".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.slack.handle_bot_messages".into(),
                    default_bool: Some(false),
                    default_string: None,
                },
            ],
            hot_reloadable: false,
            has_qr_login: false,
        },
        // ── WhatsApp ─────────────────────────────────────────────────
        //
        // Credential env names are marked TBD in the Phase 3 doc — we
        // need to verify against a live Hermes. For now ship a single
        // placeholder key and let T3.2 nail it down when we wire forms.
        ChannelSpec {
            id: "whatsapp",
            display_name: "WhatsApp",
            yaml_root: "channels.whatsapp",
            env_keys: vec![EnvKeySpec {
                name: "WHATSAPP_TOKEN".into(),
                required: true,
                hint_key: "channels.whatsapp.hint_token".into(),
            }],
            yaml_fields: vec![
                YamlFieldSpec {
                    path: "enable".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.enable".into(),
                    default_bool: Some(false),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "mention_required".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.mention_required".into(),
                    default_bool: Some(true),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "mention_patterns".into(),
                    kind: FieldKind::StringList,
                    label_key: "channels.whatsapp.mention_patterns".into(),
                    default_bool: None,
                    default_string: None,
                },
            ],
            hot_reloadable: false,
            has_qr_login: false,
        },
        // ── Matrix ───────────────────────────────────────────────────
        ChannelSpec {
            id: "matrix",
            display_name: "Matrix",
            yaml_root: "channels.matrix",
            env_keys: vec![
                EnvKeySpec {
                    name: "MATRIX_ACCESS_TOKEN".into(),
                    required: true,
                    hint_key: "channels.matrix.hint_token".into(),
                },
                EnvKeySpec {
                    name: "MATRIX_HOMESERVER".into(),
                    required: true,
                    hint_key: "channels.matrix.hint_homeserver".into(),
                },
            ],
            yaml_fields: vec![
                YamlFieldSpec {
                    path: "auto_thread".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.field.auto_thread".into(),
                    default_bool: Some(false),
                    default_string: None,
                },
                YamlFieldSpec {
                    path: "dm_mention_thread".into(),
                    kind: FieldKind::Bool,
                    label_key: "channels.matrix.dm_mention_thread".into(),
                    default_bool: Some(false),
                    default_string: None,
                },
            ],
            hot_reloadable: false,
            has_qr_login: false,
        },
        // ── Feishu (Lark) ────────────────────────────────────────────
        ChannelSpec {
            id: "feishu",
            display_name: "Feishu (Lark)",
            yaml_root: "channels.feishu",
            env_keys: vec![
                EnvKeySpec {
                    name: "FEISHU_APP_ID".into(),
                    required: true,
                    hint_key: "channels.feishu.hint_app_id".into(),
                },
                EnvKeySpec {
                    name: "FEISHU_APP_SECRET".into(),
                    required: true,
                    hint_key: "channels.feishu.hint_app_secret".into(),
                },
            ],
            yaml_fields: vec![YamlFieldSpec {
                path: "mention_required".into(),
                kind: FieldKind::Bool,
                label_key: "channels.field.mention_required".into(),
                default_bool: Some(true),
                default_string: None,
            }],
            hot_reloadable: false,
            has_qr_login: false,
        },
        // ── WeChat ───────────────────────────────────────────────────
        //
        // Credentials come in via the QR scan flow (T3.3), not a text
        // input. We still ship an EnvKeySpec so the allowlist accepts
        // the eventual write, but `required=false` + `has_qr_login=true`
        // tell the UI to render a QR button in place of an input.
        ChannelSpec {
            id: "wechat",
            display_name: "WeChat",
            yaml_root: "",
            env_keys: vec![EnvKeySpec {
                name: "WECHAT_SESSION".into(),
                required: false,
                hint_key: "channels.wechat.hint_qr".into(),
            }],
            yaml_fields: vec![],
            hot_reloadable: false,
            has_qr_login: true,
        },
        // ── WeCom (Enterprise WeChat) ────────────────────────────────
        ChannelSpec {
            id: "wecom",
            display_name: "WeCom",
            yaml_root: "channels.wecom",
            env_keys: vec![
                EnvKeySpec {
                    name: "WECOM_BOT_ID".into(),
                    required: true,
                    hint_key: "channels.wecom.hint_bot_id".into(),
                },
                EnvKeySpec {
                    name: "WECOM_BOT_SECRET".into(),
                    required: true,
                    hint_key: "channels.wecom.hint_bot_secret".into(),
                },
            ],
            yaml_fields: vec![],
            hot_reloadable: false,
            has_qr_login: false,
        },
    ]
}

/// The catalog. Built once at first access.
pub static CHANNEL_SPECS: Lazy<Vec<ChannelSpec>> = Lazy::new(build_specs);

/// Lookup a channel by its stable slug. `O(n)` over 8 entries — fine.
pub fn find_spec(id: &str) -> Option<&'static ChannelSpec> {
    CHANNEL_SPECS.iter().find(|s| s.id == id)
}

/// Flat set of every env-key name any channel declares. Used by
/// `hermes_config::is_allowed_env_key` so `hermes_env_set_key` accepts
/// channel tokens without relaxing its `*_API_KEY` rule for other callers.
///
/// Returns owned `String`s rather than `&'static str`: the catalog is a
/// `Lazy<Vec<_>>` so the borrows would in fact be `'static`, but keeping
/// the API owned avoids an `unsafe` lifetime transmute and the ~16-byte
/// allocation cost is nothing next to an `.env` read.
pub fn allowed_channel_env_keys() -> Vec<String> {
    CHANNEL_SPECS
        .iter()
        .flat_map(|s| s.env_keys.iter().map(|e| e.name.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_has_exactly_eight_channels_with_unique_ids() {
        assert_eq!(CHANNEL_SPECS.len(), 8);
        let mut ids = HashSet::new();
        for s in CHANNEL_SPECS.iter() {
            assert!(ids.insert(s.id), "duplicate channel id: {}", s.id);
        }
    }

    #[test]
    fn every_channel_has_a_display_name_and_ids_are_lowercase() {
        for s in CHANNEL_SPECS.iter() {
            assert!(!s.display_name.is_empty(), "{} missing name", s.id);
            assert!(
                s.id.chars().all(|c| c.is_ascii_lowercase()),
                "id '{}' must be all-lowercase",
                s.id,
            );
        }
    }

    #[test]
    fn wechat_is_the_only_qr_channel() {
        let qrs: Vec<_> = CHANNEL_SPECS.iter().filter(|s| s.has_qr_login).collect();
        assert_eq!(qrs.len(), 1);
        assert_eq!(qrs[0].id, "wechat");
    }

    #[test]
    fn find_spec_lookup_works_and_unknown_returns_none() {
        assert_eq!(find_spec("telegram").unwrap().id, "telegram");
        assert_eq!(find_spec("feishu").unwrap().display_name, "Feishu (Lark)");
        assert!(find_spec("twitter").is_none());
    }

    #[test]
    fn every_required_env_key_name_is_screaming_snake_case() {
        for spec in CHANNEL_SPECS.iter() {
            for env in &spec.env_keys {
                assert!(
                    env.name
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'),
                    "env name '{}' should be SCREAMING_SNAKE_CASE",
                    env.name
                );
                assert!(
                    !env.name.starts_with('_') && !env.name.ends_with('_'),
                    "env name '{}' shouldn't have leading/trailing underscore",
                    env.name,
                );
            }
        }
    }

    #[test]
    fn allowed_channel_env_keys_includes_every_declared_name() {
        let allowed: HashSet<String> = allowed_channel_env_keys().into_iter().collect();
        for spec in CHANNEL_SPECS.iter() {
            for env in &spec.env_keys {
                assert!(
                    allowed.contains(&env.name),
                    "{} missing from allowlist",
                    env.name,
                );
            }
        }
        // Sanity: the allowlist doesn't accidentally include a random
        // non-channel name.
        assert!(!allowed.contains("OPENAI_API_KEY"));
    }

    #[test]
    fn yaml_fields_never_use_empty_or_absolute_paths() {
        for spec in CHANNEL_SPECS.iter() {
            for field in &spec.yaml_fields {
                assert!(!field.path.is_empty(), "{}: empty yaml path", spec.id);
                assert!(
                    !field.path.starts_with('.'),
                    "{}: yaml path must be relative, got '{}'",
                    spec.id,
                    field.path,
                );
            }
        }
    }

    #[test]
    fn yaml_root_matches_id_convention_except_for_rootless_channels() {
        for spec in CHANNEL_SPECS.iter() {
            if spec.yaml_root.is_empty() {
                // Only WeChat should be rootless at the moment.
                assert_eq!(spec.id, "wechat");
                continue;
            }
            assert!(
                spec.yaml_root.starts_with("channels."),
                "{}: yaml_root '{}' should live under channels.*",
                spec.id,
                spec.yaml_root,
            );
            assert!(
                spec.yaml_root.ends_with(spec.id),
                "{}: yaml_root '{}' should end with the channel id",
                spec.id,
                spec.yaml_root,
            );
        }
    }
}
