use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::context::{evaluate_condition, RunContext};
use super::model::{WorkflowDef, WorkflowStep};
use super::planner;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StepRunStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
    /// Approval step has paused the run and is waiting for the
    /// human-in-the-loop. Cleared by `workflow_approve` (→
    /// `Completed`) which then resumes the engine. Distinct from
    /// `Pending` so the UI can render a "Approve / Reject" affordance.
    AwaitingApproval,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepRun {
    pub step_id: String,
    pub status: StepRunStatus,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: String,
    pub workflow_id: String,
    pub status: RunStatus,
    pub inputs: serde_json::Value,
    pub step_runs: HashMap<String, StepRun>,
    pub error: Option<String>,
    /// Wall-clock millis when the run was created. Stamped once and
    /// never mutated. Used by the History view (sort by recency) and
    /// by audit reports that quote a verifiable start time.
    #[serde(default)]
    pub started_at_ms: i64,
    /// Last time any field on this run changed (status flip, step
    /// transition, approval). Updated by the persistence layer on
    /// every `upsert_workflow_run` call. Used by the History view's
    /// MRU sort and to avoid noisy DB writes when nothing changed.
    #[serde(default)]
    pub updated_at_ms: i64,
}

impl WorkflowRun {
    pub fn new(workflow_id: &str, inputs: serde_json::Value) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id: Uuid::new_v4().to_string(),
            workflow_id: workflow_id.to_string(),
            status: RunStatus::Pending,
            inputs,
            step_runs: HashMap::new(),
            error: None,
            started_at_ms: now,
            updated_at_ms: now,
        }
    }
}

#[allow(dead_code)]
pub struct EngineResult {
    pub run: WorkflowRun,
    #[allow(dead_code)]
    pub context: RunContext,
}

pub fn create_initial_run(
    def: &WorkflowDef,
    inputs: serde_json::Value,
) -> (WorkflowRun, RunContext) {
    let run_id = Uuid::new_v4().to_string();
    let ctx = RunContext::new(&def.id, &run_id, inputs);
    let mut run = WorkflowRun::new(&def.id, ctx.inputs.clone());

    for step in &def.steps {
        run.step_runs.insert(
            step.id.clone(),
            StepRun {
                step_id: step.id.clone(),
                status: StepRunStatus::Pending,
                output: None,
                error: None,
                duration_ms: None,
            },
        );
    }
    run.status = RunStatus::Running;
    (run, ctx)
}

pub trait StepExecutor: Send + Sync {
    fn execute_agent(&self, agent_id: &str, prompt: &str) -> Result<String, String>;

    /// Streaming variant: identical contract to `execute_agent`
    /// (returns the final assistant content) but the implementation
    /// MAY call `progress` with cumulative partial content as it
    /// streams in. The engine wires `progress` through to the
    /// step-progress hook so the UI can show "Hermes is thinking…"
    /// text in real time during a 30-second agent call.
    ///
    /// `progress` receives the FULL accumulated text so far (not the
    /// delta chunk) — saves the engine + UI from doing their own
    /// reassembly.
    ///
    /// Default impl falls back to `execute_agent`, so trait users
    /// that don't care about live UX (tests, simulator) don't have
    /// to write a streaming method.
    fn execute_agent_streaming(
        &self,
        agent_id: &str,
        prompt: &str,
        _progress: &dyn Fn(&str),
    ) -> Result<String, String> {
        self.execute_agent(agent_id, prompt)
    }

    fn execute_browser(
        &self,
        action: &str,
        url: &str,
        instruction: &str,
        profile: &str,
    ) -> Result<String, String> {
        Ok(format!(
            "[browser:{}] {} @ {} (profile={})",
            action, instruction, url, profile
        ))
    }
}

#[allow(dead_code)]
pub struct SimulatedExecutor;

impl StepExecutor for SimulatedExecutor {
    fn execute_agent(&self, _agent_id: &str, prompt: &str) -> Result<String, String> {
        Ok(format!("[simulated] {}", prompt))
    }
}

/// Drive a workflow forward. **Idempotent**: safe to call again on
/// the same `run` after a pause (e.g. an approval step). On entry
/// we re-seed the planner + context from any already-completed
/// steps in `run.step_runs`, so resume picks up from the boundary
/// without re-running anything. Approval steps short-circuit the
/// loop by setting `RunStatus::Paused` and returning early — the
/// `workflow_approve` IPC then flips the step to `Completed` and
/// re-invokes this function.
pub fn execute_with_executor(
    def: &WorkflowDef,
    run: &mut WorkflowRun,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) {
    execute_with_hooks(def, run, ctx, executor, &|_| {}, &|_, _| {}, &|| false);
}

/// Step-end hook variant. The hook is called with a borrow of the
/// (mutating) run **after every step state transition** — completion,
/// failure, or pause-on-approval — so the IPC layer can:
///
///   1. Snapshot the run back into `state.workflow_runs` while we're
///      not inside the engine's hot loop, so concurrent
///      `workflow_run_status` polls can read fresh state without
///      waiting for the whole workflow to finish.
///   2. Persist the snapshot to SQLite at the same boundary so a
///      crash mid-workflow survives with up-to-date state, not just
///      the boundary at the executor's outermost return.
///
/// The hook fires AT MOST once per step transition, never inside an
/// agent step's blocking `chat_once`. That's the whole point: the
/// agent step is the slow thing, and we want to NOT be holding
/// state's mutex while it runs.
pub fn execute_with_hooks(
    def: &WorkflowDef,
    run: &mut WorkflowRun,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
    on_step_end: &dyn Fn(&WorkflowRun),
    on_step_progress: &dyn Fn(&str, &str),
    should_cancel: &dyn Fn() -> bool,
) {
    let mut plan = planner::build_plan(def);

    // ── Resume bootstrap ──────────────────────────────────────────
    // For every step already marked Completed, remove it from the
    // remaining-deps map and merge its output back into ctx. After
    // this, the `ready` set represents what's actually executable
    // *right now* (downstream of all completed work + all
    // approvals that have been resolved).
    let completed_ids: Vec<String> = run
        .step_runs
        .iter()
        .filter(|(_, sr)| sr.status == StepRunStatus::Completed)
        .map(|(id, _)| id.clone())
        .collect();
    for id in &completed_ids {
        if let Some(sr) = run.step_runs.get(id) {
            if let Some(out) = &sr.output {
                ctx.set_step_output(id, out.clone());
            }
        }
        planner::mark_completed(&mut plan.remaining, id);
    }
    // Recompute ready set: anything in `remaining` whose `after` is
    // now empty is unblocked. (`build_plan`'s initial `plan.ready`
    // is only correct for a fresh run.)
    let mut ready: Vec<String> = plan
        .remaining
        .iter()
        .filter(|(_, deps)| deps.after.is_empty())
        .map(|(id, _)| id.clone())
        .collect();

    // Run is now actively driving forward.
    if run.status == RunStatus::Paused || run.status == RunStatus::Pending {
        run.status = RunStatus::Running;
    }

    while !ready.is_empty() {
        // Honor cancellation at the START of each scheduling pass.
        // We deliberately do NOT abort an in-flight `execute_step_live`
        // — interrupting a chat_stream mid-token would leave hermes
        // billing for content the user threw away. Instead we let
        // the current step finish, then short-circuit before
        // dispatching the next batch. Worst case: one extra agent
        // step runs after the user clicks Cancel; usually that's
        // single-digit seconds.
        if should_cancel() {
            run.status = RunStatus::Cancelled;
            run.error = Some("Cancelled by user".into());
            tracing::info!(run_id = %run.id, "workflow run cancelled by user");
            on_step_end(run);
            return;
        }
        let mut next_ready = Vec::new();

        for step_id in &ready {
            let step = def.steps.iter().find(|s| &s.id == step_id);
            let Some(step) = step else {
                continue;
            };

            // ── Approval gate ────────────────────────────────────
            // Pause the entire run and exit the executor. The
            // human-in-the-loop will eventually call
            // `workflow_approve`, which sets this step to Completed
            // and re-enters this function — at which point the
            // resume bootstrap above will skip past it.
            if step.step_type == "approval" {
                let cur_status = run
                    .step_runs
                    .get(step_id)
                    .map(|s| s.status.clone())
                    .unwrap_or(StepRunStatus::Pending);
                if cur_status != StepRunStatus::Completed {
                    let msg = step
                        .approval_message
                        .as_deref()
                        .map(|m| ctx.render_template(m))
                        .unwrap_or_default();
                    if let Some(sr) = run.step_runs.get_mut(step_id) {
                        sr.status = StepRunStatus::AwaitingApproval;
                        sr.output = Some(json!({
                            "status": "awaiting_approval",
                            "message": msg,
                        }));
                    }
                    run.status = RunStatus::Paused;
                    tracing::info!(step_id = %step_id, "workflow paused awaiting approval");
                    on_step_end(run);
                    return;
                }
                // Already approved on a prior call — skip.
                continue;
            }

            // Snapshot Running BEFORE we enter execute_step_live so
            // the UI can show "X is running" during the (possibly
            // 30 s+) agent call. Without this hook the run's
            // visible state would jump straight from Pending to
            // Completed when the agent finally returns.
            if let Some(sr) = run.step_runs.get_mut(step_id) {
                sr.status = StepRunStatus::Running;
            }
            on_step_end(run);

            let step_start = std::time::Instant::now();
            // For agent steps we route through the streaming variant
            // and forward partial content to the progress hook.
            // Other step types (tool/browser/branch/loop/parallel)
            // don't have a meaningful "partial" concept — the
            // engine just runs them through the legacy path.
            let exec_result = if step.step_type == "agent" {
                execute_agent_step_streaming(step, ctx, executor, &|partial| {
                    on_step_progress(step_id, partial);
                })
            } else {
                execute_step_live(step, ctx, executor)
            };
            match exec_result {
                Ok(output) => {
                    let elapsed = step_start.elapsed().as_millis() as u64;
                    ctx.set_step_output(step_id, output.clone());
                    if let Some(sr) = run.step_runs.get_mut(step_id) {
                        sr.status = StepRunStatus::Completed;
                        sr.output = Some(output);
                        sr.duration_ms = Some(elapsed);
                    }
                    tracing::info!(step_id = %step_id, duration_ms = elapsed, "workflow step completed");
                    let newly = planner::mark_completed(&mut plan.remaining, step_id);
                    next_ready.extend(newly);
                    on_step_end(run);
                }
                Err(e) => {
                    let elapsed = step_start.elapsed().as_millis() as u64;
                    if let Some(sr) = run.step_runs.get_mut(step_id) {
                        sr.status = StepRunStatus::Failed;
                        sr.error = Some(e.clone());
                        sr.duration_ms = Some(elapsed);
                    }
                    tracing::warn!(step_id = %step_id, duration_ms = elapsed, error = %e, "workflow step failed");
                    run.status = RunStatus::Failed;
                    run.error = Some(e);
                    on_step_end(run);
                    return;
                }
            }
        }

        ready = next_ready;
    }

    if run.status != RunStatus::Failed {
        run.status = RunStatus::Completed;
    }
    on_step_end(run);
}

#[allow(dead_code)]
pub fn execute_sync(def: &WorkflowDef, inputs: serde_json::Value) -> EngineResult {
    let (mut run, mut ctx) = create_initial_run(def, inputs);
    let executor = SimulatedExecutor;
    execute_with_executor(def, &mut run, &mut ctx, &executor);
    EngineResult { run, context: ctx }
}

fn execute_step_live(
    step: &WorkflowStep,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) -> Result<serde_json::Value, String> {
    match step.step_type.as_str() {
        "agent" => execute_agent_step_live(step, ctx, executor),
        "tool" => execute_tool_step(step, ctx),
        "browser" => execute_browser_step(step, ctx, executor),
        "parallel" => execute_parallel_step_live(step, ctx, executor),
        "branch" => execute_branch_step(step, ctx),
        "loop" => execute_loop_step_live(step, ctx, executor),
        // `approval` is handled inline in `execute_with_executor`'s
        // outer loop — it pauses the run instead of returning a value.
        // Reaching here would mean the loop forgot to short-circuit
        // (a bug); be loud rather than silently auto-approving.
        "approval" => Err("approval step reached execute_step_live; \
                          should have been intercepted by the run loop".into()),
        other => Err(format!("Unknown step type: {other}")),
    }
}

fn execute_agent_step_live(
    step: &WorkflowStep,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) -> Result<serde_json::Value, String> {
    // Non-streaming entry point. Used by the legacy
    // `execute_with_executor` path (no progress hook) and by
    // parallel/loop sub-steps where threading a progress callback
    // through nested children isn't worth the complexity.
    let prompt = step.prompt.as_deref().ok_or("agent step missing prompt")?;
    let rendered = ctx.render_template(prompt);
    let agent_id = step.agent_id.as_deref().unwrap_or("hermes-default");
    let text = executor.execute_agent(agent_id, &rendered)?;
    Ok(json!({
        "text": text,
        "agent_id": agent_id,
    }))
}

fn execute_agent_step_streaming(
    step: &WorkflowStep,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
    progress: &dyn Fn(&str),
) -> Result<serde_json::Value, String> {
    // Streaming-aware version. The executor MAY call `progress` with
    // cumulative partial text as the agent's output streams in;
    // that text is then forwarded to the engine's step-progress hook
    // by the caller. If the executor's default impl is in use,
    // `progress` is never called and the behaviour matches the
    // non-streaming path.
    let prompt = step.prompt.as_deref().ok_or("agent step missing prompt")?;
    let rendered = ctx.render_template(prompt);
    let agent_id = step.agent_id.as_deref().unwrap_or("hermes-default");
    let text = executor.execute_agent_streaming(agent_id, &rendered, progress)?;
    Ok(json!({
        "text": text,
        "agent_id": agent_id,
    }))
}

fn execute_browser_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) -> Result<serde_json::Value, String> {
    let instruction = step
        .prompt
        .as_deref()
        .ok_or("browser step missing instruction (prompt)")?;
    let rendered = ctx.render_template(instruction);
    let url = step.tool_name.as_deref().unwrap_or("");
    let action = step.agent_id.as_deref().unwrap_or("agent");
    let profile = step.browser_profile.as_deref().unwrap_or("");
    let result = executor.execute_browser(action, url, &rendered, profile)?;
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&result);
    match parsed {
        Ok(v) => Ok(v),
        Err(_) => Ok(json!({ "raw": result })),
    }
}

fn execute_parallel_step_live(
    step: &WorkflowStep,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) -> Result<serde_json::Value, String> {
    let branches = step
        .branches
        .as_ref()
        .ok_or("parallel step missing branches")?;
    let mut results = serde_json::Map::new();
    for branch in branches {
        let output = execute_step_live(branch, ctx, executor)?;
        ctx.set_step_output(&branch.id, output.clone());
        results.insert(branch.id.clone(), output);
    }
    Ok(serde_json::Value::Object(results))
}

fn execute_loop_step_live(
    step: &WorkflowStep,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) -> Result<serde_json::Value, String> {
    let body = step.body.as_ref().ok_or("loop step missing body")?;
    let max = step.max_iterations.unwrap_or(3);
    let mut iterations = Vec::new();

    for i in 0..max {
        let mut iter_output = serde_json::Map::new();
        for b in body {
            match execute_step_live(b, ctx, executor) {
                Ok(out) => {
                    ctx.set_step_output(&b.id, out.clone());
                    iter_output.insert(b.id.clone(), out);
                }
                Err(e) => {
                    iterations.push(json!({ "iteration": i, "error": e }));
                    return Ok(json!({ "iterations": iterations, "status": "failed" }));
                }
            }
        }

        iterations.push(json!({ "iteration": i, "outputs": iter_output }));

        if let Some(exit_cond) = &step.exit_condition {
            if evaluate_condition(exit_cond, ctx) {
                return Ok(json!({ "iterations": iterations, "status": "exited_early" }));
            }
        }
    }

    Ok(json!({ "iterations": iterations, "status": "max_reached" }))
}

fn execute_tool_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let tool = step
        .tool_name
        .as_deref()
        .ok_or("tool step missing tool_name")?;
    let args_rendered = step
        .tool_args
        .as_ref()
        .map(|a| {
            let s = serde_json::to_string(a).unwrap_or_default();
            serde_json::from_str::<serde_json::Value>(&ctx.render_template(&s)).unwrap_or(json!({}))
        })
        .unwrap_or(json!({}));
    Ok(json!({
        "tool": tool,
        "args": args_rendered,
        "status": "simulated"
    }))
}

fn execute_branch_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let conditions = step
        .conditions
        .as_ref()
        .ok_or("branch step missing conditions")?;
    for cond in conditions {
        if evaluate_condition(&cond.expression, ctx) {
            return Ok(json!({
                "matched": cond.expression,
                "goto": cond.goto
            }));
        }
    }
    Ok(json!({ "matched": null, "goto": null }))
}

#[cfg(test)]
mod tests;
