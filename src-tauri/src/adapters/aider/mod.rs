//! Aider adapter — T5.3 (mock-first).
//!
//! Aider is the repo-aware pair-programmer CLI: one process per repo,
//! it reads/edits tracked files and commits to git. For Caduceus, each
//! Aider *session* is pinned to a repo path via `ChatTurn.cwd` (T5.1).
//!
//! This module ships the **mock** only — real integration (T5.3b) adds
//! `process.rs` (spawn + JSON-lines bidirectional transport),
//! `protocol.rs` (event parser), and `repo.rs` (repo detection).
//!
//! The mock exists so:
//!   1. The `AgentSwitcher` has three first-class citizens (not two), so
//!      capability-gated nav can be exercised against three distinct
//!      capability vectors.
//!   2. E2E tests can send a chat request against `aider` and assert the
//!      tool-call ribbons render correctly for file-edit events — real
//!      Aider's `Edit` / `Apply` stream shape is known; the mock emits
//!      the same shape.

use std::sync::RwLock;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::adapters::hermes::gateway::{ChatStreamDone, ChatStreamEvent, HermesToolProgress};
use crate::adapters::{
    AgentAdapter, Capabilities, ChatTurn, Health, ModelInfo, Session, SessionId, SessionQuery,
};
use crate::error::{AdapterError, AdapterResult};

const ADAPTER_ID: &str = "aider";
const ADAPTER_NAME: &str = "Aider";
const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4-5";

const FIXTURE_SESSIONS: &str = include_str!("fixtures/sessions.json");
const FIXTURE_MODELS: &str = include_str!("fixtures/models.json");

/// Operating mode. `Cli { exe, repos_root }` will land in T5.3b.
enum Mode {
    Mock,
}

pub struct AiderAdapter {
    mode: Mode,
    started_at: Instant,
    last_error: RwLock<Option<String>>,
}

impl AiderAdapter {
    /// Mock-mode constructor. Same shape as `HermesAdapter::new_stub` /
    /// `ClaudeCodeAdapter::new_mock` — no process, no filesystem,
    /// deterministic canned output.
    pub fn new_mock() -> Self {
        Self {
            mode: Mode::Mock,
            started_at: Instant::now(),
            last_error: RwLock::new(None),
        }
    }

    fn uptime_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    fn read_last_error(&self) -> Option<String> {
        self.last_error.read().ok().and_then(|g| g.clone())
    }
}

#[async_trait]
impl AgentAdapter for AiderAdapter {
    fn id(&self) -> &'static str {
        ADAPTER_ID
    }

    fn name(&self) -> &'static str {
        ADAPTER_NAME
    }

    /// Aider's capability vector differs from Claude Code in two telling
    /// ways: no `attachments` (Aider reads files from the repo, not from
    /// pasted images) and no `trajectory_export` (Aider's artefact is a
    /// git commit, not a replayable session JSON).
    ///
    /// See `docs/phases/phase-5-multi-agent.md §T5.3`.
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            streaming: true,
            tool_calls: true,
            attachments: false,
            multiple_sessions: true,
            session_search: true,
            skills: false,
            memory: false,
            scheduler: false,
            channels: vec![],
            logs: false,
            terminal: false,
            vector_search: false,
            trajectory_export: false,
            cost_accounting: true,
        }
    }

    async fn health(&self) -> AdapterResult<Health> {
        match &self.mode {
            Mode::Mock => Ok(Health {
                ok: true,
                adapter_id: ADAPTER_ID.into(),
                version: Some("mock-0.1.0".into()),
                gateway_url: None,
                latency_ms: Some(0),
                message: Some("mock — canned fixtures".into()),
                last_error: self.read_last_error(),
                uptime_ms: Some(self.uptime_ms()),
            }),
        }
    }

    async fn list_sessions(&self, query: SessionQuery) -> AdapterResult<Vec<Session>> {
        let all: Vec<Session> =
            serde_json::from_str(FIXTURE_SESSIONS).map_err(|e| AdapterError::Internal {
                source: anyhow::anyhow!("failed to parse aider session fixtures: {e}"),
            })?;
        let filtered: Vec<Session> = match query.search.as_deref().map(str::trim) {
            Some(q) if !q.is_empty() => {
                let needle = q.to_lowercase();
                all.into_iter()
                    .filter(|s| s.title.to_lowercase().contains(&needle))
                    .collect()
            }
            _ => all,
        };
        Ok(match query.limit {
            Some(n) if (n as usize) < filtered.len() => {
                filtered.into_iter().take(n as usize).collect()
            }
            _ => filtered,
        })
    }

    async fn get_session(&self, id: &SessionId) -> AdapterResult<Session> {
        let all = self.list_sessions(SessionQuery::default()).await?;
        all.into_iter()
            .find(|s| &s.id == id)
            .ok_or_else(|| AdapterError::Protocol {
                detail: format!("session '{id}' not found"),
            })
    }

    async fn list_models(&self) -> AdapterResult<Vec<ModelInfo>> {
        serde_json::from_str::<Vec<ModelInfo>>(FIXTURE_MODELS).map_err(|e| AdapterError::Internal {
            source: anyhow::anyhow!("failed to parse aider model fixtures: {e}"),
        })
    }

    /// Non-streaming completion. Aider NEEDS a repo path; the mock
    /// surfaces that contract explicitly so callers forgetting to set
    /// `ChatTurn.cwd` get a clear error instead of silent behaviour.
    async fn chat_once(&self, turn: ChatTurn) -> AdapterResult<String> {
        match &self.mode {
            Mode::Mock => match turn.cwd.as_deref() {
                Some(repo) => Ok(canned_reply(repo, &turn)),
                None => Err(AdapterError::NotConfigured {
                    hint: "Aider requires a repo path (set ChatTurn.cwd)".into(),
                }),
            },
        }
    }

    /// Streaming mock. Emits two `ToolProgress` events ("🔍 read" + "✏️ edit")
    /// around word-chunked content so the UI's tool-call ribbon is
    /// exercised with a realistic Aider-shaped sequence.
    async fn chat_stream(
        &self,
        turn: ChatTurn,
        tx: mpsc::Sender<ChatStreamEvent>,
    ) -> AdapterResult<ChatStreamDone> {
        match &self.mode {
            Mode::Mock => {
                let repo = turn
                    .cwd
                    .clone()
                    .ok_or_else(|| AdapterError::NotConfigured {
                        hint: "Aider requires a repo path (set ChatTurn.cwd)".into(),
                    })?;
                let started = Instant::now();
                let text = canned_reply(&repo, &turn);

                // Tool sequence: read the relevant file first, then emit
                // an edit. Real Aider does this across Edit/Apply/Done
                // events — we collapse to two progress pings.
                let _ = tx
                    .send(ChatStreamEvent::Tool(HermesToolProgress {
                        tool: "read".into(),
                        emoji: Some("🔍".into()),
                        label: Some(format!("{repo}/src/lib.rs")),
                    }))
                    .await;

                let _ = tx
                    .send(ChatStreamEvent::Tool(HermesToolProgress {
                        tool: "edit".into(),
                        emoji: Some("✏️".into()),
                        label: Some(format!("{repo}/src/lib.rs")),
                    }))
                    .await;

                let mut first = true;
                for word in text.split_whitespace() {
                    let chunk = if first {
                        first = false;
                        word.to_string()
                    } else {
                        format!(" {word}")
                    };
                    if tx.send(ChatStreamEvent::Delta(chunk)).await.is_err() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }

                let prompt_tokens = turn
                    .messages
                    .iter()
                    .map(|m| m.content.split_whitespace().count() as u32)
                    .sum::<u32>()
                    .max(1);
                let completion_tokens = text.split_whitespace().count() as u32;

                Ok(ChatStreamDone {
                    finish_reason: Some("stop".into()),
                    model: turn.model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
                    latency_ms: started.elapsed().as_millis() as u32,
                    prompt_tokens: Some(prompt_tokens),
                    completion_tokens: Some(completion_tokens),
                })
            }
        }
    }
}

/// Canned reply shared by `chat_once` and the streamer. Mentions the repo
/// so tests can pin the T5.1 `ChatTurn.cwd` plumbing to Aider-specific
/// semantics (it's not just a hint — Aider treats it as the repo root).
fn canned_reply(repo: &str, turn: &ChatTurn) -> String {
    let last_user = turn
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.trim())
        .unwrap_or("");
    format!("Mock Aider reply. repo={repo}. You said: {last_user}")
}

// ───────────────────────── Tests ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::ChatMessageDto;

    fn user(msg: &str) -> ChatMessageDto {
        ChatMessageDto {
            role: "user".into(),
            content: msg.into(),
            attachments: vec![],
        }
    }

    #[tokio::test]
    async fn t53_mock_capabilities_distinguish_from_claude_code() {
        let a = AiderAdapter::new_mock();
        let c = a.capabilities();
        assert!(c.streaming);
        assert!(c.tool_calls);
        // Aider is file-centric, NOT vision — no attachments.
        assert!(!c.attachments, "aider doesn't accept attachments");
        // No terminal / no trajectory_export / no skills — matches the
        // Phase 5 spec §T5.3 and diverges from Claude Code's set.
        assert!(!c.terminal);
        assert!(!c.trajectory_export);
        assert!(!c.skills);
        assert!(c.channels.is_empty());
    }

    #[tokio::test]
    async fn t53_mock_health_is_ok_and_reports_uptime() {
        let a = AiderAdapter::new_mock();
        let h = a.health().await.unwrap();
        assert!(h.ok);
        assert_eq!(h.adapter_id, ADAPTER_ID);
        assert!(h.uptime_ms.is_some());
        assert!(h.last_error.is_none());
    }

    #[tokio::test]
    async fn t53_fixture_sessions_load_with_repo_metadata() {
        let a = AiderAdapter::new_mock();
        let sessions = a.list_sessions(SessionQuery::default()).await.unwrap();
        assert!(!sessions.is_empty());
        for s in &sessions {
            assert_eq!(s.adapter_id, ADAPTER_ID);
            // Aider sessions carry `repo` in metadata — this is what
            // distinguishes them from other adapters' sessions in the
            // unified inbox.
            let repo = s
                .metadata
                .get("repo")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            assert!(!repo.is_empty(), "aider session must declare a repo path");
        }
    }

    #[tokio::test]
    async fn t53_chat_once_refuses_without_cwd() {
        let a = AiderAdapter::new_mock();
        let err = a
            .chat_once(ChatTurn {
                messages: vec![user("refactor this")],
                model: None,
                cwd: None,
            })
            .await
            .unwrap_err();
        // NotConfigured with a repo-hint is the contract.
        match err {
            AdapterError::NotConfigured { hint } => {
                assert!(hint.contains("repo") || hint.contains("cwd"))
            }
            other => panic!("expected NotConfigured, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn t53_chat_once_echoes_repo_when_cwd_set() {
        let a = AiderAdapter::new_mock();
        let reply = a
            .chat_once(ChatTurn {
                messages: vec![user("add type hints")],
                model: None,
                cwd: Some("/tmp/myrepo".into()),
            })
            .await
            .unwrap();
        assert!(reply.contains("repo=/tmp/myrepo"));
        assert!(reply.contains("add type hints"));
    }

    #[tokio::test]
    async fn t53_chat_stream_emits_read_then_edit_then_deltas() {
        use tokio::sync::mpsc;
        let a = AiderAdapter::new_mock();
        let (tx, mut rx) = mpsc::channel::<ChatStreamEvent>(32);
        let handle = tokio::spawn(async move {
            a.chat_stream(
                ChatTurn {
                    messages: vec![user("hi")],
                    model: None,
                    cwd: Some("/tmp/repo".into()),
                },
                tx,
            )
            .await
        });

        let mut tools: Vec<String> = Vec::new();
        let mut delta_count = 0usize;
        while let Some(ev) = rx.recv().await {
            match ev {
                ChatStreamEvent::Tool(p) => tools.push(p.tool),
                ChatStreamEvent::Delta(_) => delta_count += 1,
            }
        }
        let done = handle.await.unwrap().unwrap();

        assert_eq!(
            tools,
            vec!["read".to_string(), "edit".to_string()],
            "expected read -> edit tool sequence"
        );
        assert!(delta_count > 0, "must emit content deltas");
        assert_eq!(done.finish_reason.as_deref(), Some("stop"));
        assert_eq!(done.model, DEFAULT_MODEL);
    }
}
