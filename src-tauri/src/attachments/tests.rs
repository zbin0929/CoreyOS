use super::*;
use std::sync::Mutex;

// Tests mutate $HOME; serialise via the crate-wide HOME_LOCK.
static LOCAL_LOCK: Mutex<()> = Mutex::new(());

struct HomeGuard {
    _local: std::sync::MutexGuard<'static, ()>,
    _crate: std::sync::MutexGuard<'static, ()>,
    prev_home: Option<std::ffi::OsString>,
    prev_userprofile: Option<std::ffi::OsString>,
}
impl HomeGuard {
    fn new(home: &Path) -> Self {
        let local = LOCAL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let c = crate::skills::HOME_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let prev_home = std::env::var_os("HOME");
        let prev_userprofile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", home);
        std::env::set_var("USERPROFILE", home);
        Self {
            _local: local,
            _crate: c,
            prev_home,
            prev_userprofile,
        }
    }
}
impl Drop for HomeGuard {
    fn drop(&mut self) {
        match self.prev_home.take() {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        match self.prev_userprofile.take() {
            Some(v) => std::env::set_var("USERPROFILE", v),
            None => std::env::remove_var("USERPROFILE"),
        }
    }
}

fn tmp_home() -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "caduceus-attachments-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn stage_blob_writes_bytes_and_returns_matching_metadata() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);

    let body = b"hello world";
    let b64 = base64::engine::general_purpose::STANDARD.encode(body);
    let att = stage_blob("hi.txt", "text/plain", &b64).unwrap();

    assert_eq!(att.name, "hi.txt");
    assert_eq!(att.mime, "text/plain");
    assert_eq!(att.size, body.len() as i64);
    let on_disk = std::fs::read(&att.path).unwrap();
    assert_eq!(on_disk, body);
    // On-disk filename uses the id + ext — not the display name.
    let fname = Path::new(&att.path).file_name().unwrap().to_str().unwrap();
    assert!(fname.ends_with(".txt"));
    assert!(fname.starts_with(&att.id));
}

#[test]
fn stage_blob_rejects_oversize() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    // MAX_BLOB_BYTES + 1 decoded; pad the base64 accordingly.
    let huge = vec![0u8; MAX_BLOB_BYTES + 1];
    let b64 = base64::engine::general_purpose::STANDARD.encode(&huge);
    let err = stage_blob("big.bin", "application/octet-stream", &b64).unwrap_err();
    assert!(err.to_string().contains("too large"), "got: {err}");
}

#[test]
fn stage_blob_rejects_invalid_base64() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    let err = stage_blob("x.png", "image/png", "not_base64!!!!").unwrap_err();
    assert!(err.to_string().contains("base64"), "got: {err}");
}

#[test]
fn stage_path_copies_file_and_guesses_mime() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    // Source outside of attachments dir.
    let src_dir = std::env::temp_dir().join(format!("caduceus-attach-src-{}", std::process::id()));
    std::fs::create_dir_all(&src_dir).unwrap();
    let src = src_dir.join("cat.png");
    std::fs::write(&src, b"\x89PNG\r\n\x1a\nfake").unwrap();

    let att = stage_path(&src, None).unwrap();
    assert_eq!(att.name, "cat.png");
    assert_eq!(att.mime, "image/png");
    // File is a COPY — original still intact.
    assert!(src.is_file());
    assert!(Path::new(&att.path).is_file());
}

#[test]
fn stage_path_rejects_directory_and_missing() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    let missing = home.join("does-not-exist.png");
    assert!(stage_path(&missing, None).is_err());
    // Use home itself as a "directory" target.
    assert!(stage_path(&home, None).is_err());
}

#[test]
fn delete_is_idempotent_and_path_sandboxed() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    let b64 = base64::engine::general_purpose::STANDARD.encode(b"x");
    let att = stage_blob("x.txt", "text/plain", &b64).unwrap();

    delete(&att.path).unwrap();
    assert!(!Path::new(&att.path).exists());
    // Second delete is a no-op, not an error.
    delete(&att.path).unwrap();

    // Paths outside the attachments dir are rejected.
    let outside = home.join("evil.txt");
    std::fs::write(&outside, b"bad").unwrap();
    let err = delete(outside.to_str().unwrap()).unwrap_err();
    assert!(err.to_string().contains("refusing"), "got: {err}");
    assert!(
        outside.exists(),
        "delete() must not touch files outside the dir"
    );
}

// T1.5d — preview

#[test]
fn preview_returns_data_url_for_image() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    let bytes = b"\x89PNG\r\n\x1a\nfake-body";
    let b64_body = base64::engine::general_purpose::STANDARD.encode(bytes);
    let att = stage_blob("pic.png", "image/png", &b64_body).unwrap();

    let url = read_as_data_url(&att.path, Some("image/png")).unwrap();
    assert!(url.starts_with("data:image/png;base64,"));
    let comma = url.find(',').unwrap();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&url[comma + 1..])
        .unwrap();
    assert_eq!(decoded, bytes);
}

#[test]
fn preview_rejects_non_image_mime() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    let b64 = base64::engine::general_purpose::STANDARD.encode(b"PDF-bytes");
    let att = stage_blob("doc.pdf", "application/pdf", &b64).unwrap();
    let err = read_as_data_url(&att.path, Some("application/pdf")).unwrap_err();
    assert!(err.to_string().contains("image/"), "got: {err}");
}

#[test]
fn preview_rejects_outside_sandbox() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    let outside = home.join("sneaky.png");
    std::fs::write(&outside, b"bytes").unwrap();
    let err = read_as_data_url(outside.to_str().unwrap(), Some("image/png")).unwrap_err();
    assert!(err.to_string().contains("refusing"), "got: {err}");
}

#[test]
fn preview_falls_back_to_guessed_mime_when_hint_blank() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    // guess_mime() keys off the display name — stage needs a .png
    // name so the extension-based guess returns image/png even when
    // we pass an empty hint.
    let b64 = base64::engine::general_purpose::STANDARD.encode(b"bytes");
    let att = stage_blob("auto.png", "image/png", &b64).unwrap();
    let url = read_as_data_url(&att.path, Some("")).unwrap();
    assert!(url.starts_with("data:image/png;base64,"));
}

// T1.5e — GC

#[test]
fn gc_removes_orphans_and_keeps_live() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);

    let b64 = base64::engine::general_purpose::STANDARD.encode(b"live");
    let live = stage_blob("live.txt", "text/plain", &b64).unwrap();
    let orphan = stage_blob("orphan.txt", "text/plain", &b64).unwrap();

    let mut set = std::collections::HashSet::new();
    set.insert(PathBuf::from(&live.path));

    let report = gc_orphans(&set).unwrap();
    assert_eq!(report.removed_count, 1);
    assert_eq!(report.removed_bytes, b"live".len() as u64);
    assert!(report.failed.is_empty());
    assert!(Path::new(&live.path).exists(), "live file must survive");
    assert!(
        !Path::new(&orphan.path).exists(),
        "orphan file must be swept"
    );
}

#[test]
fn gc_empty_dir_is_noop() {
    let home = tmp_home();
    let _g = HomeGuard::new(&home);
    // Dir may not even exist yet.
    let report = gc_orphans(&std::collections::HashSet::new()).unwrap();
    assert_eq!(report.removed_count, 0);
    assert!(report.failed.is_empty());
}

#[test]
fn validate_name_rejects_separators() {
    assert!(validate_name("").is_err());
    assert!(validate_name("ok.txt").is_ok());
    assert!(validate_name("../evil.txt").is_err());
    assert!(validate_name("sub/dir.txt").is_err());
    assert!(validate_name("win\\path.txt").is_err());
}
