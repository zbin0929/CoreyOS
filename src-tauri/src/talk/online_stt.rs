use std::sync::Arc;

use anyhow::Context;
use async_trait::async_trait;
use sherpa_onnx::{
    OnlineModelConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineTransducerModelConfig,
};

use super::backend::Stt;
use super::paths::zipformer_stt_model_dir;
use super::stt::decode_and_resample_to_16k;

const TARGET_RATE: u32 = 16_000;

pub struct ZipformerStt {
    recognizer: Arc<OnlineRecognizer>,
}

impl ZipformerStt {
    pub fn try_load() -> anyhow::Result<Self> {
        let model_dir = zipformer_stt_model_dir()?;
        let encoder = model_dir.join("encoder.int8.onnx");
        let decoder = model_dir.join("decoder.onnx");
        let joiner = model_dir.join("joiner.int8.onnx");
        let tokens = model_dir.join("tokens.txt");

        if !encoder.exists() || !decoder.exists() || !joiner.exists() || !tokens.exists() {
            anyhow::bail!(
                "zipformer model not found in {} — install the local voice pack",
                model_dir.display()
            );
        }

        let config = OnlineRecognizerConfig {
            model_config: OnlineModelConfig {
                transducer: OnlineTransducerModelConfig {
                    encoder: Some(encoder.to_string_lossy().into_owned()),
                    decoder: Some(decoder.to_string_lossy().into_owned()),
                    joiner: Some(joiner.to_string_lossy().into_owned()),
                },
                tokens: Some(tokens.to_string_lossy().into_owned()),
                num_threads: 4,
                ..Default::default()
            },
            ..Default::default()
        };

        let recognizer =
            OnlineRecognizer::create(&config).context("failed to create OnlineRecognizer")?;

        tracing::info!(
            target: "talk.online_stt",
            "Zipformer bilingual STT loaded from {}",
            model_dir.display()
        );

        Ok(Self {
            recognizer: Arc::new(recognizer),
        })
    }

    pub fn ready() -> bool {
        zipformer_stt_model_dir()
            .map(|d| {
                d.join("encoder.int8.onnx").exists()
                    && d.join("decoder.onnx").exists()
                    && d.join("joiner.int8.onnx").exists()
                    && d.join("tokens.txt").exists()
            })
            .unwrap_or(false)
    }

    pub fn into_recognizer(self) -> OnlineRecognizer {
        match Arc::try_unwrap(self.recognizer) {
            Ok(r) => r,
            Err(_) => panic!("into_recognizer: Arc should have exactly one owner"),
        }
    }
}

#[async_trait]
impl Stt for ZipformerStt {
    fn name(&self) -> &str {
        "zipformer-online"
    }

    async fn transcribe(&self, wav: &[u8]) -> anyhow::Result<String> {
        let recognizer = self.recognizer.clone();
        let wav = wav.to_vec();

        let started = std::time::Instant::now();

        let text = tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
            let pcm = decode_and_resample_to_16k(&wav)?;
            if pcm.is_empty() {
                return Ok(String::new());
            }

            let stream = recognizer.create_stream();
            stream.accept_waveform(TARGET_RATE as i32, &pcm);

            while recognizer.is_ready(&stream) {
                recognizer.decode(&stream);
            }

            let result = recognizer
                .get_result(&stream)
                .context("zipformer returned no result")?;

            Ok(result.text.trim().to_string())
        })
        .await
        .context("spawn_blocking panicked")??;

        tracing::info!(
            target: "talk.online_stt",
            chars = text.chars().count(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "zipformer transcribed"
        );

        Ok(text)
    }
}
