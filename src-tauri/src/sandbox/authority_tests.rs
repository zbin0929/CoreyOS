use super::*;

// ───────────────────── T6.5 scope tests ─────────────────────

#[test]
fn new_authority_has_only_default_scope() {
    let auth = PathAuthority::new();
    let scopes = auth.scopes();
    assert_eq!(scopes.len(), 1);
    assert_eq!(scopes[0].id, DEFAULT_SCOPE_ID);
    assert!(scopes[0].roots.is_empty());
}

#[test]
fn upsert_scope_rejects_invalid_ids() {
    let auth = PathAuthority::new();
    let bad_ids = [
        "",
        "With Spaces",
        "UPPER",
        "has.dot",
        "has/slash",
        &"x".repeat(33),
    ];
    for id in bad_ids {
        let err = auth
            .upsert_scope(SandboxScope {
                id: id.into(),
                label: "lbl".into(),
                roots: vec![],
            })
            .unwrap_err();
        assert!(
            matches!(err, SandboxError::InvalidScope { .. }),
            "id {id:?} should reject as InvalidScope, got {err:?}"
        );
    }
}

#[test]
fn delete_default_scope_is_rejected() {
    let auth = PathAuthority::new();
    let err = auth.delete_scope(DEFAULT_SCOPE_ID).unwrap_err();
    assert!(matches!(err, SandboxError::InvalidScope { .. }));
    // Still present.
    assert!(auth.scopes().iter().any(|s| s.id == DEFAULT_SCOPE_ID));
}

#[test]
fn check_scoped_respects_per_scope_roots() {
    // Build two scopes: `default` with /tmp, `worker` with no roots.
    // Reading /tmp under `default` allows; under `worker` (enforced)
    // denies.
    let auth = PathAuthority::new();
    let tmp = std::env::temp_dir();
    auth.set_roots(vec![WorkspaceRoot {
        path: tmp.clone(),
        label: "tmp".into(),
        mode: AccessMode::ReadWrite,
    }]);
    auth.upsert_scope(SandboxScope {
        id: "worker".into(),
        label: "Worker".into(),
        roots: vec![],
    })
    .unwrap();
    // Force enforced mode so `worker`'s empty-roots + enforced →
    // consent-required rather than dev-allow.
    auth.set_enforced();

    // default scope: ok.
    assert!(auth.check_scoped("default", &tmp, AccessOp::Read).is_ok());
    // worker scope: consent required (same path, different policy).
    let err = auth
        .check_scoped("worker", &tmp, AccessOp::Read)
        .unwrap_err();
    assert!(matches!(err, SandboxError::ConsentRequired { .. }));
}

#[test]
fn grant_once_is_scope_local() {
    // A grant in `worker` must not satisfy a check against `default`.
    let auth = PathAuthority::new();
    auth.upsert_scope(SandboxScope {
        id: "worker".into(),
        label: "Worker".into(),
        roots: vec![],
    })
    .unwrap();
    auth.set_enforced();

    let tmp = std::env::temp_dir();
    auth.grant_once_in("worker", tmp.clone()).unwrap();

    // Worker can see it.
    assert!(auth.check_scoped("worker", &tmp, AccessOp::Read).is_ok());
    // Default scope cannot — grants don't cross scopes.
    let err = auth
        .check_scoped("default", &tmp, AccessOp::Read)
        .unwrap_err();
    assert!(matches!(err, SandboxError::ConsentRequired { .. }));
}

#[test]
fn check_unknown_scope_errors_out() {
    let auth = PathAuthority::new();
    let err = auth
        .check_scoped("ghost", &std::env::temp_dir(), AccessOp::Read)
        .unwrap_err();
    assert!(matches!(err, SandboxError::UnknownScope { .. }));
}

#[test]
fn denylist_still_wins_per_scope() {
    // Even a scope with ~ as a read-write root cannot punch
    // through ~/.ssh.
    let auth = PathAuthority::new();
    if let Some(home) = dirs_home() {
        auth.upsert_scope(SandboxScope {
            id: "wide".into(),
            label: "Wide".into(),
            roots: vec![WorkspaceRoot {
                path: home.clone(),
                label: "home".into(),
                mode: AccessMode::ReadWrite,
            }],
        })
        .unwrap();
        let ssh = home.join(".ssh");
        if ssh.exists() {
            let err = auth.check_scoped("wide", &ssh, AccessOp::Read).unwrap_err();
            assert!(matches!(err, SandboxError::Denied { .. }));
        }
    }
}

#[test]
fn delete_scope_clears_its_session_grants() {
    let auth = PathAuthority::new();
    auth.upsert_scope(SandboxScope {
        id: "temp".into(),
        label: "Temp".into(),
        roots: vec![],
    })
    .unwrap();
    let tmp = std::env::temp_dir();
    auth.grant_once_in("temp", tmp.clone()).unwrap();
    assert_eq!(auth.session_grants_in("temp").len(), 1);

    auth.delete_scope("temp").unwrap();
    // Re-adding the scope gets a clean grant list.
    auth.upsert_scope(SandboxScope {
        id: "temp".into(),
        label: "Temp".into(),
        roots: vec![],
    })
    .unwrap();
    assert!(
        auth.session_grants_in("temp").is_empty(),
        "session grants should not leak across scope recreation"
    );
}

// ───────────────────── Pre-T6.5 behaviour preservation ─────────────────────
//
// These tests pre-date T6.5 and assert legacy default-scope
// behaviour — they MUST keep passing so callers that never touch
// the scope API see zero behaviour change.

#[test]
fn empty_roots_phase0_allows() {
    let auth = PathAuthority::new();
    let p = std::env::temp_dir();
    assert!(auth.check(&p, AccessOp::Read).is_ok());
}

#[test]
fn denylist_wins_over_roots() {
    let auth = PathAuthority::new();
    if let Some(home) = dirs_home() {
        auth.set_roots(vec![WorkspaceRoot {
            path: home.clone(),
            label: "home".into(),
            mode: AccessMode::ReadWrite,
        }]);
        let ssh = home.join(".ssh");
        if ssh.exists() {
            let err = auth.check(&ssh, AccessOp::Read).unwrap_err();
            assert!(matches!(err, SandboxError::Denied { .. }));
        }
    }
}

#[test]
fn outside_root_requires_consent() {
    let auth = PathAuthority::new();
    let tmp = std::env::temp_dir();
    auth.set_roots(vec![WorkspaceRoot {
        path: tmp.clone(),
        label: "tmp".into(),
        mode: AccessMode::ReadWrite,
    }]);
    // `/` is definitely outside `/tmp` on any system.
    let err = auth.check(Path::new("/"), AccessOp::Read).unwrap_err();
    assert!(matches!(err, SandboxError::ConsentRequired { .. }));
}

// ───────────────────────── Windows verbatim-prefix tests ─────────────────
//
// Phase 0's retro flagged a real bug: `std::fs::canonicalize` on Windows
// returns `\\?\C:\…` verbatim paths, and our denylist does string-prefix
// matching against `"C:\\Windows\\System32\\"` which then silently fails.
// The fix was to route every canonicalization through `dunce::canonicalize`
// — these tests lock that contract in so a future "simplify the sandbox"
// refactor can't regress it without turning the Windows CI leg red.

#[cfg(target_os = "windows")]
#[test]
fn canonicalize_or_parent_strips_verbatim_prefix() {
    // `C:\Windows` is guaranteed to exist on every Windows runner.
    let canonical = canonicalize_or_parent(Path::new("C:\\Windows"))
        .expect("C:\\Windows must canonicalize on Windows");
    let s = canonical.to_string_lossy();
    assert!(
        !s.starts_with("\\\\?\\"),
        "dunce should have stripped the verbatim prefix, got {s}"
    );
    assert!(
        s.eq_ignore_ascii_case("C:\\Windows"),
        "unexpected canonical form: {s}"
    );
}

#[cfg(target_os = "windows")]
#[test]
fn hard_denylist_blocks_system32_even_with_verbatim_input() {
    let auth = PathAuthority::new();
    let victim = Path::new("C:\\Windows\\System32\\config\\SAM");
    let err = auth
        .check(victim, AccessOp::Read)
        .expect_err("System32 hive must be denied");
    assert!(
        matches!(err, SandboxError::Denied { .. }),
        "expected Denied, got {err:?}"
    );
}

#[cfg(target_os = "windows")]
#[test]
fn home_relative_denylist_blocks_ssh_dir() {
    let Some(home) = dirs_home() else {
        return;
    };
    let auth = PathAuthority::new();
    auth.set_roots(vec![WorkspaceRoot {
        path: home.clone(),
        label: "home".into(),
        mode: AccessMode::ReadWrite,
    }]);

    let ssh = home.join(".ssh");
    if ssh.exists() {
        let err = auth
            .check(&ssh, AccessOp::Read)
            .expect_err("~/.ssh must be denied even when HOME is a root");
        assert!(matches!(err, SandboxError::Denied { .. }));
    }
}
