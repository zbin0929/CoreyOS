//! Phase 4 · T4.5 — PTY registry.
//!
//! One `Pty` per frontend terminal tab. The frontend hands us a
//! caller-generated id (a uuid string), we spawn the user's login shell
//! under a pty, and relay stdout bytes on `pty:data:<id>` tauri events.
//! Writes go the other way via `Pty::write`.
//!
//! We keep this deliberately small:
//!
//! - No shell portability magic: we honor $SHELL on Unix, `ComSpec` on
//!   Windows, and fall back to `/bin/sh` / `cmd.exe`.
//! - No scrollback buffer on the backend. xterm.js holds scrollback;
//!   reconnecting isn't supported — a kill tears the tab down.
//! - Reads run on a blocking OS thread (portable-pty's reader is
//!   std::io::Read). We push bytes over a tokio mpsc into a tokio task
//!   that emits the Tauri event.

use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{CommandBuilder, PtyPair, PtySize};

/// Owner of a single pty + the child process it wraps. Not Send across
/// threads for the underlying handles — we lock around writes and keep
/// the reader on its own thread.
pub struct Pty {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

impl Pty {
    /// Write user keystrokes into the pty. Returns the number of bytes
    /// actually written (portable-pty's writer will happily accept all
    /// of `bytes` on every platform we care about).
    pub fn write(&self, bytes: &[u8]) -> std::io::Result<usize> {
        self.writer.lock().write(bytes)
    }

    pub fn resize(&self, rows: u16, cols: u16) -> anyhow::Result<()> {
        self.master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow::anyhow!("resize failed: {e}"))
    }

    pub fn kill(&self) -> anyhow::Result<()> {
        self.child
            .lock()
            .kill()
            .map_err(|e| anyhow::anyhow!("kill failed: {e}"))
    }
}

/// Spawn a pty running the user's default shell and start a reader
/// thread that pushes stdout bytes into `on_data`. Returns an `Arc<Pty>`
/// the caller can store for writes/resizes/kills.
pub fn spawn(
    rows: u16,
    cols: u16,
    on_data: impl Fn(Vec<u8>) + Send + 'static,
) -> anyhow::Result<Arc<Pty>> {
    let pty_system = portable_pty::native_pty_system();
    let PtyPair { master, slave } = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| anyhow::anyhow!("openpty failed: {e}"))?;

    let shell = default_shell();
    let cmd = CommandBuilder::new(&shell);
    let child = slave
        .spawn_command(cmd)
        .map_err(|e| anyhow::anyhow!("spawn {shell} failed: {e}"))?;
    // Drop the slave fd in the parent — only the child should hold it.
    drop(slave);

    let writer = master
        .take_writer()
        .map_err(|e| anyhow::anyhow!("take_writer failed: {e}"))?;
    let reader = master
        .try_clone_reader()
        .map_err(|e| anyhow::anyhow!("clone_reader failed: {e}"))?;

    let pty = Arc::new(Pty {
        writer: Mutex::new(writer),
        master: Mutex::new(master),
        child: Mutex::new(child),
    });

    // Reader runs on its own OS thread — portable-pty's Read is blocking.
    std::thread::spawn(move || {
        let mut r = reader;
        let mut buf = [0u8; 4096];
        loop {
            match r.read(&mut buf) {
                Ok(0) => break, // EOF: child exited
                Ok(n) => on_data(buf[..n].to_vec()),
                Err(e) => {
                    tracing::debug!(error = %e, "pty reader exiting");
                    break;
                }
            }
        }
    });

    Ok(pty)
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

// Unix-only: Windows `cmd.exe` echoes `echo caduceus-pty-hi\r`
// differently (the command itself is printed verbatim along with a
// prompt line) and the timing of its output stream isn't predictable
// enough to assert a marker round-trip without flakes. The spawn /
// write / resize / kill wiring is still exercised on Windows through
// Tauri E2E harnesses at integration time.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn spawn_write_read_round_trip() {
        // Skip in CI containers that don't allocate a pty.
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let pty = match spawn(24, 80, move |bytes| {
            let _ = tx.send(bytes);
        }) {
            Ok(p) => p,
            Err(_) => return, // environment without pty — skip.
        };

        // Give the shell a moment to print its banner, then echo a marker.
        std::thread::sleep(Duration::from_millis(200));
        pty.write(b"echo caduceus-pty-hi\r").unwrap();

        // Drain up to 2s of output looking for our marker.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut buf = Vec::new();
        while std::time::Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
                buf.extend(chunk);
                if String::from_utf8_lossy(&buf).contains("caduceus-pty-hi") {
                    pty.kill().ok();
                    return;
                }
            }
        }
        pty.kill().ok();
        panic!(
            "marker not seen in output: {:?}",
            String::from_utf8_lossy(&buf)
        );
    }
}
