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

async fn probe_telegram(token: &str) -> IpcResult<ChannelProbeResult> {
    // Telegram's `getMe` returns `{ ok: true, result: { id, username, first_name } }`
    // on success and `{ ok: false, description: "Unauthorized" }` on
    // an invalid token. We mirror their `ok` flag straight through.
    #[derive(serde::Deserialize)]
    struct Resp {
        ok: bool,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        result: Option<TgUser>,
    }
    #[derive(serde::Deserialize)]
    struct TgUser {
        id: i64,
        #[serde(default)]
        username: Option<String>,
        #[serde(default)]
        first_name: Option<String>,
    }
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
    let body: Resp = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("telegram probe parse: {e}"),
    })?;
    if !body.ok {
        return Ok(ChannelProbeResult {
            ok: false,
            display_name: None,
            identifier: None,
            error: Some(body.description.unwrap_or_else(|| "unknown error".into())),
        });
    }
    let user = body.result.ok_or_else(|| IpcError::Internal {
        message: "telegram getMe ok=true but result missing".into(),
    })?;
    let display_name = user
        .username
        .as_deref()
        .map(|u| format!("@{u}"))
        .or(user.first_name);
    Ok(ChannelProbeResult {
        ok: true,
        display_name,
        identifier: Some(user.id.to_string()),
        error: None,
    })
}

async fn probe_discord(token: &str) -> IpcResult<ChannelProbeResult> {
    // Discord's `users/@me` returns `{ id, username, discriminator,
    // global_name }` for bot tokens (auth header `Bot <token>`).
    // Errors come back as `{ message: "401: Unauthorized", code }`.
    #[derive(serde::Deserialize)]
    struct Resp {
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
    let body: Resp = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("discord probe parse: {e}"),
    })?;
    if !status.is_success() {
        return Ok(ChannelProbeResult {
            ok: false,
            display_name: None,
            identifier: None,
            error: Some(body.message.unwrap_or_else(|| status.to_string())),
        });
    }
    let display_name = body.global_name.or_else(|| {
        match (body.username.as_deref(), body.discriminator.as_deref()) {
            (Some(u), Some(d)) if d != "0" => Some(format!("{u}#{d}")),
            (Some(u), _) => Some(u.to_string()),
            _ => None,
        }
    });
    Ok(ChannelProbeResult {
        ok: true,
        display_name,
        identifier: body.id,
        error: None,
    })
}

async fn probe_slack(token: &str) -> IpcResult<ChannelProbeResult> {
    // Slack's `auth.test` returns `{ ok: true, team, user, team_id, user_id }`
    // on success and `{ ok: false, error: "invalid_auth" }` otherwise.
    // Bot tokens go in the `Authorization: Bearer <token>` header.
    #[derive(serde::Deserialize)]
    struct Resp {
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
    let body: Resp = resp.json().await.map_err(|e| IpcError::Internal {
        message: format!("slack probe parse: {e}"),
    })?;
    if !body.ok {
        return Ok(ChannelProbeResult {
            ok: false,
            display_name: None,
            identifier: None,
            error: Some(body.error.unwrap_or_else(|| "unknown error".into())),
        });
    }
    // Pretty label = `team` (workspace name) when present; fall
    // back to `user` for tokens whose scope doesn't surface team
    // info.
    let display_name = body.team.or_else(|| body.user.clone());
    Ok(ChannelProbeResult {
        ok: true,
        display_name,
        identifier: body.team_id,
        error: None,
    })
}
