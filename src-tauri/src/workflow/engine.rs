use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::context::{evaluate_condition, RunContext};
use super::model::{WorkflowDef, WorkflowStep};
use super::planner;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RunStatus {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

pub struct EngineResult {
    pub run: WorkflowRun,
    pub context: RunContext,
}

pub fn execute_sync(def: &WorkflowDef, inputs: serde_json::Value) -> EngineResult {
    let run_id = Uuid::new_v4().to_string();
    let mut ctx = RunContext::new(&def.id, &run_id, inputs);
    let mut run = WorkflowRun::new(&def.id, ctx.inputs.clone());

    for step in &def.steps {
        run.step_runs.insert(
            step.id.clone(),
            StepRun {
                step_id: step.id.clone(),
                status: StepRunStatus::Pending,
                output: None,
                error: None,
            },
        );
    }

    run.status = RunStatus::Running;

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

            match execute_step(step, &mut ctx) {
                Ok(output) => {
                    ctx.set_step_output(step_id, output.clone());
                    if let Some(sr) = run.step_runs.get_mut(step_id) {
                        sr.status = StepRunStatus::Completed;
                        sr.output = Some(output);
                    }
                    let newly = planner::mark_completed(&mut plan.remaining, step_id);
                    next_ready.extend(newly);
                }
                Err(e) => {
                    if let Some(sr) = run.step_runs.get_mut(step_id) {
                        sr.status = StepRunStatus::Failed;
                        sr.error = Some(e.clone());
                    }
                    run.status = RunStatus::Failed;
                    run.error = Some(e);
                    return EngineResult { run, context: ctx };
                }
            }
        }

        ready = next_ready;
    }

    if run.status != RunStatus::Failed {
        run.status = RunStatus::Completed;
    }

    EngineResult { run, context: ctx }
}

fn execute_step(step: &WorkflowStep, ctx: &mut RunContext) -> Result<serde_json::Value, String> {
    match step.step_type.as_str() {
        "agent" => execute_agent_step(step, ctx),
        "tool" => execute_tool_step(step, ctx),
        "parallel" => execute_parallel_step(step, ctx),
        "branch" => execute_branch_step(step, ctx),
        "loop" => execute_loop_step(step, ctx),
        "approval" => execute_approval_step(step, ctx),
        other => Err(format!("Unknown step type: {other}")),
    }
}

fn execute_agent_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let prompt = step.prompt.as_deref().ok_or("agent step missing prompt")?;
    let rendered = ctx.render_template(prompt);
    Ok(json!({
        "text": rendered,
        "agent_id": step.agent_id,
        "status": "simulated"
    }))
}

fn execute_tool_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let tool = step.tool_name.as_deref().ok_or("tool step missing tool_name")?;
    let args_rendered = step
        .tool_args
        .as_ref()
        .map(|a| {
            let s = serde_json::to_string(a).unwrap_or_default();
            serde_json::from_str::<serde_json::Value>(&ctx.render_template(&s))
                .unwrap_or(json!({}))
        })
        .unwrap_or(json!({}));
    Ok(json!({
        "tool": tool,
        "args": args_rendered,
        "status": "simulated"
    }))
}

fn execute_parallel_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let branches = step.branches.as_ref().ok_or("parallel step missing branches")?;
    let mut results = serde_json::Map::new();
    for branch in branches {
        let output = execute_step(branch, ctx)?;
        ctx.set_step_output(&branch.id, output.clone());
        results.insert(branch.id.clone(), output);
    }
    Ok(serde_json::Value::Object(results))
}

fn execute_branch_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let conditions = step.conditions.as_ref().ok_or("branch step missing conditions")?;
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

fn execute_loop_step(
    step: &WorkflowStep,
    ctx: &mut RunContext,
) -> Result<serde_json::Value, String> {
    let body = step.body.as_ref().ok_or("loop step missing body")?;
    let max = step.max_iterations.unwrap_or(3);
    let mut iterations = Vec::new();

    for i in 0..max {
        let mut iter_output = serde_json::Map::new();
        for b in body {
            match execute_step(b, ctx) {
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
mod tests {
    use super::*;
    use crate::workflow::model::*;

    fn agent_step(id: &str, after: Vec<&str>, prompt: &str) -> WorkflowStep {
        WorkflowStep {
            id: id.into(),
            name: id.into(),
            step_type: "agent".into(),
            after: after.into_iter().map(String::from).collect(),
            agent_id: Some("hermes-default".into()),
            prompt: Some(prompt.into()),
            ..Default::default()
        }
    }

    fn parallel_step(id: &str, after: Vec<&str>, branches: Vec<WorkflowStep>) -> WorkflowStep {
        WorkflowStep {
            id: id.into(),
            name: id.into(),
            step_type: "parallel".into(),
            after: after.into_iter().map(String::from).collect(),
            branches: Some(branches),
            ..Default::default()
        }
    }

    #[test]
    fn execute_simple_chain() {
        let def = WorkflowDef {
            id: "chain".into(),
            name: "Chain".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                agent_step("a", vec![], "hello"),
                agent_step("b", vec!["a"], "{{a.output}}"),
            ],
        };
        let result = execute_sync(&def, json!({}));
        assert_eq!(result.run.status, RunStatus::Completed);
        assert!(result.run.step_runs["a"].status == StepRunStatus::Completed);
        assert!(result.run.step_runs["b"].status == StepRunStatus::Completed);
    }

    #[test]
    fn execute_parallel() {
        let def = WorkflowDef {
            id: "par".into(),
            name: "Parallel".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                agent_step("a", vec![], "start"),
                parallel_step(
                    "p",
                    vec!["a"],
                    vec![
                        agent_step("b1", vec![], "branch1"),
                        agent_step("b2", vec![], "branch2"),
                    ],
                ),
            ],
        };
        let result = execute_sync(&def, json!({}));
        assert_eq!(result.run.status, RunStatus::Completed);
        assert!(result.context.step_outputs.contains_key("b1"));
        assert!(result.context.step_outputs.contains_key("b2"));
    }

    #[test]
    fn execute_branch() {
        let def = WorkflowDef {
            id: "br".into(),
            name: "Branch".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                WorkflowStep {
                    id: "review".into(),
                    name: "Review".into(),
                    step_type: "agent".into(),
                    agent_id: Some("h".into()),
                    prompt: Some("review".into()),
                    ..Default::default()
                },
                WorkflowStep {
                    id: "route".into(),
                    name: "Route".into(),
                    step_type: "branch".into(),
                    after: vec!["review".into()],
                    conditions: Some(vec![BranchCondition {
                        expression: "inputs.topic == \"AI\"".into(),
                        goto: "final".into(),
                    }]),
                    ..Default::default()
                },
                agent_step("final", vec!["route"], "done"),
            ],
        };
        let result = execute_sync(&def, json!({ "topic": "AI" }));
        assert_eq!(result.run.status, RunStatus::Completed);
    }

    #[test]
    fn execute_with_inputs() {
        let def = WorkflowDef {
            id: "inp".into(),
            name: "Inputs".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![agent_step("a", vec![], "topic is {{inputs.topic}}")],
        };
        let result = execute_sync(&def, json!({ "topic": "test" }));
        assert_eq!(result.run.status, RunStatus::Completed);
        let output = result.run.step_runs["a"].output.as_ref().unwrap();
        assert_eq!(output["text"], "topic is test");
    }

    #[test]
    fn execute_loop() {
        let def = WorkflowDef {
            id: "loop".into(),
            name: "Loop".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![WorkflowStep {
                id: "l".into(),
                name: "Loop".into(),
                step_type: "loop".into(),
                max_iterations: Some(2),
                body: Some(vec![agent_step("fix", vec![], "fix")]),
                ..Default::default()
            }],
        };
        let result = execute_sync(&def, json!({}));
        assert_eq!(result.run.status, RunStatus::Completed);
        let output = result.run.step_runs["l"].output.as_ref().unwrap();
        assert_eq!(output["status"], "max_reached");
    }
}
