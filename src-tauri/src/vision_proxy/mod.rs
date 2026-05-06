//! **Vision Proxy** — feed images to a vision-capable LLM, then hand
//! the resulting description as plain text to whichever non-vision
//! model the user is actually chatting with.
//!
//! Use case: user has a chat going with `deepseek-chat` (no vision)
//! and drops a screenshot in. Without the proxy the model gets
//! `[attached: foo.png (图片 - 当前模型不支持图片)]` and is stuck.
//! With the proxy: we hit a configured vision model (e.g.
//! `gpt-4o-mini`, `qwen-vl-plus`, `claude-3.5-sonnet`) once per
//! image, get back a structured description, and append the
//! description into the user's text.
//!
//! ## Why pre-process at the IPC boundary, not inside the adapter
//!
//! The `build_content` function in `adapters/hermes/text_extract.rs`
//! is sync and called from many call paths (chat / compare / agent
//! eval). Making it async would ripple through five files. Instead
//! we hook in `chat_stream_start` (and `chat_send`) right before
//! `ChatTurn` is built, where we already have an async runtime, and
//! we mutate the **input** (text + attachments) so the adapter sees
//! a turn that's already been "vision-resolved".
//!
//! ## Cache
//!
//! Each image is hashed (SHA-256 of bytes); the description is
//! cached at `~/.hermes/vision_cache/<hex>.txt`. Second time we see
//! the same image bytes we skip the LLM call entirely. The cache is
//! a flat directory with no eviction — images are typically tiny
//! (< 1 MB) and screenshots get overwritten by hash collision
//! resistance, so unbounded growth isn't a real concern.
//!
//! ## Hermes Agent invariant
//!
//! Zero changes to the Hermes Agent or any adapter. The vision
//! proxy lives entirely in Corey-side glue and uses raw HTTP to
//! reach an OpenAI-compatible endpoint.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::adapters::ChatAttachmentRef;

const CONFIG_FILE: &str = "vision_proxy.json";
const CACHE_DIR: &str = "vision_cache";

/// On-disk shape persisted at `~/.hermes/vision_proxy.json`.
///
/// Mirrors `BrowserConfig` (browser_config.rs) so users have a
/// single mental model for "configure an OpenAI-compatible
/// endpoint": model name, base URL, and either an inline key or
/// the **name** of an env var that holds the key (the latter is
/// preferred — keeps secrets out of JSON files).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VisionProxyConfig {
    /// Disabled by default; user opts in via Settings.
    #[serde(default)]
    pub enabled: bool,
    /// Provider/model in the form the user's gateway expects, e.g.
    /// `"openai/gpt-4o-mini"` or `"qwen-vl-plus"`.
    #[serde(default)]
    pub model: String,
    /// OpenAI-compatible chat completions endpoint base URL.
    /// Trailing slash optional; we strip it on send.
    #[serde(default)]
    pub base_url: String,
    /// Inline API key. Plaintext — for users who don't mind it
    /// living in JSON. Falls back to `api_key_env` if empty.
    #[serde(default)]
    pub api_key: String,
    /// Name of an environment variable that holds the key (read
    /// from the process env first, then `~/.hermes/.env` via
    /// `hermes_config::read_env_value`). Preferred over inline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    /// Optional override for the describe prompt. Empty = use the
    /// default from `default_prompt()`.
    #[serde(default)]
    pub prompt: String,
}

fn config_path() -> std::io::Result<PathBuf> {
    Ok(crate::paths::hermes_data_dir()?.join(CONFIG_FILE))
}

fn cache_dir() -> std::io::Result<PathBuf> {
    let dir = crate::paths::hermes_data_dir()?.join(CACHE_DIR);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn load() -> VisionProxyConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return VisionProxyConfig::default(),
    };
    if !path.exists() {
        return VisionProxyConfig::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => VisionProxyConfig::default(),
    }
}

pub fn save(cfg: &VisionProxyConfig) -> std::io::Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)
}

/// Resolve the actual API key string at call time. Mirrors
/// `browser_config::resolve_api_key` — try env, then
/// `~/.hermes/.env`, then inline.
fn resolve_api_key(cfg: &VisionProxyConfig) -> Option<String> {
    if let Some(name) = cfg.api_key_env.as_ref().filter(|s| !s.is_empty()) {
        if let Ok(v) = std::env::var(name) {
            if !v.is_empty() {
                return Some(v);
            }
        }
        if let Ok(Some(v)) = crate::hermes_config::read_env_value(name) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    if !cfg.api_key.is_empty() {
        return Some(cfg.api_key.clone());
    }
    None
}

fn default_prompt() -> &'static str {
    "请用中文详细描述这张图片，包括：\
     (1) 主要对象和它们的相对位置；\
     (2) 任何可见的文字（按从上到下、从左到右的顺序），\
     注明大致坐标或所在区域；\
     (3) 颜色、风格、可能的截图来源（网页 / 应用 / 表格）；\
     (4) 如有数据图表，输出表格化的数据。\
     输出尽可能简洁但完整，500 字以内。"
}

fn cache_path_for(hash: &str) -> std::io::Result<PathBuf> {
    Ok(cache_dir()?.join(format!("{hash}.txt")))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Hit the configured vision LLM with a single image and return its
/// text description. Cached by SHA-256 of image bytes — second call
/// for the same file is a flat-file read, no LLM round-trip.
pub async fn describe_image(
    cfg: &VisionProxyConfig,
    image_path: &Path,
    mime: &str,
) -> Result<String, String> {
    let bytes = std::fs::read(image_path).map_err(|e| format!("read image: {e}"))?;
    let hash = hash_bytes(&bytes);

    // Cache hit short-circuits the network call.
    if let Ok(p) = cache_path_for(&hash) {
        if let Ok(s) = std::fs::read_to_string(&p) {
            if !s.trim().is_empty() {
                tracing::debug!(hash = %hash, "vision_proxy cache hit");
                return Ok(s);
            }
        }
    }

    let api_key = resolve_api_key(cfg).ok_or_else(|| {
        "vision proxy: no API key resolved (set api_key_env or api_key)".to_string()
    })?;
    if cfg.base_url.is_empty() || cfg.model.is_empty() {
        return Err("vision proxy: base_url and model must be set".into());
    }

    let prompt = if cfg.prompt.trim().is_empty() {
        default_prompt().to_string()
    } else {
        cfg.prompt.clone()
    };

    let data_url = format!("data:{};base64,{}", mime, BASE64.encode(&bytes));

    // OpenAI-compatible Chat Completions request. We hardcode
    // non-streaming because we want the whole description at once
    // and the latency overhead of streaming a 500-char response is
    // bigger than the response itself.
    let body = serde_json::json!({
        "model": cfg.model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]
        }],
        "stream": false,
        "max_tokens": 800,
    });

    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("vision proxy client build: {e}"))?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("vision proxy POST: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "vision proxy returned {status}: {}",
            body.chars().take(500).collect::<String>()
        ));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("vision proxy parse: {e}"))?;
    let text = json
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| {
            format!(
                "vision proxy response missing choices[0].message.content: {}",
                serde_json::to_string(&json).unwrap_or_default()
            )
        })?;

    // Best-effort cache write; failure here just means we miss next
    // time, not that the request is broken.
    if let Ok(p) = cache_path_for(&hash) {
        let _ = std::fs::write(&p, &text);
    }

    Ok(text)
}

/// Iterate `messages` and, for the LAST user message that has image
/// attachments, replace those images with text descriptions inlined
/// into the message content. Earlier messages are left alone — by
/// the time the model gets to them they're already historical
/// context, and re-describing every image on every turn would be
/// expensive.
///
/// Returns the (possibly mutated) message list. If `enabled=false`,
/// `vision=Some(true)`, or no images are present, returns the input
/// unchanged. On per-image proxy failure, falls back to the
/// existing "(图片 - 当前模型不支持图片)" marker so the model still
/// knows the file existed.
pub async fn expand_images_in_messages(
    cfg: &VisionProxyConfig,
    mut messages: Vec<crate::adapters::ChatMessageDto>,
    vision_supported: Option<bool>,
) -> Vec<crate::adapters::ChatMessageDto> {
    if !cfg.enabled || vision_supported == Some(true) {
        return messages;
    }
    // Find the last user message that has at least one image
    // attachment. Walking from the end keeps the cost O(messages)
    // worst case but typically O(1) — agents send N-many turns
    // with images on the latest only.
    let target_idx = messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(i, m)| {
            if m.role == "user" && m.attachments.iter().any(|a| a.mime.starts_with("image/")) {
                Some(i)
            } else {
                None
            }
        });
    let Some(idx) = target_idx else {
        return messages;
    };

    let msg = &mut messages[idx];
    let (images, others): (Vec<ChatAttachmentRef>, Vec<ChatAttachmentRef>) = std::mem::take(
        &mut msg.attachments,
    )
    .into_iter()
    .partition(|a| a.mime.starts_with("image/"));
    msg.attachments = others;

    let mut additions = String::new();
    for img in images {
        match describe_image(cfg, Path::new(&img.path), &img.mime).await {
            Ok(desc) => {
                additions.push_str("\n\n");
                additions.push_str(&format!(
                    "[图片 {} — 视觉代理识别（{}）]\n{}",
                    img.name, cfg.model, desc
                ));
                tracing::info!(
                    image = %img.name,
                    chars = desc.len(),
                    "vision_proxy described image"
                );
            }
            Err(e) => {
                additions.push_str("\n\n");
                additions.push_str(&format!(
                    "[图片 {} — 视觉代理失败：{}]",
                    img.name,
                    e.chars().take(140).collect::<String>()
                ));
                tracing::warn!(image = %img.name, error = %e, "vision_proxy failed");
            }
        }
    }
    msg.content.push_str(&additions);
    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_default_is_disabled() {
        let cfg = VisionProxyConfig::default();
        assert!(!cfg.enabled);
        assert!(cfg.model.is_empty());
    }

    #[test]
    fn resolve_api_key_prefers_inline_when_no_env() {
        let cfg = VisionProxyConfig {
            api_key: "sk-inline".into(),
            ..Default::default()
        };
        assert_eq!(resolve_api_key(&cfg).as_deref(), Some("sk-inline"));
    }

    #[test]
    fn resolve_api_key_returns_none_when_unset() {
        let cfg = VisionProxyConfig::default();
        assert_eq!(resolve_api_key(&cfg), None);
    }

    #[tokio::test]
    async fn expand_skips_when_disabled() {
        let cfg = VisionProxyConfig::default();
        let messages = vec![crate::adapters::ChatMessageDto {
            role: "user".into(),
            content: "hi".into(),
            attachments: vec![ChatAttachmentRef {
                path: "/nonexistent.png".into(),
                mime: "image/png".into(),
                name: "x.png".into(),
            }],
        }];
        let out = expand_images_in_messages(&cfg, messages.clone(), Some(false)).await;
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].attachments.len(), 1, "disabled → no mutation");
    }

    #[tokio::test]
    async fn expand_skips_when_vision_supported() {
        let cfg = VisionProxyConfig {
            enabled: true,
            model: "gpt-4o-mini".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-test".into(),
            ..Default::default()
        };
        let messages = vec![crate::adapters::ChatMessageDto {
            role: "user".into(),
            content: "hi".into(),
            attachments: vec![ChatAttachmentRef {
                path: "/nonexistent.png".into(),
                mime: "image/png".into(),
                name: "x.png".into(),
            }],
        }];
        let out = expand_images_in_messages(&cfg, messages, Some(true)).await;
        assert_eq!(out[0].attachments.len(), 1, "vision=true → no mutation");
    }

    #[tokio::test]
    async fn expand_noop_when_no_images() {
        let cfg = VisionProxyConfig {
            enabled: true,
            ..Default::default()
        };
        let messages = vec![crate::adapters::ChatMessageDto {
            role: "user".into(),
            content: "hi".into(),
            attachments: vec![],
        }];
        let out = expand_images_in_messages(&cfg, messages, Some(false)).await;
        assert_eq!(out[0].content, "hi");
    }
}
