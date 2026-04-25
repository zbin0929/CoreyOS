//! Phase E · P2 — TF-IDF vector search over historical messages.
//!
//! Zero-dependency semantic retrieval: instead of pulling in an ONNX
//! runtime + embedding model (~80 MB), we compute TF-IDF vectors
//! purely from token frequency statistics. Good enough for "find
//! messages similar to this one" at desktop scale (<100k messages).
//!
//! Pipeline:
//!   1. On `upsert_message` for user messages → compute TF-IDF → store in `embeddings` table
//!   2. On `search_similar` → compute query TF-IDF → cosine similarity → top-k results
//!
//! The IDF (inverse document frequency) is approximated from a random
//! sample of existing messages, refreshed periodically. Exact IDF over
//! the full corpus would require a full scan on every query, which is
//! overkill for a single-tenant desktop app.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Sparse TF-IDF vector stored as a map of token → weight.
/// Serialized as JSON BLOB in SQLite for portability.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TfidfVector(HashMap<String, f64>);

impl TfidfVector {
    pub fn cosine_similarity(&self, other: &TfidfVector) -> f64 {
        if self.0.is_empty() || other.0.is_empty() {
            return 0.0;
        }
        let mut dot = 0.0;
        let mut norm_a = 0.0;
        let mut norm_b = 0.0;
        for (token, &wa) in &self.0 {
            norm_a += wa * wa;
            if let Some(&wb) = other.0.get(token) {
                dot += wa * wb;
            }
        }
        for &wb in other.0.values() {
            norm_b += wb * wb;
        }
        let denom = norm_a.sqrt() * norm_b.sqrt();
        if denom == 0.0 {
            0.0
        } else {
            dot / denom
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".into())
    }

    pub fn from_json(s: &str) -> Self {
        serde_json::from_str(s).unwrap_or_default()
    }
}

/// Compute a TF-IDF vector for a single document given term frequencies
/// and document frequencies. `total_docs` is the corpus size for IDF.
pub fn compute_tfidf(
    text: &str,
    doc_freqs: &HashMap<String, usize>,
    total_docs: usize,
) -> TfidfVector {
    let tokens = tokenize(text);
    if tokens.is_empty() {
        return TfidfVector::default();
    }

    // Term frequency (raw count, normalized by doc length)
    let mut tf: HashMap<String, f64> = HashMap::new();
    let len = tokens.len() as f64;
    for token in &tokens {
        *tf.entry(token.clone()).or_insert(0.0) += 1.0 / len;
    }

    // TF-IDF = tf * log(N / df)
    let mut vec = HashMap::new();
    let n = total_docs.max(1) as f64;
    for (token, tf_val) in &tf {
        let df = *doc_freqs.get(token).unwrap_or(&1) as f64;
        let idf = (n / df).ln().max(0.0);
        let weight = tf_val * idf;
        if weight > 0.001 {
            vec.insert(token.clone(), weight);
        }
    }

    TfidfVector(vec)
}

/// Simple whitespace + punctuation tokenizer with basic stop-word filtering.
/// Handles CJK by splitting on character boundaries for short segments.
pub fn tokenize(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut tokens = Vec::new();

    // Split on whitespace and common punctuation
    for word in lower.split(|c: char| c.is_whitespace() || ",.!?;:()[]{}\"'`\n\r\t".contains(c)) {
        let w = word.trim_matches(|c: char| c == '-' || c == '_' || c == '/');
        if w.len() < 2 {
            continue;
        }
        // Skip common stop words
        if is_stop_word(w) {
            continue;
        }
        tokens.push(w.to_string());
    }

    // For CJK: also extract bigrams from runs of CJK characters
    let chars: Vec<char> = lower.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if is_cjk(chars[i]) {
            let start = i;
            while i < chars.len() && is_cjk(chars[i]) {
                i += 1;
            }
            let cjk_str: String = chars[start..i].iter().collect();
            // Add the whole CJK segment
            if cjk_str.len() >= 2 {
                tokens.push(cjk_str);
            }
            // Also add character bigrams for partial matching
            if i - start >= 2 {
                for j in start..i - 1 {
                    let bigram: String = format!("{}{}", chars[j], chars[j + 1]);
                    tokens.push(bigram);
                }
            }
        } else {
            i += 1;
        }
    }

    tokens
}

/// Collect document frequencies from a set of documents.
pub fn collect_doc_freqs(documents: &[String]) -> HashMap<String, usize> {
    let mut df: HashMap<String, usize> = HashMap::new();
    for doc in documents {
        let tokens = tokenize(doc);
        let unique: std::collections::HashSet<_> = tokens.into_iter().collect();
        for token in unique {
            *df.entry(token).or_insert(0) += 1;
        }
    }
    df
}

fn is_stop_word(w: &str) -> bool {
    matches!(
        w,
        "the"
            | "a"
            | "an"
            | "is"
            | "are"
            | "was"
            | "were"
            | "be"
            | "been"
            | "being"
            | "have"
            | "has"
            | "had"
            | "do"
            | "does"
            | "did"
            | "will"
            | "would"
            | "could"
            | "should"
            | "may"
            | "might"
            | "shall"
            | "can"
            | "need"
            | "dare"
            | "ought"
            | "used"
            | "to"
            | "of"
            | "in"
            | "for"
            | "on"
            | "with"
            | "at"
            | "by"
            | "from"
            | "as"
            | "into"
            | "through"
            | "during"
            | "before"
            | "after"
            | "above"
            | "below"
            | "between"
            | "out"
            | "off"
            | "over"
            | "under"
            | "again"
            | "further"
            | "then"
            | "once"
            | "and"
            | "but"
            | "or"
            | "nor"
            | "not"
            | "so"
            | "yet"
            | "both"
            | "either"
            | "neither"
            | "each"
            | "every"
            | "all"
            | "any"
            | "few"
            | "more"
            | "most"
            | "other"
            | "some"
            | "such"
            | "no"
            | "only"
            | "own"
            | "same"
            | "than"
            | "too"
            | "very"
            | "just"
            | "because"
            | "if"
            | "when"
            | "where"
            | "how"
            | "what"
            | "which"
            | "who"
            | "whom"
            | "this"
            | "that"
            | "these"
            | "those"
            | "i"
            | "me"
            | "my"
            | "myself"
            | "we"
            | "our"
            | "ours"
            | "you"
            | "your"
            | "yours"
            | "he"
            | "him"
            | "his"
            | "she"
            | "her"
            | "hers"
            | "it"
            | "its"
            | "they"
            | "them"
            | "their"
            | "theirs"
            | "的"
            | "了"
            | "在"
            | "是"
            | "我"
            | "有"
            | "和"
            | "就"
            | "不"
            | "人"
            | "都"
            | "一"
            | "一个"
            | "上"
            | "也"
            | "很"
            | "到"
            | "说"
            | "要"
            | "去"
            | "你"
            | "会"
            | "着"
            | "没有"
            | "看"
            | "好"
            | "自己"
            | "这"
    )
}

fn is_cjk(c: char) -> bool {
    let cp = c as u32;
    (0x4E00..=0x9FFF).contains(&cp) // CJK Unified Ideographs
        || (0x3400..=0x4DBF).contains(&cp) // CJK Extension A
        || (0x3000..=0x303F).contains(&cp) // CJK Symbols
        || (0x3040..=0x309F).contains(&cp) // Hiragana
        || (0x30A0..=0x30FF).contains(&cp) // Katakana
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_english() {
        let tokens = tokenize("Hello, world! This is a test.");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        assert!(tokens.contains(&"test".to_string()));
        assert!(!tokens.contains(&"is".to_string())); // stop word
    }

    #[test]
    fn tokenize_chinese() {
        let tokens = tokenize("我喜欢用 TypeScript 写代码");
        assert!(tokens
            .iter()
            .any(|t| t.contains("我喜") || t.contains("喜欢")));
        assert!(tokens.contains(&"typescript".to_string()));
    }

    #[test]
    fn cosine_identical() {
        let docs = vec![
            "hello world".to_string(),
            "foo bar baz".to_string(),
            "other content here".to_string(),
        ];
        let df = collect_doc_freqs(&docs);
        let v1 = compute_tfidf("hello world", &df, 3);
        let v2 = compute_tfidf("hello world", &df, 3);
        assert!(v1.cosine_similarity(&v2) > 0.99);
    }

    #[test]
    fn cosine_different() {
        let docs = vec![
            "rust programming language".to_string(),
            "cooking recipes kitchen".to_string(),
        ];
        let df = collect_doc_freqs(&docs);
        let v1 = compute_tfidf("rust programming", &df, 2);
        let v2 = compute_tfidf("cooking recipes", &df, 2);
        assert!(v1.cosine_similarity(&v2) < 0.3);
    }

    #[test]
    fn cosine_partial_match() {
        let docs = vec![
            "rust programming language".to_string(),
            "python programming language".to_string(),
            "cooking recipes".to_string(),
        ];
        let df = collect_doc_freqs(&docs);
        let v1 = compute_tfidf("rust programming", &df, 3);
        let v2 = compute_tfidf("python programming", &df, 3);
        let sim = v1.cosine_similarity(&v2);
        assert!(sim > 0.1 && sim < 0.9);
    }

    #[test]
    fn tfidf_serialization_roundtrip() {
        let docs = vec!["hello world test".to_string(), "foo bar baz".to_string()];
        let df = collect_doc_freqs(&docs);
        let v = compute_tfidf("hello world", &df, 2);
        let json = v.to_json();
        let v2 = TfidfVector::from_json(&json);
        assert!((v.cosine_similarity(&v2) - 1.0).abs() < 0.001);
    }
}
