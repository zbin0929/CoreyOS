pub mod generate;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::ipc::pack::mcp_transport::resolve_mcp_source;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::browser_config as browser_config_ipc;
use crate::adapters::{ChatMessageDto, ChatTurn};
use crate::db::Db;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::workflow;
use crate::workflow::browser_config;
use crate::workflow::engine::{self, StepExecutor, WorkflowRun};
use crate::workflow::model::{WorkflowDef, WorkflowSummary};
use crate::workflow::store::{self, ValidationError};

/// Best-effort persistence of a run's current state to SQLite.
///
/// Stamps `updated_at_ms` to "now" so the History list can MRU-sort
/// without needing every state mutation site to remember to bump it.
/// Persistence errors are logged and swallowed: the in-memory copy
/// remains the source of truth for the running session, and a flaky
/// disk shouldn't take down a workflow that's otherwise progressing.
fn persist_run(db: &Option<Arc<Db>>, run: &mut WorkflowRun) {
    run.updated_at_ms = chrono::Utc::now().timestamp_millis();
    let Some(db) = db.as_ref() else {
        return;
    };
    if let Err(e) = db.upsert_workflow_run(run) {
        tracing::warn!(
            run_id = %run.id,
            error = %e,
            "workflow run persist failed; in-memory state still authoritative"
        );
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
}

#[tauri::command]
pub async fn workflow_list(state: State<'_, AppState>) -> IpcResult<Vec<WorkflowSummary>> {
    let dir = state.config_dir.clone();
    let summaries = tokio::task::spawn_blocking(move || {
        let defs = store::list()?;
        let mut out = Vec::new();
        for def in &defs {
            let path = dir.join("workflows").join(format!("{}.yaml", def.id));
            let mtime = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(def.summary(mtime));
        }
        anyhow::Ok(out)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_list join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_list: {e}"),
    })?;
    Ok(summaries)
}

#[tauri::command]
pub async fn workflow_get(id: String) -> IpcResult<WorkflowDef> {
    tokio::task::spawn_blocking(move || store::get(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_get join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_get: {e}"),
        })
}

#[tauri::command]
pub async fn workflow_save(def: WorkflowDef) -> IpcResult<WorkflowDef> {
    tokio::task::spawn_blocking(move || {
        store::save(&def)?;
        anyhow::Ok(def)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_save join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_save: {e}"),
    })
}

#[tauri::command]
pub async fn workflow_delete(id: String) -> IpcResult<bool> {
    tokio::task::spawn_blocking(move || store::delete(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_delete join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_delete: {e}"),
        })
}

#[tauri::command]
pub async fn workflow_validate(def: WorkflowDef) -> IpcResult<ValidationResult> {
    let errors = tokio::task::spawn_blocking(move || store::validate(&def))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_validate join: {e}"),
        })?;
    Ok(ValidationResult {
        valid: errors.is_empty(),
        errors,
    })
}

struct HermesExecutor {
    adapters: std::sync::Arc<crate::adapters::AdapterRegistry>,
    /// Threaded through so `execute_tool_with_timeout` (B-10.4) can
    /// reach `pack::resolve_mcp_source` without going via Tauri
    /// State (the executor runs inside `spawn_blocking`, no
    /// `app.state::<AppState>()` available there).
    authority: std::sync::Arc<crate::sandbox::PathAuthority>,
}

impl StepExecutor for HermesExecutor {
    fn execute_agent(&self, agent_id: &str, prompt: &str) -> Result<String, String> {
        // Non-streaming path. Kept for symmetry with the trait
        // contract; in production the engine routes agent steps
        // through `execute_agent_streaming` (below) so the UI can
        // surface partial output during a 30+ second call.
        let rt = tokio::runtime::Handle::current();
        let adapter_id = if agent_id.is_empty() {
            "hermes"
        } else {
            agent_id
        };
        let adapter = self
            .adapters
            .get(adapter_id)
            .or_else(|| self.adapters.default_adapter())
            .ok_or_else(|| format!("adapter '{}' not found", adapter_id))?;

        let turn = ChatTurn {
            messages: vec![ChatMessageDto {
                role: "user".into(),
                content: prompt.into(),
                attachments: vec![],
            }],
            model: None,
            cwd: None,
            model_supports_vision: None,
        };

        rt.block_on(async { adapter.chat_once(turn).await })
            .map_err(|e| format!("agent error: {e}"))
    }

    fn execute_agent_streaming(
        &self,
        agent_id: &str,
        prompt: &str,
        progress: &dyn Fn(&str),
    ) -> Result<String, String> {
        // Stream the agent's response and forward cumulative content
        // to `progress` as deltas arrive. The engine wires `progress`
        // to the step-progress hook, so a step parked in
        // `running` for 30+ seconds renders an actual stream of
        // tokens in the UI instead of a frozen spinner.
        //
        // Reasoning-model chunks (deepseek-reasoner, o1) are NOT
        // forwarded as content — they go to a separate channel in
        // the chat surface, but workflow steps only care about the
        // final answer. We still rely on their arrival to know
        // hermes is alive (no spurious timeouts).
        use crate::adapters::hermes::gateway::ChatStreamEvent;

        let rt = tokio::runtime::Handle::current();
        let adapter_id = if agent_id.is_empty() {
            "hermes"
        } else {
            agent_id
        };
        let adapter = self
            .adapters
            .get(adapter_id)
            .or_else(|| self.adapters.default_adapter())
            .ok_or_else(|| format!("adapter '{}' not found", adapter_id))?;

        let turn = ChatTurn {
            messages: vec![ChatMessageDto {
                role: "user".into(),
                content: prompt.into(),
                attachments: vec![],
            }],
            model: None,
            cwd: None,
            model_supports_vision: None,
        };

        // Buffered enough that the producer (gateway) doesn't park
        // on backpressure during a fast burst, but small enough that
        // we don't materially delay the engine if the consumer
        // (this thread) is slow.
        let (tx, mut rx) = tokio::sync::mpsc::channel::<ChatStreamEvent>(64);

        // The streaming future and its event-pump must run in
        // parallel: the future ends only when [DONE] arrives, but
        // it can't make progress unless someone is draining the
        // channel. `tokio::join!` runs both on the current
        // runtime's worker pool so the producer's `await` and the
        // consumer's `recv` can interleave correctly.
        let result: Result<String, String> = rt.block_on(async move {
            let producer = async {
                adapter
                    .chat_stream(turn, tx)
                    .await
                    .map_err(|e| format!("agent error: {e}"))
            };

            // Consumer: accumulate deltas, fire `progress` per chunk.
            // We throttle to roughly 1 callback per 50 ms of new
            // content so a fast model spitting tokens doesn't cause
            // hundreds of mutex acquisitions per second on the
            // hook's lock + SQLite write path. The final state is
            // always flushed when the channel closes.
            let consumer = async {
                let mut acc = String::new();
                let mut last_emit = std::time::Instant::now();
                while let Some(ev) = rx.recv().await {
                    if let ChatStreamEvent::Delta(chunk) = ev {
                        if !chunk.is_empty() {
                            acc.push_str(&chunk);
                            if last_emit.elapsed() >= std::time::Duration::from_millis(50) {
                                progress(&acc);
                                last_emit = std::time::Instant::now();
                            }
                        }
                    }
                    // Reasoning + tool events are intentionally ignored
                    // here — they're not the agent's final answer.
                }
                // One final flush so the last partial state lands
                // even if the throttle window swallowed it.
                if !acc.is_empty() {
                    progress(&acc);
                }
                acc
            };

            // join: wait for both to finish. Producer's outcome is
            // authoritative for errors; consumer just collects bytes.
            let (producer_res, accumulated) = tokio::join!(producer, consumer);
            producer_res?;
            Ok(accumulated)
        });

        result
    }

    // ── B-10.1 timeout overrides ───────────────────────────────────
    //
    // These three methods are what the engine actually calls. Each
    // wraps the underlying blocking `rt.block_on(...)` body in
    // `tokio::time::timeout(d, future)` so a stuck network call —
    // hermes hung mid-stream, an LLM provider sitting on the socket,
    // a browser-runner subprocess that won't exit — gets converted
    // into a clean `Err("step timeout after Xs")` instead of pegging
    // a worker forever. The error string is plain enough that retry
    // + on_error can compose with it (B-10.2 / B-10.3) without any
    // special-casing.
    //
    // `None` means "no timeout enforced" (e.g. the caller deliberately
    // opted out via `step.timeout_minutes = 0` on a future schema
    // change). Today the engine always passes a Some via
    // `default_timeout`, so the None branch is a forward-compat
    // courtesy.

    fn execute_agent_with_timeout(
        &self,
        agent_id: &str,
        prompt: &str,
        timeout: Option<std::time::Duration>,
    ) -> Result<String, String> {
        let Some(d) = timeout else {
            return self.execute_agent(agent_id, prompt);
        };
        let rt = tokio::runtime::Handle::current();
        let adapter_id = if agent_id.is_empty() {
            "hermes"
        } else {
            agent_id
        };
        let adapter = self
            .adapters
            .get(adapter_id)
            .or_else(|| self.adapters.default_adapter())
            .ok_or_else(|| format!("adapter '{}' not found", adapter_id))?;

        let turn = ChatTurn {
            messages: vec![ChatMessageDto {
                role: "user".into(),
                content: prompt.into(),
                attachments: vec![],
            }],
            model: None,
            cwd: None,
            model_supports_vision: None,
        };

        rt.block_on(async move {
            match tokio::time::timeout(d, adapter.chat_once(turn)).await {
                Ok(res) => res.map_err(|e| format!("agent error: {e}")),
                Err(_) => Err(format!("step timeout after {}s", d.as_secs())),
            }
        })
    }

    fn execute_agent_streaming_with_timeout(
        &self,
        agent_id: &str,
        prompt: &str,
        timeout: Option<std::time::Duration>,
        progress: &dyn Fn(&str),
    ) -> Result<String, String> {
        let Some(d) = timeout else {
            return self.execute_agent_streaming(agent_id, prompt, progress);
        };
        use crate::adapters::hermes::gateway::ChatStreamEvent;

        let rt = tokio::runtime::Handle::current();
        let adapter_id = if agent_id.is_empty() {
            "hermes"
        } else {
            agent_id
        };
        let adapter = self
            .adapters
            .get(adapter_id)
            .or_else(|| self.adapters.default_adapter())
            .ok_or_else(|| format!("adapter '{}' not found", adapter_id))?;

        let turn = ChatTurn {
            messages: vec![ChatMessageDto {
                role: "user".into(),
                content: prompt.into(),
                attachments: vec![],
            }],
            model: None,
            cwd: None,
            model_supports_vision: None,
        };

        let (tx, mut rx) = tokio::sync::mpsc::channel::<ChatStreamEvent>(64);

        rt.block_on(async move {
            let work = async {
                let producer = async {
                    adapter
                        .chat_stream(turn, tx)
                        .await
                        .map_err(|e| format!("agent error: {e}"))
                };
                let consumer = async {
                    let mut acc = String::new();
                    let mut last_emit = std::time::Instant::now();
                    while let Some(ev) = rx.recv().await {
                        if let ChatStreamEvent::Delta(chunk) = ev {
                            if !chunk.is_empty() {
                                acc.push_str(&chunk);
                                if last_emit.elapsed() >= std::time::Duration::from_millis(50) {
                                    progress(&acc);
                                    last_emit = std::time::Instant::now();
                                }
                            }
                        }
                    }
                    if !acc.is_empty() {
                        progress(&acc);
                    }
                    acc
                };
                let (producer_res, accumulated) = tokio::join!(producer, consumer);
                producer_res?;
                Ok::<String, String>(accumulated)
            };
            match tokio::time::timeout(d, work).await {
                Ok(res) => res,
                Err(_) => Err(format!("step timeout after {}s", d.as_secs())),
            }
        })
    }

    fn execute_tool_with_timeout(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        timeout: Option<std::time::Duration>,
    ) -> Result<serde_json::Value, String> {
        // Tool step routing (B-10.4). We accept exactly one format:
        //
        //     mcp:<server>:<tool>
        //
        // where `<server>` is an `mcp_servers.<id>` key from
        // config.yaml and `<tool>` is the JSON-RPC tool name the
        // server exposes. Underscores in either field are fine —
        // colons can't appear in either (verified against the
        // tools/list responses we've seen so far), so the format is
        // unambiguous. Any other prefix is rejected so a typo in
        // the workflow definition becomes a loud error at run time
        // instead of silently shadowing into the simulated stub.
        let parts: Vec<&str> = tool_name.splitn(3, ':').collect();
        if parts.len() != 3 || parts[0] != "mcp" || parts[1].is_empty() || parts[2].is_empty() {
            return Err(format!(
                "tool step expects 'mcp:<server>:<tool>' format, got '{}'",
                tool_name
            ));
        }
        let server = parts[1].to_string();
        let tool = parts[2].to_string();
        // `pack::resolve_mcp_source` reads its own `timeout_secs`
        // from the cfg map and applies it as the HTTP / stdio
        // session timeout. If the engine handed us a `None`, fall
        // back to 30 s — the same default the Pack data-source
        // path uses, so behaviour is identical across surfaces.
        let timeout_secs = timeout.map(|d| d.as_secs()).unwrap_or(30);
        let cfg = serde_json::json!({
            "server": server,
            "tool": tool,
            "params": args,
            "timeout_secs": timeout_secs,
        });

        let authority = self.authority.clone();
        let rt = tokio::runtime::Handle::current();
        let started = std::time::Instant::now();
        let result = rt.block_on(async move {
            resolve_mcp_source(
                &cfg,
                &authority,
                &serde_json::Value::Object(serde_json::Map::new()),
            )
            .await
            .map_err(|e| match e {
                crate::error::IpcError::Internal { message } => {
                    format!("mcp tool error: {message}")
                }
                other => format!("mcp tool error: {other:?}"),
            })
        });
        match &result {
            Ok(_) => tracing::info!(
                server = %server,
                tool = %tool,
                duration_ms = started.elapsed().as_millis() as u64,
                "tool step done",
            ),
            Err(e) => tracing::warn!(
                server = %server,
                tool = %tool,
                duration_ms = started.elapsed().as_millis() as u64,
                error = %e,
                "tool step failed",
            ),
        }
        result
    }

    fn execute_browser_with_timeout(
        &self,
        action: &str,
        url: &str,
        instruction: &str,
        profile: &str,
        timeout: Option<std::time::Duration>,
    ) -> Result<String, String> {
        run_browser_subprocess(action, url, instruction, profile, timeout)
    }

    fn execute_browser(
        &self,
        action: &str,
        url: &str,
        instruction: &str,
        profile: &str,
    ) -> Result<String, String> {
        // Trait-default fallback used by callers that haven't
        // adopted `_with_timeout` yet (e.g. tests). The timeout
        // path is the production one; this just calls it with
        // `None`.
        run_browser_subprocess(action, url, instruction, profile, None)
    }
}

/// Spawn the `browser-runner` subprocess and wait for it, optionally
/// enforcing a wall-clock timeout. Extracted from the trait impl so
/// the kill-on-timeout logic can be unit-tested directly via
/// `run_command_capturing` against a synthetic `sleep` command.
fn run_browser_subprocess(
    action: &str,
    url: &str,
    instruction: &str,
    profile: &str,
    timeout: Option<std::time::Duration>,
) -> Result<String, String> {
    use std::process::Command;

    let cfg = browser_config::load();
    let script_path = browser_config_ipc::find_browser_runner();
    let is_binary = script_path.extension().is_some_and(|e| e == "exe")
        || !script_path.extension().is_some_and(|e| e == "cjs");

    tracing::info!(action = %action, url = %url, profile = %profile, "browser step start");

    let task = serde_json::json!({
        "action": action,
        "url": url,
        "instruction": instruction,
        "profile": if profile.is_empty() { "" } else { profile },
    });

    let mut cmd = if is_binary {
        let mut c = Command::new(&script_path);
        c.arg(task.to_string());
        crate::hermes_config::suppress_window(&mut c);
        c
    } else {
        let mut c = Command::new("node");
        c.arg(&script_path).arg(task.to_string());
        crate::hermes_config::suppress_window(&mut c);
        c
    };

    if !cfg.model.is_empty() {
        cmd.env("BROWSER_LLM_MODEL", &cfg.model);
    }
    if let Some(key) = browser_config::resolve_api_key(&cfg) {
        cmd.env("BROWSER_LLM_API_KEY", key);
    }
    if !cfg.base_url.is_empty() {
        cmd.env("BROWSER_LLM_BASE_URL", &cfg.base_url);
    }

    let started = std::time::Instant::now();
    let outcome = run_command_capturing(cmd, timeout);
    let duration_ms = started.elapsed().as_millis() as u64;

    match outcome {
        Ok(CommandOutcome::Exited {
            success,
            stdout,
            stderr,
        }) => {
            if !success {
                tracing::warn!(
                    action = %action,
                    duration_ms,
                    stderr = %stderr,
                    "browser step failed"
                );
                return Err(format!("browser-runner failed: {}{}", stdout, stderr));
            }
            tracing::info!(action = %action, duration_ms, "browser step done");
            Ok(stdout.trim().to_string())
        }
        Ok(CommandOutcome::TimedOut { secs }) => {
            tracing::warn!(action = %action, duration_ms, timeout_seconds = secs, "browser step timeout");
            Err(format!("step timeout after {secs}s"))
        }
        Err(e) => {
            tracing::warn!(action = %action, duration_ms, error = %e, "browser step spawn failed");
            Err(format!("failed to spawn browser-runner: {e}"))
        }
    }
}

/// Outcome of `run_command_capturing`. A clean `Exited` carries the
/// captured stdout/stderr regardless of exit status — the caller
/// decides what counts as success. `TimedOut` means we proactively
/// killed the child after the deadline; any partial output is
/// discarded since it can't be trusted to be a complete response.
enum CommandOutcome {
    Exited {
        success: bool,
        stdout: String,
        stderr: String,
    },
    TimedOut {
        secs: u64,
    },
}

/// Run `cmd` to completion, capturing stdout/stderr, with an optional
/// wall-clock timeout. When the deadline expires we send SIGKILL (or
/// the Windows equivalent), reap the zombie, and return `TimedOut`.
///
/// Implementation notes:
///
/// - Stdio is `piped()` so we can read the child's output. Reader
///   threads are necessary because writing more than ~64 KB to a
///   piped FD without a reader will deadlock the child.
/// - Polling with `try_wait` every 100 ms is the simplest
///   cross-platform pattern. We don't use `wait-timeout` (extra
///   crate) or signals (POSIX-only); 100 ms latency before kill is
///   fine for human-perceptible step boundaries.
/// - `None` timeout means "wait forever", same shape as the legacy
///   `cmd.output()` call this replaces.
fn run_command_capturing(
    mut cmd: std::process::Command,
    timeout: Option<std::time::Duration>,
) -> std::io::Result<CommandOutcome> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::Instant;

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;

    let mut stdout = child
        .stdout
        .take()
        .expect("piped stdout missing on spawned child");
    let mut stderr = child
        .stderr
        .take()
        .expect("piped stderr missing on spawned child");

    let stdout_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });

    let deadline = timeout.map(|d| Instant::now() + d);

    loop {
        match child.try_wait()? {
            Some(status) => {
                let stdout_buf = stdout_thread.join().unwrap_or_default();
                let stderr_buf = stderr_thread.join().unwrap_or_default();
                return Ok(CommandOutcome::Exited {
                    success: status.success(),
                    stdout: String::from_utf8_lossy(&stdout_buf).into_owned(),
                    stderr: String::from_utf8_lossy(&stderr_buf).into_owned(),
                });
            }
            None => {
                if let Some(dl) = deadline {
                    if Instant::now() >= dl {
                        let _ = child.kill();
                        let _ = child.wait();
                        // Reader threads will see EOF once the child's
                        // FDs close; let them drain so we don't leak.
                        let _ = stdout_thread.join();
                        let _ = stderr_thread.join();
                        let secs = timeout.map(|d| d.as_secs()).unwrap_or(0);
                        return Ok(CommandOutcome::TimedOut { secs });
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
}

#[cfg(all(test, not(target_os = "windows")))]
mod browser_subprocess_tests {
    use super::*;
    use std::process::Command;
    use std::time::Duration;

    fn sleep_cmd(seconds: &str) -> Command {
        let mut c = Command::new("sleep");
        c.arg(seconds);
        c
    }

    #[test]
    fn run_command_capturing_completes_normally_under_timeout() {
        // 0-second sleep exits immediately; we should see Exited
        // with success=true and empty output, well before the 5 s
        // timeout fires.
        let cmd = sleep_cmd("0");
        let outcome =
            run_command_capturing(cmd, Some(Duration::from_secs(5))).expect("spawn failed");
        match outcome {
            CommandOutcome::Exited { success, .. } => {
                assert!(success, "sleep 0 should exit successfully");
            }
            CommandOutcome::TimedOut { .. } => {
                panic!("sleep 0 should not time out under a 5 s deadline");
            }
        }
    }

    #[test]
    fn run_command_capturing_kills_child_on_timeout() {
        // 5-second sleep with 200 ms timeout → must kill the child
        // and return TimedOut. We bound the test wall clock at 2 s
        // so a hung implementation fails CI loudly instead of
        // silently making the suite slow.
        let cmd = sleep_cmd("5");
        let started = std::time::Instant::now();
        let outcome =
            run_command_capturing(cmd, Some(Duration::from_millis(200))).expect("spawn failed");
        let elapsed = started.elapsed();
        assert!(
            matches!(outcome, CommandOutcome::TimedOut { .. }),
            "expected TimedOut, got Exited"
        );
        assert!(
            elapsed < Duration::from_secs(2),
            "kill-on-timeout took too long: {elapsed:?}"
        );
    }

    #[test]
    fn run_command_capturing_no_timeout_waits_for_completion() {
        // None = no enforcement, same shape as legacy cmd.output().
        // sleep 0 finishes naturally.
        let cmd = sleep_cmd("0");
        let outcome = run_command_capturing(cmd, None).expect("spawn failed");
        assert!(matches!(
            outcome,
            CommandOutcome::Exited { success: true, .. }
        ));
    }
}

#[tauri::command]
pub async fn workflow_run(
    state: State<'_, AppState>,
    id: String,
    inputs: serde_json::Value,
) -> IpcResult<String> {
    let wf_id = id.clone();
    let runs = state.workflow_runs.clone();

    let def = tokio::task::spawn_blocking(move || store::get(&wf_id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run load: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run load: {e}"),
        })?;

    let (mut run, ctx) = engine::create_initial_run(&def, inputs);
    let run_id = run.id.clone();

    // Stamp the initial Pending state to disk before the executor
    // even starts. This costs ~1 ms and means a crash mid-startup
    // (rare but possible: Hermes hangs while we're trying to chat
    // its first agent step) still leaves a trace the History view
    // can show.
    let db = state.db.clone();
    persist_run(&db, &mut run);
    runs.lock().insert(run_id.clone(), run);

    // Allocate a cancel flag for this run so `workflow_run_cancel`
    // has somewhere to flip the bit. We hold a shared Arc clone in
    // both `state.workflow_cancel_flags` (so the cancel IPC can
    // find it by run_id) and inside `spawn_run_executor` (so the
    // engine's should_cancel hook reads it).
    let cancel_flag: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    state
        .workflow_cancel_flags
        .lock()
        .insert(run_id.clone(), cancel_flag.clone());

    spawn_run_executor(
        runs.clone(),
        state.adapters.clone(),
        state.authority.clone(),
        db.clone(),
        def,
        run_id.clone(),
        ctx,
        cancel_flag,
    );

    Ok(run_id)
}

/// Public spawn helper: kick the engine on `run_id` in a blocking
/// task. Used by:
///   * `workflow_run` — initial start
///   * `workflow_approve` — resume after an approval gate
///   * `lib.rs setup()` — rehydrate executor on app boot for runs
///     that were `running` / `pending` when Corey was last killed
///
/// All three paths need the same dance (take owned → re-insert →
/// execute_with_hooks → final sync → persist), and inlining it 3×
/// guaranteed drift, so it lives here. `pub` so the boot path can
/// call it from `lib.rs` without going through an IPC dispatch.
///
/// Eight parameters is one over clippy's default warning threshold,
/// but each one is a distinct shared-state pointer the executor
/// genuinely needs (runs map, adapters, authority for MCP routing,
/// db, def, run id, ctx, cancel flag) — bundling them into a struct
/// would just shift the line count without adding cohesion.
#[allow(clippy::too_many_arguments)]
pub fn spawn_run_executor(
    runs: std::sync::Arc<parking_lot::Mutex<std::collections::HashMap<String, WorkflowRun>>>,
    adapters: std::sync::Arc<crate::adapters::AdapterRegistry>,
    authority: std::sync::Arc<crate::sandbox::PathAuthority>,
    db: Option<Arc<Db>>,
    def: WorkflowDef,
    run_id: String,
    mut ctx: workflow::context::RunContext,
    cancel_flag: Arc<AtomicBool>,
) {
    let rid_for_log = run_id.clone();
    let wf_id_for_log = def.id.clone();
    // Emit `workflow:run-started` so the tray counter (B-9.2) and any
    // future listener can react before we hop into spawn_blocking.
    // Paired with the `workflow:run-finished` emit at the bottom of
    // this function — both must be reachable on every code path or
    // the tray active-runs counter drifts.
    if let Some(app) = crate::app_handle::get() {
        use tauri::Emitter;
        let payload = serde_json::json!({
            "run_id": run_id,
            "workflow_id": def.id,
            "workflow_name": def.name,
        });
        if let Err(e) = app.emit("workflow:run-started", payload) {
            tracing::warn!(error = %e, "failed to emit workflow:run-started");
        }
    }
    tokio::task::spawn_blocking(move || {
        let executor = HermesExecutor {
            adapters,
            authority,
        };
        let hook = make_step_end_hook(
            runs.clone(),
            db.clone(),
            run_id.clone(),
            cancel_flag.clone(),
        );
        let progress_hook = make_step_progress_hook(runs.clone(), run_id.clone());
        let should_cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };
        // Take the run OUT of the in-memory map for the duration of
        // execution. The hook syncs the run back into the map at
        // every step boundary, so concurrent `workflow_run_status`
        // polls can read fresh state without us holding the lock
        // while a 30 s agent step churns.
        let Some(mut owned) = runs.lock().remove(&run_id) else {
            return;
        };
        // Make the run visible to pollers immediately, before the
        // first agent call.
        runs.lock().insert(run_id.clone(), owned.clone());
        engine::execute_with_hooks(
            &def,
            &mut owned,
            &mut ctx,
            &executor,
            &hook,
            &progress_hook,
            &should_cancel,
        );
        // Final sync (hook already did this on the terminal
        // transition; this is belt-and-suspenders for safety).
        runs.lock().insert(run_id.clone(), owned.clone());
        persist_run(&db, &mut owned);
        let final_status = format!("{:?}", owned.status);
        tracing::info!(
            wf_id = %wf_id_for_log,
            run_id = %rid_for_log,
            status = %final_status,
            "workflow run finished"
        );

        // Emit `workflow:run-finished` so the frontend can show a
        // desktop notification (B-9.2). Skips if Tauri runtime
        // isn't up (unit tests). Status string matches RunStatus
        // Debug repr — frontend filters Completed / Failed /
        // Cancelled and ignores Running / Paused (those would be
        // mid-flight states from a partial finalize, not terminal).
        if let Some(app) = crate::app_handle::get() {
            use tauri::Emitter;
            let payload = serde_json::json!({
                "run_id": rid_for_log,
                "workflow_id": wf_id_for_log,
                "workflow_name": def.name.clone(),
                "status": final_status,
                "error": owned.error.clone(),
                "started_at_ms": owned.started_at_ms,
                "updated_at_ms": owned.updated_at_ms,
            });
            if let Err(e) = app.emit("workflow:run-finished", payload) {
                tracing::warn!(error = %e, "failed to emit workflow:run-finished");
            }
        }

        if let Some(ref notify_cfg) = def.notify {
            let is_done = owned.status == engine::RunStatus::Completed;
            let is_failed = owned.status == engine::RunStatus::Failed;
            let should_notify =
                (is_done && notify_cfg.on_done) || (is_failed && notify_cfg.on_failure);
            if should_notify {
                let cfg = notify_cfg.clone();
                let wf_name = def.name.clone();
                let st = final_status.clone();
                let err = owned.error.clone();
                let elapsed = owned.updated_at_ms.saturating_sub(owned.started_at_ms) as u64;
                tokio::task::spawn(async move {
                    crate::workflow::notify::send_notify(
                        &cfg,
                        &wf_name,
                        &st,
                        err.as_deref(),
                        elapsed,
                    )
                    .await;
                });
            }
        }
    });
}

/// Closure factory for the engine's step-progress hook. Called many
/// times per agent step (every ~50 ms) with cumulative partial
/// content. We push it into `step.output["partial"]` and snapshot
/// the in-memory copy back so polls see live text streaming in. We
/// deliberately DON'T persist progress to SQLite — that would mean
/// hundreds of DB writes per agent step and the partial isn't
/// authoritative anyway (the final `step_end` hook supersedes it).
fn make_step_progress_hook(
    runs: std::sync::Arc<parking_lot::Mutex<std::collections::HashMap<String, WorkflowRun>>>,
    run_id: String,
) -> impl Fn(&str, &str) {
    move |step_id: &str, partial: &str| {
        let mut map = runs.lock();
        let Some(run) = map.get_mut(&run_id) else {
            return;
        };
        let Some(sr) = run.step_runs.get_mut(step_id) else {
            return;
        };
        // Stash the partial under a stable key the frontend reads.
        // We preserve any other fields the agent might have already
        // produced (currently none for streaming agent steps; this
        // is just defensive in case the engine starts setting an
        // `output: {}` placeholder).
        let mut out = sr
            .output
            .clone()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        out.insert(
            "partial".into(),
            serde_json::Value::String(partial.to_string()),
        );
        sr.output = Some(serde_json::Value::Object(out));
        run.updated_at_ms = chrono::Utc::now().timestamp_millis();
    }
}

/// Closure factory for the engine's step-end hook. Each invocation
/// captures `Arc<Mutex<…>>` and an `Option<Arc<Db>>`, returning a
/// `Fn(&WorkflowRun)` that snapshots the run back into the in-memory
/// map AND persists to SQLite. Called once per step transition
/// (running / completed / failed / paused).
fn make_step_end_hook(
    runs: std::sync::Arc<parking_lot::Mutex<std::collections::HashMap<String, WorkflowRun>>>,
    db: Option<Arc<Db>>,
    run_id: String,
    cancel_flag: Arc<AtomicBool>,
) -> impl Fn(&WorkflowRun) {
    move |r: &WorkflowRun| {
        // Step 1: refresh in-memory copy so pollers see live state.
        // Acquire-and-release in a tight scope so the hot loop doesn't
        // sit on the lock during the upcoming SQLite write.
        //
        // If the user clicked Cancel while the engine was mid-step
        // (chat_stream, etc.), the IPC handler set the in-memory
        // status to Cancelled but the engine's owned `r` is still
        // Running (engine hasn't reached its next `should_cancel`
        // check yet). Without override-protection, this hook would
        // happily clobber Cancelled with Running on its next fire.
        // We snap the clone we publish back to the map / SQLite to
        // Cancelled when the cancel flag is set, so the UI's
        // optimistic flip stays sticky and the next poll confirms.
        let cancel_requested = cancel_flag.load(Ordering::Relaxed);
        let mut snap = r.clone();
        if cancel_requested
            && !matches!(
                snap.status,
                engine::RunStatus::Cancelled
                    | engine::RunStatus::Failed
                    | engine::RunStatus::Completed
            )
        {
            snap.status = engine::RunStatus::Cancelled;
            if snap.error.is_none() {
                snap.error = Some("Cancelled by user".into());
            }
        }
        {
            let mut map = runs.lock();
            // `insert` (rather than `get_mut + clone_from`) keeps the
            // semantics simple: even if the run was evicted by a
            // concurrent delete, we re-insert to reflect that the
            // executor is still authoritatively driving it.
            map.insert(run_id.clone(), snap.clone());
        }
        // Step 2: persist to SQLite outside the in-memory lock. Best-
        // effort: a flaky disk shouldn't stop the engine.
        snap.updated_at_ms = chrono::Utc::now().timestamp_millis();
        if let Some(db) = db.as_ref() {
            if let Err(e) = db.upsert_workflow_run(&snap) {
                tracing::warn!(
                    run_id = %snap.id,
                    error = %e,
                    "step-end persist failed; in-memory state still authoritative"
                );
            }
        }
    }
}

#[tauri::command]
pub async fn workflow_run_status(
    state: State<'_, AppState>,
    run_id: String,
) -> IpcResult<Option<WorkflowRun>> {
    let runs = state.workflow_runs.clone();
    let run = tokio::task::spawn_blocking(move || runs.lock().get(&run_id).cloned())
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run_status join: {e}"),
        })?;
    Ok(run)
}

#[derive(Debug, Deserialize)]
pub struct ApproveParams {
    pub run_id: String,
    pub step_id: String,
    pub approved: bool,
    pub feedback: Option<String>,
}

/// Resolve a paused approval step.
///
/// `approved=true` flips the step to Completed and re-enters the
/// engine to drive the rest of the workflow forward (the executor
/// is idempotent — it picks up where it left off).
///
/// `approved=false` flips the run to Failed with a clear error so
/// downstream steps don't run. We deliberately don't have a
/// "resume from elsewhere" path; rejection means abort.
#[tauri::command]
pub async fn workflow_approve(
    state: State<'_, AppState>,
    params: ApproveParams,
) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    let adapters = state.adapters.clone();
    let db = state.db.clone();
    let run_id = params.run_id.clone();
    let step_id = params.step_id.clone();
    let approved = params.approved;
    let feedback = params.feedback.clone();

    // Phase 1: stamp the approval verdict onto the step + decide
    // whether we still need to drive the engine forward.
    let (should_resume, workflow_id) = tokio::task::spawn_blocking({
        let runs = runs.clone();
        let run_id = run_id.clone();
        let step_id = step_id.clone();
        let feedback = feedback.clone();
        let db = db.clone();
        move || -> Option<(bool, String)> {
            let mut map = runs.lock();
            let run = map.get_mut(&run_id)?;
            let sr = run.step_runs.get_mut(&step_id)?;
            // Only act on a step that's actually paused on us.
            // Re-clicks (network retry, double-tap) become no-ops.
            if sr.status != engine::StepRunStatus::AwaitingApproval {
                return Some((false, run.workflow_id.clone()));
            }
            if approved {
                sr.status = engine::StepRunStatus::Completed;
                sr.output = Some(serde_json::json!({
                    "approved": true,
                    "feedback": feedback,
                    "decided_at": chrono::Utc::now().to_rfc3339(),
                }));
            } else {
                // The frontend always passes a localized feedback
                // string (defaulting to t('workflow_page.rejected_default')
                // when the user clicked Reject without typing a reason),
                // so we just surface it verbatim. Avoids hard-coded
                // English in the run error pill / banner.
                let reason = feedback
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "rejected".into());
                sr.error = Some(reason.clone());
                run.status = engine::RunStatus::Failed;
                run.error = Some(reason);
            }
            // Persist the verdict immediately. If the user closes
            // Corey before the resume task fires (or the resume
            // crashes), the History view still records exactly what
            // happened on the approval gate.
            persist_run(&db, run);
            Some((approved, run.workflow_id.clone()))
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_approve join: {e}"),
    })?
    .ok_or_else(|| IpcError::Internal {
        message: format!("run/step not found: {run_id}/{step_id}"),
    })?;

    // Phase 2: if approved, fire the executor again to resume the
    // run. This mirrors what `workflow_run` does on initial start —
    // we re-load the def from disk (small YAML, cheap) and re-build
    // ctx from the run's persisted step_runs.
    if !should_resume {
        return Ok(true);
    }

    // Resume: load the def, build a fresh ctx (the engine's resume
    // bootstrap will repopulate step outputs from `step_runs`), then
    // hand off to the shared executor spawn helper.
    let def = match tokio::task::spawn_blocking(move || store::get(&workflow_id)).await {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => {
            tracing::error!(error = %e, "workflow_approve: cannot reload def to resume");
            return Ok(true);
        }
        Err(e) => {
            return Err(IpcError::Internal {
                message: format!("workflow_approve def load join: {e}"),
            })
        }
    };
    let inputs_for_ctx = runs
        .lock()
        .get(&run_id)
        .map(|r| r.inputs.clone())
        .unwrap_or(serde_json::Value::Null);
    let ctx = workflow::context::RunContext::new(&def.id, &run_id, inputs_for_ctx);
    // Reuse the existing cancel flag if one is already registered
    // (the run was started in this session and never finished); else
    // allocate a fresh one so `workflow_run_cancel` can still target
    // a resumed-from-disk run.
    let cancel_flag = state
        .workflow_cancel_flags
        .lock()
        .entry(run_id.clone())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone();
    spawn_run_executor(
        runs.clone(),
        adapters,
        state.authority.clone(),
        db.clone(),
        def,
        run_id.clone(),
        ctx,
        cancel_flag,
    );
    tracing::info!(run_id = %run_id, "workflow_approve: resume task spawned");

    Ok(true)
}

/// Manually stop a running workflow. Sets the cancel flag and (for
/// already-paused runs that have no executor running) flips the
/// in-memory + persisted status to `Cancelled` directly. Returns
/// `true` on success, `false` if the run wasn't found.
///
/// Cancellation is honored at the next step boundary — an in-flight
/// agent step (~30 s `chat_stream`) finishes its current call before
/// the engine exits. We deliberately don't abort mid-stream because
/// hermes would still bill for the partial response.
#[tauri::command]
pub async fn workflow_run_cancel(state: State<'_, AppState>, run_id: String) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    let flags = state.workflow_cancel_flags.clone();
    let db = state.db.clone();
    let rid = run_id.clone();
    tokio::task::spawn_blocking(move || -> bool {
        // 1. Flip the atomic flag so the engine sees it on the
        //    next step boundary (covers running / resuming runs).
        let had_flag = flags.lock().get(&rid).is_some();
        if let Some(flag) = flags.lock().get(&rid) {
            flag.store(true, Ordering::Relaxed);
        }
        // 2. ALWAYS flip status to Cancelled immediately, regardless
        //    of current state. Earlier draft only did this for
        //    Paused/Pending runs (with the rationale that the engine
        //    would handle Running runs at the next step boundary).
        //    Problem: an in-flight 30 s `chat_stream` is a step
        //    boundary that's 30 seconds away — the user clicked
        //    Stop, saw nothing happen, assumed cancellation was
        //    broken, and complained.
        //
        //    Now we set Cancelled in-memory + persist immediately
        //    so the next status poll shows it. The engine still
        //    finishes the current step's chat_stream (hermes already
        //    billed for it; aborting wastes the tokens), then sees
        //    `should_cancel = true` on the next dispatch and exits
        //    cleanly. The terminal `on_step_end` fire will not
        //    overwrite Cancelled because the engine's terminal
        //    transitions only set Completed when status != Failed,
        //    and the cancel branch sets it to Cancelled before
        //    returning.
        let mut map = runs.lock();
        let Some(run) = map.get_mut(&rid) else {
            return had_flag;
        };
        // Already terminal — no-op so we don't overwrite Failed /
        // Completed with Cancelled.
        let already_terminal = matches!(
            run.status,
            engine::RunStatus::Cancelled
                | engine::RunStatus::Failed
                | engine::RunStatus::Completed
        );
        if !already_terminal {
            run.status = engine::RunStatus::Cancelled;
            run.error = Some("Cancelled by user".into());
            run.updated_at_ms = chrono::Utc::now().timestamp_millis();
            if let Some(db) = db.as_ref() {
                if let Err(e) = db.upsert_workflow_run(run) {
                    tracing::warn!(run_id = %rid, error = %e, "cancel persist failed");
                }
            }
        }
        tracing::info!(run_id = %rid, "workflow run cancelled (status=Cancelled, executor will exit at next step boundary)");
        true
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run_cancel join: {e}"),
    })
}

/// History list for the workflow page's "past runs" view. Returns
/// MRU-first summaries of every persisted run (terminal + active),
/// optionally filtered to one workflow id. `limit` caps the result so
/// a workflow that's been hammered for months doesn't blow render
/// time; the typed clamp lives inside `db.list_workflow_history`.
#[tauri::command]
pub async fn workflow_history_list(
    state: State<'_, AppState>,
    workflow_id: Option<String>,
    limit: Option<u32>,
) -> IpcResult<Vec<crate::db::WorkflowRunSummary>> {
    let db = state.db.clone();
    let lim = limit.unwrap_or(100);
    let rows = tokio::task::spawn_blocking(move || -> IpcResult<Vec<_>> {
        let Some(db) = db else {
            return Ok(Vec::new());
        };
        db.list_workflow_history(workflow_id.as_deref(), lim)
            .map_err(|e| IpcError::Internal {
                message: format!("list workflow history: {e}"),
            })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_history_list join: {e}"),
    })??;
    Ok(rows)
}

/// Fetch one full historical run (header + all steps) by id. Returns
/// `Ok(None)` when the run id is unknown — used by the History view's
/// "view past audit trail" affordance.
#[tauri::command]
pub async fn workflow_run_get(
    state: State<'_, AppState>,
    run_id: String,
) -> IpcResult<Option<WorkflowRun>> {
    let db = state.db.clone();
    let run = tokio::task::spawn_blocking(move || -> IpcResult<Option<WorkflowRun>> {
        let Some(db) = db else {
            return Ok(None);
        };
        db.get_workflow_run(&run_id)
            .map_err(|e| IpcError::Internal {
                message: format!("get workflow run: {e}"),
            })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run_get join: {e}"),
    })??;
    Ok(run)
}

/// Hard-delete one run + its step rows from the audit trail. Used by
/// the History view's trash affordance. Also evicts the run from the
/// in-memory active-runs map so a re-open doesn't surface a ghost.
#[tauri::command]
pub async fn workflow_run_delete(state: State<'_, AppState>, run_id: String) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        // Evict in-memory copy first so a concurrent active-runs poll
        // can't briefly resurrect what we're about to delete.
        runs.lock().remove(&run_id);
        if let Some(db) = db {
            db.delete_workflow_run(&run_id)
                .map_err(|e| IpcError::Internal {
                    message: format!("delete workflow run: {e}"),
                })?;
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run_delete join: {e}"),
    })??;
    Ok(true)
}

#[tauri::command]
pub async fn workflow_active_runs(state: State<'_, AppState>) -> IpcResult<Vec<WorkflowRun>> {
    let runs = state.workflow_runs.clone();
    let active = tokio::task::spawn_blocking(move || {
        runs.lock()
            .values()
            .filter(|r| {
                matches!(
                    r.status,
                    engine::RunStatus::Running
                        | engine::RunStatus::Pending
                        | engine::RunStatus::Paused
                )
            })
            .cloned()
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_active_runs join: {e}"),
    })?;
    Ok(active)
}

#[derive(Debug, Clone, Serialize)]
pub struct HermesOneshotResult {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
    pub cli_available: bool,
}

#[tauri::command]
pub async fn hermes_oneshot(prompt: String) -> IpcResult<HermesOneshotResult> {
    tokio::task::spawn_blocking(move || -> IpcResult<HermesOneshotResult> {
        let mut cmd = std::process::Command::new("hermes");
        cmd.arg("-z").arg(&prompt);
        crate::hermes_config::suppress_window(&mut cmd);
        let output = cmd.output();
        match output {
            Ok(o) => Ok(HermesOneshotResult {
                stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
                status: o.status.code().unwrap_or(-1),
                cli_available: true,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HermesOneshotResult {
                stdout: String::new(),
                stderr: format!("hermes CLI not found: {e}"),
                status: -1,
                cli_available: false,
            }),
            Err(e) => Err(IpcError::Internal {
                message: format!("hermes -z spawn: {e}"),
            }),
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("hermes_oneshot join: {e}"),
    })?
}
