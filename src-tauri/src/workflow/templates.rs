use super::model::WorkflowDef;

pub fn builtin_templates() -> Vec<(&'static str, &'static str)> {
    vec![
        ("daily-news-digest.yaml", include_str!("templates/daily-news-digest.yaml")),
        ("ai-comic-pipeline.yaml", include_str!("templates/ai-comic-pipeline.yaml")),
        ("code-review-pipeline.yaml", include_str!("templates/code-review-pipeline.yaml")),
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
