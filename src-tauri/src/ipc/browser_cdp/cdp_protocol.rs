//! CDP (Chrome DevTools Protocol) WebSocket helpers for our spawned
//! AI Browser. Two public entry points:
//!
//!   - [`apply_cdp_download_behavior`]: open a one-shot browser-level
//!     WS, send `Browser.setDownloadBehavior`, close. Routes downloads
//!     into `~/.hermes/downloads/` so `save_artifact(source_path=...)`
//!     can pick them up reliably across Chromium versions (the
//!     Preferences-file fallback in `spawn_chrome` is best-effort and
//!     Chromium frequently ignores it).
//!
//!   - [`apply_cdp_post_launch`]: same, plus optionally minimizes the
//!     window via `Browser.setWindowBounds`. Used after background
//!     boot-time spawn where `--window-position` is silently ignored
//!     by Chrome's saved-state restore (Local State / Preferences).
//!     Falls back to OS-level minimize (handled by parent module's
//!     `os_minimize_chrome_window`) when CDP `Browser.setWindowBounds`
//!     hits its long-standing macOS HEADED-Chrome bug
//!     (`Browser.getWindowForTarget` returns "Browser window not found",
//!     Chromium issue 1140655 et al.).
//!
//! Extracted from `browser_cdp.rs` 2026-05-17 to keep the WebSocket
//! protocol code in one place. The parent module owns lifecycle
//! (spawn / kill / detect Chrome) and the OS-level minimize fallback;
//! this submodule owns the wire layer.

use std::time::{Duration, Instant};

use super::CDP_PORT;

pub(super) fn apply_cdp_download_behavior() -> Result<(), String> {
    apply_cdp_post_launch(false)
}

/// Same as [`apply_cdp_download_behavior`] but additionally minimizes
/// the Chrome window to the dock when `minimize=true`. We use this for
/// background (boot-time) launches because:
///
/// - `--window-position=-2400,-2400` is **silently ignored** when the
///   user-data-dir already contains a `Local State` / `Preferences`
///   file with a saved window placement — Chrome restores the last
///   position. After the very first launch this is always the case.
/// - The macOS `osascript "set visible to false"` fallback requires
///   the user to grant System Events automation permission, and races
///   against Chrome registering with the Apple Event system.
///
/// `Browser.setWindowBounds` with `windowState: "minimized"` is
/// Chrome's official window-management API. It works regardless of
/// saved state, has no permission prompt, and the agent can still
/// navigate / click / snapshot the minimized window via CDP — Chrome
/// keeps the renderer running, only the OS window is hidden to the
/// dock.
pub(super) fn apply_cdp_post_launch(minimize: bool) -> Result<(), String> {
    let dl_dir = super::downloads_dir().map_err(|e| format!("resolve downloads dir: {e:?}"))?;
    std::fs::create_dir_all(&dl_dir).map_err(|e| format!("create downloads dir: {e}"))?;

    // Build a tiny current-thread tokio runtime so we don't touch
    // (or require) an ambient runtime. `apply_cdp_download_behavior`
    // is called from `spawn_blocking` contexts where there's no
    // surrounding runtime handle to inherit.
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => return Err(format!("build runtime: {e}")),
    };

    rt.block_on(async move {
        // (1) Resolve the browser-level WS URL via the JSON HTTP API.
        //     Chrome exposes `/json/version` once `DevToolsActivePort`
        //     has been written; the TCP listen probe in `launch_sync`
        //     doesn't guarantee that, so retry briefly here.
        let mut ws_url: Option<String> = None;
        let deadline = Instant::now() + Duration::from_secs(3);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(800))
            .build()
            .map_err(|e| format!("build http client: {e}"))?;
        while Instant::now() < deadline {
            match client
                .get(format!("http://localhost:{CDP_PORT}/json/version"))
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(v) = resp.json::<serde_json::Value>().await {
                        if let Some(s) = v
                            .get("webSocketDebuggerUrl")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string())
                        {
                            ws_url = Some(s);
                            break;
                        }
                    }
                }
                _ => {}
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        let ws_url = ws_url.ok_or_else(|| {
            "Chrome /json/version never returned a webSocketDebuggerUrl".to_string()
        })?;

        // (2) Open the WS and send setDownloadBehavior. We do NOT
        //     `eventsEnabled=true` because Corey doesn't subscribe to
        //     download progress events (the agent polls the filesystem
        //     via bash). Enabling them would just churn CDP messages.
        use futures::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let (mut ws, _resp) = tokio_tungstenite::connect_async(&ws_url)
            .await
            .map_err(|e| format!("cdp ws connect {ws_url}: {e}"))?;

        let payload = serde_json::json!({
            "id": 1,
            "method": "Browser.setDownloadBehavior",
            "params": {
                "behavior": "allowAndName",
                "downloadPath": dl_dir.to_string_lossy(),
                "eventsEnabled": false,
            }
        });
        ws.send(Message::Text(payload.to_string()))
            .await
            .map_err(|e| format!("cdp ws send: {e}"))?;

        // (3) Wait for the matching response or 2 s timeout, whichever
        //     comes first. Chrome can interleave events on the
        //     browser-level WS, so we read until we see `"id":1` or
        //     hit timeout. Errors get logged but not propagated.
        let read_deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if Instant::now() > read_deadline {
                return Err("cdp ws response timeout".to_string());
            }
            let next = tokio::time::timeout(Duration::from_millis(500), ws.next()).await;
            let Ok(Some(msg)) = next else {
                continue;
            };
            let msg = match msg {
                Ok(m) => m,
                Err(e) => return Err(format!("cdp ws recv: {e}")),
            };
            let Message::Text(text) = msg else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            if v.get("id").and_then(|x| x.as_u64()) == Some(1) {
                if let Some(err) = v.get("error") {
                    return Err(format!("Browser.setDownloadBehavior error: {err}"));
                }
                break;
            }
        }

        tracing::info!(
            "CDP Browser.setDownloadBehavior applied: downloadPath={}",
            dl_dir.display()
        );

        // (4) Optional: minimize the window. Best-effort — any failure
        //     here is logged warn and swallowed so it never blocks
        //     launch.
        //
        // CDP `Browser.setWindowBounds` has a long-standing macOS bug
        // for HEADED Chrome where `Browser.getWindowForTarget` returns
        // `{"code":-32000,"message":"Browser window not found"}` even
        // though the window clearly exists (Chromium issue 1140655 et
        // al.). When that happens we fall back to OS-level window
        // hiding via `os_minimize_chrome_window`, which is reliable
        // (uses Accessibility AXMinimized on macOS, ShowWindow SW_HIDE
        // on Windows).
        if minimize {
            if let Err(e) = cdp_minimize_window(&mut ws).await {
                tracing::warn!("CDP minimize window failed (non-fatal): {e}");
                let _ = ws.close(None).await;
                if let Err(e2) = super::lifecycle::os_minimize_chrome_window() {
                    tracing::warn!("OS minimize fallback failed (non-fatal): {e2}");
                } else {
                    tracing::info!("OS-level fallback minimized background Chrome window");
                }
                return Ok::<(), String>(());
            } else {
                tracing::info!("CDP background Chrome window minimized");
            }
        }

        let _ = ws.close(None).await;
        Ok::<(), String>(())
    })
}

/// Drive the minimize sequence on an already-open browser-level WS:
/// 1. `Target.getTargets` → pick a `page` target
/// 2. `Browser.getWindowForTarget {targetId}` → resolve windowId
/// 3. `Browser.setWindowBounds {windowId, bounds:{windowState:"minimized"}}`
///
/// We use the existing connection to keep this cheap (no second
/// WS handshake) and to make the request IDs sequential / debuggable.
async fn cdp_minimize_window<S>(
    ws: &mut tokio_tungstenite::WebSocketStream<S>,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    async fn rpc<S>(
        ws: &mut tokio_tungstenite::WebSocketStream<S>,
        id: u64,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let payload = serde_json::json!({"id": id, "method": method, "params": params});
        ws.send(Message::Text(payload.to_string()))
            .await
            .map_err(|e| format!("ws send {method}: {e}"))?;
        let read_deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if Instant::now() > read_deadline {
                return Err(format!("ws response timeout for {method}"));
            }
            let next = tokio::time::timeout(Duration::from_millis(500), ws.next()).await;
            let Ok(Some(msg)) = next else {
                continue;
            };
            let msg = match msg {
                Ok(m) => m,
                Err(e) => return Err(format!("ws recv {method}: {e}")),
            };
            let Message::Text(text) = msg else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            if v.get("id").and_then(|x| x.as_u64()) == Some(id) {
                if let Some(err) = v.get("error") {
                    return Err(format!("{method} error: {err}"));
                }
                return Ok(v.get("result").cloned().unwrap_or(serde_json::Value::Null));
            }
        }
    }

    // (1) Find any page target. Browser-level WS isn't bound to a
    //     specific target so we must resolve one explicitly before
    //     getWindowForTarget will work.
    let targets = rpc(ws, 10, "Target.getTargets", serde_json::json!({})).await?;
    let target_id = targets
        .get("targetInfos")
        .and_then(|t| t.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|t| t.get("type").and_then(|x| x.as_str()) == Some("page"))
                .and_then(|t| t.get("targetId").and_then(|x| x.as_str()))
                .map(|s| s.to_string())
        })
        .ok_or_else(|| "no page target found via Target.getTargets".to_string())?;

    // (2) Resolve windowId for that target.
    let win = rpc(
        ws,
        11,
        "Browser.getWindowForTarget",
        serde_json::json!({"targetId": target_id}),
    )
    .await?;
    let window_id = win
        .get("windowId")
        .and_then(|x| x.as_i64())
        .ok_or_else(|| "Browser.getWindowForTarget returned no windowId".to_string())?;

    // (3) Minimize. NOTE: when setting `windowState`, the bounds object
    //     must NOT contain left/top/width/height — Chrome rejects the
    //     call with `Cannot specify bounds when state is not normal`
    //     otherwise.
    rpc(
        ws,
        12,
        "Browser.setWindowBounds",
        serde_json::json!({
            "windowId": window_id,
            "bounds": {"windowState": "minimized"},
        }),
    )
    .await?;

    Ok(())
}
