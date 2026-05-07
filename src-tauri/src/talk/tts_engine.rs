use std::sync::Arc;

use anyhow::Context;
use parking_lot::Mutex;
use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig,
    OfflineTtsVitsModelConfig,
};

use super::backend::{Tts, TtsAudio};
use super::paths::sherpa_tts_model_dir;

pub struct SherpaEngine {
    engine: Arc<Mutex<OfflineTts>>,
    sample_rate: i32,
}

impl SherpaEngine {
    pub fn try_load() -> anyhow::Result<Self> {
        if let Some(engine) = Self::try_load_vits_local()? {
            return Ok(engine);
        }
        Self::try_load_vits_cli()
    }

    fn try_load_vits_local() -> anyhow::Result<Option<Self>> {
        let model_dir = match sherpa_tts_model_dir() {
            Ok(d) if d.join("model.onnx").exists() => d,
            _ => return Ok(None),
        };
        let tokens = model_dir.join("tokens.txt");
        let lexicon = model_dir.join("lexicon.txt");
        if !tokens.exists() || !lexicon.exists() {
            return Ok(None);
        }

        let dict_dir = model_dir.join("dict");
        let mut rule_fsts = String::new();
        for fst in &["date.fst", "number.fst", "phone.fst", "new_heteronym.fst"] {
            let p = model_dir.join(fst);
            if p.exists() {
                if !rule_fsts.is_empty() {
                    rule_fsts.push(',');
                }
                rule_fsts.push_str(&p.to_string_lossy());
            }
        }

        let vits = OfflineTtsVitsModelConfig {
            model: Some(model_dir.join("model.onnx").to_string_lossy().into_owned()),
            lexicon: Some(lexicon.to_string_lossy().into_owned()),
            tokens: Some(tokens.to_string_lossy().into_owned()),
            dict_dir: if dict_dir.exists() {
                Some(dict_dir.to_string_lossy().into_owned())
            } else {
                None
            },
            noise_scale: 0.667,
            noise_scale_w: 0.8,
            length_scale: 1.0,
            data_dir: None,
        };

        let config = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                vits,
                num_threads: 2,
                debug: false,
                ..Default::default()
            },
            rule_fsts: if rule_fsts.is_empty() {
                None
            } else {
                Some(rule_fsts)
            },
            max_num_sentences: 1,
            ..Default::default()
        };

        let engine = OfflineTts::create(&config).context("failed to create VITS engine")?;
        let sample_rate = engine.sample_rate();

        tracing::info!(
            target: "talk.tts_engine",
            sample_rate,
            "VITS MeloTTS engine loaded (in-process)"
        );

        Ok(Some(Self {
            engine: Arc::new(Mutex::new(engine)),
            sample_rate,
        }))
    }

    fn try_load_vits_cli() -> anyhow::Result<Self> {
        anyhow::bail!(
            "VITS model not found — install the local voice pack (Settings → Voice → Download)"
        );
    }

    pub async fn synthesize_with_speed(&self, text: &str, speed: f32) -> anyhow::Result<TtsAudio> {
        if text.trim().is_empty() {
            anyhow::bail!("sherpa-engine: empty text");
        }

        let engine = self.engine.clone();
        let sample_rate = self.sample_rate;
        let text = text.to_string();

        let started = std::time::Instant::now();

        let wav_bytes = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
            let eng = engine.lock();
            let config = GenerationConfig {
                speed,
                silence_scale: 1.0,
                sid: 0,
                ..Default::default()
            };
            let audio = eng
                .generate_with_config(&text, &config, None::<fn(&[f32], f32) -> bool>)
                .context("sherpa-onnx generate returned None")?;
            let samples = audio.samples();
            f32_samples_to_wav(samples, sample_rate)
        })
        .await
        .context("spawn_blocking panicked")??;

        tracing::info!(
            target: "talk.tts_engine",
            bytes = wav_bytes.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            speed,
            "sherpa-engine synth complete"
        );

        Ok(TtsAudio {
            bytes: wav_bytes,
            mime: "audio/wav",
        })
    }

    pub fn ready() -> bool {
        sherpa_tts_model_dir()
            .map(|d| d.join("model.onnx").exists())
            .unwrap_or(false)
    }
}

fn normalize_rms(samples: &mut [f32], target_rms: f32) {
    let rms = (samples.iter().map(|&s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    if rms < 1e-6 {
        return;
    }
    let gain = target_rms / rms;
    let gain = gain.min(10.0);
    for s in samples.iter_mut() {
        *s = (*s * gain).clamp(-1.0, 1.0);
    }
}

fn f32_samples_to_wav(samples: &[f32], sample_rate: i32) -> anyhow::Result<Vec<u8>> {
    use std::io::Cursor;

    let mut samples = samples.to_vec();
    normalize_rms(&mut samples, 0.08);

    let i16_samples: Vec<i16> = samples
        .iter()
        .map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            (clamped * i16::MAX as f32) as i16
        })
        .collect();

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: sample_rate as u32,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut buf = Cursor::new(Vec::with_capacity(i16_samples.len() * 2 + 44));
    {
        let mut writer = hound::WavWriter::new(&mut buf, spec)?;
        for &s in &i16_samples {
            writer.write_sample(s)?;
        }
        writer.finalize()?;
    }
    Ok(buf.into_inner())
}

#[async_trait::async_trait]
impl Tts for SherpaEngine {
    fn name(&self) -> &str {
        "sherpa-engine"
    }

    async fn synthesize(&self, text: &str) -> anyhow::Result<TtsAudio> {
        if text.trim().is_empty() {
            anyhow::bail!("sherpa-engine: empty text");
        }

        let engine = self.engine.clone();
        let sample_rate = self.sample_rate;
        let text = text.to_string();

        let started = std::time::Instant::now();

        let wav_bytes = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
            let eng = engine.lock();
            let config = GenerationConfig {
                speed: 1.0,
                silence_scale: 1.0,
                sid: 0,
                ..Default::default()
            };
            let audio = eng
                .generate_with_config(&text, &config, None::<fn(&[f32], f32) -> bool>)
                .context("sherpa-onnx generate returned None")?;
            let samples = audio.samples();
            f32_samples_to_wav(samples, sample_rate)
        })
        .await
        .context("spawn_blocking panicked")??;

        tracing::info!(
            target: "talk.tts_engine",
            bytes = wav_bytes.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "sherpa-engine synth complete"
        );

        Ok(TtsAudio {
            bytes: wav_bytes,
            mime: "audio/wav",
        })
    }
}
