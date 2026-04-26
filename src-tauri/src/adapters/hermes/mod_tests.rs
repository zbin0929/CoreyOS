use super::*;

/// Messages without attachments keep the classic string `content` —
/// this matters for provider parity because some gateways reject the
/// array form when there are no image parts.
#[test]
fn build_content_no_attachments_stays_text() {
    let c = build_content("hello".to_string(), vec![], true);
    match c {
        ChatMessageContent::Text(s) => assert_eq!(s, "hello"),
        _ => panic!("expected Text variant for attachment-free message"),
    }
    // …and serialises as a bare JSON string, not an array.
    let j = serde_json::to_value(ChatMessageContent::Text("x".into())).unwrap();
    assert_eq!(j, serde_json::json!("x"));
}

/// An image attachment becomes a `{type:"image_url", image_url:{url:"data:…"}}`
/// part; the text part comes first so instructions lead.
#[test]
fn build_content_image_becomes_data_url_part() {
    use std::io::Write;

    let dir = std::env::temp_dir().join(format!("caduceus-t15b-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("pixel.png");
    // 1x1 transparent PNG — content isn't parsed, just encoded.
    let bytes: &[u8] = b"\x89PNG\r\n\x1a\n-fake-body";
    std::fs::File::create(&path)
        .unwrap()
        .write_all(bytes)
        .unwrap();

    let c = build_content(
        "describe this".into(),
        vec![ChatAttachmentRef {
            path: path.to_string_lossy().into_owned(),
            mime: "image/png".into(),
            name: "pixel.png".into(),
        }],
        true,
    );
    let parts = match c {
        ChatMessageContent::Parts(p) => p,
        _ => panic!("expected Parts variant for message with image"),
    };
    assert_eq!(parts.len(), 2, "text + image_url");
    match &parts[0] {
        ChatContentPart::Text { text } => assert_eq!(text, "describe this"),
        _ => panic!("part 0 must be text"),
    }
    match &parts[1] {
        ChatContentPart::ImageUrl { image_url } => {
            assert!(
                image_url.url.starts_with("data:image/png;base64,"),
                "got url: {}",
                image_url.url
            );
            // base64-decodes back to our bytes.
            let comma = image_url.url.find(',').unwrap();
            let decoded = BASE64.decode(&image_url.url[comma + 1..]).unwrap();
            assert_eq!(decoded, bytes);
        }
        _ => panic!("part 1 must be image_url"),
    }

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir(&dir);
}

/// Non-image attachments degrade to a `[attached: name]` marker
/// appended to the text part — no image_url part is emitted.
#[test]
fn build_content_non_image_falls_back_to_marker() {
    let c = build_content(
        "here's the spec".into(),
        vec![ChatAttachmentRef {
            path: "/nonexistent/doc.pdf".into(),
            mime: "application/pdf".into(),
            name: "doc.pdf".into(),
        }],
        true,
    );
    let parts = match c {
        ChatMessageContent::Parts(p) => p,
        _ => panic!("expected Parts variant"),
    };
    assert_eq!(parts.len(), 1, "no image_url part for non-image");
    match &parts[0] {
        ChatContentPart::Text { text } => {
            assert!(text.contains("here's the spec"));
            assert!(text.contains("[attached: doc.pdf]"));
        }
        _ => panic!("part 0 must be text"),
    }
}

/// A missing image file logs a warning and degrades the same way as
/// a non-image — the user's text must still reach the model.
#[test]
fn build_content_missing_image_degrades_to_marker() {
    let c = build_content(
        "look".into(),
        vec![ChatAttachmentRef {
            path: "/definitely/not/there/ghost.png".into(),
            mime: "image/png".into(),
            name: "ghost.png".into(),
        }],
        true,
    );
    let parts = match c {
        ChatMessageContent::Parts(p) => p,
        _ => panic!("expected Parts"),
    };
    assert_eq!(parts.len(), 1);
    match &parts[0] {
        ChatContentPart::Text { text } => {
            assert!(text.contains("look"));
            assert!(text.contains("[attached: ghost.png]"));
        }
        _ => panic!("expected text part"),
    }
}

/// Mixed attachments: one image reads OK, one PDF degrades to a
/// marker. Order is preserved (text-marker first since PDF comes
/// first in the input, image_url follows).
#[test]
fn build_content_mixed_keeps_text_first_then_images() {
    use std::io::Write;

    let dir = std::env::temp_dir().join(format!("caduceus-t15b-mix-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let img = dir.join("a.png");
    std::fs::File::create(&img)
        .unwrap()
        .write_all(b"IMG")
        .unwrap();

    let c = build_content(
        "mixed".into(),
        vec![
            ChatAttachmentRef {
                path: "/missing/thing.pdf".into(),
                mime: "application/pdf".into(),
                name: "thing.pdf".into(),
            },
            ChatAttachmentRef {
                path: img.to_string_lossy().into_owned(),
                mime: "image/png".into(),
                name: "a.png".into(),
            },
        ],
        true,
    );
    let parts = match c {
        ChatMessageContent::Parts(p) => p,
        _ => panic!("expected Parts"),
    };
    assert_eq!(parts.len(), 2, "text part + single image_url");
    match &parts[0] {
        ChatContentPart::Text { text } => {
            assert!(text.contains("mixed"));
            assert!(text.contains("[attached: thing.pdf]"));
            assert!(!text.contains("a.png"), "image must not bleed into marker");
        }
        _ => panic!("first part must be text"),
    }
    assert!(matches!(parts[1], ChatContentPart::ImageUrl { .. }));

    let _ = std::fs::remove_file(&img);
    let _ = std::fs::remove_dir(&dir);
}

// ───────────────────────── T5.1 tests ─────────────────────────

/// Stub health carries the new `uptime_ms` + `last_error` fields. Uptime is
/// "very small positive" (we just constructed it), last_error is `None`.
#[tokio::test]
async fn t51_stub_health_exposes_uptime_and_clean_last_error() {
    let a = HermesAdapter::new_stub();
    let h = a.health().await.unwrap();
    assert!(h.ok);
    assert_eq!(h.adapter_id, "hermes");
    assert!(h.uptime_ms.is_some(), "stub must report uptime");
    assert!(h.last_error.is_none(), "fresh stub has no errors");
}

/// `list_sessions` honours the new `search` field. We don't know the
/// exact contents of the fixture, but an obviously-absent needle must
/// filter down to zero, and an empty/None query must match the full set.
#[tokio::test]
async fn t51_list_sessions_search_filters_by_title() {
    let a = HermesAdapter::new_stub();
    let full = a.list_sessions(SessionQuery::default()).await.unwrap();
    assert!(!full.is_empty(), "fixture must seed at least one session");

    let none = a
        .list_sessions(SessionQuery {
            search: Some("definitely-not-a-title-xyz-zzz".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(none.is_empty(), "impossible needle must match nothing");

    // First session's first word should always match itself (modulo case).
    let pivot_title = full[0].title.clone();
    let needle = pivot_title
        .split_whitespace()
        .next()
        .unwrap_or(&pivot_title)
        .to_string();
    let some = a
        .list_sessions(SessionQuery {
            search: Some(needle.to_uppercase()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(
        !some.is_empty(),
        "case-insensitive match on a word from an existing title must hit"
    );
}

/// `limit` caps the result set without interacting with `search`.
#[tokio::test]
async fn t51_list_sessions_limit_caps_result_set() {
    let a = HermesAdapter::new_stub();
    let capped = a
        .list_sessions(SessionQuery {
            limit: Some(1),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(capped.len(), 1, "limit=1 must yield one row");
}

/// `ChatTurn.cwd` survives a serde round-trip and defaults to `None`
/// when absent from the wire (back-compat with pre-T5.1 callers).
#[test]
fn t51_chat_turn_cwd_is_optional_on_the_wire() {
    let legacy = r#"{"messages":[],"model":null}"#;
    let turn: ChatTurn = serde_json::from_str(legacy).unwrap();
    assert!(turn.cwd.is_none());

    let with_cwd = r#"{"messages":[],"model":null,"cwd":"/tmp/repo"}"#;
    let turn: ChatTurn = serde_json::from_str(with_cwd).unwrap();
    assert_eq!(turn.cwd.as_deref(), Some("/tmp/repo"));
}
