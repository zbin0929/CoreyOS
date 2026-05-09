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
    #[serde(default)]
    pub notify: Option<NotifyConfig>,
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
    #[serde(default)]
    pub browser_profile: Option<String>,
    #[serde(default)]
    pub retry: Option<RetryPolicy>,
    #[serde(default)]
    pub on_error: Option<String>,
    /// **B-10.6 sub-workflow**. When `step_type == "workflow"`, this
    /// names the child workflow def to invoke (looked up via
    /// `workflow::store::get`). The engine renders `workflow_inputs`
    /// against the parent's RunContext, builds a fresh child run,
    /// drives it to completion synchronously, and surfaces the
    /// child's final step outputs as this step's output. Required
    /// for `step_type == "workflow"`; ignored for other types.
    #[serde(default)]
    pub workflow_id: Option<String>,
    /// Input values passed to the child workflow (B-10.6). Each value
    /// is template-rendered against the parent's RunContext before
    /// the child run starts, so a sub-workflow can take inputs like
    /// `"{{ steps.scrape.text }}"`. Optional; defaults to `{}` (no
    /// inputs) which only works if the child def has no required
    /// inputs of its own.
    #[serde(default)]
    pub workflow_inputs: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RetryPolicy {
    #[serde(default)]
    pub max: u32,
    #[serde(default)]
    pub backoff_seconds: u32,
    #[serde(default)]
    pub exponential: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyConfig {
    #[serde(default)]
    pub on_done: bool,
    #[serde(default = "default_true")]
    pub on_failure: bool,
    pub webhook_url: String,
    #[serde(default = "default_notify_format")]
    pub format: String,
    #[serde(default)]
    pub message: Option<String>,
}

fn default_notify_format() -> String {
    "generic".to_string()
}

fn default_true() -> bool {
    true
}
