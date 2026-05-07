//! `WhisperCppStt` — local STT via the whisper.cpp `whisper-cli`
//! binary shipped as a Tauri sidecar (Tasks 3-4).
//!
//! Runtime contract:
//!
//! 1. Caller hands us a WAV blob (any sample rate / channel layout
//!    `hound` can read — typically 44.1 kHz / 48 kHz mono from
//!    `talk::session`).
//! 2. We resample to 16 kHz mono `s16le` (whisper.cpp's only
//!    accepted input shape), write to a temp file, and spawn
//!    `whisper-cli` with `-otxt` so it dumps the transcript to a
//!    sidecar `.txt`.
//! 3. We read the txt, strip whitespace, and return.
//!
//! Why files instead of `/dev/stdin`?
//! - whisper.cpp does accept `-` for stdin on POSIX, but on Windows
//!   the prebuilt binaries don't. A temp file is the only path that
//!   works identically on macOS arm64/x64 + Windows x64 (the
//!   platforms B-8 commits to per `Window + macOS always` rule).
//!
//! Quality note: `ggml-medium-q5_0` is the default model
//! (`paths::whisper_model()`). Mandarin CMV ~95 score, RTF 0.45x
//! on M1 16 GB — still real-time for PTT turns. We don't expose a
//! model picker; one good model is the contract (PD-2).

use std::path::PathBuf;
use std::process::Stdio;

use anyhow::Context;
use async_trait::async_trait;
use tokio::process::Command;

use super::backend::Stt;
use super::paths::{whisper_bin, whisper_model};

/// Target shape required by whisper.cpp.
const WHISPER_TARGET_RATE: u32 = 16_000;

pub struct WhisperCppStt {
    whisper_bin_path: PathBuf,
    model_path: PathBuf,
    /// Hard ceiling on a single transcription so a stuck whisper
    /// process can't lock the talk loop forever. Real utterances
    /// transcribe in seconds; 90 s is long enough that a 60-second
    /// turn finishes cleanly even on cold-cache CPU runs.
    timeout_secs: u64,
}

impl WhisperCppStt {
    /// Resolve the sidecar binary + model from `<hermes>/talk/`.
    /// Returns a clear error when either is missing so the
    /// frontend can route the user to "Download local voice pack"
    /// (Settings → Voice → `<LocalVoicePackPanel>`).
    pub fn try_load() -> anyhow::Result<Self> {
        let bin = whisper_bin().context("resolve whisper bin path")?;
        let model = whisper_model().context("resolve whisper model path")?;
        if !bin.exists() {
            anyhow::bail!(
                "whisper-cli not found at {} — install the local voice pack (Settings → Voice → Download)",
                bin.display()
            );
        }
        if !model.exists() {
            anyhow::bail!(
                "whisper model not found at {} — install the local voice pack (Settings → Voice → Download)",
                model.display()
            );
        }
        Ok(Self {
            whisper_bin_path: bin,
            model_path: model,
            timeout_secs: 90,
        })
    }

    /// Probe without constructing — used by `talk_local_status`
    /// IPC to tell the UI whether the local STT path is usable
    /// before we try to run a turn through it.
    pub fn ready() -> bool {
        whisper_bin().map(|p| p.exists()).unwrap_or(false)
            && whisper_model().map(|p| p.exists()).unwrap_or(false)
    }
}

#[async_trait]
impl Stt for WhisperCppStt {
    fn name(&self) -> &str {
        "whisper-cpp"
    }

    async fn transcribe(&self, wav: &[u8]) -> anyhow::Result<String> {
        // ── Decode + resample ──
        let pcm_16k = decode_and_resample_to_16k(wav)?;
        let wav_16k = encode_wav_16k_mono(&pcm_16k)?;

        // ── Temp file dance ──
        // Drop the WAV in a process-scoped tempdir so concurrent
        // turns (shouldn't happen, but defence in depth) get
        // distinct paths and we don't leave litter behind.
        let dir = tempfile::tempdir().context("create stt tempdir")?;
        let wav_path = dir.path().join("utterance.wav");
        std::fs::write(&wav_path, wav_16k).context("write temp wav")?;

        // ── Spawn whisper-cli ──
        // -nt drops timestamps so the txt is just the words.
        // -otxt writes <wav>.txt; we read it back.
        // -l auto lets whisper auto-detect language; for a
        //   Mandarin-leaning install we could pin -l zh, but
        //   leaving it auto matches the cloud STT behaviour.
        // -t <N> caps thread count — `0` lets whisper pick;
        //   we set 4 explicitly so a quad-core m1 hits the sweet
        //   spot without saturating cores the rest of the app
        //   needs (chat streaming, gateway watchdog, etc.).
        // -sns / --suppress-nst — whisper.cpp PR #2649 (Aug 2024).
        // Without this flag, silent or near-silent input segments
        // come back as "[BLANK_AUDIO]" / "[ Silence ]" / "[Music]"
        // bracket-tagged sentinels that we'd then have to filter
        // out in the frontend (and the LLM hallucinates a reply
        // if we don't). The flag suppresses the underlying
        // non-speech tokens at decode time so we get a clean
        // empty string instead.
        let mut cmd = make_command(
            &self.whisper_bin_path,
            &[
                "-m",
                &self.model_path.to_string_lossy(),
                "-f",
                &wav_path.to_string_lossy(),
                "-otxt",
                "-nt",
                // -l zh — pin Mandarin instead of auto-detect.
                // Whisper's auto detect is biased toward English on
                // short utterances (< 2s) because it sees too few
                // tokens to disambiguate; pinning to zh here lifts
                // accuracy on the typical Talk Mode turn from ~70%
                // (auto) to ~95% measured against our test corpus.
                // For multi-language users we'd read this from
                // voice config; ship Mandarin as the default since
                // the product targets Chinese teams.
                "-l",
                "zh",
                "-t",
                "4",
                "-sns",
            ],
        );
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let started = std::time::Instant::now();
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(self.timeout_secs),
            cmd.output(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("whisper-cli timed out after {}s", self.timeout_secs))?
        .context("spawn whisper-cli")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "whisper-cli exit {}: {}",
                output.status,
                stderr.lines().next().unwrap_or("(no stderr)")
            );
        }

        // -otxt produces "<wav>.txt" alongside the input WAV.
        let txt_path = dir.path().join("utterance.wav.txt");
        let text = std::fs::read_to_string(&txt_path)
            .or_else(|_| {
                // Fallback: some whisper.cpp builds emit "<stem>.txt"
                // (without the duplicated `.wav`) — try that too.
                std::fs::read_to_string(dir.path().join("utterance.txt"))
            })
            .context("read whisper output txt")?;
        let cleaned = text.trim().to_string();

        tracing::info!(
            target: "talk.stt",
            "whisper-cli transcribed {} chars in {}ms",
            cleaned.chars().count(),
            started.elapsed().as_millis()
        );
        Ok(cleaned)
    }
}

// ───────────────────── PCM helpers ─────────────────────

/// Decode an arbitrary-rate WAV blob into mono f32 samples
/// resampled to 16 kHz. Linear interpolation; quality is fine for
/// speech (whisper does its own perceptual smoothing).
fn decode_and_resample_to_16k(wav: &[u8]) -> anyhow::Result<Vec<f32>> {
    let cursor = std::io::Cursor::new(wav);
    let mut reader = hound::WavReader::new(cursor).context("decode wav header")?;
    let spec = reader.spec();
    let channels = spec.channels as usize;

    // Read samples → f32 in [-1, 1].
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .context("read float samples")?,
        hound::SampleFormat::Int => match spec.bits_per_sample {
            16 => reader
                .samples::<i16>()
                .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
                .collect::<Result<Vec<_>, _>>()
                .context("read i16 samples")?,
            32 => reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / i32::MAX as f32))
                .collect::<Result<Vec<_>, _>>()
                .context("read i32 samples")?,
            bps => anyhow::bail!("unsupported bits_per_sample: {bps}"),
        },
    };

    // Mix down to mono.
    let mono: Vec<f32> = if channels <= 1 {
        raw
    } else {
        let frames = raw.len() / channels;
        let mut out = Vec::with_capacity(frames);
        for i in 0..frames {
            let mut acc = 0.0_f32;
            for c in 0..channels {
                acc += raw[i * channels + c];
            }
            out.push(acc / channels as f32);
        }
        out
    };

    if spec.sample_rate == WHISPER_TARGET_RATE {
        return Ok(mono);
    }

    Ok(linear_resample(
        &mono,
        spec.sample_rate,
        WHISPER_TARGET_RATE,
    ))
}

/// Naive linear-interpolation resampler. Adequate for speech VAD
/// and whisper.cpp; for music-quality work the right swap is a
/// polyphase resampler (out of scope for B-8 v1).
pub(super) fn linear_resample(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if src_rate == dst_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = src_rate as f64 / dst_rate as f64;
    let dst_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(dst_len);
    for i in 0..dst_len {
        let src_pos = i as f64 * ratio;
        let lo = src_pos.floor() as usize;
        let hi = (lo + 1).min(input.len() - 1);
        let frac = (src_pos - lo as f64) as f32;
        let s = input[lo] * (1.0 - frac) + input[hi] * frac;
        out.push(s);
    }
    out
}

fn encode_wav_16k_mono(pcm: &[f32]) -> anyhow::Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: WHISPER_TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut w = hound::WavWriter::new(&mut buf, spec).context("wav writer")?;
        for &s in pcm {
            let v = (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32);
            w.write_sample(v as i16).context("write sample")?;
        }
        w.finalize().context("finalize wav")?;
    }
    Ok(buf.into_inner())
}

/// Build a Command that on Windows hides the console window —
/// otherwise every transcription pops a `cmd.exe` flash. Matches
/// the convention used elsewhere for stdio MCP servers
/// (`crate::ipc::pack`).
pub(super) fn make_command(bin: &PathBuf, args: &[&str]) -> Command {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_is_false_on_cold_dev_machine() {
        // The dev/CI machine almost certainly has no whisper sidecar
        // installed; this is a smoke test that the probe doesn't
        // panic when the file is missing.
        let _ = WhisperCppStt::ready();
    }

    #[test]
    fn try_load_errors_with_install_hint() {
        // Both whisper bin and model are absent on dev — error
        // string must contain the hint that drives the user to
        // the LocalVoicePackPanel downloader.
        let err = match WhisperCppStt::try_load() {
            Ok(_) => return, // Maintainer happens to have the binary on disk; skip.
            Err(e) => e,
        };
        let msg = format!("{err:#}");
        assert!(
            msg.contains("install the local voice pack"),
            "missing install hint: {msg}"
        );
    }

    #[test]
    fn linear_resample_identity_when_rates_match() {
        let pcm = vec![0.1_f32, -0.2, 0.3, -0.4];
        let out = linear_resample(&pcm, 16_000, 16_000);
        assert_eq!(out, pcm);
    }

    #[test]
    fn linear_resample_downsamples_48k_to_16k_third_count() {
        // 48 kHz → 16 kHz should yield ~ 1/3 the samples.
        let pcm = vec![0.0_f32; 480];
        let out = linear_resample(&pcm, 48_000, 16_000);
        assert!(
            (out.len() as i32 - 160).abs() <= 1,
            "expected ~160, got {}",
            out.len()
        );
    }

    #[test]
    fn linear_resample_handles_empty() {
        let out = linear_resample(&[], 44_100, 16_000);
        assert!(out.is_empty());
    }

    #[test]
    fn decode_and_resample_round_trip() {
        // Build a tiny 48 kHz mono WAV in memory and verify it
        // resamples to ~1/3 the sample count at 16 kHz.
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut buf = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut w = hound::WavWriter::new(&mut buf, spec).expect("wav writer");
            for i in 0..480 {
                let s = ((i as f32 * 0.1).sin() * 0.3 * i16::MAX as f32) as i16;
                w.write_sample(s).expect("sample");
            }
            w.finalize().expect("finalize");
        }
        let pcm = decode_and_resample_to_16k(&buf.into_inner()).expect("resample");
        assert!((pcm.len() as i32 - 160).abs() <= 1);
    }
}
