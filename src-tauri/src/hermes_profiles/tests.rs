use super::*;
use std::io::Write;

/// Cheap tempdir helper (consistent with other modules in this crate).
/// Uses nanos + a per-process counter so parallel tests don't clash —
/// ms resolution wasn't enough when cargo test runs them all at once.
struct TempHome(PathBuf);
impl TempHome {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let base = std::env::temp_dir().join(format!(
            "caduceus-profiles-{}-{}-{}",
            std::process::id(),
            nanos,
            seq,
        ));
        fs::create_dir_all(base.join(".hermes/profiles")).unwrap();
        Self(base)
    }
    fn path(&self) -> &Path {
        &self.0
    }
    fn seed(&self, name: &str) {
        fs::create_dir_all(self.0.join(".hermes/profiles").join(name)).unwrap();
    }
    fn seed_active(&self, name: &str) {
        let mut f = fs::File::create(self.0.join(".hermes/active_profile")).unwrap();
        f.write_all(name.as_bytes()).unwrap();
    }
}
impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn list_profiles_surfaces_dirs_and_flags_active() {
    let h = TempHome::new();
    h.seed("prod");
    h.seed("dev");
    h.seed_active("dev");
    // Hidden dir — must be skipped.
    fs::create_dir_all(h.path().join(".hermes/profiles/.cache")).unwrap();
    // Stray file — must be skipped.
    fs::write(h.path().join(".hermes/profiles/README.md"), "hi").unwrap();

    let view = list_profiles_at(h.path()).unwrap();
    assert!(!view.missing_root);
    assert_eq!(view.active.as_deref(), Some("dev"));
    assert_eq!(view.profiles.len(), 2);
    // Active sorts first; then alphabetical.
    assert_eq!(view.profiles[0].name, "dev");
    assert!(view.profiles[0].is_active);
    assert_eq!(view.profiles[1].name, "prod");
    assert!(!view.profiles[1].is_active);
}

#[test]
fn list_profiles_missing_root_is_not_an_error() {
    // Fresh tempdir with no .hermes at all.
    let base = std::env::temp_dir().join(format!("caduceus-noprofiles-{}", now_ms()));
    fs::create_dir_all(&base).unwrap();
    let view = list_profiles_at(&base).unwrap();
    assert!(view.missing_root);
    assert!(view.profiles.is_empty());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn create_profile_roundtrips_and_seeds_config() {
    let h = TempHome::new();
    let info = create_profile_at(h.path(), "alpha", None).unwrap();
    assert_eq!(info.name, "alpha");

    let cfg = h.path().join(".hermes/profiles/alpha/config.yaml");
    assert!(cfg.is_file(), "seed config.yaml should exist");
}

#[test]
fn create_profile_inherits_root_model_section() {
    let h = TempHome::new();
    fs::write(
        h.path().join(".hermes/config.yaml"),
        "model:\n  default: deepseek-v4-pro\n  temperature: 0.7\nother: keep\n",
    )
    .expect("seed root config");

    create_profile_at(h.path(), "beta", None).expect("create profile");

    let cfg = fs::read_to_string(h.path().join(".hermes/profiles/beta/config.yaml"))
        .expect("read seed config");
    let value: serde_yaml::Value = serde_yaml::from_str(&cfg).expect("parse seed yaml");
    assert_eq!(
        value["model"]["default"].as_str(),
        Some("deepseek-v4-pro"),
        "profile must inherit root model.default"
    );
    assert!(
        value.get("other").is_none(),
        "only the model section is inherited"
    );
}

#[test]
fn create_profile_falls_back_when_root_has_no_model() {
    let h = TempHome::new();
    fs::write(h.path().join(".hermes/config.yaml"), "approvals: {}\n")
        .expect("seed modelless root config");

    create_profile_at(h.path(), "gamma", None).expect("create profile");

    let cfg = fs::read_to_string(h.path().join(".hermes/profiles/gamma/config.yaml"))
        .expect("read seed config");
    assert!(
        cfg.contains("{}"),
        "no root model → historical {{}} sentinel"
    );
}

#[test]
fn repair_backfills_modelless_profiles_and_preserves_good_ones() {
    let h = TempHome::new();
    fs::write(
        h.path().join(".hermes/config.yaml"),
        "model:\n  default: deepseek-v4-pro\n  provider: deepseek\n",
    )
    .expect("seed root config");

    // Two broken profiles (the `{}` sentinel) + one already-good one.
    for name in ["broken-a", "broken-b"] {
        let dir = h.path().join(".hermes/profiles").join(name);
        fs::create_dir_all(&dir).expect("mkdir");
        fs::write(dir.join("config.yaml"), "# managed by Corey\n{}\n").expect("seed broken");
    }
    let good = h.path().join(".hermes/profiles/good");
    fs::create_dir_all(&good).expect("mkdir good");
    fs::write(good.join("config.yaml"), "model:\n  default: keep-me\n").expect("seed good");

    let repaired = repair_profiles_missing_model_at(h.path()).expect("repair");
    assert_eq!(repaired, 2, "only the two modelless profiles are repaired");

    for name in ["broken-a", "broken-b"] {
        let cfg = fs::read_to_string(
            h.path()
                .join(".hermes/profiles")
                .join(name)
                .join("config.yaml"),
        )
        .expect("read repaired");
        let v: serde_yaml::Value = serde_yaml::from_str(&cfg).expect("parse");
        assert_eq!(v["model"]["default"].as_str(), Some("deepseek-v4-pro"));
    }

    // The good profile's custom model must survive untouched.
    let good_cfg = fs::read_to_string(good.join("config.yaml")).expect("read good");
    let gv: serde_yaml::Value = serde_yaml::from_str(&good_cfg).expect("parse good");
    assert_eq!(gv["model"]["default"].as_str(), Some("keep-me"));

    // Idempotent: a second pass repairs nothing.
    assert_eq!(
        repair_profiles_missing_model_at(h.path()).expect("repair2"),
        0
    );
}

#[test]
fn repair_fixes_empty_string_model_and_preserves_other_keys() {
    let h = TempHome::new();
    fs::write(
        h.path().join(".hermes/config.yaml"),
        "model:\n  default: deepseek-v4-pro\n  provider: deepseek\n",
    )
    .expect("seed root config");

    // The shape Hermes writes after it expands a modelless profile on
    // first use: a full-ish config with an EMPTY string model plus a
    // Pack-injected MCP server that MUST survive the repair.
    let dir = h.path().join(".hermes/profiles/market");
    fs::create_dir_all(&dir).expect("mkdir");
    fs::write(
        dir.join("config.yaml"),
        "model: ''\nproviders: {}\nmcp_servers:\n  sellersprite:\n    url: https://mcp.example/x\n    enabled: true\n",
    )
    .expect("seed empty-string-model profile");

    let repaired = repair_profiles_missing_model_at(h.path()).expect("repair");
    assert_eq!(repaired, 1, "the empty-string-model profile is repaired");

    let raw = fs::read_to_string(dir.join("config.yaml")).expect("read repaired");
    let v: serde_yaml::Value = serde_yaml::from_str(&raw).expect("parse");
    assert_eq!(
        v["model"]["default"].as_str(),
        Some("deepseek-v4-pro"),
        "empty string model is replaced with the root model"
    );
    // The Pack MCP server (and everything else) must be preserved.
    assert_eq!(
        v["mcp_servers"]["sellersprite"]["enabled"].as_bool(),
        Some(true),
        "in-place merge must not drop other keys"
    );
    assert_eq!(
        v["mcp_servers"]["sellersprite"]["url"].as_str(),
        Some("https://mcp.example/x")
    );

    // Idempotent: now that the model is usable, a second pass is a no-op.
    assert_eq!(
        repair_profiles_missing_model_at(h.path()).expect("repair2"),
        0
    );
}

#[test]
fn repair_is_noop_when_root_has_no_model() {
    let h = TempHome::new();
    fs::write(h.path().join(".hermes/config.yaml"), "approvals: {}\n").expect("seed root");
    let dir = h.path().join(".hermes/profiles/x");
    fs::create_dir_all(&dir).expect("mkdir");
    fs::write(dir.join("config.yaml"), "{}\n").expect("seed");

    assert_eq!(
        repair_profiles_missing_model_at(h.path()).expect("repair"),
        0,
        "no root model → nothing to backfill"
    );
}

#[test]
fn create_profile_rejects_duplicate() {
    let h = TempHome::new();
    h.seed("dup");
    let err = create_profile_at(h.path(), "dup", None).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
}

#[test]
fn create_profile_validates_name() {
    let h = TempHome::new();
    assert!(create_profile_at(h.path(), "", None).is_err());
    assert!(create_profile_at(h.path(), "..", None).is_err());
    assert!(create_profile_at(h.path(), "a/b", None).is_err());
    assert!(create_profile_at(h.path(), ".hidden", None).is_err());
    // Control char (NUL) — assemble explicitly.
    let bad = String::from_utf8(vec![b'a', 0, b'b']).unwrap();
    assert!(create_profile_at(h.path(), &bad, None).is_err());
}

#[test]
fn rename_profile_moves_directory_and_is_no_op_when_same() {
    let h = TempHome::new();
    h.seed("old");
    rename_profile_at(h.path(), "old", "new", None).unwrap();
    assert!(!h.path().join(".hermes/profiles/old").exists());
    assert!(h.path().join(".hermes/profiles/new").is_dir());

    // Same name is a no-op (no error, no filesystem churn).
    rename_profile_at(h.path(), "new", "new", None).unwrap();
}

#[test]
fn rename_profile_refuses_to_clobber() {
    let h = TempHome::new();
    h.seed("a");
    h.seed("b");
    let err = rename_profile_at(h.path(), "a", "b", None).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
}

#[test]
fn delete_profile_refuses_active() {
    let h = TempHome::new();
    h.seed("live");
    h.seed_active("live");
    let err = delete_profile_at(h.path(), "live", None).unwrap_err();
    assert!(err.to_string().contains("refusing to delete active"));
}

#[test]
fn delete_profile_removes_non_active() {
    let h = TempHome::new();
    h.seed("keep");
    h.seed("gone");
    h.seed_active("keep");
    delete_profile_at(h.path(), "gone", None).unwrap();
    assert!(!h.path().join(".hermes/profiles/gone").exists());
    assert!(h.path().join(".hermes/profiles/keep").exists());
}

#[test]
fn clone_profile_copies_contents_recursively() {
    let h = TempHome::new();
    h.seed("src");
    fs::write(
        h.path().join(".hermes/profiles/src/config.yaml"),
        "model: x\n",
    )
    .unwrap();
    fs::create_dir_all(h.path().join(".hermes/profiles/src/skills")).unwrap();
    fs::write(
        h.path().join(".hermes/profiles/src/skills/hello.md"),
        "howdy",
    )
    .unwrap();

    clone_profile_at(h.path(), "src", "dst", None).unwrap();

    let cloned_cfg = fs::read_to_string(h.path().join(".hermes/profiles/dst/config.yaml")).unwrap();
    assert_eq!(cloned_cfg, "model: x\n");
    let cloned_skill =
        fs::read_to_string(h.path().join(".hermes/profiles/dst/skills/hello.md")).unwrap();
    assert_eq!(cloned_skill, "howdy");
}

#[test]
fn clone_profile_refuses_existing_dst() {
    let h = TempHome::new();
    h.seed("a");
    h.seed("b");
    let err = clone_profile_at(h.path(), "a", "b", None).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
}

#[test]
fn validate_name_matrix() {
    assert!(validate_name("prod").is_ok());
    assert!(validate_name("my-agent_01").is_ok());
    assert!(validate_name("").is_err());
    assert!(validate_name("..").is_err());
    assert!(validate_name("a/b").is_err());
    assert!(validate_name(".hidden").is_err());
    assert!(validate_name(&"x".repeat(65)).is_err());
}

#[test]
fn activate_writes_pointer_and_marks_active() {
    let h = TempHome::new();
    h.seed("dev");
    h.seed("prod");
    h.seed_active("dev");

    let info = activate_profile_at(h.path(), "prod", None).unwrap();
    assert!(info.is_active);
    assert_eq!(info.name, "prod");

    // Pointer file now reads "prod\n".
    let pointer = h.path().join(".hermes/active_profile");
    let raw = fs::read_to_string(&pointer).unwrap();
    assert_eq!(raw.trim(), "prod");

    // Next list() reflects the flip.
    let view = list_profiles_at(h.path()).unwrap();
    assert_eq!(view.active.as_deref(), Some("prod"));
    let prod = view.profiles.iter().find(|p| p.name == "prod").unwrap();
    assert!(prod.is_active);
}

#[test]
fn activate_refuses_nonexistent_profile() {
    let h = TempHome::new();
    h.seed("dev");
    let err = activate_profile_at(h.path(), "ghost", None).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::NotFound);
    // Pointer file was never written.
    assert!(!h.path().join(".hermes/active_profile").exists());
}

#[test]
fn activate_is_idempotent_when_already_active() {
    let h = TempHome::new();
    h.seed("dev");
    h.seed_active("dev");

    // Sanity: starting state.
    assert_eq!(read_active(h.path()).as_deref(), Some("dev"));

    // Activating again succeeds without throwing — the no-op path
    // avoids clutter in the changelog journal.
    let info = activate_profile_at(h.path(), "dev", None).unwrap();
    assert!(info.is_active);
}
