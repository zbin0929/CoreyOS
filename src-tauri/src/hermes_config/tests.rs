use super::*;

/// Helper — acquire the crate-wide `HOME` lock from `skills::HOME_LOCK`.
/// `cargo test` runs in parallel, and the two tests below rewrite
/// `$HOME` to a tempdir; without joining the same lock used by the
/// `attachments` / `changelog` / `memory` / `skills` suites, two of
/// them racing would silently observe each other's tempdir and flake.
fn _home_lock() -> std::sync::MutexGuard<'static, ()> {
    crate::skills::HOME_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[test]
fn extract_model_parses_standard_layout() {
    let yaml = r#"
model:
  default: deepseek-reasoner
  provider: deepseek
  base_url: https://api.deepseek.com/v1
unrelated: keep_me
"#;
    let root: Value = serde_yaml::from_str(yaml).unwrap();
    let m = extract_model(&root);
    assert_eq!(m.default.as_deref(), Some("deepseek-reasoner"));
    assert_eq!(m.provider.as_deref(), Some("deepseek"));
    assert_eq!(m.base_url.as_deref(), Some("https://api.deepseek.com/v1"));
}

#[test]
fn set_or_remove_clears_empty() {
    let k = || Value::String("k".into());
    let mut m = Mapping::new();
    m.insert(k(), Value::String("old".into()));
    set_or_remove(&mut m, "k", None);
    assert!(m.get(k()).is_none());

    set_or_remove(&mut m, "k", Some("new"));
    assert_eq!(m.get(k()).and_then(Value::as_str), Some("new"));

    set_or_remove(&mut m, "k", Some(""));
    assert!(m.get(k()).is_none());
}

#[test]
fn env_keys_only_returns_nonempty_api_keys() {
    let tmp = std::env::temp_dir().join(format!("caduceus-hermes-env-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let env_file = tmp.join(".env");
    std::fs::write(
        &env_file,
        r#"
# comment
DEEPSEEK_API_KEY=sk-abc
OPENAI_API_KEY=
ANTHROPIC_API_KEY="sk-xyz"
NOT_A_KEY=hello
"#,
    )
    .unwrap();

    let _lock = _home_lock();
    let orig = std::env::var_os("COREY_HERMES_DIR");
    std::env::set_var("COREY_HERMES_DIR", &tmp);

    let keys = read_env_key_names().unwrap();
    assert!(keys.contains(&"DEEPSEEK_API_KEY".to_string()));
    assert!(keys.contains(&"ANTHROPIC_API_KEY".to_string()));
    assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
    assert!(!keys.contains(&"NOT_A_KEY".to_string()));

    if let Some(v) = orig {
        std::env::set_var("COREY_HERMES_DIR", v);
    } else {
        std::env::remove_var("COREY_HERMES_DIR");
    }
}

#[test]
fn is_allowed_env_key_gates_non_api_keys() {
    assert!(is_allowed_env_key("OPENAI_API_KEY"));
    assert!(is_allowed_env_key("FOO_BAR_API_KEY"));
    assert!(!is_allowed_env_key("OPENAI_KEY"));
    assert!(!is_allowed_env_key("API_SERVER_ENABLED"));
    assert!(!is_allowed_env_key("openai_api_key")); // lowercase rejected
    assert!(!is_allowed_env_key(""));
    assert!(!is_allowed_env_key("EVIL $() _API_KEY"));
}

#[test]
fn walk_set_creates_missing_intermediate_mappings() {
    let mut doc = Value::Mapping(Mapping::new());
    walk_set(
        &mut doc,
        "channels.telegram.mention_required",
        Value::Bool(true),
    );
    walk_set(&mut doc, "channels.telegram.reactions", Value::Bool(false));

    let telegram = doc
        .as_mapping()
        .unwrap()
        .get(Value::String("channels".into()))
        .unwrap()
        .as_mapping()
        .unwrap()
        .get(Value::String("telegram".into()))
        .unwrap()
        .as_mapping()
        .unwrap();
    assert_eq!(
        telegram.get(Value::String("mention_required".into())),
        Some(&Value::Bool(true)),
    );
    assert_eq!(
        telegram.get(Value::String("reactions".into())),
        Some(&Value::Bool(false)),
    );
}

#[test]
fn walk_remove_clears_leaf_without_touching_siblings() {
    let mut doc: Value = serde_yaml::from_str(
        "channels:\n  telegram:\n    mention_required: true\n    reactions: false\n",
    )
    .unwrap();
    walk_remove(&mut doc, "channels.telegram.reactions");
    let telegram = doc
        .as_mapping()
        .unwrap()
        .get(Value::String("channels".into()))
        .unwrap()
        .as_mapping()
        .unwrap()
        .get(Value::String("telegram".into()))
        .unwrap()
        .as_mapping()
        .unwrap();
    assert!(telegram.get(Value::String("reactions".into())).is_none());
    assert_eq!(
        telegram.get(Value::String("mention_required".into())),
        Some(&Value::Bool(true)),
    );
}

#[test]
fn json_to_yaml_preserves_scalars_lists_and_nested_objects() {
    let j = serde_json::json!({
        "a": true,
        "b": 42,
        "c": "hi",
        "d": [1, "two", false],
        "e": { "nested": "ok" }
    });
    let y = json_to_yaml_value(&j);
    let m = y.as_mapping().unwrap();
    assert_eq!(m.get(Value::String("a".into())), Some(&Value::Bool(true)));
    assert_eq!(
        m.get(Value::String("c".into())).and_then(Value::as_str),
        Some("hi"),
    );
    let d = m
        .get(Value::String("d".into()))
        .unwrap()
        .as_sequence()
        .unwrap();
    assert_eq!(d.len(), 3);
}

#[test]
fn write_channel_yaml_fields_round_trips_through_disk() {
    let tmp = std::env::temp_dir().join(format!(
        "caduceus-hermes-yaml-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    ));
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(tmp.join("config.yaml"), "model:\n  default: gpt-4o\n").unwrap();

    let _lock = _home_lock();
    let orig = std::env::var_os("COREY_HERMES_DIR");
    std::env::set_var("COREY_HERMES_DIR", &tmp);

    let mut updates = std::collections::HashMap::new();
    updates.insert("mention_required".to_string(), serde_json::json!(true));
    updates.insert("free_chats".to_string(), serde_json::json!(["one", "two"]));
    write_channel_yaml_fields("channels.telegram", &updates, None).unwrap();

    let raw = std::fs::read_to_string(tmp.join("config.yaml")).unwrap();
    let parsed: Value = serde_yaml::from_str(&raw).unwrap();
    let tg = parsed
        .as_mapping()
        .unwrap()
        .get(Value::String("channels".into()))
        .unwrap()
        .as_mapping()
        .unwrap()
        .get(Value::String("telegram".into()))
        .unwrap()
        .as_mapping()
        .unwrap();
    assert_eq!(
        tg.get(Value::String("mention_required".into())),
        Some(&Value::Bool(true)),
    );
    let fc = tg.get(Value::String("free_chats".into())).unwrap();
    assert_eq!(fc.as_sequence().unwrap().len(), 2);
    assert!(parsed
        .as_mapping()
        .unwrap()
        .get(Value::String("model".into()))
        .is_some());

    let mut del = std::collections::HashMap::new();
    del.insert("mention_required".to_string(), serde_json::Value::Null);
    write_channel_yaml_fields("channels.telegram", &del, None).unwrap();
    let raw2 = std::fs::read_to_string(tmp.join("config.yaml")).unwrap();
    let parsed2: Value = serde_yaml::from_str(&raw2).unwrap();
    let tg2 = parsed2
        .as_mapping()
        .unwrap()
        .get(Value::String("channels".into()))
        .unwrap()
        .as_mapping()
        .unwrap()
        .get(Value::String("telegram".into()))
        .unwrap()
        .as_mapping()
        .unwrap();
    assert!(tg2.get(Value::String("mention_required".into())).is_none());

    if let Some(v) = orig {
        std::env::set_var("COREY_HERMES_DIR", v);
    } else {
        std::env::remove_var("COREY_HERMES_DIR");
    }
}

#[test]
fn line_matches_key_handles_whitespace_and_comments() {
    assert!(line_matches_key("OPENAI_API_KEY=sk-x", "OPENAI_API_KEY"));
    assert!(line_matches_key("  OPENAI_API_KEY=sk-x", "OPENAI_API_KEY"));
    assert!(line_matches_key("OPENAI_API_KEY =sk-x", "OPENAI_API_KEY"));
    assert!(!line_matches_key("# OPENAI_API_KEY=sk-x", "OPENAI_API_KEY"));
    assert!(!line_matches_key(
        "OPENAI_API_KEY_V2=sk-x",
        "OPENAI_API_KEY"
    ));
    assert!(!line_matches_key("other line", "OPENAI_API_KEY"));
}
