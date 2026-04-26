//! Static catalog of the 8 messaging channels Hermes supports
//! (Telegram, Discord, Slack, WhatsApp, Matrix, Feishu, WeiXin, WeCom).
//!
//! Phase 3 · T3.1 — the schema that drives everything downstream:
//!   - Rust side: env-key allowlist extension so `hermes_env_set_key` can
//!     store channel tokens without a separate code path per channel.
//!   - Frontend side: drives form rendering (label, input kind, masking
//!     rules) via `hermes_channel_list`.
//!
//! The catalog is a `Lazy<Vec<ChannelSpec>>` built at first access, keyed
//! by the channel's stable slug (`telegram`, `discord`, …). Slugs never
//! change — frontend code and changelog entries reference them.
//!
//! **2026-04-23 pm (T6.7a)**: schema reconciled against `hermes-agent`
//! upstream (see `docs/hermes-reality-check-2026-04-23.md`). Three env
//! names were silently mismatched and are now corrected:
//!   - `WHATSAPP_TOKEN` (never read by Hermes) → `WHATSAPP_ENABLED` +
//!     `WHATSAPP_MODE` + `WHATSAPP_ALLOWED_USERS`.
//!   - `WECOM_BOT_SECRET` → `WECOM_SECRET` (no `BOT_` prefix).
//!   - `WECHAT_SESSION` + fake QR flow → `WEIXIN_ACCOUNT_ID` +
//!     `WEIXIN_TOKEN` + `WEIXIN_BASE_URL`. Hermes hits iLink directly;
//!     there is no QR flow upstream. The slug changes `wechat` →
//!     `weixin` to match Hermes' naming.
//!   - Slack also gained the optional `SLACK_APP_TOKEN` required for
//!     Socket Mode.
//!
//! What this module is NOT:
//!   - No actual write path. `write_env_key` / `write_channel_yaml`
//!     consume the spec for validation but the spec itself is pure data.
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
    /// footprint (all channels have one post-T6.7a).
    pub yaml_root: &'static str,
    pub env_keys: Vec<EnvKeySpec>,
    pub yaml_fields: Vec<YamlFieldSpec>,
    /// `true` if Hermes hot-reloads config changes for this channel; if
    /// `false`, the UI must surface a "restart gateway?" prompt after
    /// a save. Conservatively start at `false` for everything — we don't
    /// have runtime evidence yet — and flip on channel-by-channel.
    pub hot_reloadable: bool,
    /// Reserved: `true` when a channel uses a QR scan flow. No channel
    /// in Hermes uses one today — the previous WeChat QR implementation
    /// was based on a misread of the upstream schema. Kept in the type
    /// for forward-compatibility; always `false` today. Frontend treats
    /// it as a hint only and no longer mounts a QR panel.
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
        //
        // Slack's real deployment uses Socket Mode, which requires BOTH
        // a bot token (`xoxb-...`) and an app-level token (`xapp-...`).
        // We surface both so users don't end up with a gateway that
        // silently fails to connect. Only the bot token is marked
        // `required` so we don't hard-block users on webhook-style
        // integrations that skip Socket Mode.
        ChannelSpec {
            id: "slack",
            display_name: "Slack",
            yaml_root: "channels.slack",
            env_keys: vec![
                EnvKeySpec {
                    name: "SLACK_BOT_TOKEN".into(),
                    required: true,
                    hint_key: "channels.slack.hint_token".into(),
                },
                EnvKeySpec {
                    name: "SLACK_APP_TOKEN".into(),
                    required: false,
                    hint_key: "channels.slack.hint_app_token".into(),
                },
            ],
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
        // Hermes has no `WHATSAPP_TOKEN` (the old Corey schema wrote to
        // a variable Hermes never reads). Real integration uses a bridge
        // process, configured via `WHATSAPP_ENABLED` / `WHATSAPP_MODE`
        // (`bot` vs `self-chat`) / `WHATSAPP_ALLOWED_USERS` etc. — none
        // of which is a secret, so these all render as plain text inputs
        // without the password mask.
        ChannelSpec {
            id: "whatsapp",
            display_name: "WhatsApp",
            yaml_root: "channels.whatsapp",
            env_keys: vec![
                EnvKeySpec {
                    name: "WHATSAPP_ENABLED".into(),
                    required: true,
                    hint_key: "channels.whatsapp.hint_enabled".into(),
                },
                EnvKeySpec {
                    name: "WHATSAPP_MODE".into(),
                    required: false,
                    hint_key: "channels.whatsapp.hint_mode".into(),
                },
                EnvKeySpec {
                    name: "WHATSAPP_ALLOWED_USERS".into(),
                    required: false,
                    hint_key: "channels.whatsapp.hint_allowed_users".into(),
                },
                EnvKeySpec {
                    name: "WHATSAPP_ALLOW_ALL_USERS".into(),
                    required: false,
                    hint_key: "channels.whatsapp.hint_allow_all".into(),
                },
            ],
            yaml_fields: vec![
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
        // ── WeiXin (personal WeChat via Tencent iLink) ───────────────
        //
        // Replaces the old `wechat` slug + fake QR flow. Hermes hits
        // `WEIXIN_BASE_URL` (defaults to `https://ilinkai.weixin.qq.com`)
        // directly with a plain account_id + token — no QR scan, no
        // session cookie dance. See `docs/hermes-reality-check-2026-04-23.md`.
        ChannelSpec {
            id: "weixin",
            display_name: "WeiXin (Personal)",
            yaml_root: "channels.weixin",
            env_keys: vec![
                EnvKeySpec {
                    name: "WEIXIN_ACCOUNT_ID".into(),
                    required: true,
                    hint_key: "channels.weixin.hint_account_id".into(),
                },
                EnvKeySpec {
                    name: "WEIXIN_TOKEN".into(),
                    required: true,
                    hint_key: "channels.weixin.hint_token".into(),
                },
                EnvKeySpec {
                    name: "WEIXIN_BASE_URL".into(),
                    required: false,
                    hint_key: "channels.weixin.hint_base_url".into(),
                },
                EnvKeySpec {
                    name: "WEIXIN_DM_POLICY".into(),
                    required: false,
                    hint_key: "channels.weixin.hint_dm_policy".into(),
                },
                EnvKeySpec {
                    name: "WEIXIN_GROUP_POLICY".into(),
                    required: false,
                    hint_key: "channels.weixin.hint_group_policy".into(),
                },
                EnvKeySpec {
                    name: "WEIXIN_ALLOWED_USERS".into(),
                    required: false,
                    hint_key: "channels.weixin.hint_allowed_users".into(),
                },
            ],
            yaml_fields: vec![],
            hot_reloadable: false,
            has_qr_login: false,
        },
        // ── WeCom (Enterprise WeChat) ────────────────────────────────
        //
        // Corrected 2026-04-23 pm: `WECOM_BOT_SECRET` in our old schema
        // was an off-by-prefix mistake; Hermes reads `WECOM_SECRET`.
        // Added websocket URL and allowlist for parity with Hermes.
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
                    name: "WECOM_SECRET".into(),
                    required: true,
                    hint_key: "channels.wecom.hint_secret".into(),
                },
                EnvKeySpec {
                    name: "WECOM_WEBSOCKET_URL".into(),
                    required: false,
                    hint_key: "channels.wecom.hint_websocket_url".into(),
                },
                EnvKeySpec {
                    name: "WECOM_ALLOWED_USERS".into(),
                    required: false,
                    hint_key: "channels.wecom.hint_allowed_users".into(),
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
mod tests;
