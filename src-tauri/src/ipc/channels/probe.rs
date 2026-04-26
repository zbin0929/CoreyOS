//! Token probes for platform channels.
//!
//! Lets the Channels form pre-flight a freshly-pasted bot token by
//! hitting the platform's identity endpoint and surfacing what the
//! token actually authenticates as (`@MyBotName` / Slack workspace
//! name / Discord user id…). Saves the user a "saved → restarted →
//! oh, wrong token" round-trip.
//!
//! Scope: only platforms whose identity probe is a single GET with
//! the bot token alone — Telegram, Discord, Slack. Multi-credential
//! flows (WeCom, Feishu, WeiXin: corp_id + secret pair) and
//! installer-driven ones (Matrix, WhatsApp) are deferred until the
//! UI carries the second credential alongside the first.
//!
//! The endpoints we hit are public, idempotent, and rate-limited by
//! the platform itself; we add a 6-second per-probe timeout so a
//! flaky network never wedges the Settings UI.

use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

const PROBE_TIMEOUT_S: u64 = 6;
const TELEGRAM_API: &str = "https://api.telegram.org";
const DISCORD_API: &str = "https://discord.com/api/v10";
const SLACK_API: &str = "https://slack.com/api";

/// Result of a token probe.
///
/// `ok = true` means the platform accepted the token and we know
/// what it represents; the front-end displays `display_name` next
/// to the input as confirmation. `ok = false` carries a humanised
/// `error` string — typically the platform's own error code, since
/// users searching that string land on the right docs page faster
/// than they would on a generic "invalid token" message.
#[derive(Debug, Clone, Serialize)]
pub struct ChannelProbeResult {
    pub ok: bool,
    /// The platform's user-facing label for the entity the token
    /// belongs to: `@MyBotName` (Telegram), `MyBot#1234` (Discord),
    /// `acme-team` (Slack). `None` when `ok = false`.
    pub display_name: Option<String>,
    /// Optional secondary identifier — e.g. Slack's `team_id`,
    /// Discord's user id, Telegram's bot id. Surfaced as a tooltip
    /// in the UI so power users can tell two tokens apart at a
    /// glance.
    pub identifier: Option<String>,
    /// Humanised error message when `ok = false`. Prefer the
    /// platform's own `description` / `error` field over a generic
    /// label — it's almost always the most useful debugging signal.
    pub error: Option<String>,
}

/// IPC entry point. Dispatches by channel id to the per-platform
/// probe implementation. Unknown channel ids return a structured
/// error so the front-end can hide the affordance instead of
/// surfacing a confusing "probe failed" toast.
#[tauri::command]
pub async fn hermes_channel_probe_token(
    _state: State<'_, AppState>,
    channel_id: String,
    token: String,
) -> IpcResult<ChannelProbeResult> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(IpcError::Internal {
            message: "token is empty".into(),
        });
    }
    match channel_id.as_str() {
        "telegram" => probe_telegram(&token).await,
        "discord" => probe_discord(&token).await,
        "slack" => probe_slack(&token).await,
        other => Err(IpcError::Internal {
            message: format!("token probe not supported for channel '{other}'"),
        }),
    }
}

fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_S))
        .build()
}

// Telegram `getMe` returns `{ ok, description?, result: { id, username, first_name } }`.
// Schema captures only the fields we surface.
#[derive(serde::Deserialize)]
struct TelegramGetMe {
    ok: bool,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    result: Option<TelegramUser>,
}
#[derive(serde::Deserialize)]
struct TelegramUser {
    id: i64,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    first_name: Option<String>,
}

/// Map a parsed `getMe` body into the IPC result shape. Pulled out
/// of the async wrapper so the projection stays unit-testable
/// without spinning up an HTTP server.
fn telegram_result_from(body: TelegramGetMe) -> ChannelProbeResult {
    if !body.ok {
        return ChannelProbeResult {
            ok: false,
            display_name: None,
            identifier: None,
            error: Some(body.description.unwrap_or_else(|| "unknown error".into())),
        };
    }
    let Some(user) = body.result else {
        // Defensive: Telegram never emits this shape, but if a
        // future API tweak does we'd rather surface it as a probe
        // failure than crash the IPC.
        return ChannelProbeResult {
            ok: false,
            display_name: None,
            identifier: None,
            error: Some("getMe ok=true but result missing".into()),
        };
    };
    let display_name = user
        .username
        .as_deref()
        .map(|u| format!("@{u}"))
        .or(user.first_name);
    ChannelProbeResult {
        ok: true,
        display_name,
        identifier: Some(user.id.to_string()),
        error: None,
    }
}

async fn probe_telegram(token: &str) -> IpcResult<ChannelProbeResult> {
    let url = format!("{TELEGRAM_API}/bot{token}/getMe");
    let client = http_client().map_err(|e| IpcError::Internal {
        message: format!("http client: {e}"),
    })?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("telegram probe transport: {e}"),
        })?;
    let body: TelegramGetMe = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("telegram probe parse: {e}"),
    })?;
    Ok(telegram_result_from(body))
}

// Discord's `users/@me` returns `{ id, username, discriminator,
// global_name }` for bot tokens. Errors come back as
// `{ message: "401: Unauthorized", code }`.
#[derive(serde::Deserialize)]
struct DiscordMe {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    discriminator: Option<String>,
    #[serde(default)]
    global_name: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

fn discord_result_from(body: DiscordMe, http_ok: bool, status_label: &str) -> ChannelProbeResult {
    if !http_ok {
        return ChannelProbeResult {
            ok: false,
            display_name: None,
            identifier: None,
            error: Some(body.message.unwrap_or_else(|| status_label.to_string())),
        };
    }
    let display_name = body.global_name.or_else(|| {
        match (body.username.as_deref(), body.discriminator.as_deref()) {
            // Legacy Discord tag is `name#1234`; the migrated unique-
            // username world stamps `discriminator: "0"`, in which
            // case we drop the suffix.
            (Some(u), Some(d)) if d != "0" => Some(format!("{u}#{d}")),
            (Some(u), _) => Some(u.to_string()),
            _ => None,
        }
    });
    ChannelProbeResult {
        ok: true,
        display_name,
        identifier: body.id,
        error: None,
    }
}

async fn probe_discord(token: &str) -> IpcResult<ChannelProbeResult> {
    let url = format!("{DISCORD_API}/users/@me");
    let client = http_client().map_err(|e| IpcError::Internal {
        message: format!("http client: {e}"),
    })?;
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("discord probe transport: {e}"),
        })?;
    let status = resp.status();
    let status_label = status.to_string();
    let body: DiscordMe = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("discord probe parse: {e}"),
    })?;
    Ok(discord_result_from(body, status.is_success(), &status_label))
}

// Slack's `auth.test` returns `{ ok: true, team, user, team_id, user_id }`
// on success and `{ ok: false, error: "invalid_auth" }` otherwise.
#[derive(serde::Deserialize)]
struct SlackAuthTest {
    ok: bool,
    #[serde(default)]
    team: Option<String>,
    #[serde(default)]
    team_id: Option<String>,
    #[serde(default)]
    user: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn slack_result_from(body: SlackAuthTest) -> ChannelProbeResult {
    if !body.ok {
        return ChannelProbeResult {
            ok: false,
            display_name: None,
            identifier: None,
            error: Some(body.error.unwrap_or_else(|| "unknown error".into())),
        };
    }
    // Pretty label = `team` (workspace name) when present; fall
    // back to `user` for tokens whose scope doesn't surface team
    // info.
    let display_name = body.team.or_else(|| body.user.clone());
    ChannelProbeResult {
        ok: true,
        display_name,
        identifier: body.team_id,
        error: None,
    }
}

async fn probe_slack(token: &str) -> IpcResult<ChannelProbeResult> {
    let url = format!("{SLACK_API}/auth.test");
    let client = http_client().map_err(|e| IpcError::Internal {
        message: format!("http client: {e}"),
    })?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("slack probe transport: {e}"),
        })?;
    let body: SlackAuthTest = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("slack probe parse: {e}"),
    })?;
    Ok(slack_result_from(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to feed JSON straight into the Telegram parser the
    /// same way reqwest's `.json()` would. Failing to deserialize
    /// here is itself a useful coverage signal — the structs above
    /// have to keep up with whatever Telegram emits.
    fn parse_telegram(json: &str) -> ChannelProbeResult {
        let body: TelegramGetMe = serde_json::from_str(json).expect("valid JSON");
        telegram_result_from(body)
    }
    fn parse_discord(json: &str, http_ok: bool, status: &str) -> ChannelProbeResult {
        let body: DiscordMe = serde_json::from_str(json).expect("valid JSON");
        discord_result_from(body, http_ok, status)
    }
    fn parse_slack(json: &str) -> ChannelProbeResult {
        let body: SlackAuthTest = serde_json::from_str(json).expect("valid JSON");
        slack_result_from(body)
    }

    #[test]
    fn telegram_ok_with_username_renders_at_handle() {
        let out = parse_telegram(
            r#"{"ok": true, "result": {"id": 1234567890, "username": "MyBot", "first_name": "My Bot"}}"#,
        );
        assert!(out.ok);
        assert_eq!(out.display_name.as_deref(), Some("@MyBot"));
        assert_eq!(out.identifier.as_deref(), Some("1234567890"));
        assert!(out.error.is_none());
    }

    #[test]
    fn telegram_ok_without_username_falls_back_to_first_name() {
        let out = parse_telegram(
            r#"{"ok": true, "result": {"id": 42, "first_name": "Alice"}}"#,
        );
        assert!(out.ok);
        assert_eq!(out.display_name.as_deref(), Some("Alice"));
    }

    #[test]
    fn telegram_unauthorized_surfaces_platform_description() {
        let out = parse_telegram(r#"{"ok": false, "description": "Unauthorized"}"#);
        assert!(!out.ok);
        assert_eq!(out.error.as_deref(), Some("Unauthorized"));
        assert!(out.display_name.is_none());
    }

    #[test]
    fn discord_legacy_user_renders_with_discriminator() {
        let out = parse_discord(
            r#"{"id": "987", "username": "MyBot", "discriminator": "1234"}"#,
            true,
            "200 OK",
        );
        assert!(out.ok);
        assert_eq!(out.display_name.as_deref(), Some("MyBot#1234"));
        assert_eq!(out.identifier.as_deref(), Some("987"));
    }

    #[test]
    fn discord_unique_username_drops_zero_discriminator() {
        // Post-2023 Discord users have `discriminator: "0"`.
        let out = parse_discord(
            r#"{"id": "1", "username": "newbot", "discriminator": "0", "global_name": "New Bot"}"#,
            true,
            "200 OK",
        );
        // global_name wins when present.
        assert_eq!(out.display_name.as_deref(), Some("New Bot"));
    }

    #[test]
    fn discord_http_error_surfaces_message_or_status() {
        // Discord-style error body.
        let out = parse_discord(
            r#"{"message": "401: Unauthorized", "code": 0}"#,
            false,
            "401 Unauthorized",
        );
        assert!(!out.ok);
        assert_eq!(out.error.as_deref(), Some("401: Unauthorized"));
        // Empty body → fall back to status label.
        let out2 = parse_discord(r#"{}"#, false, "401 Unauthorized");
        assert_eq!(out2.error.as_deref(), Some("401 Unauthorized"));
    }

    #[test]
    fn slack_ok_uses_team_name_with_team_id_in_identifier() {
        let out = parse_slack(
            r#"{"ok": true, "team": "Acme", "team_id": "T123", "user": "alice"}"#,
        );
        assert!(out.ok);
        assert_eq!(out.display_name.as_deref(), Some("Acme"));
        assert_eq!(out.identifier.as_deref(), Some("T123"));
    }

    #[test]
    fn slack_ok_without_team_falls_back_to_user() {
        let out = parse_slack(r#"{"ok": true, "user": "bob"}"#);
        assert_eq!(out.display_name.as_deref(), Some("bob"));
    }

    #[test]
    fn slack_invalid_auth_surfaces_platform_error_code() {
        let out = parse_slack(r#"{"ok": false, "error": "invalid_auth"}"#);
        assert!(!out.ok);
        assert_eq!(out.error.as_deref(), Some("invalid_auth"));
    }
}
