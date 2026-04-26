//! Conversational workflow synthesis.
//!
//! Lets a non-engineer describe a workflow in plain language ("每天
//! 早上 9 点抓 V2EX 热帖前 10，让 GPT 总结，发到 Telegram") and
//! get back a concrete `WorkflowDef` that drops straight into the
//! editor. Implemented by passing the user's prompt + the schema's
//! shape to the default Hermes adapter and parsing the YAML reply.
//!
//! Failure handling: structured. If the LLM returns malformed YAML
//! or a doc that fails our validators, we surface the parse / first
//! validation error so the front-end can show "I couldn't quite get
//! that — try rephrasing" rather than a stack trace.
//!
//! Why not stream? The output is small (one workflow, typically
//! <2 KB of YAML) and the editor needs the full document to render
//! the DAG. Streaming would just add UI complexity without any
//! latency win on a sub-second response.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::adapters::{ChatMessageDto, ChatTurn};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::workflow::model::WorkflowDef;
use crate::workflow::store;

#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowGenerateArgs {
    /// Natural-language description of the workflow.
    pub prompt: String,
    /// `'zh'` or `'en'` — controls reply language for the
    /// generated `name` / `description` fields. Steps stay in the
    /// schema's English keys regardless.
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowGenerateResult {
    /// The parsed + validated workflow. Caller drops it straight
    /// into the editor; pressing Save writes it to disk.
    pub workflow: WorkflowDef,
    /// Echo of the raw LLM YAML so power users can copy-paste it
    /// somewhere else if they want.
    pub raw_yaml: String,
}

/// IPC entry point. The single round-trip lives entirely on the
/// Rust side so a frontend timeout doesn't leak a half-spent LLM
/// call.
#[tauri::command]
pub async fn workflow_generate(
    state: State<'_, AppState>,
    args: WorkflowGenerateArgs,
) -> IpcResult<WorkflowGenerateResult> {
    let prompt = args.prompt.trim();
    if prompt.is_empty() {
        return Err(IpcError::Internal {
            message: "prompt is empty".into(),
        });
    }

    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;

    let locale = args.locale.as_deref().unwrap_or("en");
    let system_prompt = build_system_prompt(locale);

    let turn = ChatTurn {
        messages: vec![
            ChatMessageDto {
                role: "system".into(),
                content: system_prompt,
                attachments: vec![],
            },
            ChatMessageDto {
                role: "user".into(),
                content: prompt.to_string(),
                attachments: vec![],
            },
        ],
        model: None,
        cwd: None,
        model_supports_vision: None,
    };

    let reply = adapter
        .chat_once(turn)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("LLM call failed: {e}"),
        })?;

    let yaml_str = extract_yaml(&reply);

    // Parse into the strongly-typed model. Any required field
    // missing or shape mismatch surfaces as a `serde_yaml` error
    // we forward so the user sees what the LLM tripped on.
    let mut def: WorkflowDef = serde_yaml::from_str(&yaml_str).map_err(|e| IpcError::Internal {
        message: format!(
            "AI returned invalid YAML: {e}. Try rephrasing or simplifying the request.",
        ),
    })?;

    // Stamp a fresh id if the LLM forgot — `validate` rejects
    // empty ids, but we'd rather auto-fill a stable slug than make
    // the user re-prompt for the missing line.
    if def.id.trim().is_empty() {
        def.id = slugify(&def.name);
    }
    if def.version == 0 {
        def.version = 1;
    }

    let errors = store::validate(&def);
    if !errors.is_empty() {
        let first = &errors[0];
        return Err(IpcError::Internal {
            message: format!(
                "AI returned a workflow that fails validation ({}: {}). Try simplifying the request.",
                first.field, first.message,
            ),
        });
    }

    Ok(WorkflowGenerateResult {
        workflow: def,
        raw_yaml: yaml_str,
    })
}

/// Build the system prompt. Inlines a compact schema description +
/// a single complete example so smaller models can pattern-match
/// instead of having to derive the structure from prose.
fn build_system_prompt(locale: &str) -> String {
    let language_hint = match locale {
        "zh" | "zh-CN" | "zh-cn" => {
            "Reply in Chinese for the `name` and `description` fields when the user wrote in Chinese."
        }
        _ => "Reply in the user's language for the `name` and `description` fields.",
    };
    format!(
        r#"You are a CoreyOS workflow author. Convert the user's natural-language
description into a complete, valid workflow YAML document.

OUTPUT RULES (strict):
- Output ONLY a YAML document. No prose, no commentary, no fenced code block.
  The first character of your reply must be `id:` (or `---` then `id:`).
- The YAML must round-trip through serde_yaml::from_str into the schema below.
- Use lowercase-with-dashes for `id`. {language_hint}

SCHEMA:
  id: string (required, slug)
  name: string (required, human title)
  description: string (one-line summary)
  version: integer (default 1)
  trigger:
    type: "manual" | "cron"
    expression: string  # only when type=cron, e.g. "0 9 * * *"
  inputs: list of
    - name: string
      label: string
      type: "string" | "number" | "select"
      default: string (optional)
      required: bool (default false)
      options: list of strings (only for type=select)
  steps: list of
    - id: string (unique within the workflow)
      name: string (display label)
      type: "agent" | "tool" | "parallel" | "loop" | "condition" | "approval" | "browser"
      after: list of step ids this step waits on (default [])
      # type=agent
      agent_id: "hermes-default"   # always use this id; the user has it.
      prompt: |- multi-line string. Reference `{{{{inputs.NAME}}}}` and `{{{{STEP_ID.output}}}}`.
      output_format: "text" | "json" | "markdown" (optional)
      # type=tool
      tool_name: "telegram_send" | "discord_send" | "slack_send" | "http_request" | "shell"
      tool_args: object  (depends on tool)
      # type=approval
      approval_message: string
      timeout_minutes: integer
      # type=loop
      body: nested list of steps
      max_iterations: integer (default 5)
      exit_condition: string (Jinja2-style boolean expression)

EXAMPLE (for "每天 9 点搜 AI 新闻，总结，发到 Telegram"):

id: ai-news-daily
name: 每日 AI 新闻摘要
description: 定时抓取 AI 行业新闻并推送摘要到 Telegram
version: 1

trigger:
  type: cron
  expression: "0 9 * * *"

inputs:
  - name: topic
    label: 新闻主题
    type: string
    default: "AI 大模型"
    required: true

steps:
  - id: search
    name: 搜索新闻
    type: agent
    agent_id: hermes-default
    prompt: |
      搜索今天关于「{{{{inputs.topic}}}}」的最新中英文新闻，挑出最重要的 5 条，
      返回 JSON 数组，每条包含 title / source / url / summary。
    output_format: json

  - id: summarize
    name: 生成摘要
    type: agent
    after: [search]
    agent_id: hermes-default
    prompt: |
      根据以下新闻数据生成一份 200 字以内的中文摘要，逐条列出标题与一句话点评：
      {{{{search.output}}}}
    output_format: markdown

  - id: send
    name: 发到 Telegram
    type: tool
    after: [summarize]
    tool_name: telegram_send
    tool_args:
      chat_id: "{{{{inputs.chat_id}}}}"
      text: "{{{{summarize.output}}}}"

Now produce the YAML for the user's request."#,
    )
}

/// Strip a Markdown fenced code block if the model couldn't help
/// itself. Accepts ` ```yaml `, ` ```yml `, ` ``` ` (no language)
/// and bare YAML alike. Returns owned string for downstream parse.
fn extract_yaml(reply: &str) -> String {
    let trimmed = reply.trim();
    // Look for the first fence. If there is one, strip everything
    // before + including the opening fence and stop at the matching
    // closing fence. Otherwise return the body verbatim.
    if let Some(fence_start) = trimmed.find("```") {
        let after_open = &trimmed[fence_start + 3..];
        // Skip the optional language tag on the same line as the
        // opening fence.
        let body_start = after_open.find('\n').map(|n| n + 1).unwrap_or(0);
        let body = &after_open[body_start..];
        if let Some(fence_end) = body.find("```") {
            return body[..fence_end].trim().to_string();
        }
        return body.trim().to_string();
    }
    trimmed.to_string()
}

/// Best-effort id slug for a name like "每日 AI 新闻摘要". Keeps
/// ASCII alphanumerics + dashes; collapses runs and lowercases.
/// Falls back to a timestamp when the name is entirely non-ASCII so
/// the saved workflow always has a non-empty stable id.
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    let cleaned = out.trim_matches('-').to_string();
    if cleaned.is_empty() {
        return format!(
            "wf-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
        );
    }
    cleaned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_yaml_handles_fenced_blocks() {
        // Backtick-fenced with `yaml` language tag.
        let s = "```yaml\nid: foo\nname: bar\n```";
        assert_eq!(extract_yaml(s), "id: foo\nname: bar");
        // Plain fence with no language.
        let s2 = "```\nid: x\n```";
        assert_eq!(extract_yaml(s2), "id: x");
        // Bare YAML, no fences — pass through.
        let s3 = "id: y\nname: z";
        assert_eq!(extract_yaml(s3), "id: y\nname: z");
        // Prose preamble + fenced block — common when models drift.
        let s4 = "Here's your workflow:\n\n```yaml\nid: ok\n```\n";
        assert_eq!(extract_yaml(s4), "id: ok");
    }

    #[test]
    fn slugify_handles_chinese_names_with_ascii_fragments() {
        assert_eq!(slugify("每日 AI 新闻摘要"), "ai");
        assert_eq!(slugify("Daily News Digest"), "daily-news-digest");
        assert_eq!(slugify("v2ex--hot--posts"), "v2ex-hot-posts");
        // No ASCII at all → timestamp-prefixed fallback. Just
        // assert the shape since the timestamp varies.
        let pure_cn = slugify("纯中文");
        assert!(pure_cn.starts_with("wf-"));
    }
}
