use std::sync::Arc;

use serde_json::Value as JsonValue;
use serde_yaml::Value as YamlValue;

use crate::error::{IpcError, IpcResult};
use crate::sandbox::PathAuthority;

pub fn yaml_to_json(v: &YamlValue) -> JsonValue {
    match v {
        YamlValue::Null => JsonValue::Null,
        YamlValue::Bool(b) => JsonValue::Bool(*b),
        YamlValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                JsonValue::Number(serde_json::Number::from(i))
            } else if let Some(u) = n.as_u64() {
                JsonValue::Number(serde_json::Number::from(u))
            } else if let Some(f) = n.as_f64() {
                serde_json::Number::from_f64(f)
                    .map(JsonValue::Number)
                    .unwrap_or(JsonValue::Null)
            } else {
                JsonValue::Null
            }
        }
        YamlValue::String(s) => JsonValue::String(s.clone()),
        YamlValue::Sequence(s) => JsonValue::Array(s.iter().map(yaml_to_json).collect()),
        YamlValue::Mapping(m) => {
            let mut out = serde_json::Map::new();
            for (k, v) in m {
                let key = match k {
                    YamlValue::String(s) => s.clone(),
                    other => serde_yaml::to_string(other)
                        .ok()
                        .map(|s| s.trim().to_string())
                        .unwrap_or_default(),
                };
                out.insert(key, yaml_to_json(v));
            }
            JsonValue::Object(out)
        }
        YamlValue::Tagged(tagged) => yaml_to_json(&tagged.value),
    }
}

pub fn resolve_config_templates(
    ds: &YamlValue,
    pack_id: &str,
    hermes_dir: &std::path::Path,
) -> YamlValue {
    let mut yaml_str = match serde_yaml::to_string(ds) {
        Ok(s) => s,
        Err(_) => return ds.clone(),
    };
    if !yaml_str.contains("${config.") {
        return ds.clone();
    }
    let config_path = hermes_dir
        .join("pack-data")
        .join(pack_id)
        .join("config.json");
    let config: JsonValue = config_path
        .exists()
        .then(|| {
            std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        })
        .flatten()
        .unwrap_or(JsonValue::Object(serde_json::Map::new()));
    if let Some(obj) = config.as_object() {
        for (k, v) in obj {
            let placeholder = format!("${{config.{k}}}");
            let replacement = v
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| v.to_string());
            yaml_str = yaml_str.replace(&placeholder, &replacement);
        }
    }
    serde_yaml::from_str(&yaml_str).unwrap_or_else(|_| ds.clone())
}

pub async fn resolve_data_source_async(
    ds: &YamlValue,
    authority: &Arc<PathAuthority>,
    runtime_params: &JsonValue,
) -> IpcResult<JsonValue> {
    let json = yaml_to_json(ds);
    let Some(obj) = json.as_object() else {
        return Ok(JsonValue::Object(serde_json::Map::new()));
    };
    if let Some(static_value) = obj.get("static") {
        return Ok(static_value.clone());
    }
    if let Some(http_cfg) = obj.get("http") {
        return resolve_http_source(http_cfg).await;
    }
    if let Some(mcp_cfg) = obj.get("mcp") {
        return super::mcp_transport::resolve_mcp_source(mcp_cfg, authority, runtime_params).await;
    }
    Ok(JsonValue::Object(serde_json::Map::new()))
}

pub async fn resolve_http_source(cfg: &JsonValue) -> IpcResult<JsonValue> {
    let url = cfg
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or(IpcError::Internal {
            message: "http data_source missing 'url'".into(),
        })?;
    let method = cfg
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();
    let timeout_secs = cfg
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(15);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| IpcError::Internal {
            message: format!("http client build: {e}"),
        })?;
    let mut req = match method.as_str() {
        "POST" => client.post(url),
        _ => client.get(url),
    };
    if let Some(headers) = cfg.get("headers").and_then(|v| v.as_object()) {
        for (k, v) in headers {
            if let Some(val) = v.as_str() {
                req = req.header(k, val);
            }
        }
    }
    if let Some(body) = cfg.get("body") {
        req = req.json(body);
    }
    let resp = req.send().await.map_err(|e| IpcError::Internal {
        message: format!("http fetch failed: {e}"),
    })?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(IpcError::Internal {
            message: format!("http {status}: {body}"),
        });
    }
    resp.json::<JsonValue>()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("http json parse: {e}"),
        })
}

pub fn rpc_id_now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn extract_mcp_text_content(result: &JsonValue) -> IpcResult<JsonValue> {
    let content = result
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str());
    if let Some(text) = content {
        Ok(serde_json::from_str(text).unwrap_or_else(|_| JsonValue::String(text.to_string())))
    } else {
        Ok(result.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn resolve_data_source_async_returns_static_data() {
        let ds: YamlValue =
            serde_yaml::from_str("static: { metrics: { revenue: 123 } }").expect("yaml");
        let authority = Arc::new(crate::sandbox::PathAuthority::new());
        let empty = JsonValue::Object(serde_json::Map::new());
        let rt = tokio::runtime::Runtime::new().expect("rt");
        let result = rt
            .block_on(resolve_data_source_async(&ds, &authority, &empty))
            .expect("resolve");
        assert_eq!(result["metrics"]["revenue"], 123);
    }

    #[test]
    fn resolve_data_source_async_returns_empty_for_unknown_kind() {
        let ds: YamlValue = serde_yaml::from_str("sql: { query: \"SELECT 1\" }").expect("yaml");
        let authority = Arc::new(crate::sandbox::PathAuthority::new());
        let empty = JsonValue::Object(serde_json::Map::new());
        let rt = tokio::runtime::Runtime::new().expect("rt");
        let result = rt
            .block_on(resolve_data_source_async(&ds, &authority, &empty))
            .expect("resolve");
        assert!(result.as_object().map(|o| o.is_empty()).unwrap_or(true));
    }

    #[test]
    fn resolve_http_source_rejects_missing_url() {
        let cfg = JsonValue::Object(serde_json::Map::new());
        let rt = tokio::runtime::Runtime::new().expect("rt");
        let result = rt.block_on(resolve_http_source(&cfg));
        assert!(result.is_err());
    }

    #[test]
    fn extract_mcp_text_content_parses_json_string() {
        let resp = JsonValue::Object(serde_json::Map::from_iter([(
            "result".to_string(),
            JsonValue::Object(serde_json::Map::from_iter([(
                "content".to_string(),
                JsonValue::Array(vec![JsonValue::Object(serde_json::Map::from_iter([
                    ("type".to_string(), JsonValue::String("text".to_string())),
                    (
                        "text".to_string(),
                        JsonValue::String("{\"revenue\": 999}".to_string()),
                    ),
                ]))]),
            )])),
        )]));
        let out = extract_mcp_text_content(&resp).expect("extract");
        assert_eq!(out["revenue"], 999);
    }

    #[test]
    fn extract_mcp_text_content_returns_raw_when_not_json() {
        let resp = JsonValue::Object(serde_json::Map::from_iter([(
            "result".to_string(),
            JsonValue::Object(serde_json::Map::from_iter([(
                "content".to_string(),
                JsonValue::Array(vec![JsonValue::Object(serde_json::Map::from_iter([
                    ("type".to_string(), JsonValue::String("text".to_string())),
                    (
                        "text".to_string(),
                        JsonValue::String("plain string".to_string()),
                    ),
                ]))]),
            )])),
        )]));
        let out = extract_mcp_text_content(&resp).expect("extract");
        assert_eq!(out.as_str().expect("str"), "plain string");
    }

    #[test]
    fn extract_mcp_text_content_fallback_for_missing_content() {
        let resp = JsonValue::Object(serde_json::Map::from_iter([(
            "id".to_string(),
            JsonValue::Number(serde_json::Number::from(1)),
        )]));
        let out = extract_mcp_text_content(&resp).expect("extract");
        assert_eq!(out["id"], 1);
    }

    #[test]
    fn rpc_id_now_returns_nonzero() {
        assert!(rpc_id_now() > 0);
    }

    #[test]
    fn resolve_config_templates_substitutes_placeholders() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pack_data = tmp.path().join("pack-data").join("test_pack");
        std::fs::create_dir_all(&pack_data).expect("mkdir");
        std::fs::write(
            pack_data.join("config.json"),
            r#"{"marketplace":"JP","threshold":"25"}"#,
        )
        .expect("write");
        let ds: YamlValue = serde_yaml::from_str(
            "mcp: { server: srv, tool: t, params: { marketplace: \"${config.marketplace}\" } }",
        )
        .expect("yaml");
        let result = resolve_config_templates(&ds, "test_pack", tmp.path());
        let json = yaml_to_json(&result);
        let mp = json
            .get("mcp")
            .and_then(|m| m.get("params"))
            .and_then(|p| p.get("marketplace"))
            .and_then(|v| v.as_str());
        assert_eq!(mp, Some("JP"));
    }

    #[test]
    fn resolve_config_templates_noop_without_placeholders() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ds: YamlValue = serde_yaml::from_str("static: { revenue: 100 }").expect("yaml");
        let result = resolve_config_templates(&ds, "any", tmp.path());
        let json = yaml_to_json(&result);
        assert_eq!(json["static"]["revenue"], 100);
    }
}
