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

/// Hermes 0.13.0 `/v1/runs/{run_id}/events` SSE stream emits a tagged
/// JSON union; the Rust client parses each line into a `RunEvent`
/// variant. This locks in the exact shapes Corey relies on so a
/// future Hermes rename surfaces as a single failing test rather than
/// silently dropping deltas / approvals.
#[test]
fn run_event_parses_each_variant() {
    use serde_json::json;
    let cases = vec![
        (
            json!({"event": "message.delta", "delta": "hello"}),
            "message",
        ),
        (
            json!({"event": "tool.started", "tool": "terminal", "label": "ls", "emoji": "📂"}),
            "tool_started",
        ),
        (
            json!({"event": "tool.completed", "tool": "terminal"}),
            "tool_completed",
        ),
        (
            json!({"event": "reasoning.available", "reasoning": "thinking..."}),
            "reasoning",
        ),
        (
            json!({
                "event": "approval.request",
                "command": "rm -rf /",
                "description": "fork bomb",
                "pattern_key": "rm_rf_root",
                "pattern_keys": ["rm_rf_root"],
                "choices": ["once", "session", "always", "deny"],
                "run_id": "run_abc123"
            }),
            "approval_request",
        ),
        (
            json!({"event": "approval.responded", "choice": "once"}),
            "approval_responded",
        ),
        (
            json!({"event": "run.completed", "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}}),
            "run_completed",
        ),
        (
            json!({"event": "run.failed", "error": "model timeout"}),
            "run_failed",
        ),
        (json!({"event": "run.cancelled"}), "run_cancelled"),
    ];
    for (raw, label) in cases {
        let parsed: RunEvent = serde_json::from_value(raw.clone())
            .unwrap_or_else(|e| panic!("{label} failed to parse: {e} from {raw}"));
        match (label, parsed) {
            ("message", RunEvent::MessageDelta { delta }) => assert_eq!(delta, "hello"),
            ("tool_started", RunEvent::ToolStarted { tool, label, emoji }) => {
                assert_eq!(tool, "terminal");
                assert_eq!(label.as_deref(), Some("ls"));
                assert_eq!(emoji.as_deref(), Some("📂"));
            }
            ("tool_completed", RunEvent::ToolCompleted { .. }) => {}
            ("reasoning", RunEvent::ReasoningAvailable { reasoning }) => {
                assert_eq!(reasoning, "thinking...")
            }
            (
                "approval_request",
                RunEvent::ApprovalRequest {
                    command,
                    run_id,
                    choices,
                    ..
                },
            ) => {
                assert_eq!(command, "rm -rf /");
                assert_eq!(run_id, "run_abc123");
                assert_eq!(choices.len(), 4);
            }
            ("approval_responded", RunEvent::ApprovalResponded { choice }) => {
                assert_eq!(choice, "once")
            }
            ("run_completed", RunEvent::RunCompleted { usage }) => {
                let u = usage.expect("usage missing");
                assert_eq!(u.input_tokens, 100);
                assert_eq!(u.output_tokens, 50);
                assert_eq!(u.total_tokens, 150);
            }
            ("run_failed", RunEvent::RunFailed { error }) => assert_eq!(error, "model timeout"),
            ("run_cancelled", RunEvent::RunCancelled {}) => {}
            (other, got) => panic!("variant mismatch for {other}: {got:?}"),
        }
    }
}

/// Hermes 0.13.0 sends `tool.completed` with a result payload that we
/// don't surface. Verify it still parses (non-fatal) when the
/// `result` field shows up in unexpected shapes.
#[test]
fn run_event_tolerates_unknown_extra_fields() {
    let raw = serde_json::json!({
        "event": "tool.completed",
        "tool": "web_search",
        "result": {"hits": 3, "elapsed_ms": 42},
        "future_field": [1, 2, 3]
    });
    let parsed: RunEvent =
        serde_json::from_value(raw).expect("tool.completed with extras should parse");
    assert!(matches!(parsed, RunEvent::ToolCompleted { .. }));
}

/// Approval URL is composed from `api_url("runs/{id}/approval")` so it
/// follows the same `/v1` prefix convention as `chat/completions`.
#[test]
fn approval_url_uses_v1_runs_path() {
    let gw = HermesGateway::new("http://127.0.0.1:8642", None)
        .expect("HermesGateway construction with a valid URL never fails");
    assert_eq!(
        gw.api_url("runs/run_abc/approval"),
        "http://127.0.0.1:8642/v1/runs/run_abc/approval"
    );
    assert_eq!(
        gw.api_url("runs/run_abc/events"),
        "http://127.0.0.1:8642/v1/runs/run_abc/events"
    );
    assert_eq!(gw.api_url("runs"), "http://127.0.0.1:8642/v1/runs");
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
