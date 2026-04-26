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
        };
        let val = serde_json::to_value(&run).unwrap();
        assert!(val.get("id").is_some(), "missing id");
        assert!(val.get("workflow_id").is_some(), "missing workflow_id");
        assert!(val.get("status").is_some(), "missing status");
        assert!(val.get("inputs").is_some(), "missing inputs");
        assert!(val.get("step_runs").is_some(), "missing step_runs");
        assert!(val.get("error").is_some(), "missing error");
    }
