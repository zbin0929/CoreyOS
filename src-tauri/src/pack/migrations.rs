use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

use crate::pack::manifest::Migration;

const CONFIG_FILE: &str = "config.json";

pub fn run_migrations(
    pack_data_dir: &Path,
    from_version: &str,
    to_version: &str,
    migrations: &[Migration],
) -> io::Result<()> {
    if migrations.is_empty() || from_version == to_version {
        return Ok(());
    }

    let applicable: Vec<&Migration> = migrations
        .iter()
        .filter(|m| m.from_version == from_version && m.to_version == to_version)
        .collect();
    if applicable.is_empty() {
        return Ok(());
    }

    let config_path = pack_data_dir.join(CONFIG_FILE);
    let mut config: BTreeMap<String, serde_json::Value> = if config_path.exists() {
        let raw = fs::read_to_string(&config_path)?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        BTreeMap::new()
    };

    for m in &applicable {
        for (old_key, new_key) in &m.config_renames {
            if let Some(val) = config.remove(old_key) {
                config.insert(new_key.clone(), val);
            }
        }
        for (key, default) in &m.config_defaults {
            if !config.contains_key(key) {
                let json_val = yaml_to_json_value(default);
                config.insert(key.clone(), json_val);
            }
        }
    }

    let out = serde_json::to_string_pretty(&config)?;
    if let Err(e) = fs::create_dir_all(pack_data_dir) {
        if e.kind() != io::ErrorKind::AlreadyExists {
            return Err(e);
        }
    }
    fs::write(&config_path, out)?;
    Ok(())
}

fn yaml_to_json_value(v: &serde_yaml::Value) -> serde_json::Value {
    match v {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(*b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::from(i)
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s.clone()),
        serde_yaml::Value::Sequence(seq) => {
            serde_json::Value::Array(seq.iter().map(yaml_to_json_value).collect())
        }
        serde_yaml::Value::Mapping(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let Some(ks) = k.as_str() {
                    obj.insert(ks.to_string(), yaml_to_json_value(v));
                }
            }
            serde_json::Value::Object(obj)
        }
        serde_yaml::Value::Tagged(t) => yaml_to_json_value(&t.value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_migrations_renames_and_defaults() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("corey-migration-test-{ts}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");

        let config_path = dir.join(CONFIG_FILE);
        fs::write(&config_path, r#"{"old_key": "val"}"#).expect("write");

        let migrations = vec![Migration {
            from_version: "1.0.0".into(),
            to_version: "1.1.0".into(),
            config_renames: {
                let mut m = BTreeMap::new();
                m.insert("old_key".into(), "new_key".into());
                m
            },
            config_defaults: {
                let mut m = BTreeMap::new();
                m.insert("added".into(), serde_yaml::Value::String("default".into()));
                m
            },
        }];

        run_migrations(&dir, "1.0.0", "1.1.0", &migrations).expect("run");

        let result: BTreeMap<String, serde_json::Value> =
            serde_json::from_str(&fs::read_to_string(&config_path).expect("read")).expect("parse");
        assert!(!result.contains_key("old_key"), "old_key should be renamed");
        assert_eq!(result["new_key"], "val");
        assert_eq!(result["added"], "default");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_migrations_no_op_when_same_version() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("corey-migration-noop-{ts}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");

        let migrations = vec![Migration {
            from_version: "1.0.0".into(),
            to_version: "1.1.0".into(),
            config_renames: BTreeMap::new(),
            config_defaults: BTreeMap::new(),
        }];

        run_migrations(&dir, "1.0.0", "1.0.0", &migrations).expect("run");
        assert!(
            !dir.join(CONFIG_FILE).exists(),
            "no config.json should be created for same version"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
