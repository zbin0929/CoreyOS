use super::model::WorkflowDef;

/// Bundled workflow templates seeded into `~/.hermes/workflows/` on
/// first boot via `ensure_templates`. Existing files are NEVER
/// overwritten — `ensure_templates` only adds files that are missing.
///
/// ## History
///
/// - **v10 (2026-05-06)**: Emptied the list; demos moved into the
///   `corey_starter` default Pack so the base binary shipped with
///   zero workflow templates.
/// - **2026-05-10**: Decision reversed — `corey_starter` felt
///   awkward as a user-facing "Pack" when it only existed to ship
///   two generic demo workflows. Those demos are back here as true
///   builtin templates (`daily-news-digest`, `pdf-summary`) and the
///   `corey_starter` Pack was removed. Rationale: base binary users
///   want "a few useful workflows that just work"; a Pack entry they
///   can't uninstall cleanly is worse UX than two seeded yaml files.
///
/// The yaml payloads live under `assets/default-workflows/` and are
/// inlined via `include_str!` so they're compiled into the binary
/// (no `tauri.conf.json` resources entry needed for these).
pub fn builtin_templates() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "daily-news-digest.yaml",
            include_str!("../../assets/default-workflows/daily-news-digest.yaml"),
        ),
        (
            "pdf-summary.yaml",
            include_str!("../../assets/default-workflows/pdf-summary.yaml"),
        ),
    ]
}

pub fn ensure_templates() -> anyhow::Result<usize> {
    let dir = super::store::workflows_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }

    let mut installed = 0;
    for (filename, yaml_str) in builtin_templates() {
        let path = dir.join(filename);
        if !path.exists() {
            let def: WorkflowDef = serde_yaml::from_str(yaml_str)?;
            super::store::save(&def)?;
            installed += 1;
        }
    }
    Ok(installed)
}
