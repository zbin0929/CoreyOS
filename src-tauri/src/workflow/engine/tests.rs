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
        Ok(self.progress_script.last().cloned().unwrap_or_default())
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

    execute_with_hooks(
        &def,
        &mut run,
        &mut ctx,
        &executor,
        &on_end,
        &on_progress,
        &no_cancel,
    );

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

    execute_with_hooks(
        &def,
        &mut run,
        &mut ctx,
        &executor,
        &on_end,
        &on_progress,
        &no_cancel,
    );

    let calls = progress_seen.borrow();
    // Three scripted progress emits, all for the only agent step.
    assert_eq!(
        calls.len(),
        3,
        "expected one progress call per scripted chunk"
    );
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

    execute_with_hooks(
        &def,
        &mut run,
        &mut ctx,
        &executor,
        &on_end,
        &on_progress,
        &no_cancel,
    );

    assert_eq!(
        *progress_calls.borrow(),
        0,
        "tool steps must not fire progress"
    );
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
        end_seen
            .borrow_mut()
            .push((approval_status, r.status.clone()));
    };
    let on_progress = |_: &str, _: &str| {};
    let no_cancel = || false;

    execute_with_hooks(
        &def,
        &mut run,
        &mut ctx,
        &executor,
        &on_end,
        &on_progress,
        &no_cancel,
    );

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

    execute_with_hooks(
        &def,
        &mut run,
        &mut ctx,
        &executor,
        &on_end,
        &on_progress,
        &should_cancel,
    );

    assert_eq!(run.status, RunStatus::Cancelled);
    assert_eq!(run.step_runs["a"].status, StepRunStatus::Completed);
    // Step b never started — must still be Pending, not Failed,
    // not Cancelled (we only cancel the *run*, not the step).
    assert_eq!(run.step_runs["b"].status, StepRunStatus::Pending);
    assert_eq!(run.error.as_deref(), Some("Cancelled by user"));
}

// ───────────────────────── B-10.2 / B-10.3 retry + on_error ─────────────────────────

/// Test executor that fails `fail_n` times before returning success.
/// Counter is shared via Mutex because the trait demands Send+Sync.
struct FlakyExecutor {
    fail_n: u32,
    calls: Mutex<u32>,
}

impl StepExecutor for FlakyExecutor {
    fn execute_agent(&self, _agent_id: &str, prompt: &str) -> Result<String, String> {
        let mut n = self.calls.lock().expect("calls lock poisoned");
        *n += 1;
        if *n <= self.fail_n {
            Err(format!("flaky failure #{}", *n))
        } else {
            Ok(format!("ok: {}", prompt))
        }
    }

    fn execute_agent_streaming(
        &self,
        agent_id: &str,
        prompt: &str,
        _progress: &dyn Fn(&str),
    ) -> Result<String, String> {
        self.execute_agent(agent_id, prompt)
    }
}

#[test]
fn retry_succeeds_after_transient_failures() {
    // Step fails twice, succeeds on the third attempt. With
    // max=3 the run should still complete cleanly and the step
    // should record the final success — not the earlier errors.
    let def = WorkflowDef {
        id: "retry-ok".into(),
        name: "retry-ok".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "a".into(),
            name: "a".into(),
            step_type: "agent".into(),
            agent_id: Some("hermes-default".into()),
            prompt: Some("hello".into()),
            retry: Some(crate::workflow::model::RetryPolicy {
                max: 3,
                backoff_seconds: 0,
                exponential: false,
            }),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = FlakyExecutor {
        fail_n: 2,
        calls: Mutex::new(0),
    };

    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(run.step_runs["a"].status, StepRunStatus::Completed);
    assert!(run.step_runs["a"].error.is_none());
    assert_eq!(*executor.calls.lock().expect("calls"), 3);
}

#[test]
fn retry_exhausted_fails_run() {
    // max=2 → 3 total attempts; all 3 fail → run goes to Failed
    // and the step's error is the *last* one (no on_error set).
    let def = WorkflowDef {
        id: "retry-fail".into(),
        name: "retry-fail".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "a".into(),
            name: "a".into(),
            step_type: "agent".into(),
            agent_id: Some("hermes-default".into()),
            prompt: Some("hello".into()),
            retry: Some(crate::workflow::model::RetryPolicy {
                max: 2,
                backoff_seconds: 0,
                exponential: false,
            }),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = FlakyExecutor {
        fail_n: 999,
        calls: Mutex::new(0),
    };

    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Failed);
    assert_eq!(run.step_runs["a"].status, StepRunStatus::Failed);
    assert_eq!(*executor.calls.lock().expect("calls"), 3);
    let err = run.step_runs["a"]
        .error
        .as_deref()
        .expect("step must record error");
    assert!(err.contains("flaky failure #3"), "got: {err}");
}

#[test]
fn on_error_routes_to_handler_step() {
    // Failed step has on_error → handler. The handler runs and
    // the run completes successfully (Failed step is recorded
    // but does NOT fail the run). Steps depending on the failed
    // step's normal output are NOT unblocked — they stay Pending.
    let def = WorkflowDef {
        id: "on-err".into(),
        name: "on-err".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![
            WorkflowStep {
                id: "primary".into(),
                name: "primary".into(),
                step_type: "agent".into(),
                agent_id: Some("hermes-default".into()),
                prompt: Some("doit".into()),
                on_error: Some("handler".into()),
                ..Default::default()
            },
            // Normal downstream — should stay Pending because we
            // never reach the success path.
            agent_step("downstream", vec!["primary"], "next"),
            // Error handler — depends on `primary` so it doesn't
            // fire on the first scheduling pass; on_error forces
            // it through by clearing its remaining deps.
            agent_step("handler", vec!["primary"], "recover"),
        ],
    };
    // Custom executor: only "primary" prompt fails; handler succeeds.
    // Using FlakyExecutor here would fail the handler too and mask
    // the routing under test.
    struct PrimaryFailsExecutor;
    impl StepExecutor for PrimaryFailsExecutor {
        fn execute_agent(&self, _agent_id: &str, prompt: &str) -> Result<String, String> {
            if prompt.contains("doit") {
                Err("primary blew up".into())
            } else {
                Ok(prompt.to_string())
            }
        }
    }

    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    execute_with_executor(&def, &mut run, &mut ctx, &PrimaryFailsExecutor);

    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(run.step_runs["primary"].status, StepRunStatus::Failed);
    assert_eq!(
        run.step_runs["primary"].error.as_deref(),
        Some("primary blew up")
    );
    assert_eq!(run.step_runs["handler"].status, StepRunStatus::Completed);
    // Normal downstream must NOT have run.
    assert_eq!(run.step_runs["downstream"].status, StepRunStatus::Pending);
}

#[test]
fn retry_then_on_error_handler() {
    // Retry exhausts → on_error kicks in → handler runs → run
    // completes. Verifies the two policies compose in the right
    // order (retry first, on_error after retries are spent).
    let def = WorkflowDef {
        id: "retry+on_err".into(),
        name: "retry+on_err".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![
            WorkflowStep {
                id: "primary".into(),
                name: "primary".into(),
                step_type: "agent".into(),
                agent_id: Some("hermes-default".into()),
                prompt: Some("flaky".into()),
                retry: Some(crate::workflow::model::RetryPolicy {
                    max: 1,
                    backoff_seconds: 0,
                    exponential: false,
                }),
                on_error: Some("handler".into()),
                ..Default::default()
            },
            agent_step("handler", vec![], "recover"),
        ],
    };

    struct CountingExecutor {
        primary_calls: Mutex<u32>,
    }
    impl StepExecutor for CountingExecutor {
        fn execute_agent(&self, _agent_id: &str, prompt: &str) -> Result<String, String> {
            if prompt.contains("flaky") {
                let mut n = self.primary_calls.lock().expect("lock");
                *n += 1;
                Err(format!("primary fail #{}", *n))
            } else {
                Ok(prompt.to_string())
            }
        }
    }

    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = CountingExecutor {
        primary_calls: Mutex::new(0),
    };
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(run.step_runs["primary"].status, StepRunStatus::Failed);
    assert_eq!(run.step_runs["handler"].status, StepRunStatus::Completed);
    // max=1 → 2 attempts total before on_error fires.
    assert_eq!(*executor.primary_calls.lock().expect("lock"), 2);
}

// ───────────────────────── B-10.1 timeout plumbing ─────────────────────────

use std::time::Duration;

/// Test executor that records every timeout it received via the
/// `_with_timeout` trait methods. Used to pin engine→executor
/// plumbing without relying on a real tokio timeout firing.
struct TimeoutRecorder {
    seen: Mutex<Vec<Option<Duration>>>,
}

impl StepExecutor for TimeoutRecorder {
    fn execute_agent(&self, _agent_id: &str, prompt: &str) -> Result<String, String> {
        Ok(prompt.to_string())
    }

    fn execute_agent_streaming_with_timeout(
        &self,
        _agent_id: &str,
        prompt: &str,
        timeout: Option<Duration>,
        _progress: &dyn Fn(&str),
    ) -> Result<String, String> {
        self.seen.lock().expect("seen lock").push(timeout);
        Ok(prompt.to_string())
    }

    fn execute_agent_with_timeout(
        &self,
        _agent_id: &str,
        prompt: &str,
        timeout: Option<Duration>,
    ) -> Result<String, String> {
        self.seen.lock().expect("seen lock").push(timeout);
        Ok(prompt.to_string())
    }
}

#[test]
fn timeout_default_for_agent_step_is_30min() {
    // No `timeout_minutes` on the step → engine applies the
    // per-type default (agent = 30 min). Pinning this contract
    // here so a future tweak to `default_timeout` doesn't drift
    // silently.
    let def = WorkflowDef {
        id: "to-default".into(),
        name: "to-default".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![agent_step("a", vec![], "hello")],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = TimeoutRecorder {
        seen: Mutex::new(Vec::new()),
    };
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Completed);
    let seen = executor.seen.lock().expect("seen");
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0], Some(Duration::from_secs(30 * 60)));
}

#[test]
fn timeout_step_field_overrides_default() {
    // `timeout_minutes: 2` should land at the executor as 120s,
    // not the 30-min agent default.
    let def = WorkflowDef {
        id: "to-override".into(),
        name: "to-override".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "a".into(),
            name: "a".into(),
            step_type: "agent".into(),
            agent_id: Some("hermes-default".into()),
            prompt: Some("hello".into()),
            timeout_minutes: Some(2),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = TimeoutRecorder {
        seen: Mutex::new(Vec::new()),
    };
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    let seen = executor.seen.lock().expect("seen");
    assert_eq!(seen[0], Some(Duration::from_secs(120)));
}

#[test]
fn timeout_error_marks_step_failed_and_composes_with_retry() {
    // An executor that returns the canonical timeout error string.
    // With `retry.max = 2`, the step should be attempted 3 times
    // total before flipping the run to Failed. Verifies that the
    // retry policy treats timeout failures the same as any other
    // error (no special-casing required).
    struct AlwaysTimesOut {
        calls: Mutex<u32>,
    }
    impl StepExecutor for AlwaysTimesOut {
        fn execute_agent(&self, _agent_id: &str, _prompt: &str) -> Result<String, String> {
            let mut n = self.calls.lock().expect("calls");
            *n += 1;
            Err("step timeout after 60s".into())
        }
    }

    let def = WorkflowDef {
        id: "to-fail".into(),
        name: "to-fail".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "a".into(),
            name: "a".into(),
            step_type: "agent".into(),
            agent_id: Some("hermes-default".into()),
            prompt: Some("hello".into()),
            retry: Some(crate::workflow::model::RetryPolicy {
                max: 2,
                backoff_seconds: 0,
                exponential: false,
            }),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = AlwaysTimesOut {
        calls: Mutex::new(0),
    };
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Failed);
    assert_eq!(run.step_runs["a"].status, StepRunStatus::Failed);
    assert_eq!(*executor.calls.lock().expect("calls"), 3);
    assert!(run.step_runs["a"]
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("step timeout"));
}

#[test]
fn timeout_default_none_for_branch_step() {
    // Branch is in-process, can't hang on I/O — engine should
    // pass `None` to keep `default_timeout` honest for non-I/O
    // step types. (We assert this indirectly: the agent child
    // gets the agent default; the branch parent is never sent to
    // an executor at all.)
    let def = WorkflowDef {
        id: "to-branch".into(),
        name: "to-branch".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![
            agent_step("seed", vec![], "topic is {{inputs.topic}}"),
            WorkflowStep {
                id: "route".into(),
                name: "route".into(),
                step_type: "branch".into(),
                after: vec!["seed".into()],
                conditions: Some(vec![BranchCondition {
                    expression: "inputs.topic == \"AI\"".into(),
                    goto: "done".into(),
                }]),
                ..Default::default()
            },
            agent_step("done", vec!["route"], "ok"),
        ],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({ "topic": "AI" }));
    let executor = TimeoutRecorder {
        seen: Mutex::new(Vec::new()),
    };
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Completed);
    let seen = executor.seen.lock().expect("seen");
    // Two agent calls (seed + done), both at the agent default.
    // Branch step never hits the executor.
    assert_eq!(seen.len(), 2);
    assert!(seen
        .iter()
        .all(|t| *t == Some(Duration::from_secs(30 * 60))));
}

// ───────────────────────── B-10.4 tool step routing ─────────────────────────

/// Records every (tool_name, args, timeout) tuple the engine sends to
/// the tool dispatcher. Used to pin engine→executor plumbing without
/// spinning up a real MCP server. Returns whatever `reply` is set to,
/// so a single executor instance can power both the success and error
/// paths.
struct ToolRecorder {
    calls: Mutex<Vec<(String, serde_json::Value, Option<Duration>)>>,
    reply: Mutex<Result<serde_json::Value, String>>,
}

impl StepExecutor for ToolRecorder {
    fn execute_agent(&self, _agent_id: &str, prompt: &str) -> Result<String, String> {
        Ok(prompt.to_string())
    }

    fn execute_tool_with_timeout(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        timeout: Option<Duration>,
    ) -> Result<serde_json::Value, String> {
        self.calls
            .lock()
            .expect("calls")
            .push((tool_name.to_string(), args.clone(), timeout));
        self.reply.lock().expect("reply").clone()
    }
}

#[test]
fn tool_step_dispatches_to_executor_with_args_and_timeout() {
    // Asserts the trinity: tool_name forwarded verbatim, tool_args
    // rendered through the template engine, and the per-type
    // default timeout (5 min for tool steps) reaches the executor.
    let def = WorkflowDef {
        id: "tool-dispatch".into(),
        name: "tool-dispatch".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "t".into(),
            name: "t".into(),
            step_type: "tool".into(),
            tool_name: Some("mcp:amazon-sp-api:get_orders".into()),
            tool_args: Some(json!({ "marketplace": "{{inputs.market}}" })),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({ "market": "US" }));
    let executor = ToolRecorder {
        calls: Mutex::new(Vec::new()),
        reply: Mutex::new(Ok(json!({ "orders": 42 }))),
    };

    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Completed);
    let calls = executor.calls.lock().expect("calls");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "mcp:amazon-sp-api:get_orders");
    assert_eq!(calls[0].1, json!({ "marketplace": "US" }));
    assert_eq!(calls[0].2, Some(Duration::from_secs(5 * 60)));
    assert_eq!(
        run.step_runs["t"].output,
        Some(json!({ "orders": 42 })),
        "executor's reply must land in the step output verbatim"
    );
}

#[test]
fn tool_step_executor_error_propagates_to_run() {
    // Tool failure flows through the same retry / on_error path as
    // agent failures — no special-casing. Without retry, one error
    // → run Failed.
    let def = WorkflowDef {
        id: "tool-fail".into(),
        name: "tool-fail".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "t".into(),
            name: "t".into(),
            step_type: "tool".into(),
            tool_name: Some("mcp:bad-server:nope".into()),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = ToolRecorder {
        calls: Mutex::new(Vec::new()),
        reply: Mutex::new(Err("mcp tool error: server 'bad-server' not found".into())),
    };

    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Failed);
    assert_eq!(run.step_runs["t"].status, StepRunStatus::Failed);
    assert!(run.step_runs["t"]
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("bad-server"));
}

#[test]
fn tool_step_default_simulated_for_simulated_executor() {
    // SimulatedExecutor uses the trait's default `execute_tool` impl,
    // which returns `{tool, args, status: simulated}`. This pins the
    // backward-compat contract the existing `execute_with_hooks_skips_progress_for_tool_step`
    // test relies on, surfaced here as a focused assertion.
    let def = WorkflowDef {
        id: "tool-sim".into(),
        name: "tool-sim".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "t".into(),
            name: "t".into(),
            step_type: "tool".into(),
            tool_name: Some("noop".into()),
            tool_args: Some(json!({ "x": 1 })),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = SimulatedExecutor;
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Completed);
    let out = run.step_runs["t"]
        .output
        .as_ref()
        .expect("tool step must have output");
    assert_eq!(out["status"], "simulated");
    assert_eq!(out["tool"], "noop");
    assert_eq!(out["args"], json!({ "x": 1 }));
}

// ── B-10.6 sub-workflow ───────────────────────────────────────────

#[test]
fn subworkflow_step_without_id_fails_validation_at_dispatch() {
    // We can't drive the engine through a real sub-workflow load
    // without seeding paths::set_app_config_dir + writing a YAML
    // file (the store reads from disk). Instead we validate the
    // shape contracts:
    //   1. Missing workflow_id → step fails at dispatch with a
    //      clear error, does NOT panic, does NOT auto-load.
    //   2. Self-id → cycle detected before any disk I/O.
    //
    // Both paths exit through `execute_subworkflow_step` before
    // ever touching `store::get`, so they're safe to test without
    // a workspace.
    let def = WorkflowDef {
        id: "outer".into(),
        name: "outer".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "child".into(),
            name: "child".into(),
            step_type: "workflow".into(),
            workflow_id: None,
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = SimulatedExecutor;
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Failed);
    let sr = &run.step_runs["child"];
    assert_eq!(sr.status, StepRunStatus::Failed);
    assert!(
        sr.error
            .as_deref()
            .unwrap_or("")
            .contains("missing workflow_id"),
        "expected missing-id error, got {:?}",
        sr.error
    );
}

#[test]
fn subworkflow_self_call_is_caught_as_cycle() {
    let def = WorkflowDef {
        id: "loop".into(),
        name: "loop".into(),
        description: String::new(),
        version: 1,
        trigger: WorkflowTrigger::Manual,
        inputs: vec![],
        steps: vec![WorkflowStep {
            id: "recurse".into(),
            name: "recurse".into(),
            step_type: "workflow".into(),
            workflow_id: Some("loop".into()),
            ..Default::default()
        }],
    };
    let (mut run, mut ctx) = create_initial_run(&def, json!({}));
    let executor = SimulatedExecutor;
    execute_with_executor(&def, &mut run, &mut ctx, &executor);

    assert_eq!(run.status, RunStatus::Failed);
    let sr = &run.step_runs["recurse"];
    assert_eq!(sr.status, StepRunStatus::Failed);
    assert!(
        sr.error
            .as_deref()
            .unwrap_or("")
            .contains("cycle detected"),
        "expected cycle error, got {:?}",
        sr.error
    );
}

#[test]
fn subworkflow_inputs_render_against_parent_context() {
    use super::render_subworkflow_inputs;
    let mut ctx = RunContext::new("p", "r", json!({ "topic": "AI", "count": 3 }));
    ctx.set_step_output("scrape", json!({ "text": "hello world" }));

    let inputs = json!({
        "from_inputs": "{{ inputs.topic }}",
        "from_step": "{{ scrape.text }}",
        "literal_number": 42,
        "literal_array": [1, 2],
    });
    let rendered = render_subworkflow_inputs(Some(&inputs), &ctx);
    assert_eq!(rendered["from_inputs"], "AI");
    assert_eq!(rendered["from_step"], "hello world");
    assert_eq!(rendered["literal_number"], 42);
    assert_eq!(rendered["literal_array"], json!([1, 2]));
}

#[test]
fn subworkflow_inputs_default_when_none() {
    use super::render_subworkflow_inputs;
    let ctx = RunContext::new("p", "r", json!({}));
    let rendered = render_subworkflow_inputs(None, &ctx);
    assert_eq!(rendered, json!({}));
}
