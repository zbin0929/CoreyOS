use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::model::WorkflowDef;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunContext {
    pub workflow_id: String,
    pub run_id: String,
    pub inputs: Value,
    pub step_outputs: HashMap<String, Value>,
}

impl RunContext {
    pub fn new(workflow_id: &str, run_id: &str, inputs: Value) -> Self {
        Self {
            workflow_id: workflow_id.to_string(),
            run_id: run_id.to_string(),
            inputs,
            step_outputs: HashMap::new(),
        }
    }

    pub fn set_step_output(&mut self, step_id: &str, output: Value) {
        self.step_outputs.insert(step_id.to_string(), output);
    }

    pub fn render_template(&self, template: &str) -> String {
        let mut result = template.to_string();
        while let Some(start) = result.find("{{") {
            let end = match result[start..].find("}}") {
                Some(e) => start + e,
                None => break,
            };
            let expr = result[start + 2..end].trim();
            let replacement = self.resolve_expr(expr);
            result.replace_range(start..end + 2, &replacement);
        }
        result
    }

    fn resolve_expr(&self, expr: &str) -> String {
        let parts: Vec<&str> = expr.split('.').collect();
        if parts.is_empty() {
            return String::new();
        }

        let root_val: Option<&Value> = match parts[0] {
            "inputs" => Some(&self.inputs),
            s => self.step_outputs.get(s),
        };

        let Some(root) = root_val else {
            return String::new();
        };

        let resolved: Option<&Value> = if parts.len() == 1 {
            Some(root)
        } else if parts[1] == "output" {
            if parts.len() == 2 {
                Some(root)
            } else {
                walk_path(root, &parts[2..])
            }
        } else {
            walk_path(root, &parts[1..])
        };

        match resolved {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::Bool(b)) => b.to_string(),
            Some(Value::Null) => String::new(),
            Some(other) => other.to_string(),
            None => String::new(),
        }
    }
}

fn walk_path<'a>(val: &'a Value, parts: &[&str]) -> Option<&'a Value> {
    let mut current = val;
    for part in parts {
        if let Ok(idx) = part.parse::<usize>() {
            current = current.get(idx)?;
        } else {
            current = current.get(*part)?;
        }
    }
    Some(current)
}

pub fn evaluate_condition(expr: &str, ctx: &RunContext) -> bool {
    let rendered = ctx.render_template(&format!("{{{{{expr}}}}}"));

    if let Some(eq_pos) = expr.find("==") {
        let left = expr[..eq_pos].trim();
        let right = expr[eq_pos + 2..].trim();

        let left_val = ctx.render_template(&format!("{{{{{left}}}}}"));
        let right_unquoted = right.trim_matches('"').trim_matches('\'');

        if right == "true" {
            return left_val == "true";
        }
        if right == "false" {
            return left_val == "false";
        }
        return left_val == right_unquoted;
    }

    !rendered.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ctx_with_outputs() -> RunContext {
        let mut ctx = RunContext::new("wf-1", "run-1", json!({ "topic": "AI" }));
        ctx.set_step_output("step1", json!({ "result": "hello" }));
        ctx.set_step_output("step2", json!("world"));
        ctx.set_step_output("review", json!({ "approved": true, "feedback": "looks good" }));
        ctx
    }

    #[test]
    fn render_inputs() {
        let ctx = RunContext::new("wf", "r1", json!({ "topic": "AI" }));
        assert_eq!(ctx.render_template("topic is {{inputs.topic}}"), "topic is AI");
    }

    #[test]
    fn render_step_output_object() {
        let ctx = ctx_with_outputs();
        assert_eq!(
            ctx.render_template("result: {{step1.result}}"),
            "result: hello"
        );
    }

    #[test]
    fn render_step_output_scalar() {
        let ctx = ctx_with_outputs();
        assert_eq!(ctx.render_template("{{step2.output}}"), "world");
    }

    #[test]
    fn render_missing_is_empty() {
        let ctx = ctx_with_outputs();
        assert_eq!(ctx.render_template("{{nonexistent.foo}}"), "");
    }

    #[test]
    fn render_full_step_output() {
        let ctx = ctx_with_outputs();
        let result = ctx.render_template("{{step1.output}}");
        assert!(result.contains("hello"));
    }

    #[test]
    fn evaluate_bool_true() {
        let ctx = ctx_with_outputs();
        assert!(evaluate_condition("review.approved == true", &ctx));
    }

    #[test]
    fn evaluate_bool_false() {
        let ctx = ctx_with_outputs();
        assert!(!evaluate_condition("review.approved == false", &ctx));
    }

    #[test]
    fn evaluate_string_eq() {
        let ctx = ctx_with_outputs();
        assert!(evaluate_condition("inputs.topic == \"AI\"", &ctx));
    }
}
