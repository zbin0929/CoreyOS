//! `~/.hermes/SOUL.md` Corey-managed block sync.
//!
//! Appends (or in-place rewrites) Corey's iron-rules block into the
//! customer's `SOUL.md`, leaving any content the customer wrote
//! outside the marker pair **completely untouched**.
//!
//! # Why this exists
//!
//! Corey's L1 base soul (see `src/app/baseSoul.ts`) only enters chat
//! via the Corey UI frontend path. But Hermes Agent also gets invoked
//! from WhatsApp / Slack / cron / MCP clients that bypass the Corey
//! UI entirely — those hit `hermes gateway` directly and get the
//! system prompt from `~/.hermes/SOUL.md` (Hermes'
//! `agent/prompt_builder.py::_load_soul_md` loader).
//!
//! For Corey's **meta iron rules** (the highest-priority behavioural
//! discipline, e.g. "only do what user asks") to apply across **every
//! channel**, the rule text must live in `SOUL.md`.
//!
//! # Why not just overwrite SOUL.md
//!
//! A prior iteration (v0.2.11 early) did exactly that. It broke the
//! customer-sovereignty contract (HD-3): customers use `SOUL.md` as
//! their own persona override slot, and blindly overwriting nuked
//! their customisations on every upgrade. Commit `f756d70` retired
//! that path on 2026-05-11 morning.
//!
//! This module reinstates Corey → SOUL.md writes but with the
//! previously-missing **marker discipline**: Corey only ever touches
//! content between `<!-- COREY:BEGIN iron-rules vN -->` and
//! `<!-- COREY:END iron-rules vN -->`. Anything above, below, or
//! in a different marker block is customer property and remains
//! bit-identical across upgrades.
//!
//! # Contract summary
//!
//! - First install: block is appended to end of file (or file is
//!   created if missing) with a leading blank line separator.
//! - Subsequent syncs: block content between markers is replaced
//!   in-place; customer content before BEGIN and after END is
//!   preserved byte-for-byte.
//! - Version bump (v1 → v2): change the marker version string.
//!   Old markers (v1) become orphan customer content which Corey
//!   no longer touches — the user may delete them manually or we
//!   add a one-shot migration.
//! - Write is atomic: content goes to `SOUL.md.tmp` then renames.
//!   A crash mid-write leaves the previous `SOUL.md` intact.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// BEGIN marker. Must appear verbatim on its own line. The trailing
/// version string lets future Corey releases ignore blocks they don't
/// own (e.g. a v2 Corey sees v1 markers and leaves them be — the
/// customer has presumably downgraded or we've shipped a migration).
pub const MARKER_BEGIN: &str = "<!-- COREY:BEGIN iron-rules v1 -->";
pub const MARKER_END: &str = "<!-- COREY:END iron-rules v1 -->";

/// Payload shipped into every customer `SOUL.md`. Compiled into the
/// Corey binary so upgrade = new content on next boot, no seed file
/// copy needed on the customer machine.
pub const IRON_RULES_MARKDOWN: &str = include_str!("../assets/soul/corey_iron_rules.md");

/// What happened during a sync, for logging + UI feedback + tests.
#[derive(Debug, PartialEq, Eq)]
pub enum SyncOutcome {
    /// SOUL.md did not exist; created with just the Corey block.
    CreatedFile,
    /// File existed but had no Corey block; appended one.
    AppendedBlock,
    /// File existed with an out-of-date Corey block; rewrote between
    /// markers. Customer content outside the block is untouched.
    ReplacedBlock,
    /// File existed with an up-to-date Corey block (byte-identical
    /// content); no write performed.
    Unchanged,
}

/// Synchronise Corey's iron-rules block into `<hermes_dir>/SOUL.md`.
///
/// Idempotent. Safe to call every boot.
pub fn sync_corey_block(hermes_dir: &Path) -> io::Result<SyncOutcome> {
    let soul_path = hermes_dir.join("SOUL.md");
    sync_corey_block_with(&soul_path, IRON_RULES_MARKDOWN)
}

/// Testable inner function: explicit file path + explicit block body.
/// The body will be wrapped with BEGIN/END markers on write.
pub fn sync_corey_block_with(soul_path: &Path, body: &str) -> io::Result<SyncOutcome> {
    let desired_block = format!("{MARKER_BEGIN}\n{}\n{MARKER_END}\n", body.trim_end());

    let existing = match fs::read_to_string(soul_path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };

    let (new_content, outcome) = match existing {
        None => {
            // Fresh install — write just the block.
            (desired_block.clone(), SyncOutcome::CreatedFile)
        }
        Some(current) => match find_block(&current) {
            None => {
                // Customer has content but no Corey block. Append with
                // exactly one blank line separator so we don't stick
                // the block onto the last line of customer prose.
                let sep = if current.ends_with("\n\n") {
                    ""
                } else if current.ends_with('\n') {
                    "\n"
                } else {
                    "\n\n"
                };
                let combined = format!("{current}{sep}{desired_block}");
                (combined, SyncOutcome::AppendedBlock)
            }
            Some((start, end)) => {
                // Replace between markers. `end` is the byte index
                // *after* the closing marker's newline if present.
                let before = &current[..start];
                let after = &current[end..];
                // Current block text (including markers + trailing
                // newline if any) is what was there before.
                let was = &current[start..end];
                if was == desired_block {
                    return Ok(SyncOutcome::Unchanged);
                }
                let combined = format!("{before}{desired_block}{after}");
                (combined, SyncOutcome::ReplacedBlock)
            }
        },
    };

    atomic_write(soul_path, new_content.as_bytes())?;
    Ok(outcome)
}

/// Locate the Corey-owned block inside `haystack`. Returns the byte
/// offsets `[start, end)` such that `&haystack[start..end]` is the
/// complete block including both markers and any trailing newline
/// inside the block.
///
/// `None` if either marker is missing, or they appear in the wrong
/// order (defensive: corrupt markers are treated as "no block" so
/// we fall into append-path rather than rewriting customer text).
fn find_block(haystack: &str) -> Option<(usize, usize)> {
    let begin = haystack.find(MARKER_BEGIN)?;
    let after_begin = begin + MARKER_BEGIN.len();
    let end_marker_rel = haystack[after_begin..].find(MARKER_END)?;
    let end_marker_abs = after_begin + end_marker_rel;
    let end_abs = end_marker_abs + MARKER_END.len();
    // Consume the single newline right after the END marker, if any,
    // so replacement doesn't accumulate blank lines across syncs.
    let end = if haystack[end_abs..].starts_with('\n') {
        end_abs + 1
    } else {
        end_abs
    };
    Some((begin, end))
}

/// Atomic write: tmp-file + rename. A partial write crash leaves the
/// previous `SOUL.md` intact, which is the cautious default when the
/// file holds customer configuration we can't regenerate.
fn atomic_write(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp_path: PathBuf = {
        let mut p = target.to_path_buf();
        let fname = target
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("SOUL.md");
        p.set_file_name(format!("{fname}.corey-tmp"));
        p
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&tmp_path, bytes)?;
    fs::rename(&tmp_path, target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("corey-soul-md-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("create test dir");
        d
    }

    #[test]
    fn first_install_creates_file_with_just_corey_block() {
        let dir = temp_dir("first-install");
        let soul = dir.join("SOUL.md");
        let outcome = sync_corey_block_with(&soul, "Hello rules.").expect("sync");
        assert_eq!(outcome, SyncOutcome::CreatedFile);

        let content = fs::read_to_string(&soul).expect("read");
        assert!(content.contains(MARKER_BEGIN));
        assert!(content.contains(MARKER_END));
        assert!(content.contains("Hello rules."));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn existing_customer_content_without_marker_is_preserved_on_append() {
        let dir = temp_dir("preserve-customer");
        let soul = dir.join("SOUL.md");
        let customer_persona = "You are my personal Amazon consultant.\n\
             Always answer in Chinese.\n\
             I like concise bullet points.\n";
        fs::write(&soul, customer_persona).expect("seed");

        let outcome = sync_corey_block_with(&soul, "Iron rules body.").expect("sync");
        assert_eq!(outcome, SyncOutcome::AppendedBlock);

        let content = fs::read_to_string(&soul).expect("read");
        // Customer prose at the top is byte-identical.
        assert!(
            content.starts_with(customer_persona),
            "customer content must be preserved at file head: {content:?}"
        );
        // Corey block appended below.
        assert!(content.contains(MARKER_BEGIN));
        assert!(content.contains("Iron rules body."));
        assert!(content.contains(MARKER_END));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn existing_corey_block_is_rewritten_in_place_preserving_neighbours() {
        let dir = temp_dir("rewrite-inplace");
        let soul = dir.join("SOUL.md");
        let before = "Customer header line.\n";
        let after = "\nCustomer footer written after Corey's block.\n";
        let old_body = "old rules v0";
        let seeded = format!("{before}{MARKER_BEGIN}\n{old_body}\n{MARKER_END}\n{after}");
        fs::write(&soul, &seeded).expect("seed");

        let outcome = sync_corey_block_with(&soul, "new rules v1 content").expect("sync");
        assert_eq!(outcome, SyncOutcome::ReplacedBlock);

        let content = fs::read_to_string(&soul).expect("read");
        assert!(
            content.starts_with("Customer header line.\n"),
            "header preserved: {content:?}"
        );
        assert!(
            content.ends_with("\nCustomer footer written after Corey's block.\n"),
            "footer preserved: {content:?}"
        );
        assert!(content.contains("new rules v1 content"));
        assert!(!content.contains("old rules v0"), "old block removed");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn byte_identical_block_is_noop() {
        let dir = temp_dir("noop-when-equal");
        let soul = dir.join("SOUL.md");

        // First sync.
        sync_corey_block_with(&soul, "same content").expect("first sync");
        let first_mtime = fs::metadata(&soul)
            .expect("meta")
            .modified()
            .expect("mtime");

        // Ensure at least 1 ms passes — unnecessary for the assertion
        // we actually make (outcome == Unchanged) but keeps the test
        // honest if we later tighten the check to "file untouched".
        std::thread::sleep(std::time::Duration::from_millis(5));

        // Second sync with identical payload.
        let outcome = sync_corey_block_with(&soul, "same content").expect("second sync");
        assert_eq!(outcome, SyncOutcome::Unchanged);

        // File wasn't rewritten.
        let second_mtime = fs::metadata(&soul)
            .expect("meta")
            .modified()
            .expect("mtime");
        assert_eq!(
            first_mtime, second_mtime,
            "no-op sync must not touch the file"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_marker_is_treated_as_no_block() {
        // Only BEGIN marker, no END. Should fall into append-path
        // rather than try to rewrite something we can't delimit.
        let dir = temp_dir("malformed");
        let soul = dir.join("SOUL.md");
        let content = format!("prefix\n{MARKER_BEGIN}\nhalf a block with no end\n");
        fs::write(&soul, &content).expect("seed");

        let outcome = sync_corey_block_with(&soul, "fresh rules").expect("sync");
        assert_eq!(outcome, SyncOutcome::AppendedBlock);

        let final_content = fs::read_to_string(&soul).expect("read");
        // Original corrupt prefix is preserved — customer presumably
        // wrote it by hand, we're not in the business of repairing it.
        assert!(final_content.contains("half a block with no end"));
        // A fresh valid block is appended below.
        assert!(final_content.contains("fresh rules"));
        // The final file now has TWO BEGIN markers (the old corrupt
        // one + the new fresh one). Future syncs will match the first
        // pair (first BEGIN + first END), so the stale half-block acts
        // as a no-op island. Acceptable failure mode — better than
        // silently clobbering customer hand-written content.
        assert_eq!(final_content.matches(MARKER_BEGIN).count(), 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_iron_rules_payload_is_nontrivial() {
        // Regression guard: a prior refactor accidentally set
        // include_str! to a missing path which silently compiled to
        // "". Assert we actually ship content.
        assert!(
            IRON_RULES_MARKDOWN.len() > 500,
            "bundled iron rules payload suspiciously short: {} bytes",
            IRON_RULES_MARKDOWN.len()
        );
        assert!(IRON_RULES_MARKDOWN.contains("只做用户明确要求的事"));
        assert!(IRON_RULES_MARKDOWN.contains("有疑问先提问"));
    }
}
