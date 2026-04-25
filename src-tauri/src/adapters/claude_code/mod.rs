//! Claude Code adapter — T5.2 (mock-first).
//!
//! Phase 5 introduces Caduceus as genuinely agent-agnostic. This module
//! ships the *mock* implementation first so the rest of Phase 5 (agent
//! switcher, unified inbox, cross-adapter analytics) can be built + tested
//! against two distinct adapters without depending on the upstream
//! `claude-code` CLI being installed on the dev/CI machine.
//!
//! Real CLI wiring (T5.2b) lives alongside as sibling modules:
//!   - `cli.rs`      spawn + bidirectional JSONL transport
//!   - `sessions.rs` enumerate `~/.claude/sessions` on disk
//!   - `stream.rs`   map upstream JSONL events into our `ChatStreamEvent`
//!
//! For now only `mod.rs` exists; the others are stubs to be filled in.

use std::sync::RwLock;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::adapters::hermes::gateway::{ChatStreamDone, ChatStreamEvent, HermesToolProgress};
use crate::adapters::{
    AgentAdapter, Capabilities, ChatTurn, Health, ModelInfo, Session, SessionId, SessionQuery,
};
use crate::error::{AdapterError, AdapterResult};

const ADAPTER_ID: &str = "claude_code";
const ADAPTER_NAME: &str = "Claude Code";
const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4-5";

const FIXTURE_SESSIONS: &str = include_str!("fixtures/sessions.json");
const FIXTURE_MODELS: &str = include_str!("fixtures/models.json");

/// Operating mode for the adapter. `Mock` is the only variant in T5.2a;
/// `Cli { exe_path, sessions_dir }` will land in T5.2b.
enum Mode {
    Mock,
    // Cli { exe_path: std::path::PathBuf, sessions_dir: std::path::PathBuf },
}

pub struct ClaudeCodeAdapter {
    mode: Mode,
    started_at: Instant,
    /// Sticky last-error, same pattern as `HermesAdapter`.
    last_error: RwLock<Option<String>>,
}

impl ClaudeCodeAdapter {
    /// Mock-mode constructor. No filesystem or process side-effects; fixture
    /// JSON drives `list_sessions` / `list_models`, and `chat_*` return
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
impl AgentAdapter for ClaudeCodeAdapter {
    fn id(&self) -> &'static str {
        ADAPTER_ID
    }

    fn name(&self) -> &'static str {
        ADAPTER_NAME
    }

    /// Claude Code's capability surface, lifted from
    /// `docs/phases/phase-5-multi-agent.md §T5.2`:
    ///
    ///   - `streaming=true` — it speaks JSONL events
    ///   - `tool_calls=true` — tool-use heavy (reads/writes files, shells)
    ///   - `attachments=true` — vision-capable
    ///   - `skills=false` — skills are a Hermes-specific idiom
    ///   - `channels=[]` — no external messenger integrations
    ///   - `terminal=true` — it IS terminal-first
    ///   - `trajectory_export=true` — session directories are exportable
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            streaming: true,
            tool_calls: true,
            attachments: true,
            multiple_sessions: true,
            session_search: true,
            skills: false,
            memory: false,
            scheduler: false,
            channels: vec![],
            logs: true,
            terminal: true,
            vector_search: false,
            trajectory_export: true,
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
                source: anyhow::anyhow!("failed to parse claude_code session fixtures: {e}"),
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
            source: anyhow::anyhow!("failed to parse claude_code model fixtures: {e}"),
        })
    }

    /// Mock non-streaming completion. The canned reply acknowledges the
    /// last user turn and echoes the `cwd` when present so tests can
    /// confirm T5.1's `ChatTurn.cwd` plumbed through end-to-end.
    async fn chat_once(&self, turn: ChatTurn) -> AdapterResult<String> {
        match &self.mode {
            Mode::Mock => Ok(canned_reply(&turn)),
        }
    }

    /// Mock streaming completion. Splits the canned reply into word-sized
    /// chunks + inserts a synthetic `ToolProgress` so the UI's tool-call
    /// rendering path exercises this adapter too.
    async fn chat_stream(
        &self,
        turn: ChatTurn,
        tx: mpsc::Sender<ChatStreamEvent>,
    ) -> AdapterResult<ChatStreamDone> {
        match &self.mode {
            Mode::Mock => {
                let started = Instant::now();
                let text = canned_reply(&turn);

                // Emit a single tool-progress early so downstream tool-call
                // UI gets exercised. Kept intentionally coarse — real
                // Claude Code streams Read/Edit/Bash etc. as distinct
                // events; we'll parse those in T5.2b.
                let _ = tx
                    .send(ChatStreamEvent::Tool(HermesToolProgress {
                        tool: "read".into(),
                        emoji: Some("📖".into()),
                        label: turn.cwd.clone().or_else(|| Some("(no cwd)".into())),
                    }))
                    .await;

                // Split by whitespace, re-attach spaces so bubble spacing
                // looks natural. 20ms per chunk keeps streaming visible
                // without being annoyingly slow in e2e tests.
                let mut first = true;
                for word in text.split_whitespace() {
                    let chunk = if first {
                        first = false;
                        word.to_string()
                    } else {
                        format!(" {word}")
                    };
                    if tx.send(ChatStreamEvent::Delta(chunk)).await.is_err() {
                        // Receiver dropped — caller cancelled. Exit early.
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
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

/// Deterministic canned reply shared by `chat_once` and the streamer so
/// unit tests can assert on shape without racing the stream.
///
/// The reply deliberately mentions `cwd` (if supplied) so a single assertion
/// in T5.2 tests verifies the T5.1 `ChatTurn.cwd` plumbing survived the
/// trait → adapter → response loop.
fn canned_reply(turn: &ChatTurn) -> String {
    let last_user = turn
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.trim())
        .unwrap_or("");
    let cwd = turn.cwd.as_deref().unwrap_or("(no working directory set)");

    // Keep the shape stable — tests pattern-match on it. Mention cwd so
    // T5.1 plumbing is observable in the response.
    format!("Mock Claude Code reply. cwd={cwd}. You said: {last_user}")
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
    async fn t52_mock_health_is_ok_and_reports_uptime() {
        let a = ClaudeCodeAdapter::new_mock();
        let h = a.health().await.unwrap();
        assert!(h.ok);
        assert_eq!(h.adapter_id, ADAPTER_ID);
        assert!(h.uptime_ms.is_some());
        assert!(h.last_error.is_none());
    }

    #[tokio::test]
    async fn t52_mock_capabilities_match_phase_5_spec() {
        let a = ClaudeCodeAdapter::new_mock();
        let c = a.capabilities();
        assert!(c.streaming);
        assert!(c.tool_calls);
        assert!(c.attachments);
        assert!(c.terminal);
        assert!(c.trajectory_export);
        assert!(!c.skills, "claude_code does not ship skills");
        assert!(
            c.channels.is_empty(),
            "claude_code has no messenger integrations"
        );
    }

    #[tokio::test]
    async fn t52_fixture_sessions_load_and_respect_search() {
        let a = ClaudeCodeAdapter::new_mock();
        let all = a.list_sessions(SessionQuery::default()).await.unwrap();
        assert!(!all.is_empty());
        assert!(all.iter().all(|s| s.adapter_id == ADAPTER_ID));

        let miss = a
            .list_sessions(SessionQuery {
                search: Some("definitely-not-a-title-zzz".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(miss.is_empty());

        // "refactor" appears in the first fixture session's title — case
        // insensitive match must hit.
        let hits = a
            .list_sessions(SessionQuery {
                search: Some("REFACTOR".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(
            !hits.is_empty(),
            "case-insensitive search for 'refactor' must hit"
        );
    }

    #[tokio::test]
    async fn t52_chat_once_echoes_cwd_from_t51_plumbing() {
        let a = ClaudeCodeAdapter::new_mock();
        let reply = a
            .chat_once(ChatTurn {
                messages: vec![user("please fix the SSE parser")],
                model: None,
                cwd: Some("/tmp/myrepo".into()),
                model_supports_vision: None,
            })
            .await
            .unwrap();
        assert!(
            reply.contains("cwd=/tmp/myrepo"),
            "cwd must survive the T5.1 plumbing and surface in the reply, got: {reply}"
        );
        assert!(reply.contains("SSE parser"));
    }

    #[tokio::test]
    async fn t52_chat_stream_emits_tool_then_chunks_and_summarises() {
        use tokio::sync::mpsc;
        let a = ClaudeCodeAdapter::new_mock();
        let (tx, mut rx) = mpsc::channel::<ChatStreamEvent>(32);
        let handle = tokio::spawn(async move {
            a.chat_stream(
                ChatTurn {
                    messages: vec![user("hi")],
                    model: None,
                    cwd: None,
                    model_supports_vision: None,
                },
                tx,
            )
            .await
        });

        let mut saw_tool = false;
        let mut delta_count = 0usize;
        while let Some(ev) = rx.recv().await {
            match ev {
                ChatStreamEvent::Tool(_) => saw_tool = true,
                ChatStreamEvent::Reasoning(_) => { /* claude_code doesn't surface reasoning */ }
                ChatStreamEvent::Delta(_) => delta_count += 1,
            }
        }
        let done = handle.await.unwrap().unwrap();

        assert!(saw_tool, "must emit at least one tool-progress event");
        assert!(delta_count > 0, "must emit content deltas");
        assert_eq!(done.finish_reason.as_deref(), Some("stop"));
        assert_eq!(done.model, DEFAULT_MODEL);
        assert!(done.completion_tokens.unwrap_or(0) > 0);
    }
}
