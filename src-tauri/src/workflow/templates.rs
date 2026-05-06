use super::model::WorkflowDef;

/// Bundled workflow templates seeded into `~/.hermes/workflows/` on
/// first boot via `ensure_templates`. Existing files are NEVER
/// overwritten — `ensure_templates` only adds files that are missing.
///
/// ## v10 audit (2026-05-06)
///
/// The single remaining base-image demo (`ecommerce-promotion-approval`)
/// has moved into the `corey_starter` default Pack so the base binary
/// ships with **no** workflow templates. New users see workflows only
/// after they enable the Pack (or import their own), which keeps the
/// "what is a workflow" surface to one place.
///
/// Re-add demos here only when there's a workflow primitive that
/// MUST exist before any Pack is loaded (extremely rare). The default
/// path is to ship demos in a Pack instead.
pub fn builtin_templates() -> Vec<(&'static str, &'static str)> {
    Vec::new()
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
