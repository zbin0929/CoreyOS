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
    assert!(output["text"].as_str().unwrap().contains("topic is test"));
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

#[test]
fn execute_with_custom_executor() {
    struct UpperExecutor;
    impl StepExecutor for UpperExecutor {
        fn execute_agent(&self, _agent_id: &str, prompt: &str) -> Result<String, String> {
            Ok(prompt.to_uppercase())
        }
    }

    let def = WorkflowDef {
        id: "custom".into(),
        name: "Custom".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![agent_step("a", vec![], "hello world")],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = UpperExecutor;
    execute_with_executor(&def, &mut run, &mut ctx, &executor);
    assert_eq!(run.status, RunStatus::Completed);
    let output = run.step_runs["a"].output.as_ref().unwrap();
    assert_eq!(output["text"], "HELLO WORLD");
}

#[test]
fn contract_step_run_serializes_expected_fields() {
    let sr = StepRun {
        step_id: "test-step".into(),
        status: StepRunStatus::Completed,
        output: Some(json!({"key": "val"})),
        error: None,
        duration_ms: Some(42),
    };
    let val = serde_json::to_value(&sr).unwrap();
    assert!(val.get("step_id").is_some(), "missing step_id");
    assert!(val.get("status").is_some(), "missing status");
    assert!(val.get("output").is_some(), "missing output");
    assert!(val.get("error").is_some(), "missing error");
    assert!(val.get("duration_ms").is_some(), "missing duration_ms");
    assert_eq!(val["step_id"], "test-step");
    assert_eq!(val["status"], "completed");
    assert_eq!(val["duration_ms"], 42);
}

#[test]
fn contract_workflow_run_serializes_expected_fields() {
    let mut step_runs = HashMap::new();
    step_runs.insert(
        "s1".into(),
        StepRun {
            step_id: "s1".into(),
            status: StepRunStatus::Pending,
            output: None,
            error: None,
            duration_ms: None,
        },
    );
    let run = WorkflowRun {
        id: "run-1".into(),
        workflow_id: "wf-1".into(),
        status: RunStatus::Pending,
        inputs: json!({}),
        step_runs,
        error: None,
        started_at_ms: 0,
        updated_at_ms: 0,
    };
    let val = serde_json::to_value(&run).unwrap();
    assert!(val.get("id").is_some(), "missing id");
    assert!(val.get("workflow_id").is_some(), "missing workflow_id");
    assert!(val.get("status").is_some(), "missing status");
    assert!(val.get("inputs").is_some(), "missing inputs");
    assert!(val.get("step_runs").is_some(), "missing step_runs");
    assert!(val.get("error").is_some(), "missing error");
    assert!(val.get("started_at_ms").is_some(), "missing started_at_ms");
    assert!(val.get("updated_at_ms").is_some(), "missing updated_at_ms");
}

// ───────────────────────── hook plumbing tests ─────────────────────────
//
// These pin the contract that `execute_with_hooks` upholds for the
// IPC layer:
//   - on_step_end fires AT LEAST once per step (Running flip + Completed
//     flip), so the in-memory map / DB stays in sync.
//   - on_step_progress fires from agent steps when the executor
//     reports streaming progress, and NEVER for non-agent step types.
//   - on_step_end's run argument always reflects the latest mutation
//     (the hook is called AFTER the field is set, not before).

use std::cell::RefCell;
use std::sync::Mutex;

/// Test executor that records calls and pushes scripted progress
/// chunks before returning the final answer. The trait demands
/// `Send + Sync`, so per-impl mutation lives behind `Mutex` rather
/// than `RefCell`.
struct RecordingExecutor {
    /// Each item: cumulative content the executor fires at
    /// `progress` before returning. The full final string is the
    /// last entry.
    progress_script: Vec<String>,
    progress_calls: Mutex<Vec<String>>,
}

impl StepExecutor for RecordingExecutor {
    fn execute_agent(&self, _agent_id: &str, _prompt: &str) -> Result<String, String> {
        // Non-streaming variant is unused in the streaming test below;
        // present only because the trait requires it.
        Ok(self.progress_script.last().cloned().unwrap_or_default())
    }

    fn execute_agent_streaming(
        &self,
        _agent_id: &str,
        _prompt: &str,
        progress: &dyn Fn(&str),
    ) -> Result<String, String> {
        for cumul in &self.progress_script {
            progress(cumul);
            self.progress_calls.lock().unwrap().push(cumul.clone());
        }
        Ok(self
            .progress_script
            .last()
            .cloned()
            .unwrap_or_default())
    }
}

#[test]
fn execute_with_hooks_calls_step_end_for_each_transition() {
    let def = WorkflowDef {
        id: "h1".into(),
        name: "h1".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![agent_step("only", vec![], "ping")],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = SimulatedExecutor;

    let end_calls = RefCell::new(0u32);
    let on_end = |_: &WorkflowRun| {
        *end_calls.borrow_mut() += 1;
    };
    let on_progress = |_: &str, _: &str| {};
    let no_cancel = || false;

    execute_with_hooks(&def, &mut run, &mut ctx, &executor, &on_end, &on_progress, &no_cancel);

    // We expect at least 3 fires: Running flip → Completed flip →
    // final-after-loop flush. More is fine (e.g. an extra fire if
    // the engine ever decides to broadcast a non-step-bound state
    // change), but fewer would mean a transition got dropped.
    let n = *end_calls.borrow();
    assert!(
        n >= 3,
        "expected on_step_end to fire at least 3× for one agent step, got {n}"
    );
    assert_eq!(run.status, RunStatus::Completed);
}

#[test]
fn execute_with_hooks_streams_progress_only_for_agent_steps() {
    let def = WorkflowDef {
        id: "h2".into(),
        name: "h2".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![agent_step("a", vec![], "start")],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = RecordingExecutor {
        progress_script: vec!["He".into(), "Hello".into(), "Hello world".into()],
        progress_calls: Mutex::new(Vec::new()),
    };

    let progress_seen = RefCell::new(Vec::<(String, String)>::new());
    let on_progress = |step_id: &str, partial: &str| {
        progress_seen
            .borrow_mut()
            .push((step_id.to_string(), partial.to_string()));
    };
    let on_end = |_: &WorkflowRun| {};
    let no_cancel = || false;

    execute_with_hooks(&def, &mut run, &mut ctx, &executor, &on_end, &on_progress, &no_cancel);

    let calls = progress_seen.borrow();
    // Three scripted progress emits, all for the only agent step.
    assert_eq!(calls.len(), 3, "expected one progress call per scripted chunk");
    assert!(calls.iter().all(|(id, _)| id == "a"));
    assert_eq!(calls[0].1, "He");
    assert_eq!(calls[2].1, "Hello world");
    // Final step output's `text` field carries the cumulative content.
    let out = run.step_runs["a"].output.as_ref().unwrap();
    assert_eq!(out["text"], "Hello world");
}

#[test]
fn execute_with_hooks_skips_progress_for_tool_step() {
    // Tool steps don't go through the streaming dispatcher; the
    // progress hook should not fire even once.
    let def = WorkflowDef {
        id: "h3".into(),
        name: "h3".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "t".into(),
            name: "t".into(),
            step_type: "tool".into(),
            tool_name: Some("noop".into()),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = SimulatedExecutor;

    let progress_calls = RefCell::new(0u32);
    let on_progress = |_: &str, _: &str| {
        *progress_calls.borrow_mut() += 1;
    };
    let on_end = |_: &WorkflowRun| {};
    let no_cancel = || false;

    execute_with_hooks(&def, &mut run, &mut ctx, &executor, &on_end, &on_progress, &no_cancel);

    assert_eq!(*progress_calls.borrow(), 0, "tool steps must not fire progress");
    assert_eq!(run.status, RunStatus::Completed);
}

#[test]
fn execute_with_hooks_pauses_on_approval_with_step_end_fire() {
    // Approval steps short-circuit the loop. The hook must still
    // see the AwaitingApproval transition so the IPC layer can
    // persist + sync the run.
    let def = WorkflowDef {
        id: "h4".into(),
        name: "h4".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "gate".into(),
            name: "gate".into(),
            step_type: "approval".into(),
            approval_message: Some("ok?".into()),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = SimulatedExecutor;

    let end_seen = RefCell::new(Vec::<(String, RunStatus)>::new());
    let on_end = |r: &WorkflowRun| {
        let approval_status = r
            .step_runs
            .get("gate")
            .map(|sr| format!("{:?}", sr.status))
            .unwrap_or_default();
        end_seen.borrow_mut().push((approval_status, r.status.clone()));
    };
    let on_progress = |_: &str, _: &str| {};
    let no_cancel = || false;

    execute_with_hooks(&def, &mut run, &mut ctx, &executor, &on_end, &on_progress, &no_cancel);

    let calls = end_seen.borrow();
    // Last hook fire should reflect the parked state.
    let last = calls.last().expect("hook never fired");
    assert!(
        last.0.contains("AwaitingApproval"),
        "expected gate=AwaitingApproval at hook time, saw {:?}",
        last.0
    );
    assert_eq!(last.1, RunStatus::Paused);
    assert_eq!(run.status, RunStatus::Paused);
}

#[test]
fn execute_with_hooks_cancels_at_step_boundary() {
    // Multi-step chain. First step completes; before the second
    // dispatches, `should_cancel` flips to true and the engine
    // exits with `RunStatus::Cancelled`. The first step's
    // Completed status survives — we don't unwind history,
    // because the audit trail is the whole point.
    let def = WorkflowDef {
        id: "h5".into(),
        name: "h5".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![
            agent_step("a", vec![], "first"),
            agent_step("b", vec!["a"], "second"),
        ],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = SimulatedExecutor;

    // Cancel triggers AFTER step `a` completes (we observe its
    // status flip in the on_step_end hook).
    let cancel_flag = std::sync::atomic::AtomicBool::new(false);
    let should_cancel = || cancel_flag.load(std::sync::atomic::Ordering::Relaxed);
    let on_end = |r: &WorkflowRun| {
        if matches!(
            r.step_runs.get("a").map(|s| &s.status),
            Some(StepRunStatus::Completed)
        ) {
            cancel_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    };
    let on_progress = |_: &str, _: &str| {};

    execute_with_hooks(&def, &mut run, &mut ctx, &executor, &on_end, &on_progress, &should_cancel);

    assert_eq!(run.status, RunStatus::Cancelled);
    assert_eq!(run.step_runs["a"].status, StepRunStatus::Completed);
    // Step b never started — must still be Pending, not Failed,
    // not Cancelled (we only cancel the *run*, not the step).
    assert_eq!(run.step_runs["b"].status, StepRunStatus::Pending);
    assert_eq!(run.error.as_deref(), Some("Cancelled by user"));
}
