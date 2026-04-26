//! Generic YAML traversal + the `write_channel_yaml_fields` channel
//! editor. Split out of the parent module so the model section in
//! `mod.rs` stays readable.

use std::fs;
use std::io;
use std::path::Path;

use serde_yaml::{Mapping, Value};

use crate::changelog;
use crate::fs_atomic;

use super::config_path;

/// `ipc::channels::walk_dotted`.
pub fn write_channel_yaml_fields(
    root: &str,
    updates: &std::collections::HashMap<String, serde_json::Value>,
    journal_path: Option<&Path>,
) -> io::Result<()> {
    if updates.is_empty() {
        return Ok(());
    }

    let config_path = config_path()?;
    let raw = fs::read_to_string(&config_path).unwrap_or_default();

    let mut doc: Value = if raw.trim().is_empty() {
        Value::Mapping(Mapping::new())
    } else {
        serde_yaml::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    };
    if !matches!(doc, Value::Mapping(_)) {
        doc = Value::Mapping(Mapping::new());
    }

    // Capture before-state for the journal: one mapping keyed by
    // relative path, values serialized to JSON for diff display.
    let mut before = serde_json::Map::new();
    let mut after = serde_json::Map::new();
    for (rel_path, new_val) in updates {
        let full = if root.is_empty() {
            rel_path.clone()
        } else {
            format!("{}.{}", root, rel_path)
        };
        let prev = walk_get(&doc, &full).cloned();
        before.insert(
            rel_path.clone(),
            prev.map(yaml_to_json_value)
                .unwrap_or(serde_json::Value::Null),
        );
        after.insert(rel_path.clone(), new_val.clone());

        let yaml_val = json_to_yaml_value(new_val);
        if matches!(yaml_val, Value::Null) {
            walk_remove(&mut doc, &full);
        } else {
            walk_set(&mut doc, &full, yaml_val);
        }
    }

    let serialized =
        serde_yaml::to_string(&doc).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs_atomic::atomic_write(&config_path, serialized.as_bytes(), None)?;

    if let Some(jp) = journal_path {
        let summary = format!("channel yaml: {} ({} field(s))", root, updates.len());
        let _ = changelog::append(
            jp,
            "hermes.channel.yaml",
            Some(serde_json::json!({ "root": root, "fields": before })),
            Some(serde_json::json!({ "root": root, "fields": after })),
            summary,
        );
    }
    Ok(())
}

pub(super) fn walk_get<'a>(doc: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = doc;
    for seg in path.split('.') {
        cur = cur.as_mapping()?.get(Value::String(seg.into()))?;
    }
    Some(cur)
}

pub(super) fn walk_set(doc: &mut Value, path: &str, value: Value) {
    let segs: Vec<&str> = path.split('.').collect();
    if segs.is_empty() {
        return;
    }
    // Ensure every intermediate level is a mapping.
    let mut cur: &mut Value = doc;
    for seg in &segs[..segs.len() - 1] {
        if !matches!(cur, Value::Mapping(_)) {
            *cur = Value::Mapping(Mapping::new());
        }
        let map = cur.as_mapping_mut().expect("is mapping");
        let key = Value::String((*seg).into());
        if !matches!(map.get(&key), Some(Value::Mapping(_))) {
            map.insert(key.clone(), Value::Mapping(Mapping::new()));
        }
        cur = map.get_mut(&key).expect("just inserted");
    }
    if !matches!(cur, Value::Mapping(_)) {
        *cur = Value::Mapping(Mapping::new());
    }
    let map = cur.as_mapping_mut().expect("is mapping");
    // `segs.last()` is provably `Some` here: the function returns
    // early at the top when `segs.is_empty()`, and split('.') on a
    // non-empty `path` always yields at least one element.
    map.insert(
        Value::String((*segs.last().expect("segs non-empty by guard")).to_string()),
        value,
    );
}

pub(super) fn walk_remove(doc: &mut Value, path: &str) {
    let segs: Vec<&str> = path.split('.').collect();
    if segs.is_empty() {
        return;
    }
    let mut cur = doc;
    for seg in &segs[..segs.len() - 1] {
        let Some(map) = cur.as_mapping_mut() else {
            return;
        };
        let key = Value::String((*seg).into());
        let Some(next) = map.get_mut(&key) else {
            return;
        };
        cur = next;
    }
    if let Some(map) = cur.as_mapping_mut() {
        // Same invariant as `walk_set` above — guarded by the
        // `segs.is_empty()` early-return; never panics.
        map.remove(Value::String(
            segs.last().expect("segs non-empty by guard").to_string(),
        ));
    }
}

/// YAML → JSON (mirror of `ipc::channels::yaml_to_json` but local —
/// avoid a crate-internal import cycle).
pub(super) fn yaml_to_json_value(v: Value) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Bool(b) => serde_json::Value::Bool(b),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                serde_json::Value::from(u)
            } else if let Some(i) = n.as_i64() {
                serde_json::Value::from(i)
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        Value::String(s) => serde_json::Value::String(s),
        Value::Sequence(seq) => {
            serde_json::Value::Array(seq.into_iter().map(yaml_to_json_value).collect())
        }
        Value::Mapping(m) => {
            let mut o = serde_json::Map::new();
            for (k, v) in m {
                if let Value::String(sk) = k {
                    o.insert(sk, yaml_to_json_value(v));
                }
            }
            serde_json::Value::Object(o)
        }
        Value::Tagged(t) => yaml_to_json_value(t.value),
    }
}

/// JSON → YAML. Numbers round-trip via serde_yaml's own conversion
/// so int/float distinction is preserved.
pub(super) fn json_to_yaml_value(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(i.into())
            } else if let Some(u) = n.as_u64() {
                Value::Number(u.into())
            } else if let Some(f) = n.as_f64() {
                Value::Number(f.into())
            } else {
                Value::Null
            }
        }
        serde_json::Value::String(s) => Value::String(s.clone()),
        serde_json::Value::Array(arr) => {
            Value::Sequence(arr.iter().map(json_to_yaml_value).collect())
        }
        serde_json::Value::Object(o) => {
            let mut m = Mapping::new();
            for (k, v) in o {
                m.insert(Value::String(k.clone()), json_to_yaml_value(v));
            }
            Value::Mapping(m)
        }
    }
}
