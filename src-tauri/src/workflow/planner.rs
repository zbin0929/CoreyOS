use std::collections::{HashMap, HashSet, VecDeque};

use super::model::{WorkflowDef, WorkflowStep};

pub struct ExecutionPlan {
    pub ready: Vec<String>,
    pub remaining: HashMap<String, StepDeps>,
}

pub struct StepDeps {
    pub after: Vec<String>,
}

pub fn build_plan(def: &WorkflowDef) -> ExecutionPlan {
    let mut remaining: HashMap<String, StepDeps> = HashMap::new();
    for step in &def.steps {
        remaining.insert(
            step.id.clone(),
            StepDeps {
                after: step.after.clone(),
            },
        );
    }

    let ready = find_ready(&remaining);
    ExecutionPlan { ready, remaining }
}

pub fn find_ready(remaining: &HashMap<String, StepDeps>) -> Vec<String> {
    remaining
        .iter()
        .filter(|(_, deps)| deps.after.is_empty())
        .map(|(id, _)| id.clone())
        .collect()
}

pub fn mark_completed(remaining: &mut HashMap<String, StepDeps>, step_id: &str) -> Vec<String> {
    remaining.remove(step_id);
    for deps in remaining.values_mut() {
        deps.after.retain(|d| d != step_id);
    }
    find_ready(remaining)
}

#[allow(dead_code)]
pub fn topological_order(def: &WorkflowDef) -> Result<Vec<String>, String> {
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();

    for step in &def.steps {
        in_degree.entry(&step.id).or_insert(0);
        adj.entry(&step.id).or_default();
        for after in &step.after {
            *in_degree.entry(&step.id).or_insert(0) += 1;
            adj.entry(after.as_str()).or_default().push(&step.id);
        }
    }

    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut order = Vec::new();
    while let Some(id) = queue.pop_front() {
        order.push(id.to_string());
        if let Some(neighbors) = adj.get(id) {
            for &n in neighbors {
                let deg = in_degree.get_mut(n).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(n);
                }
            }
        }
    }

    if order.len() != def.steps.len() {
        return Err("Cycle detected in workflow steps".into());
    }
    Ok(order)
}

#[allow(dead_code)]
pub fn collect_all_step_ids(steps: &[WorkflowStep]) -> HashSet<String> {
    let mut ids = HashSet::new();
    for step in steps {
        ids.insert(step.id.clone());
        if let Some(branches) = &step.branches {
            ids.extend(collect_all_step_ids(branches));
        }
        if let Some(body) = &step.body {
            ids.extend(collect_all_step_ids(body));
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::model::*;

    fn make_step(id: &str, after: Vec<&str>) -> WorkflowStep {
        WorkflowStep {
            id: id.into(),
            name: id.into(),
            step_type: "agent".into(),
            after: after.into_iter().map(String::from).collect(),
            agent_id: Some("hermes-default".into()),
            prompt: Some("do".into()),
            ..Default::default()
        }
    }

    #[test]
    fn topo_simple_chain() {
        let def = WorkflowDef {
            id: "test".into(),
            name: "test".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                make_step("a", vec![]),
                make_step("b", vec!["a"]),
                make_step("c", vec!["b"]),
            ],
        };
        let order = topological_order(&def).unwrap();
        assert_eq!(order, vec!["a", "b", "c"]);
    }

    #[test]
    fn topo_parallel() {
        let def = WorkflowDef {
            id: "test".into(),
            name: "test".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                make_step("a", vec![]),
                make_step("b1", vec!["a"]),
                make_step("b2", vec!["a"]),
                make_step("c", vec!["b1", "b2"]),
            ],
        };
        let order = topological_order(&def).unwrap();
        assert_eq!(order[0], "a");
        assert!(order.contains(&"b1".into()));
        assert!(order.contains(&"b2".into()));
        assert_eq!(order[3], "c");
    }

    #[test]
    fn topo_detects_cycle() {
        let def = WorkflowDef {
            id: "test".into(),
            name: "test".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![make_step("a", vec!["b"]), make_step("b", vec!["a"])],
        };
        assert!(topological_order(&def).is_err());
    }

    #[test]
    fn plan_marks_completed() {
        let def = WorkflowDef {
            id: "test".into(),
            name: "test".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                make_step("a", vec![]),
                make_step("b", vec!["a"]),
                make_step("c", vec!["b"]),
            ],
        };
        let mut plan = build_plan(&def);
        assert_eq!(plan.ready, vec!["a"]);

        let next = mark_completed(&mut plan.remaining, "a");
        assert_eq!(next, vec!["b"]);

        let next2 = mark_completed(&mut plan.remaining, "b");
        assert_eq!(next2, vec!["c"]);
    }

    #[test]
    fn plan_parallel_ready() {
        let def = WorkflowDef {
            id: "test".into(),
            name: "test".into(),
            description: String::new(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                make_step("a", vec![]),
                make_step("b1", vec!["a"]),
                make_step("b2", vec!["a"]),
            ],
        };
        let mut plan = build_plan(&def);
        assert_eq!(plan.ready, vec!["a"]);

        let next = mark_completed(&mut plan.remaining, "a");
        assert!(next.contains(&"b1".into()));
        assert!(next.contains(&"b2".into()));
    }
}
