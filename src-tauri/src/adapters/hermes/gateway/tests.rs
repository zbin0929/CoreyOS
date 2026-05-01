use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// `api_url` is the single source of truth for how we derive the
/// OpenAI-compatible endpoint from an LLM Profile's `base_url`. It
/// has three shapes to keep straight:
///   - Bare host (`.../8642`) → inject `/v1/`
///   - Already `/v1` → append directly
///   - Non-v1 versioned (`/v4`, `/v3beta`, …) → append directly
///     (bug fix for 智谱 GLM which lives at `/api/paas/v4`; pre-fix
///     builds produced `/v4/v1/chat/completions` → 404)
#[test]
fn api_url_handles_bare_v1_and_non_v1_bases() {
    let bare = HermesGateway::new("http://127.0.0.1:8642", None).unwrap();
    assert_eq!(
        bare.api_url("chat/completions"),
        "http://127.0.0.1:8642/v1/chat/completions"
    );
    assert_eq!(bare.api_url("models"), "http://127.0.0.1:8642/v1/models");

    let v1 = HermesGateway::new("https://api.openai.com/v1", None).unwrap();
    assert_eq!(
        v1.api_url("chat/completions"),
        "https://api.openai.com/v1/chat/completions"
    );

    // Regression: 智谱 GLM. Previously the client appended
    // /v1/chat/completions regardless, producing /v4/v1/... → 404.
    let glm = HermesGateway::new("https://open.bigmodel.cn/api/paas/v4", None).unwrap();
    assert_eq!(
        glm.api_url("chat/completions"),
        "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    assert_eq!(
        glm.api_url("models"),
        "https://open.bigmodel.cn/api/paas/v4/models"
    );

    // Trailing slashes are stripped at construction so we never
    // accidentally emit `.../v4//chat/completions`.
    let glm_slash = HermesGateway::new("https://open.bigmodel.cn/api/paas/v4/", None).unwrap();
    assert_eq!(
        glm_slash.api_url("chat/completions"),
        "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
}
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

/// Spawn a TCP listener that accepts N connections, increments a
/// counter, then immediately drops each socket so the client's
/// `send()` fails mid-HTTP-head. Returns the bound port and the
/// shared counter. The listener task terminates on its own once
/// the parent drops the returned guard.
async fn spawn_flaky_listener() -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let count = Arc::new(AtomicUsize::new(0));
    let count_task = count.clone();
    tokio::spawn(async move {
        while let Ok((mut s, _)) = listener.accept().await {
            count_task.fetch_add(1, Ordering::SeqCst);
            // Kill the socket before writing a status line — this
            // reliably surfaces as a reqwest transport error at
            // `send()` time.
            let _ = s.shutdown().await;
        }
    });
    (port, count)
}

/// T1.8 — chat_stream retries the initial connect up to
/// `STREAM_CONNECT_ATTEMPTS` times when the gateway keeps dropping
/// the TCP connection during the HTTP head. Each attempt lands on
/// our flaky listener, which lets us assert the retry count
/// without needing an HTTP mock library.
#[tokio::test]
async fn t18_chat_stream_retries_connect_on_transport_error() {
    let (port, count) = spawn_flaky_listener().await;
    let base = format!("http://127.0.0.1:{port}");
    let gw = HermesGateway::new(base, None).unwrap();

    let (tx, _rx) = mpsc::channel::<ChatStreamEvent>(4);
    let result = gw
        .chat_stream(
            "test-model",
            vec![ChatMessage {
                role: "user".into(),
                content: ChatMessageContent::Text("hi".into()),
            }],
            tx,
        )
        .await;

    assert!(
        matches!(result, Err(AdapterError::Unreachable { .. })),
        "expected Unreachable after exhausting retries, got {result:?}"
    );
    assert_eq!(
        count.load(Ordering::SeqCst),
        STREAM_CONNECT_ATTEMPTS as usize,
        "each retry should hit the listener exactly once"
    );
}

#[test]
fn contract_chat_stream_done_serializes_expected_fields() {
    let done = ChatStreamDone {
        finish_reason: Some("stop".into()),
        model: "gpt-4o".into(),
        latency_ms: 1234,
        first_token_latency_ms: Some(500),
        prompt_tokens: Some(100),
        completion_tokens: Some(50),
    };
    let val = serde_json::to_value(&done).unwrap();
    assert!(val.get("finish_reason").is_some(), "missing finish_reason");
    assert!(val.get("model").is_some(), "missing model");
    assert!(val.get("latency_ms").is_some(), "missing latency_ms");
    assert!(val.get("prompt_tokens").is_some(), "missing prompt_tokens");
    assert!(
        val.get("completion_tokens").is_some(),
        "missing completion_tokens"
    );
    assert_eq!(val["model"], "gpt-4o");
    assert_eq!(val["latency_ms"], 1234);
}
