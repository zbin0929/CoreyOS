use crate::workflow::model::NotifyConfig;

pub async fn send_notify(
    config: &NotifyConfig,
    workflow_name: &str,
    status: &str,
    error: Option<&str>,
    duration_ms: u64,
) {
    let payload = build_payload(config, workflow_name, status, error, duration_ms);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    let Ok(client) = client else {
        tracing::warn!("notify: failed to build http client");
        return;
    };
    let result = client
        .post(&config.webhook_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;
    match result {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                tracing::warn!(%status, "notify webhook returned non-2xx");
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "notify webhook request failed");
        }
    }
}

fn build_payload(
    config: &NotifyConfig,
    workflow_name: &str,
    status: &str,
    error: Option<&str>,
    duration_ms: u64,
) -> serde_json::Value {
    let label = status_label(status);
    let default_body = format!("Workflow「{}」{}", workflow_name, label);
    let body = config.message.as_deref().unwrap_or(&default_body);
    let detail = error.map(|e| format!("\n错误：{e}")).unwrap_or_default();
    let duration_text = format_duration(duration_ms);
    let full_text = format!("{body}（耗时 {duration_text}）{detail}");

    match config.format.as_str() {
        "dingtalk" => serde_json::json!({
            "msgtype": "markdown",
            "markdown": {
                "title": format!("CoreyOS: {}", workflow_name),
                "text": full_text,
            }
        }),
        "feishu" => serde_json::json!({
            "msg_type": "interactive",
            "card": {
                "header": {
                    "title": { "tag": "plain_text", "content": format!("CoreyOS: {}", workflow_name) },
                    "template": if status == "Completed" { "green" } else { "red" },
                },
                "elements": [
                    { "tag": "markdown", "content": full_text }
                ]
            }
        }),
        "wecom" => serde_json::json!({
            "msgtype": "markdown",
            "markdown": { "content": full_text }
        }),
        _ => serde_json::json!({
            "workflow": workflow_name,
            "status": status,
            "error": error,
            "duration_ms": duration_ms,
            "message": full_text,
        }),
    }
}

fn status_label(status: &str) -> String {
    match status {
        "Completed" => "已完成 ✅".into(),
        "Failed" => "失败 ❌".into(),
        "Cancelled" => "已取消 ⏹️".into(),
        _ => status.into(),
    }
}

fn format_duration(ms: u64) -> String {
    let secs = ms / 1000;
    if secs < 60 {
        format!("{secs}秒")
    } else {
        let mins = secs / 60;
        let remain_secs = secs % 60;
        format!("{mins}分{remain_secs}秒")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config(format: &str) -> NotifyConfig {
        NotifyConfig {
            on_done: true,
            on_failure: true,
            webhook_url: "https://example.com/webhook".into(),
            format: format.into(),
            message: None,
        }
    }

    #[test]
    fn generic_payload_shape() {
        let p = build_payload(
            &sample_config("generic"),
            "test-wf",
            "Completed",
            None,
            5000,
        );
        assert_eq!(p["workflow"], "test-wf");
        assert_eq!(p["status"], "Completed");
        assert!(p["message"].as_str().expect("message should be string").contains("已完成"));
    }

    #[test]
    fn dingtalk_payload_has_msgtype() {
        let p = build_payload(
            &sample_config("dingtalk"),
            "test-wf",
            "Failed",
            Some("timeout"),
            3000,
        );
        assert_eq!(p["msgtype"], "markdown");
        assert!(p["markdown"]["text"].as_str().expect("markdown text should be string").contains("失败"));
    }

    #[test]
    fn feishu_payload_has_card() {
        let p = build_payload(
            &sample_config("feishu"),
            "test-wf",
            "Completed",
            None,
            90000,
        );
        assert_eq!(p["msg_type"], "interactive");
        let header = &p["card"]["header"];
        assert_eq!(header["template"], "green");
    }

    #[test]
    fn wecom_payload_has_markdown() {
        let p = build_payload(
            &sample_config("wecom"),
            "test-wf",
            "Completed",
            None,
            120000,
        );
        assert!(p["markdown"]["content"]
            .as_str()
            .expect("markdown content should be string")
            .contains("2分0秒"));
    }

    #[test]
    fn format_duration_cases() {
        assert_eq!(format_duration(500), "0秒");
        assert_eq!(format_duration(5000), "5秒");
        assert_eq!(format_duration(90000), "1分30秒");
    }
}
