use std::fs;
use std::io::{self, Write};
use std::path::Path;

use zip::write::SimpleFileOptions;

const BACKUPS_DIR: &str = "backups";
const MAX_BACKUP_AGE_DAYS: u64 = 7;

pub fn backup_pack(hermes_dir: &Path, pack_id: &str) -> io::Result<()> {
    let src = hermes_dir.join("skill-packs").join(pack_id);
    if !src.is_dir() {
        return Ok(());
    }
    let backups_dir = hermes_dir.join(BACKUPS_DIR);
    fs::create_dir_all(&backups_dir)?;

    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dst = backups_dir.join(format!("{pack_id}-{ts}.zip"));

    let file = fs::File::create(&dst)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    append_dir_recursive(&mut zip, &src, pack_id, &options)?;
    zip.finish()?;

    prune_old_backups(&backups_dir, pack_id)?;
    Ok(())
}

fn append_dir_recursive(
    zip: &mut zip::ZipWriter<fs::File>,
    base: &Path,
    prefix: &str,
    options: &SimpleFileOptions,
) -> io::Result<()> {
    let entries = fs::read_dir(base)?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let zip_path = format!("{prefix}/{name_str}");
        let ft = entry.file_type()?;
        if ft.is_dir() {
            zip.add_directory(&zip_path, *options)?;
            append_dir_recursive(zip, &entry.path(), &zip_path, options)?;
        } else if ft.is_file() {
            let data = fs::read(entry.path())?;
            zip.start_file(&zip_path, *options)?;
            zip.write_all(&data)?;
        }
    }
    Ok(())
}

fn prune_old_backups(backups_dir: &Path, pack_id: &str) -> io::Result<()> {
    let cutoff = chrono::Local::now() - chrono::Duration::days(MAX_BACKUP_AGE_DAYS as i64);
    let cutoff_ts = cutoff.format("%Y%m%d").to_string();
    let prefix = format!("{pack_id}-");

    let entries = fs::read_dir(backups_dir)?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.starts_with(&prefix) || !name_str.ends_with(".zip") {
            continue;
        }
        let date_part = &name_str[prefix.len()..prefix.len() + 8];
        if date_part < cutoff_ts.as_str() {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn backup_pack_creates_zip() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("corey-backup-test-{ts}"));
        let _ = fs::remove_dir_all(&dir);
        let pack_dir = dir.join("skill-packs").join("test-pack");
        fs::create_dir_all(pack_dir.join("mcp")).expect("mkdir");
        fs::write(pack_dir.join("manifest.yaml"), "schema_version: 1").expect("write");
        fs::write(pack_dir.join("mcp").join("run.sh"), "#!/bin/sh").expect("write");

        backup_pack(&dir, "test-pack").expect("backup");

        let backups = dir.join("backups");
        let entries: Vec<_> = fs::read_dir(&backups).expect("read").flatten().collect();
        assert_eq!(entries.len(), 1);
        let name = entries[0].file_name().to_string_lossy().to_string();
        assert!(name.starts_with("test-pack-"));
        assert!(name.ends_with(".zip"));

        let _ = fs::remove_dir_all(&dir);
    }
}
