use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: u32,
    pub trigger: WorkflowTrigger,
    #[serde(default)]
    pub inputs: Vec<WorkflowInput>,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowTrigger {
    Manual,
    Cron { expression: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowInput {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub input_type: String,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowStep {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub step_type: String,
    #[serde(default)]
    pub after: Vec<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_args: Option<serde_json::Value>,
    #[serde(default)]
    pub branches: Option<Vec<WorkflowStep>>,
    #[serde(default)]
    pub conditions: Option<Vec<BranchCondition>>,
    #[serde(default)]
    pub max_iterations: Option<u32>,
    #[serde(default)]
    pub body: Option<Vec<WorkflowStep>>,
    #[serde(default)]
    pub exit_condition: Option<String>,
    #[serde(default)]
    pub after_done: Option<String>,
    #[serde(default)]
    pub timeout_minutes: Option<u32>,
    #[serde(default)]
    pub approval_message: Option<String>,
    #[serde(default)]
    pub output_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchCondition {
    pub expression: String,
    pub goto: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: u32,
    pub trigger_type: String,
    pub step_count: usize,
    pub updated_at_ms: i64,
}

impl WorkflowDef {
    pub fn trigger_type_label(&self) -> &str {
        match &self.trigger {
            WorkflowTrigger::Manual => "manual",
            WorkflowTrigger::Cron { .. } => "cron",
        }
    }

    pub fn summary(&self, updated_at_ms: i64) -> WorkflowSummary {
        WorkflowSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            version: self.version,
            trigger_type: self.trigger_type_label().to_string(),
            step_count: self.steps.len(),
            updated_at_ms,
        }
    }
}
