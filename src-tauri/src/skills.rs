//! Phase 4 · T4.2 — Skills storage.
//!
//! Skills are Markdown files under `~/.hermes/skills/**/*.md`. Each file
//! is a self-contained prompt (optionally with a YAML frontmatter block
//! declaring inputs / tools / default_model — we don't parse the
//! frontmatter on the Rust side; that's the frontend's job when it
//! renders the test-runner form later).
//!
//! We treat the tree as read-mostly: list recursively, get by relative
//! path, save (atomic write through `fs_atomic::write_string`). No
//! versioning yet — a simple "overwrite or refuse" semantics with a
//! `create_new` flag covers the MVP. Rollback / diff / test-runner land
//! with T4.2b once we have a real-user signal on what they want.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::fs_atomic;

const HERMES_DIR: &str = ".hermes";
const SKILLS_DIR: &str = "skills";

fn hermes_dir() -> io::Result<PathBuf> {
    // Match hermes_config::hermes_dir — `$HOME` first, `%USERPROFILE%`
    // as the Windows fallback so tests + CI on Windows resolve too.
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "neither $HOME nor %USERPROFILE% set",
            )
        })?;
    Ok(PathBuf::from(home).join(HERMES_DIR))
}

pub fn skills_dir() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(SKILLS_DIR))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSummary {
    /// Path under `skills/`, posix-style, with the `.md` suffix preserved.
    /// Used as the stable id from the frontend's POV.
    pub path: String,
    /// Derived display name (path without extension, last segment).
    pub name: String,
    /// Nested directory, relative to `skills/`. `None` for top-level.
    pub group: Option<String>,
    /// File size in bytes — cheap and useful in the tree view.
    pub size: u64,
    /// Last-modified unix ms. UI shows "edited 3m ago" etc.
    pub updated_at_ms: i64,
    /// First Markdown heading (`#`..`######`) line stripped of its
    /// leading `#`s + whitespace. Lets a Markdown skill present a
    /// human-readable Chinese / English title in the tree without
    /// renaming the file. `None` when no heading appears in the first
    /// ~1 KB.
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillContent {
    pub path: String,
    pub body: String,
    pub updated_at_ms: i64,
}

/// List every `*.md` file under `skills/` recursively. MRU-first.
pub fn list() -> anyhow::Result<Vec<SkillSummary>> {
    let root = skills_dir()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    walk(&root, &root, &mut out)?;
    out.sort_by_key(|s| std::cmp::Reverse(s.updated_at_ms));
    Ok(out)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<SkillSummary>) -> anyhow::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let path = entry.path();
        if ft.is_dir() {
            walk(root, &path, out)?;
        } else if ft.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
            let meta = entry.metadata()?;
            let size = meta.len();
            let updated_at_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let name = rel
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unnamed")
                .to_string();
            let group = rel.parent().and_then(|p| {
                let s = p.to_string_lossy().replace('\\', "/");
                if s.is_empty() {
                    None
                } else {
                    Some(s)
                }
            });
            let description = read_h1_title(&path);
            out.push(SkillSummary {
                path: rel_str,
                name,
                group,
                size,
                updated_at_ms,
                description,
            });
        }
    }
    Ok(())
}

/// Read at most the first 1 KiB of `path` and pull out the leading
/// ATX-style Markdown heading line (any of `#` through `######`),
/// stripped of its `#`s and surrounding whitespace.
///
/// We deliberately cap the read so listing 100s of skills stays fast —
/// any skill whose first heading isn't in the first kilobyte is a
/// malformed Markdown file by anyone's standard. Returns `None` when
/// no heading is present, the extracted title is empty, or the file
/// fails to open (the listing itself stays best-effort: a missing
/// description is harmless, a hard error here would block the entire
/// tree from rendering).
fn read_h1_title(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = fs::File::open(path).ok()?;
    let mut buf = [0u8; 1024];
    let n = file.read(&mut buf).ok()?;
    // `from_utf8_lossy` (vs strict `from_utf8`) so a CJK title whose
    // last byte falls right on the 1024 boundary doesn't blow up — we
    // only inspect the first complete line anyway, well before the
    // truncation point.
    let head = String::from_utf8_lossy(&buf[..n]);
    for line in head.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with('#') {
            // Stop at the first non-blank, non-heading content so we
            // don't drag a deep `## subheading` up if the author skipped
            // an H1 — that would be misleading.
            if !trimmed.is_empty() {
                return None;
            }
            continue;
        }
        // Match `#` followed by optional `#`s, a single space, then the
        // title. ATX-style headings only — Setext (`Title\n===`) is rare
        // enough that we ignore it.
        let title = trimmed.trim_start_matches('#').trim();
        if title.is_empty() {
            return None;
        }
        return Some(title.to_string());
    }
    None
}

/// Read a skill file. Path must be a relative posix path under `skills/`;
/// we reject any `..` segments so a curious caller can't escape the root.
pub fn get(rel_path: &str) -> anyhow::Result<SkillContent> {
    let abs = resolve(rel_path)?;
    let body = fs::read_to_string(&abs)?;
    let updated_at_ms = abs
        .metadata()?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(SkillContent {
        path: rel_path.to_string(),
        body,
        updated_at_ms,
    })
}

/// Write a skill file. Creates the parent directory if needed. Uses the
/// atomic write helper so a crash mid-save doesn't corrupt the file.
/// `create_new = true` refuses an existing target.
pub fn save(rel_path: &str, body: &str, create_new: bool) -> anyhow::Result<SkillContent> {
    let abs = resolve(rel_path)?;
    if create_new && abs.exists() {
        anyhow::bail!("skill already exists: {}", rel_path);
    }
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    // `atomic_write` takes a perms param on every target (unix has the
    // meaningful version; non-unix carries a `_`-prefixed placeholder of
    // the same shape). Pass `None` unconditionally — no cfg-gate here,
    // otherwise Windows sees 2 args where 3 are expected.
    fs_atomic::atomic_write(&abs, body.as_bytes(), None)?;
    let updated_at_ms = abs
        .metadata()?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(SkillContent {
        path: rel_path.to_string(),
        body: body.to_string(),
        updated_at_ms,
    })
}

pub fn delete(rel_path: &str) -> anyhow::Result<()> {
    let abs = resolve(rel_path)?;
    fs::remove_file(&abs)?;
    Ok(())
}

fn resolve(rel_path: &str) -> anyhow::Result<PathBuf> {
    // Reject traversal, absolute paths, and windows drive letters.
    if rel_path.is_empty() {
        anyhow::bail!("empty skill path");
    }
    if rel_path.starts_with('/') || rel_path.starts_with('\\') {
        anyhow::bail!("absolute path rejected");
    }
    for seg in rel_path.split(['/', '\\']) {
        if seg == ".." || seg.is_empty() {
            anyhow::bail!("invalid segment in path: {rel_path}");
        }
    }
    if !rel_path.ends_with(".md") {
        anyhow::bail!("skill path must end in .md: {rel_path}");
    }
    Ok(skills_dir()?.join(rel_path))
}

/// Test-only global lock on `$HOME` mutation. Any test in the crate that
/// set_var("HOME", …) should take this first — otherwise parallel tests
/// that point HOME at a tempdir clobber each other and produce spurious
/// failures. (Historically used by `wechat::tests::*`; kept available
/// for any future HOME-sensitive suites.)
#[cfg(test)]
pub(crate) static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    struct HomeGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        prev: Option<std::ffi::OsString>,
    }
    impl HomeGuard {
        fn new(home: &Path) -> Self {
            let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let prev = std::env::var_os("HOME");
            std::env::set_var("HOME", home);
            Self { _lock: lock, prev }
        }
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            if let Some(p) = &self.prev {
                std::env::set_var("HOME", p);
            } else {
                std::env::remove_var("HOME");
            }
        }
    }

    #[test]
    fn list_empty_on_fresh_home() {
        let tmp = tempdir();
        let _g = HomeGuard::new(&tmp);
        assert!(list().unwrap().is_empty());
    }

    #[test]
    fn save_then_get_round_trips() {
        let tmp = tempdir();
        let _g = HomeGuard::new(&tmp);
        save("hello.md", "# hi\nbody\n", false).unwrap();
        let got = get("hello.md").unwrap();
        assert_eq!(got.body, "# hi\nbody\n");

        // Overwriting without create_new is allowed.
        save("hello.md", "v2", false).unwrap();
        assert_eq!(get("hello.md").unwrap().body, "v2");

        // create_new refuses an existing file.
        let err = save("hello.md", "v3", true);
        assert!(err.is_err());
    }

    #[test]
    fn list_sees_nested_dirs_and_sorts_mru_first() {
        let tmp = tempdir();
        let _g = HomeGuard::new(&tmp);
        save("a.md", "a", false).unwrap();
        // Small delay to guarantee distinct mtimes even on fast filesystems.
        std::thread::sleep(std::time::Duration::from_millis(20));
        save("work/b.md", "b", false).unwrap();

        let rows = list().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].path, "work/b.md");
        assert_eq!(rows[0].group.as_deref(), Some("work"));
        assert_eq!(rows[1].path, "a.md");
        assert_eq!(rows[1].group, None);
    }

    #[test]
    fn path_traversal_is_rejected() {
        let tmp = tempdir();
        let _g = HomeGuard::new(&tmp);
        assert!(get("../evil.md").is_err());
        assert!(save("/abs.md", "x", false).is_err());
        assert!(save("ok/../../evil.md", "x", false).is_err());
        assert!(save("nocolon.txt", "x", false).is_err());
    }

    #[test]
    fn description_is_extracted_from_first_h1() {
        let tmp = tempdir();
        let _g = HomeGuard::new(&tmp);
        // ATX-style heading at the top, with leading whitespace + extra
        // `#`s + trailing newline. Title is what humans actually read,
        // independent of the file name.
        save("daily.md", "# 每日报告 Daily Report\n\nbody…", false).unwrap();
        // No H1 → description stays None.
        save("plain.md", "no heading here\nstill nothing", false).unwrap();
        // H2 is accepted too — the goal is "first human-readable
        // title", not strict H1-only semantics. Many community skills
        // start with `## Description` after a frontmatter block.
        save("h2-only.md", "## Sub heading\n\nbody", false).unwrap();
        // Empty H1 (just `#`) → None. Validates the empty-title guard.
        save("blank-h1.md", "#\nbody", false).unwrap();

        let rows = list().unwrap();
        let by_path: std::collections::HashMap<_, _> = rows
            .iter()
            .map(|r| (r.path.clone(), r.description.clone()))
            .collect();
        assert_eq!(
            by_path.get("daily.md").unwrap().as_deref(),
            Some("每日报告 Daily Report"),
        );
        assert_eq!(by_path.get("plain.md").unwrap().as_deref(), None);
        assert_eq!(
            by_path.get("h2-only.md").unwrap().as_deref(),
            Some("Sub heading")
        );
        assert_eq!(by_path.get("blank-h1.md").unwrap().as_deref(), None);
    }

    #[test]
    fn delete_removes_file() {
        let tmp = tempdir();
        let _g = HomeGuard::new(&tmp);
        save("gone.md", "x", false).unwrap();
        delete("gone.md").unwrap();
        assert!(get("gone.md").is_err());
    }

    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("caduceus-skills-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}
