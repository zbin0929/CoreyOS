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
