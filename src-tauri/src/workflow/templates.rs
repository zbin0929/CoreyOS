use super::model::WorkflowDef;

/// Bundled workflow templates seeded into `~/.hermes/workflows/` on
/// first boot via `ensure_templates`. Existing files are NEVER
/// overwritten — `ensure_templates` only adds files that are missing.
///
/// ## v9 audit (2026-04-27)
///
/// The previous bundle had six demos
/// (ups-tracking / daily-news-digest / douyin-hot-videos /
///  competitor-price-monitor / code-review-pipeline / ai-comic-pipeline)
/// that were all "chains of agent calls" Hermes can do natively
/// through chat — they advertised the wrong differentiator. See
/// `docs/agent/workflow-positioning.md` for the full reasoning.
///
/// They've been replaced by a single demo
/// (`ecommerce-promotion-approval`) that exercises the four real
/// reasons workflow exists as a separate primitive from chat:
/// schema-locked outputs, a human-approval gate, full audit log,
/// and strict step ordering.
///
/// Re-add demos here only if they materially demonstrate at least
/// one of those four capabilities. PRs that re-introduce
/// "linear-chain-of-prompts" demos should be rejected with a
/// pointer to the positioning doc.
pub fn builtin_templates() -> Vec<(&'static str, &'static str)> {
    vec![(
        "ecommerce-promotion-approval.yaml",
        include_str!("templates/ecommerce-promotion-approval.yaml"),
    )]
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
