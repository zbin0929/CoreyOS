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
#[serde(rename_all = "lowercase")]
pub enum StepRunStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
pub struct StepRun {
    pub step_id: String,
    pub status: StepRunStatus,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowRun {
    pub id: String,
    pub workflow_id: String,
    pub status: RunStatus,
    pub inputs: serde_json::Value,
    pub step_runs: HashMap<String, StepRun>,
    pub error: Option<String>,
}

impl WorkflowRun {
    pub fn new(workflow_id: &str, inputs: serde_json::Value) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            workflow_id: workflow_id.to_string(),
            status: RunStatus::Pending,
            inputs,
            step_runs: HashMap::new(),
            error: None,
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

pub fn execute_with_executor(
    def: &WorkflowDef,
    run: &mut WorkflowRun,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) {
    let mut plan = planner::build_plan(def);
    let mut ready: Vec<String> = plan.ready.clone();

    while !ready.is_empty() {
        let mut next_ready = Vec::new();

        for step_id in &ready {
            let step = def.steps.iter().find(|s| &s.id == step_id);
            let Some(step) = step else {
                continue;
            };

            if let Some(sr) = run.step_runs.get_mut(step_id) {
                sr.status = StepRunStatus::Running;
            }

            let step_start = std::time::Instant::now();
            match execute_step_live(step, ctx, executor) {
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
                    return;
                }
            }
        }

        ready = next_ready;
    }

    if run.status != RunStatus::Failed {
        run.status = RunStatus::Completed;
    }
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
        "approval" => execute_approval_step(step, ctx),
        other => Err(format!("Unknown step type: {other}")),
    }
}

fn execute_agent_step_live(
    step: &WorkflowStep,
    ctx: &mut RunContext,
    executor: &dyn StepExecutor,
) -> Result<serde_json::Value, String> {
    let prompt = step.prompt.as_deref().ok_or("agent step missing prompt")?;
    let rendered = ctx.render_template(prompt);
    let agent_id = step.agent_id.as_deref().unwrap_or("hermes-default");
    let text = executor.execute_agent(agent_id, &rendered)?;
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

fn execute_approval_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let msg = step
        .approval_message
        .as_deref()
        .map(|m| ctx.render_template(m))
        .unwrap_or_default();
    Ok(json!({
        "approved": true,
        "message": msg,
        "status": "auto_approved"
    }))
}

#[cfg(test)]
mod tests;
