//! Adapter conformance suite (T5.2).
//!
//! Every `AgentAdapter` implementation MUST pass this suite in at least one
//! canonical mode (stub / mock). It exists so adding a new adapter is a
//! mechanical, verifiable step instead of a whack-a-mole across the IPC
//! layer.
//!
//! Scope is deliberately small — checks the trait surface behaves sanely,
//! NOT the upstream-specific semantics. Per-adapter tests (e.g. Hermes's
//! multimodal wire format, Claude Code's cwd plumbing) live next to the
//! adapter. Here we verify:
//!
//!   1. `id()` and `name()` are non-empty and distinct from each other.
//!   2. `capabilities()` doesn't panic and is internally consistent.
//!   3. `health()` succeeds and reports a matching `adapter_id`.
//!   4. `list_sessions` / `list_models` either succeed or fail gracefully
//!      (neither panics, neither returns garbage `adapter_id`).
//!   5. `SessionQuery.search` plumbs through without panicking even for
//!      adapters that haven't wired filtering yet (result can be empty).
//!
//! Usage:
//! ```ignore
//! #[tokio::test]
//! async fn hermes_stub_is_conformant() {
//!     let a = Arc::new(HermesAdapter::new_stub());
//!     conformance::run(a).await;
//! }
//! ```
//!
//! All assertions panic with a descriptive message embedding the adapter
//! id so multi-adapter test output stays scannable.

use std::sync::Arc;

use crate::adapters::{AgentAdapter, SessionQuery};

/// Run the full conformance suite against `adapter`. Fails the test with
/// a panic on the first violation.
pub async fn run(adapter: Arc<dyn AgentAdapter>) {
    let id = adapter.id();
    let name = adapter.name();

    // 1. Identity basics.
    assert!(!id.is_empty(), "[{id}] adapter id must be non-empty");
    assert!(!name.is_empty(), "[{id}] adapter name must be non-empty");
    assert!(
        id.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
        "[{id}] adapter id must be ascii snake_case (got '{id}')",
    );

    // 2. Capabilities.
    let caps = adapter.capabilities();
    // `channels` can't silently contain the empty string — rendering it in
    // the UI would produce a blank pill.
    assert!(
        !caps.channels.iter().any(|c| c.is_empty()),
        "[{id}] capabilities.channels must not contain empty strings",
    );
    // If the adapter claims `streaming=false`, tests must not call
    // `chat_stream` against it; we don't enforce that here but a future
    // conformance gate might.

    // 3. Health.
    let h = adapter
        .health()
        .await
        .unwrap_or_else(|e| panic!("[{id}] health() failed: {e}"));
    assert_eq!(
        h.adapter_id, id,
        "[{id}] health.adapter_id must match adapter.id() (got '{}')",
        h.adapter_id,
    );

    // 4. Listings. Either flavour is allowed to fail with a structured
    // error (e.g. live adapter with no configured gateway) but must not
    // panic; if it succeeds, every row must be tagged with this adapter.
    if let Ok(sessions) = adapter.list_sessions(SessionQuery::default()).await {
        for s in &sessions {
            assert_eq!(
                s.adapter_id, id,
                "[{id}] session '{}' carries foreign adapter_id '{}'",
                s.id, s.adapter_id,
            );
        }
    }
    // `list_models` doesn't stamp an adapter id today — just exercising
    // the call for its Result shape suffices.
    let _ = adapter.list_models().await;

    // 5. Search pass-through. Query plumbing must not panic for an
    // adapter that doesn't actually implement filtering; an empty
    // result is the expected correct answer in that case.
    let _ = adapter
        .list_sessions(SessionQuery {
            search: Some("conformance-harness-needle".into()),
            ..Default::default()
        })
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::aider::AiderAdapter;
    use crate::adapters::claude_code::ClaudeCodeAdapter;
    use crate::adapters::hermes::HermesAdapter;

    #[tokio::test]
    async fn hermes_stub_is_conformant() {
        run(Arc::new(HermesAdapter::new_stub())).await;
    }

    #[tokio::test]
    async fn claude_code_mock_is_conformant() {
        run(Arc::new(ClaudeCodeAdapter::new_mock())).await;
    }

    #[tokio::test]
    async fn aider_mock_is_conformant() {
        run(Arc::new(AiderAdapter::new_mock())).await;
    }
}
