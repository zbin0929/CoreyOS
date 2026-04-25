use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use super::model::{WorkflowDef, WorkflowStep};

pub fn workflows_dir() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no $HOME"))?;
    Ok(PathBuf::from(home).join(".hermes").join("workflows"))
}

pub fn list() -> anyhow::Result<Vec<WorkflowDef>> {
    let dir = workflows_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("yaml")
            || path.extension().and_then(|e| e.to_str()) == Some("yml")
        {
            if let Ok(def) = load_file(&path) {
                out.push(def);
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn get(id: &str) -> anyhow::Result<WorkflowDef> {
    let dir = workflows_dir()?;
    let path = find_file(&dir, id).ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, format!("workflow '{id}' not found"))
    })?;
    load_file(&path)
}

pub fn save(def: &WorkflowDef) -> anyhow::Result<()> {
    let dir = workflows_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.yaml", def.id));
    let yaml = serde_yaml::to_string(def)?;
    crate::fs_atomic::atomic_write(&path, yaml.as_bytes(), None)?;
    Ok(())
}

pub fn delete(id: &str) -> anyhow::Result<bool> {
    let dir = workflows_dir()?;
    if let Some(path) = find_file(&dir, id) {
        std::fs::remove_file(&path)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn find_file(dir: &Path, id: &str) -> Option<PathBuf> {
    let yaml = dir.join(format!("{id}.yaml"));
    if yaml.exists() {
        return Some(yaml);
    }
    let yml = dir.join(format!("{id}.yml"));
    if yml.exists() {
        return Some(yml);
    }
    None
}

fn load_file(path: &Path) -> anyhow::Result<WorkflowDef> {
    let s = std::fs::read_to_string(path)?;
    let def: WorkflowDef = serde_yaml::from_str(&s)?;
    Ok(def)
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

pub fn validate(def: &WorkflowDef) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    if def.id.is_empty() {
        errors.push(ValidationError {
            field: "id".into(),
            message: "ID cannot be empty".into(),
        });
    }
    if def.name.is_empty() {
        errors.push(ValidationError {
            field: "name".into(),
            message: "Name cannot be empty".into(),
        });
    }

    let step_ids: Vec<&str> = def.steps.iter().map(|s| s.id.as_str()).collect();
    let mut seen = HashSet::new();
    for sid in &step_ids {
        if !seen.insert(*sid) {
            errors.push(ValidationError {
                field: format!("steps[{}]", sid),
                message: format!("Duplicate step id: {sid}"),
            });
        }
    }

    for step in &def.steps {
        validate_step(step, &step_ids, &mut errors);
    }

    errors
}

fn validate_step<'a>(
    step: &WorkflowStep,
    known_ids: &[&'a str],
    errors: &mut Vec<ValidationError>,
) {
    if step.id.is_empty() {
        errors.push(ValidationError {
            field: "step.id".into(),
            message: "Step id cannot be empty".into(),
        });
    }

    let valid_types = ["agent", "tool", "browser", "parallel", "branch", "loop", "approval"];
    if !valid_types.contains(&step.step_type.as_str()) {
        errors.push(ValidationError {
            field: format!("steps[{}].type", step.id),
            message: format!(
                "Unknown step type '{}'. Must be one of: {}",
                step.step_type,
                valid_types.join(", ")
            ),
        });
    }

    for after_id in &step.after {
        if !known_ids.contains(&after_id.as_str()) {
            errors.push(ValidationError {
                field: format!("steps[{}].after", step.id),
                message: format!("Unknown dependency: {after_id}"),
            });
        }
    }

    match step.step_type.as_str() {
        "agent" => {
            if step.agent_id.is_none() {
                errors.push(ValidationError {
                    field: format!("steps[{}].agent_id", step.id),
                    message: "Agent step requires agent_id".into(),
                });
            }
            if step.prompt.is_none() {
                errors.push(ValidationError {
                    field: format!("steps[{}].prompt", step.id),
                    message: "Agent step requires prompt".into(),
                });
            }
        }
        "tool" => {
            if step.tool_name.is_none() {
                errors.push(ValidationError {
                    field: format!("steps[{}].tool_name", step.id),
                    message: "Tool step requires tool_name".into(),
                });
            }
        }
        "parallel" => {
            if step.branches.is_none() || step.branches.as_ref().map_or(true, |b| b.is_empty()) {
                errors.push(ValidationError {
                    field: format!("steps[{}].branches", step.id),
                    message: "Parallel step requires at least one branch".into(),
                });
            }
        }
        "branch" => {
            if step.conditions.is_none() || step.conditions.as_ref().map_or(true, |c| c.is_empty())
            {
                errors.push(ValidationError {
                    field: format!("steps[{}].conditions", step.id),
                    message: "Branch step requires at least one condition".into(),
                });
            }
        }
        "loop" => {
            if step.body.is_none() || step.body.as_ref().map_or(true, |b| b.is_empty()) {
                errors.push(ValidationError {
                    field: format!("steps[{}].body", step.id),
                    message: "Loop step requires at least one body step".into(),
                });
            }
        }
        "approval" => {}
        _ => {}
    }

    if let Some(branches) = &step.branches {
        let branch_ids: Vec<&str> = branches.iter().map(|b| b.id.as_str()).collect();
        for b in branches {
            validate_step(b, &branch_ids, errors);
        }
    }
    if let Some(body) = &step.body {
        let body_ids: Vec<&str> = body.iter().map(|b| b.id.as_str()).collect();
        for b in body {
            validate_step(b, &body_ids, errors);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::model::*;

    fn sample_workflow() -> WorkflowDef {
        WorkflowDef {
            id: "test-pipeline".into(),
            name: "Test Pipeline".into(),
            description: "A test workflow".into(),
            version: 1,
            trigger: WorkflowTrigger::Manual,
            inputs: vec![],
            steps: vec![
                WorkflowStep {
                    id: "step1".into(),
                    name: "First".into(),
                    step_type: "agent".into(),
                    agent_id: Some("hermes-default".into()),
                    prompt: Some("Do something".into()),
                    ..Default::default()
                },
                WorkflowStep {
                    id: "step2".into(),
                    name: "Second".into(),
                    step_type: "agent".into(),
                    after: vec!["step1".into()],
                    agent_id: Some("hermes-default".into()),
                    prompt: Some("{{step1.output}}".into()),
                    ..Default::default()
                },
            ],
        }
    }

    #[test]
    fn validate_ok() {
        let wf = sample_workflow();
        let errs = validate(&wf);
        assert!(errs.is_empty(), "expected no errors, got: {errs:?}");
    }

    #[test]
    fn validate_empty_id() {
        let mut wf = sample_workflow();
        wf.id = String::new();
        let errs = validate(&wf);
        assert!(errs.iter().any(|e| e.field == "id"));
    }

    #[test]
    fn validate_unknown_after() {
        let mut wf = sample_workflow();
        wf.steps[1].after = vec!["nonexistent".into()];
        let errs = validate(&wf);
        assert!(errs.iter().any(|e| e.message.contains("nonexistent")));
    }

    #[test]
    fn validate_duplicate_step_id() {
        let mut wf = sample_workflow();
        wf.steps[1].id = "step1".into();
        let errs = validate(&wf);
        assert!(errs.iter().any(|e| e.message.contains("Duplicate")));
    }

    #[test]
    fn validate_agent_missing_prompt() {
        let mut wf = sample_workflow();
        wf.steps[0].prompt = None;
        let errs = validate(&wf);
        assert!(errs.iter().any(|e| e.message.contains("requires prompt")));
    }

    #[test]
    fn validate_parallel_no_branches() {
        let mut wf = sample_workflow();
        wf.steps[0] = WorkflowStep {
            id: "p1".into(),
            name: "Parallel".into(),
            step_type: "parallel".into(),
            ..Default::default()
        };
        let errs = validate(&wf);
        assert!(errs.iter().any(|e| e.message.contains("branch")));
    }

    #[test]
    fn yaml_round_trip() {
        let wf = sample_workflow();
        let yaml = serde_yaml::to_string(&wf).unwrap();
        let back: WorkflowDef = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(back.id, wf.id);
        assert_eq!(back.steps.len(), wf.steps.len());
        assert_eq!(back.steps[1].after, vec!["step1"]);
    }

    #[test]
    fn trigger_type_label() {
        let wf = sample_workflow();
        assert_eq!(wf.trigger_type_label(), "manual");
    }

    #[test]
    fn parse_builtin_templates() {
        use crate::workflow::templates::builtin_templates;
        for (filename, yaml_str) in builtin_templates() {
            let result = serde_yaml::from_str::<WorkflowDef>(yaml_str);
            match &result {
                Ok(def) => {
                    assert!(!def.steps.is_empty(), "{filename} has no steps");
                    assert!(!def.id.is_empty(), "{filename} has no id");
                }
                Err(e) => panic!("Failed to parse {filename}: {e}"),
            }
        }
    }
}
