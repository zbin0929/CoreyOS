use super::*;
use std::collections::HashSet;

#[test]
fn catalog_has_exactly_seventeen_channels_with_unique_ids() {
    assert_eq!(CHANNEL_SPECS.len(), 17);
    let mut ids = HashSet::new();
    for s in CHANNEL_SPECS.iter() {
        assert!(ids.insert(s.id), "duplicate channel id: {}", s.id);
    }
}

#[test]
fn every_channel_has_a_display_name_and_ids_are_lowercase() {
    for s in CHANNEL_SPECS.iter() {
        assert!(!s.display_name.is_empty(), "{} missing name", s.id);
        assert!(
            s.id.chars().all(|c| c.is_ascii_lowercase()),
            "id '{}' must be all-lowercase",
            s.id,
        );
    }
}

#[test]
fn qr_login_only_on_channels_that_support_it() {
    let qr_channels: Vec<&str> = CHANNEL_SPECS
        .iter()
        .filter(|s| s.has_qr_login)
        .map(|s| s.id)
        .collect();
    let expected = vec!["whatsapp", "weixin", "dingtalk", "qq"];
    assert_eq!(
        qr_channels, expected,
        "has_qr_login channels changed — update this test"
    );
}

#[test]
fn find_spec_lookup_works_and_unknown_returns_none() {
    assert_eq!(find_spec("telegram").unwrap().id, "telegram");
    assert_eq!(find_spec("feishu").unwrap().display_name, "Feishu (Lark)");
    assert_eq!(
        find_spec("weixin").unwrap().display_name,
        "WeiXin (Personal)",
    );
    assert!(
        find_spec("wechat").is_none(),
        "legacy `wechat` slug removed"
    );
    assert!(find_spec("twitter").is_none());
}

#[test]
fn t6_7a_schema_fixes_in_place() {
    // Lock in the three silently-broken env names we fixed. If a
    // future refactor accidentally reverts any of these, this test
    // fails loudly before users hit a silent miswrite.
    let whatsapp = find_spec("whatsapp").unwrap();
    let names: Vec<&str> = whatsapp.env_keys.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"WHATSAPP_ENABLED"));
    assert!(
        !names.contains(&"WHATSAPP_TOKEN"),
        "WHATSAPP_TOKEN is not read by Hermes"
    );

    let wecom = find_spec("wecom").unwrap();
    let names: Vec<&str> = wecom.env_keys.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"WECOM_SECRET"));
    assert!(
        !names.contains(&"WECOM_BOT_SECRET"),
        "WECOM_BOT_SECRET is an off-by-prefix typo"
    );

    let weixin = find_spec("weixin").unwrap();
    let names: Vec<&str> = weixin.env_keys.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"WEIXIN_ACCOUNT_ID"));
    assert!(names.contains(&"WEIXIN_TOKEN"));

    let slack = find_spec("slack").unwrap();
    let names: Vec<&str> = slack.env_keys.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"SLACK_BOT_TOKEN"));
    assert!(
        names.contains(&"SLACK_APP_TOKEN"),
        "Socket Mode needs both tokens"
    );
}

#[test]
fn every_required_env_key_name_is_screaming_snake_case() {
    for spec in CHANNEL_SPECS.iter() {
        for env in &spec.env_keys {
            assert!(
                env.name
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'),
                "env name '{}' should be SCREAMING_SNAKE_CASE",
                env.name
            );
            assert!(
                !env.name.starts_with('_') && !env.name.ends_with('_'),
                "env name '{}' shouldn't have leading/trailing underscore",
                env.name,
            );
        }
    }
}

#[test]
fn allowed_channel_env_keys_includes_every_declared_name() {
    let allowed: HashSet<String> = allowed_channel_env_keys().into_iter().collect();
    for spec in CHANNEL_SPECS.iter() {
        for env in &spec.env_keys {
            assert!(
                allowed.contains(&env.name),
                "{} missing from allowlist",
                env.name,
            );
        }
    }
    // Sanity: the allowlist doesn't accidentally include a random
    // non-channel name.
    assert!(!allowed.contains("OPENAI_API_KEY"));
}

#[test]
fn yaml_fields_never_use_empty_or_absolute_paths() {
    for spec in CHANNEL_SPECS.iter() {
        for field in &spec.yaml_fields {
            assert!(!field.path.is_empty(), "{}: empty yaml path", spec.id);
            assert!(
                !field.path.starts_with('.'),
                "{}: yaml path must be relative, got '{}'",
                spec.id,
                field.path,
            );
        }
    }
}

#[test]
fn yaml_root_matches_id_convention_except_for_rootless_channels() {
    for spec in CHANNEL_SPECS.iter() {
        if spec.yaml_root.is_empty() {
            // Post-T6.7a no channel should be rootless; the old
            // `wechat` exception is gone. Keeping the branch so a
            // future channel without yaml can opt in explicitly
            // without this test blocking.
            continue;
        }
        assert!(
            spec.yaml_root.starts_with("channels."),
            "{}: yaml_root '{}' should live under channels.*",
            spec.id,
            spec.yaml_root,
        );
        assert!(
            spec.yaml_root.ends_with(spec.id),
            "{}: yaml_root '{}' should end with the channel id",
            spec.id,
            spec.yaml_root,
        );
    }
}
