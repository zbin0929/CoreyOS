use std::path::PathBuf;

use crate::error::{IpcError, IpcResult};

/// Write a text payload to an absolute path the user just picked from a
/// native save dialog. Used by the export buttons on `/compare` and
/// `/tasks` — the WebView's `<a download>` shortcut silently fails inside
/// Tauri so we route through here instead.
///
/// The path is taken on faith because it came back from the OS save
/// sheet (no traversal vector). We refuse empty input to avoid an
/// accidental `unlink`-via-truncate.
#[tauri::command]
pub async fn save_text_file(path: String, contents: String) -> IpcResult<()> {
    if path.trim().is_empty() {
        return Err(IpcError::Internal {
            message: "save_text_file: path is empty".into(),
        });
    }
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| IpcError::Internal {
            message: format!("create_dir_all({}): {}", parent.display(), e),
        })?;
    }
    std::fs::write(&target, contents.as_bytes()).map_err(|e| IpcError::Internal {
        message: format!("write({}): {}", target.display(), e),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_empty_path() {
        let err = save_text_file(String::new(), "x".into())
            .await
            .expect_err("empty path should be rejected");
        assert!(matches!(err, IpcError::Internal { .. }));
    }

    #[tokio::test]
    async fn writes_text_to_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("out.json");
        save_text_file(path.to_string_lossy().into(), "{\"ok\":true}".into())
            .await
            .expect("write should succeed");
        let read = std::fs::read_to_string(&path).expect("read back");
        assert_eq!(read, "{\"ok\":true}");
    }
}
