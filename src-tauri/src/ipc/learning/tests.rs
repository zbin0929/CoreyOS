use super::*;

#[test]
fn jaccard_identical_strings() {
    let a = tokenize("user prefers TypeScript over JavaScript");
    let b = tokenize("user prefers TypeScript over JavaScript");
    assert!(jaccard(&a, &b) > 0.99);
}

#[test]
fn jaccard_completely_different() {
    let a = tokenize("user prefers TypeScript over JavaScript");
    let b = tokenize("the weather is sunny today");
    assert!(jaccard(&a, &b) < 0.1);
}

#[test]
fn jaccard_partial_overlap() {
    let a = tokenize("user prefers TypeScript");
    let b = tokenize("user prefers Rust language");
    let sim = jaccard(&a, &b);
    assert!(sim > 0.1 && sim < 0.8);
}

#[test]
fn truncate_preserves_char_boundary() {
    let s = "你好世界这是一段中文文本";
    let truncated = truncate_str(s, 10);
    assert!(truncated.ends_with('…'));
}

#[test]
fn format_auto_section_structure() {
    let facts = vec!["prefers dark mode".into(), "uses VS Code".into()];
    let section = format_auto_section(&facts);
    assert!(section.contains("## [auto]"));
    assert!(section.contains("- prefers dark mode"));
    assert!(section.contains("- uses VS Code"));
}

// ─── CJK bigram tokenisation (D — memory dedup fix) ───

#[test]
fn cjk_bigram_dedup_catches_paraphrase() {
    // The two strings in the user's MEMORY.md that the original
    // whitespace tokeniser failed to dedup. Bigrams should bring
    // their similarity above the 0.45 threshold.
    let a = tokenize("桌面通知已成功发送 ✅");
    let b = tokenize("桌面通知已发送 ✅");
    let sim = jaccard(&a, &b);
    assert!(
        sim >= SIMILARITY_THRESHOLD,
        "expected sim ≥ {SIMILARITY_THRESHOLD}, got {sim}",
    );
}

#[test]
fn cjk_bigram_distinguishes_unrelated() {
    let a = tokenize("用户喜欢深色模式");
    let b = tokenize("今天天气真好啊");
    let sim = jaccard(&a, &b);
    assert!(sim < 0.2, "unrelated cjk should have low sim, got {sim}");
}

#[test]
fn ascii_tokenisation_unchanged() {
    // The legacy ASCII path still works — same expectations as
    // jaccard_partial_overlap above but written explicitly to
    // catch regressions on the language we already supported.
    let a = tokenize("user prefers typescript over javascript");
    let b = tokenize("user prefers typescript");
    let sim = jaccard(&a, &b);
    assert!(sim > 0.4, "ascii partial overlap sim={sim}");
}

#[test]
fn mixed_cjk_ascii_tokenisation() {
    // A single string with both scripts produces tokens from both
    // branches — useful for facts like "用户使用 VSCode 编辑器".
    let tokens = tokenize("用户使用 VSCode 编辑器");
    assert!(tokens.contains(&"vscode".to_string()));
    // Bigrams of the leading/trailing CJK runs.
    assert!(tokens.contains(&"用户".to_string()));
    assert!(tokens.contains(&"编辑".to_string()));
}

#[test]
fn is_cjk_classifies_known_ranges() {
    assert!(is_cjk('的'));
    assert!(is_cjk('한'));
    assert!(is_cjk('あ'));
    assert!(!is_cjk('a'));
    assert!(!is_cjk('1'));
    assert!(!is_cjk('!'));
}
