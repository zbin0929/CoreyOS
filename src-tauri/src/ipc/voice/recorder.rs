//! System-level microphone capture (Phase 8 push-to-talk).
//!
//! `voice_record` opens the default input device via `cpal`, streams
//! samples for up to N seconds (or until `voice_record_stop` flips the
//! flag), and returns a base64-encoded WAV. The recording loop runs on
//! a dedicated thread because `cpal::Stream` is `!Send` and would
//! poison Tokio's executor; the result is shipped back via a oneshot.
//!
//! `pcm_to_wav` lives here too because Zhipu's TTS returns raw PCM
//! that we have to wrap in a WAV header before the frontend `<audio>`
//! tag can play it.

use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::error::{IpcError, IpcResult};

static RECORDING_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn voice_record(duration_secs: Option<u64>) -> IpcResult<String> {
    let secs = duration_secs.unwrap_or(30).min(120);
    RECORDING_ACTIVE.store(true, Ordering::SeqCst);
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let flag = &RECORDING_ACTIVE;

    std::thread::spawn(move || {
        let result = record_audio_blocking(secs, flag);
        let _ = tx.send(result);
    });

    let wav_bytes = rx
        .await
        .map_err(|e| {
            RECORDING_ACTIVE.store(false, Ordering::SeqCst);
            IpcError::Internal {
                message: format!("recording thread panicked: {e}"),
            }
        })?
        .map_err(|msg| {
            RECORDING_ACTIVE.store(false, Ordering::SeqCst);
            IpcError::Internal { message: msg }
        })?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&wav_bytes);
    Ok(b64)
}

#[tauri::command]
pub async fn voice_record_stop() -> IpcResult<()> {
    RECORDING_ACTIVE.store(false, Ordering::SeqCst);
    Ok(())
}

fn record_audio_blocking(secs: u64, active: &AtomicBool) -> Result<Vec<u8>, String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("no_input_device")?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("input_config:{e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as u16;

    let (rec_tx, rec_rx) = std::sync::mpsc::channel();
    let err_tx = rec_tx.clone();

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let samples: Vec<f32> = data.to_vec();
                let _ = rec_tx.send(samples);
            },
            move |err| {
                let _ = err_tx.send(vec![]);
                let _ = std::io::stderr().write_all(format!("audio err: {err}").as_bytes());
            },
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let samples: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                let _ = rec_tx.send(samples);
            },
            move |err| {
                let _ = err_tx.send(vec![]);
                let _ = std::io::stderr().write_all(format!("audio err: {err}").as_bytes());
            },
            None,
        ),
        fmt => return Err(format!("unsupported_format:{fmt}")),
    }
    .map_err(|e| format!("stream_build:{e}"))?;

    stream.play().map_err(|e| format!("stream_play:{e}"))?;

    let start = std::time::Instant::now();
    let mut all_samples: Vec<f32> = Vec::new();
    while active.load(Ordering::SeqCst) && start.elapsed().as_secs() < secs {
        match rec_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(samples) => all_samples.extend_from_slice(&samples),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(stream);
    active.store(false, Ordering::SeqCst);

    if all_samples.is_empty() {
        // On macOS, an empty sample buffer almost always means the
        // user has denied (or never granted) microphone permission to
        // the binary that's currently running. CoreAudio doesn't
        // surface a real error in that case — the input stream just
        // silently delivers zero callbacks. We map that condition to
        // a structured error code so the frontend can render an
        // actionable banner with a one-click "open System Settings"
        // button instead of a generic "no audio captured" toast.
        #[cfg(target_os = "macos")]
        {
            return Err("mic_permission_denied".into());
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err("no_audio_captured".into());
        }
    }

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut wav_buf = std::io::Cursor::new(Vec::new());
    {
        let mut writer =
            hound::WavWriter::new(&mut wav_buf, spec).map_err(|e| format!("wav_writer:{e}"))?;
        for &s in &all_samples {
            let val = (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32);
            writer
                .write_sample(val as i16)
                .map_err(|e| format!("wav_write:{e}"))?;
        }
        writer.finalize().map_err(|e| format!("wav_finalize:{e}"))?;
    }

    Ok(wav_buf.into_inner())
}

/// Open the macOS System Settings panel pinned to **Privacy &
/// Security → Microphone** so the user can grant the running
/// process mic access without hunting through System Settings.
///
/// We `spawn` rather than `output()` because `open` on macOS exits
/// asynchronously after the panel is on screen — waiting for it
/// would block the IPC for ~1s with no benefit. On non-macOS
/// platforms this returns an unsupported-platform error rather
/// than guessing at a Linux/Windows equivalent.
#[tauri::command]
pub async fn voice_open_mic_settings() -> IpcResult<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| IpcError::Internal {
                message: format!("failed to open System Settings: {e}"),
            })?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(IpcError::Internal {
            message: "voice_open_mic_settings is only implemented on macOS".into(),
        })
    }
}

/// Open + immediately close a short input stream so the macOS
/// permission dialog gets triggered *now* (when the Talk overlay
/// opens) rather than on the user's first PTT press, when they
/// would already be holding the button down expecting audio to
/// flow. Result: no `mic_permission_denied` race on first use.
///
/// Returns `granted` if cpal could open + receive at least one
/// callback within ~250ms, `denied` otherwise. The frontend uses
/// the result to show the recovery banner up-front when needed.
#[tauri::command]
pub async fn voice_warmup_mic() -> IpcResult<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    std::thread::spawn(move || {
        let _ = tx.send(warmup_mic_blocking());
    });
    match rx.await {
        Ok(true) => Ok("granted".into()),
        // Either the warmup thread panicked (rx error) or got 0
        // samples (returned false). Both surface to the user as
        // "please grant mic access" — there's no path forward
        // without it.
        _ => Ok("denied".into()),
    }
}

fn warmup_mic_blocking() -> bool {
    let host = cpal::default_host();
    let Some(device) = host.default_input_device() else {
        return false;
    };
    let Ok(config) = device.default_input_config() else {
        return false;
    };
    let (sample_tx, sample_rx) = std::sync::mpsc::channel::<()>();
    let stream_result = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |_data: &[f32], _: &cpal::InputCallbackInfo| {
                let _ = sample_tx.send(());
            },
            |_| {},
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |_data: &[i16], _: &cpal::InputCallbackInfo| {
                let _ = sample_tx.send(());
            },
            |_| {},
            None,
        ),
        _ => return false,
    };
    let Ok(stream) = stream_result else {
        return false;
    };
    if stream.play().is_err() {
        return false;
    }
    // Wait up to 500ms for one callback. macOS will pop the
    // permission dialog the first time we get here on a fresh
    // binary; even a denied response delivers no callbacks within
    // this window (we'll report `denied` and the frontend will
    // show the banner).
    let got_sample = sample_rx
        .recv_timeout(std::time::Duration::from_millis(500))
        .is_ok();
    drop(stream);
    got_sample
}

/// Native WAV playback (macOS `afplay`, Linux `aplay`, Windows
/// `powershell` Media.SoundPlayer). Used by Talk Mode v1 as a
/// fallback when WebView's `<audio>` + `data:` URL silently fails
/// — most reliably reproduced on Tauri 2 + macOS 14+ where the
/// renderer process audio output gets routed to a sandboxed sink
/// the user's speakers don't see, even though `audio.play()`
/// reports success and `ended` fires on schedule.
///
/// **The IPC blocks until playback finishes.** This is the
/// difference vs. the old fire-and-forget version: serialising
/// sentences in Talk Mode now boils down to "await this IPC,
/// then kick off the next" — we're guaranteed audio has finished
/// before the next clip enters the player. That fixes the bug
/// where a heuristic `setTimeout(estimatedMs)` fence on the
/// frontend under-shot real playback duration and the next
/// sentence's `voice_play_wav_native` would `kill_current_playback`
/// the still-playing previous clip mid-utterance.
///
/// Cancellation lives via a per-call `CancellationToken` parked
/// in `CURRENT_PLAYBACK`. `voice_play_stop` cancels the active
/// token, the playback `select!` arm catches it, sends SIGTERM
/// to the player, and returns — barge-in stays sub-100ms.
static CURRENT_PLAYBACK: once_cell::sync::Lazy<
    std::sync::Mutex<Option<tokio_util::sync::CancellationToken>>,
> = once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

/// RAII guard for the per-playback tempfile. Removing the WAV
/// happens in `Drop` so every code path — happy, error, panic,
/// cancellation — cleans up. Without this, a `?`-bail between
/// "wrote bytes to disk" and "afplay finished" would leak the
/// file into `/tmp/` until the OS swept it (macOS does at boot,
/// Linux on /tmp tmpfs flushes at reboot, Windows %TEMP% doesn't
/// at all).
struct TempWav(std::path::PathBuf);

impl TempWav {
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempWav {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// One-shot sweep at module init: remove any leftover
/// `corey-tts-*.wav` and `corey-say-*.wav` from `/tmp`. Catches
/// the case where a previous session was hard-killed (SIGKILL,
/// app crash, OS shutdown) before the RAII guards could run.
/// Bounded to files older than 60 seconds so we never delete
/// a file an in-flight peer process is using.
fn sweep_stale_tempfiles_once() {
    static SWEPT: std::sync::Once = std::sync::Once::new();
    SWEPT.call_once(|| {
        let tmp = std::env::temp_dir();
        let entries = match std::fs::read_dir(&tmp) {
            Ok(e) => e,
            Err(_) => return,
        };
        let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        let mut removed = 0usize;
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            let stale_prefix =
                name_str.starts_with("corey-tts-") || name_str.starts_with("corey-say-");
            if !stale_prefix || !name_str.ends_with(".wav") {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                let Ok(modified) = meta.modified() else {
                    continue;
                };
                if modified < cutoff && std::fs::remove_file(entry.path()).is_ok() {
                    removed += 1;
                }
            }
        }
        if removed > 0 {
            tracing::info!(
                target: "voice.playback",
                removed,
                "swept stale corey-tts/corey-say wav tempfiles from {}",
                tmp.display()
            );
        }
    });
}

#[tauri::command]
pub async fn voice_play_wav_native(audio_base64: String) -> IpcResult<()> {
    sweep_stale_tempfiles_once();
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| IpcError::Internal {
            message: format!("base64 decode: {e}"),
        })?;

    let mut tmp_path = std::env::temp_dir();
    tmp_path.push(format!("corey-tts-{}.wav", uuid::Uuid::new_v4()));
    std::fs::write(&tmp_path, &bytes).map_err(|e| IpcError::Internal {
        message: format!("write temp wav: {e}"),
    })?;
    // RAII guard: dropped at function exit (any branch) → file
    // is removed even if afplay panics or `?` short-circuits.
    let tmp = TempWav(tmp_path);

    // Cancel any *previous* playback before starting this one —
    // Talk Mode is mono-stream by design. Each call swaps in a
    // fresh CancellationToken; the previous IPC, if still in its
    // wait `select!`, sees the cancel and tears down its child.
    let cancel = tokio_util::sync::CancellationToken::new();
    if let Ok(mut guard) = CURRENT_PLAYBACK.lock() {
        if let Some(prev) = guard.take() {
            prev.cancel();
        }
        *guard = Some(cancel.clone());
    }

    // Spawn via tokio so we can `select!` between the natural
    // wait and the cancel token in the same async runtime.
    #[cfg(target_os = "macos")]
    let child = tokio::process::Command::new("afplay")
        .arg(tmp.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn();
    #[cfg(target_os = "linux")]
    let child = tokio::process::Command::new("aplay")
        .arg(tmp.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn();
    #[cfg(target_os = "windows")]
    let child = tokio::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "(New-Object Media.SoundPlayer '{}').PlaySync()",
                tmp.path().display()
            ),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn();

    let mut child = child.map_err(|e| IpcError::Internal {
        message: format!("spawn audio player: {e}"),
    })?;

    let pid = child.id().unwrap_or(0);
    let wav_size = bytes.len();
    tracing::info!(
        target: "voice.playback",
        pid, wav_size,
        tmp = %tmp.path().display(),
        "native playback started"
    );

    // Block until playback finishes naturally OR a barge-in
    // cancels us. Tracing logs distinguish the two cases so the
    // user-visible Logs page makes silent failures debuggable.
    tokio::select! {
        _ = cancel.cancelled() => {
            // Barge-in / next sentence requested. SIGTERM the
            // player and return — we don't wait for the kill
            // to fully reap because the natural-wait branch
            // would have a small race with the spawn_blocking
            // reaper otherwise. start_kill is idempotent.
            let _ = child.start_kill();
            // Give the OS ~50ms to reap so the next playback
            // doesn't fight the same audio device.
            let _ = tokio::time::timeout(
                std::time::Duration::from_millis(200),
                child.wait(),
            ).await;
            tracing::info!(
                target: "voice.playback",
                pid,
                "native playback cancelled (barge-in)"
            );
        }
        result = child.wait() => {
            match result {
                Ok(status) if status.success() => {
                    tracing::info!(
                        target: "voice.playback",
                        pid,
                        "native playback ended OK"
                    );
                }
                Ok(status) => {
                    let stderr = read_stderr_quietly(&mut child).await;
                    tracing::warn!(
                        target: "voice.playback",
                        pid,
                        status = ?status.code(),
                        stderr = %stderr,
                        "native playback exited non-zero"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        target: "voice.playback",
                        pid,
                        error = %e,
                        "native playback wait failed"
                    );
                }
            }
        }
    }

    // We don't try to "clear our slot if still ours" here — a
    // newer playback would already have swapped the token by
    // the time we got here, and clearing a slot we don't own
    // would race with that newer playback. Leaving stale tokens
    // in the slot is harmless because (a) `voice_play_stop`
    // cancelling a token whose owner has already exited is a
    // no-op, and (b) the next call always swap-and-cancels
    // before installing its own. Memory cost is one Arc<inner>
    // per session at worst.

    // Tempfile removed by `tmp`'s Drop impl when this scope ends.
    Ok(())
}

/// Best-effort stderr drain. Used only when the player exited
/// non-zero so we don't pay a thread for the success path.
async fn read_stderr_quietly(child: &mut tokio::process::Child) -> String {
    use tokio::io::AsyncReadExt as _;
    if let Some(mut stderr) = child.stderr.take() {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf.lines().next().unwrap_or("").to_string()
    } else {
        String::new()
    }
}

#[tauri::command]
pub async fn voice_play_stop() -> IpcResult<()> {
    if let Ok(guard) = CURRENT_PLAYBACK.lock() {
        if let Some(token) = guard.as_ref() {
            token.cancel();
        }
    }
    Ok(())
}

/// Wrap raw 16-bit PCM @ 24 kHz mono in a WAV header. Used by the
/// Zhipu TTS path which returns headerless PCM.
pub(super) fn pcm_to_wav(raw: &[u8]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut writer =
            hound::WavWriter::new(&mut buf, spec).map_err(|e| format!("pcm_to_wav write: {e}"))?;
        for chunk in raw.chunks(2) {
            let lo = chunk[0] as u16;
            let hi = if chunk.len() > 1 { chunk[1] as u16 } else { 0 };
            let sample = ((hi << 8) | lo) as i16;
            writer
                .write_sample(sample)
                .map_err(|e| format!("pcm_to_wav sample: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("pcm_to_wav finalize: {e}"))?;
    }
    Ok(buf.into_inner())
}
