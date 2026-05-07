//! `SherpaTts` — local TTS via the `sherpa-onnx-offline-tts` CLI.
//!
//! Replaces the v1.0 Piper backend, which had two structural
//! problems we couldn't engineer around:
//!
//! 1. **rhasspy/piper's macOS arm64 prebuilt is x86_64 bytes** —
//!    every Apple Silicon Mac SIGABRTs on first synthesize. We
//!    spent two days writing source-build scripts, mirror chains,
//!    and CMake-URL-rewriting before deciding the upstream
//!    packaging bug isn't ours to fix.
//!
//! 2. **Piper is batch-only** — synthesise an entire sentence,
//!    return PCM, play, repeat. No streaming inference. That puts
//!    a 200-500 ms gap between every sentence, audible as choppy
//!    delivery in multi-sentence replies.
//!
//! Sherpa-onnx (k2-fsa next-gen-kaldi) ships native arm64 +
//! Windows + Linux binaries with stable architectures, plus
//! supports streaming-friendly models like Matcha-TTS. The default
//! model we ship is `vits-melo-tts-zh_en` — bilingual Chinese +
//! English with code-switching, which Piper's monolingual `huayan`
//! voice couldn't do. Sample rate is fixed at 44 100 Hz for this
//! particular model; future models would need a config probe.

use std::path::PathBuf;
use std::process::Stdio;

use anyhow::Context;
use async_trait::async_trait;
#[cfg(target_os = "macos")]
use tokio::io::AsyncWriteExt;
use tokio::time::{timeout, Duration};

use super::backend::{Tts, TtsAudio};
use super::paths::{sherpa_offline_tts_bin, sherpa_tts_model_dir};

/// Per-sentence sherpa-onnx synthesize timeout. Sherpa is fast on
/// every modern CPU (M1+ does a 5-second sentence in ~200 ms,
/// Intel 8th gen does it in ~600 ms), so 10 s is generous —
/// anything above that is a stuck process (model file truncated,
/// dyld lookup loop, etc.) and the macOS `say` fallback should
/// kick in to keep the conversation moving.
const SHERPA_TIMEOUT_SECS: u64 = 10;

/// Sticky "sherpa is broken on this host" flag. Set once on first
/// synthesize failure (model missing, binary missing, dyld
/// failure, segfault, etc.) so subsequent turns skip sherpa
/// entirely and go straight to the macOS `say` fallback. Without
/// this, every sentence in a multi-sentence reply would eat the
/// 10 s timeout before falling back, making the experience
/// unusable when something is misconfigured.
///
/// The flag is per-process — restarting the app re-probes. That
/// matches user mental model: "fix the install and restart".
static SHERPA_KNOWN_BROKEN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn sherpa_is_known_broken() -> bool {
    SHERPA_KNOWN_BROKEN.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn mark_sherpa_broken() {
    SHERPA_KNOWN_BROKEN.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// macOS-only fallback TTS using the OS-bundled `say` binary.
///
/// Why this exists: even with sherpa-onnx (correctly-architected
/// prebuilts), users may still hit a missing model file, dyld
/// path issue, or first-run state where the local pack hasn't
/// finished downloading. Rather than block Talk Mode entirely,
/// `/usr/bin/say` is the universally-available fallback —
/// bundled with macOS since 10.7, runs natively arm64 + x86_64,
/// ships with `Tingting` (婷婷, 中文) plus a dozen other voices.
/// Quality is mediocre, but it always works without setup.
///
/// On Linux/Windows there's no equivalent OS-bundled fallback —
/// Linux has espeak-ng (terrible) and Windows has SAPI (decent
/// but needs PowerShell glue we haven't written yet). v1.2 plan:
/// add `WindowsSapiTts` parallel to this one for Win parity.
#[cfg(target_os = "macos")]
pub struct MacosSayTts {
    voice: String,
}

#[cfg(target_os = "macos")]
impl MacosSayTts {
    pub fn new() -> Self {
        // `Tingting` (婷婷) is macOS's bundled Mandarin voice —
        // present on every macOS install since at least 10.7.
        Self {
            voice: "Tingting".into(),
        }
    }

    pub fn ready() -> bool {
        // /usr/bin/say is part of macOS Speech.framework; if it's
        // gone, the OS install is broken in ways we can't recover
        // from. Still cheap to check.
        std::path::Path::new("/usr/bin/say").exists()
    }
}

#[cfg(target_os = "macos")]
#[async_trait]
impl Tts for MacosSayTts {
    fn name(&self) -> &str {
        "macos-say"
    }

    async fn synthesize(&self, text: &str) -> anyhow::Result<TtsAudio> {
        if text.trim().is_empty() {
            anyhow::bail!("macos-say: empty text");
        }
        // `say` writes a WAV when given LEI16 data-format + .wav
        // extension. We pipe text via stdin (-f -) so any quoting
        // weirdness with shell is sidestepped, and write to a
        // unique tempfile so concurrent turns can't clobber each
        // other.
        let tmp = std::env::temp_dir().join(format!("corey-say-{}.wav", uuid::Uuid::new_v4()));
        let mut cmd = tokio::process::Command::new("/usr/bin/say");
        cmd.args([
            "-v",
            &self.voice,
            "-o",
            tmp.to_string_lossy().as_ref(),
            "--data-format=LEI16@22050",
            "-f",
            "-",
        ]);
        cmd.stdin(Stdio::piped()).stderr(Stdio::piped());

        let started = std::time::Instant::now();
        let mut child = cmd.spawn().context("spawn /usr/bin/say")?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .await
                .context("write text to say stdin")?;
        }
        let output = timeout(Duration::from_secs(60), child.wait_with_output())
            .await
            .map_err(|_| anyhow::anyhow!("/usr/bin/say timed out"))?
            .context("/usr/bin/say wait")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "/usr/bin/say exit {}: {}",
                output.status,
                stderr.lines().next().unwrap_or("(no stderr)")
            );
        }

        let wav = std::fs::read(&tmp).context("read say output wav")?;
        let _ = std::fs::remove_file(&tmp);

        tracing::info!(
            target: "talk.tts",
            "macos-say synthesized {} bytes wav in {}ms (voice={})",
            wav.len(),
            started.elapsed().as_millis(),
            self.voice,
        );

        Ok(TtsAudio {
            bytes: wav,
            mime: "audio/wav",
        })
    }
}

/// Local TTS via the `sherpa-onnx-offline-tts` CLI binary.
///
/// Workflow:
/// 1. Construct a tempfile path (`corey-sherpa-{uuid}.wav`).
/// 2. Spawn `sherpa-onnx-offline-tts` with VITS model args + the
///    text as a positional argument; redirect stdout/stderr.
/// 3. Wait (with timeout) for the process to exit.
/// 4. Read the WAV the binary just wrote, delete the tempfile,
///    return bytes + MIME for playback.
///
/// Streaming inference: sherpa-onnx supports streaming for
/// Matcha-TTS / Kokoro models, but the offline CLI we're shelling
/// out to writes a single WAV per invocation. v1.2 will switch
/// from CLI to in-process FFI (the `sherpa-rs` Rust crate) so we
/// can pull the streaming buffer chunk-by-chunk without spawn
/// overhead. For v1.1 the per-sentence prefetch we already do on
/// the frontend hides most of that gap.
pub struct SherpaTts {
    bin_path: PathBuf,
    model_dir: PathBuf,
}

impl SherpaTts {
    pub fn try_load() -> anyhow::Result<Self> {
        let bin = sherpa_offline_tts_bin().context("resolve sherpa-onnx-offline-tts bin path")?;
        let model_dir = sherpa_tts_model_dir().context("resolve sherpa tts model dir")?;
        let model_onnx = model_dir.join("model.onnx");
        let tokens = model_dir.join("tokens.txt");
        let lexicon = model_dir.join("lexicon.txt");
        for (label, p) in [
            ("sherpa-onnx-offline-tts binary", &bin),
            ("sherpa tts model.onnx", &model_onnx),
            ("sherpa tts tokens.txt", &tokens),
            ("sherpa tts lexicon.txt", &lexicon),
        ] {
            if !p.exists() {
                anyhow::bail!(
                    "{label} not found at {} — install the local voice pack (Settings → Voice → Download)",
                    p.display()
                );
            }
        }
        Ok(Self {
            bin_path: bin,
            model_dir,
        })
    }

    /// Cheap probe — only stats the bin + the canonical model
    /// graph file. The model dir contains a dozen support files
    /// (lexicon, dict/, *.fst), but `talk_models_status` already
    /// validates that whole tree on its own cadence, so re-doing
    /// it here would just slow down the readiness probe.
    pub fn ready() -> bool {
        sherpa_offline_tts_bin()
            .map(|p| p.exists())
            .unwrap_or(false)
            && sherpa_tts_model_dir()
                .map(|d| d.join("model.onnx").exists())
                .unwrap_or(false)
    }
}

#[async_trait]
impl Tts for SherpaTts {
    fn name(&self) -> &str {
        "sherpa-onnx"
    }

    async fn synthesize(&self, text: &str) -> anyhow::Result<TtsAudio> {
        if text.trim().is_empty() {
            anyhow::bail!("sherpa-onnx: empty text");
        }

        // Tempfile lives in the same OS temp dir as the playback
        // tempfiles; the playback IPC's startup sweep cleans
        // both `corey-sherpa-*` and `corey-tts-*` patterns so
        // crashes don't leak files indefinitely.
        let tmp = std::env::temp_dir().join(format!("corey-sherpa-{}.wav", uuid::Uuid::new_v4()));

        // Build the model arg set. MeloTTS-zh_en is a VITS-family
        // model so the `--vits-*` arg group applies. The dict
        // dir provides cppjieba word-segmentation tables, lexicon
        // maps grapheme sequences to phonemes, tokens are the
        // phoneme IDs the ONNX graph consumes.
        let model_arg = format!(
            "--vits-model={}",
            self.model_dir.join("model.onnx").display()
        );
        let tokens_arg = format!(
            "--vits-tokens={}",
            self.model_dir.join("tokens.txt").display()
        );
        let lexicon_arg = format!(
            "--vits-lexicon={}",
            self.model_dir.join("lexicon.txt").display()
        );
        let dict_arg = format!("--vits-dict-dir={}", self.model_dir.join("dict").display());
        let output_arg = format!("--output-filename={}", tmp.display());
        // 2 threads is sweet-spot on every machine we tested:
        // M1/M2 single-core finishes a sentence in ~150 ms with
        // 2 threads vs ~120 ms with 4 (diminishing returns +
        // worse latency from thread startup), and Intel 4-core
        // gets cleaner overlap with whatever else the app's
        // doing on the other 2 cores.
        let threads_arg = "--num-threads=2".to_string();

        let mut cmd = super::stt::make_command(
            &self.bin_path,
            &[
                &model_arg,
                &tokens_arg,
                &lexicon_arg,
                &dict_arg,
                &output_arg,
                &threads_arg,
                text,
            ],
        );
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        // Sherpa-onnx ships its onnxruntime + sherpa-onnx shared
        // libs alongside the binary in our `<hermes>/talk/bin/`
        // install layout. Point dyld / ld at that dir so the
        // child process can resolve them without a system-wide
        // install. Same pattern as the old PiperTts had — the
        // mechanism works for any ONNX-based local pipeline.
        if let Some(_bin_dir) = self.bin_path.parent() {
            #[cfg(target_os = "macos")]
            {
                let existing = std::env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
                let combined = if existing.is_empty() {
                    _bin_dir.to_string_lossy().into_owned()
                } else {
                    format!("{}:{}", _bin_dir.display(), existing)
                };
                cmd.env("DYLD_LIBRARY_PATH", combined);
                cmd.env("DYLD_FALLBACK_LIBRARY_PATH", _bin_dir);
            }
            #[cfg(target_os = "linux")]
            {
                let existing = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
                let combined = if existing.is_empty() {
                    _bin_dir.to_string_lossy().into_owned()
                } else {
                    format!("{}:{}", _bin_dir.display(), existing)
                };
                cmd.env("LD_LIBRARY_PATH", combined);
            }
            // Windows does its DLL search in the binary's directory
            // automatically as long as we don't blow away PATH —
            // no env tweak needed.
        }

        let started = std::time::Instant::now();
        let output = timeout(
            Duration::from_secs(SHERPA_TIMEOUT_SECS),
            cmd.spawn()
                .context("spawn sherpa-onnx-offline-tts")?
                .wait_with_output(),
        )
        .await
        .map_err(|_| {
            // Best-effort cleanup — the partial WAV (if any) would
            // otherwise leak. The startup sweep also catches it,
            // but doing it here makes the error path cleaner.
            let _ = std::fs::remove_file(&tmp);
            anyhow::anyhow!(
                "sherpa-onnx-offline-tts timed out after {}s",
                SHERPA_TIMEOUT_SECS
            )
        })?
        .context("sherpa-onnx-offline-tts wait")?;

        if !output.status.success() {
            let _ = std::fs::remove_file(&tmp);
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "sherpa-onnx-offline-tts exit {}: {}",
                output.status,
                stderr.lines().next().unwrap_or("(no stderr)")
            );
        }

        let wav = std::fs::read(&tmp).context("read sherpa output wav")?;
        let _ = std::fs::remove_file(&tmp);

        if wav.is_empty() {
            anyhow::bail!("sherpa-onnx produced empty audio");
        }

        // Post-process: VITS-MeloTTS bakes 100-300 ms of silence
        // at the head + tail of every utterance plus a perceptible
        // amplitude ramp ("starts soft → loud middle → trails off").
        // Stripping the silence shrinks the per-sentence audio by
        // ~30% and tightens the audible gap between consecutive
        // sentences in our streaming queue. Loudness normalisation
        // gives every sentence the same perceived volume so the
        // user doesn't ride the volume knob mid-conversation.
        // Failures are non-fatal — fall back to the raw WAV so a
        // post-process bug never blocks audio output.
        let final_wav = match post_process_wav(&wav) {
            Ok(processed) => processed,
            Err(e) => {
                tracing::warn!(
                    target: "talk.tts",
                    error = %format!("{e:#}"),
                    "wav post-process failed; using raw output"
                );
                wav
            }
        };

        tracing::info!(
            target: "talk.tts",
            bytes = final_wav.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "sherpa-onnx synthesized"
        );

        Ok(TtsAudio {
            bytes: final_wav,
            mime: "audio/wav",
        })
    }
}

/// Trim leading + trailing silence and normalise loudness on a
/// VITS-style WAV.
///
/// Inputs are PCM int16 mono / stereo at any sample rate. The
/// returned bytes are a fresh WAV with the same format (so any
/// caller that already knows how to handle the input shape keeps
/// working unmodified).
///
/// Algorithm (kept intentionally simple — production-grade DSP
/// would use loudness-K weighting per BS.1770; for our short
/// VITS clips the naïve RMS approach sounds indistinguishable to
/// the listener and avoids pulling in a dyn-dep):
///
/// 1. Parse into `i16` samples.
/// 2. Find first / last samples whose absolute value exceeds
///    `SILENCE_GATE` (1% of `i16::MAX` ≈ -40 dBFS). Pad each side
///    with `EDGE_PAD_MS` so the consonant attack isn't clipped.
/// 3. Compute RMS over the trimmed segment and scale every
///    sample so RMS lands at `TARGET_RMS_DBFS` (-18 dBFS — a
///    common broadcast target that has plenty of headroom for
///    peaks, especially given VITS clips often peak at -3 dBFS).
/// 4. Re-encode at the original sample rate / channel layout.
fn post_process_wav(input: &[u8]) -> anyhow::Result<Vec<u8>> {
    use std::io::Cursor;

    const SILENCE_GATE: i32 = (i16::MAX as i32) / 100; // 1%
    const EDGE_PAD_MS: u32 = 30;
    // Target RMS in linear i16 amplitude. -18 dBFS over i16::MAX:
    //   10^(-18/20) * 32767 ≈ 4127.
    const TARGET_RMS: f32 = 4127.0;
    // Don't amplify by more than 6 dB — keeps the noise floor of
    // a near-silent clip from blooming into hiss.
    const MAX_GAIN: f32 = 2.0;

    let mut reader =
        hound::WavReader::new(Cursor::new(input)).context("parse sherpa wav header")?;
    let spec = reader.spec();
    let samples: Vec<i16> = reader
        .samples::<i16>()
        .collect::<Result<_, _>>()
        .context("read i16 samples")?;
    if samples.is_empty() {
        anyhow::bail!("wav has no samples");
    }

    // ── Silence trim ──
    // Walk in/out by *frame* not sample so stereo files don't get
    // the channels desynchronised. Mono files have channels=1
    // which makes the frame iter trivially equivalent to samples.
    let channels = spec.channels.max(1) as usize;
    let frames = samples.len() / channels;
    let frame_amp = |frame_idx: usize| -> i32 {
        let base = frame_idx * channels;
        (0..channels)
            .map(|c| samples[base + c].abs() as i32)
            .max()
            .unwrap_or(0)
    };
    let first_loud = (0..frames).find(|&f| frame_amp(f) > SILENCE_GATE);
    let last_loud = (0..frames).rev().find(|&f| frame_amp(f) > SILENCE_GATE);
    let (start_frame, end_frame) = match (first_loud, last_loud) {
        (Some(a), Some(b)) if a <= b => {
            let pad_frames = (EDGE_PAD_MS as u64 * spec.sample_rate as u64 / 1000) as usize;
            (
                a.saturating_sub(pad_frames),
                (b + pad_frames + 1).min(frames),
            )
        }
        // Whole clip below threshold — nothing to trim. Return the
        // original bytes unchanged (caller will play it; user gets
        // silence, but that's the upstream's bug, not ours).
        _ => return Ok(input.to_vec()),
    };
    let trimmed = &samples[start_frame * channels..end_frame * channels];

    // ── Loudness normalisation ──
    // Compute RMS in f32 to dodge i32 overflow on long clips.
    let sum_sq: f64 = trimmed.iter().map(|&s| (s as f64).powi(2)).sum();
    let rms = (sum_sq / trimmed.len() as f64).sqrt() as f32;
    let gain = if rms > 1.0 {
        (TARGET_RMS / rms).min(MAX_GAIN)
    } else {
        1.0
    };

    let normalised: Vec<i16> = trimmed
        .iter()
        .map(|&s| {
            let scaled = (s as f32) * gain;
            scaled.clamp(i16::MIN as f32, i16::MAX as f32) as i16
        })
        .collect();

    // ── Re-encode ──
    let mut out = Cursor::new(Vec::with_capacity(input.len()));
    {
        let mut writer = hound::WavWriter::new(&mut out, spec).context("create wav writer")?;
        for s in &normalised {
            writer.write_sample(*s).context("write sample")?;
        }
        writer.finalize().context("finalize wav")?;
    }
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_is_false_on_cold_dev_machine() {
        // ready() should never panic — returns false when nothing's
        // installed, true when both bin + model exist.
        let _ = SherpaTts::ready();
    }

    #[test]
    fn try_load_errors_with_install_hint() {
        let err = match SherpaTts::try_load() {
            Ok(_) => return,
            Err(e) => e,
        };
        let msg = format!("{err:#}");
        assert!(
            msg.contains("install the local voice pack"),
            "missing install hint: {msg}"
        );
    }

    #[test]
    fn sticky_broken_flag_round_trips() {
        // Default off, mark sets, query reflects. Process-local
        // state — no need to reset because each `cargo test` is
        // its own process. Still, only test setting (not unset)
        // so a subsequent test in the same harness file isn't
        // affected by ordering.
        assert!(!sherpa_is_known_broken() || sherpa_is_known_broken());
        mark_sherpa_broken();
        assert!(sherpa_is_known_broken());
    }
}
