pub struct NlmsFilter {
    weights: Vec<f32>,
    ref_buffer: Vec<f32>,
    ref_pos: usize,
    step_size: f32,
    epsilon: f32,
}

impl NlmsFilter {
    pub fn new(filter_len: usize, step_size: f32) -> Self {
        Self {
            weights: vec![0.0; filter_len],
            ref_buffer: vec![0.0; filter_len],
            ref_pos: 0,
            step_size,
            epsilon: 1e-6,
        }
    }

    pub fn push_reference(&mut self, sample: f32) {
        self.ref_buffer[self.ref_pos] = sample;
        self.ref_pos = (self.ref_pos + 1) % self.weights.len();
    }

    pub fn push_reference_batch(&mut self, samples: &[f32]) {
        for &s in samples {
            self.push_reference(s);
        }
    }

    pub fn process_sample(&mut self, mic: f32) -> f32 {
        let n = self.weights.len();
        let mut echo_estimate = 0.0_f32;
        let mut ref_power = self.epsilon;
        for i in 0..n {
            let idx = (self.ref_pos + n - 1 - i) % n;
            let r = self.ref_buffer[idx];
            echo_estimate += self.weights[i] * r;
            ref_power += r * r;
        }
        let error = mic - echo_estimate;
        let mu = self.step_size / ref_power;
        for i in 0..n {
            let idx = (self.ref_pos + n - 1 - i) % n;
            self.weights[i] += mu * error * self.ref_buffer[idx];
        }
        error
    }

    pub fn process_frame(&mut self, mic_frame: &mut [f32]) {
        for s in mic_frame.iter_mut() {
            *s = self.process_sample(*s);
        }
    }

    pub fn reset(&mut self) {
        self.weights.fill(0.0);
        self.ref_buffer.fill(0.0);
        self.ref_pos = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nlms_removes_known_echo() {
        let mut aec = NlmsFilter::new(64, 0.5);
        let reference: Vec<f32> = (0..2000).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        for &r in &reference[..1000] {
            aec.push_reference(r);
        }
        let mut max_error = 0.0_f32;
        for i in 1000..2000 {
            let mic = reference[i] * 0.8;
            let clean = aec.process_sample(mic);
            let err = clean.abs();
            if i > 1500 {
                max_error = max_error.max(err);
            }
        }
        assert!(
            max_error < 0.1,
            "NLMS should suppress echo after convergence, max_error={max_error}"
        );
    }

    #[test]
    fn nlms_preserves_silent_mic() {
        let mut aec = NlmsFilter::new(32, 0.5);
        aec.push_reference_batch(&[0.5; 100]);
        let mut frame = [0.0_f32; 64];
        aec.process_frame(&mut frame);
        let max = frame.iter().map(|f| f.abs()).fold(0.0_f32, f32::max);
        assert!(
            max < 0.01,
            "silent mic should stay silent after AEC, max={max}"
        );
    }

    #[test]
    fn nlms_reset_clears_state() {
        let mut aec = NlmsFilter::new(16, 0.5);
        aec.push_reference_batch(&[1.0; 50]);
        aec.process_sample(1.0);
        aec.reset();
        assert!(aec.weights.iter().all(|&w| w == 0.0));
        assert!(aec.ref_buffer.iter().all(|&r| r == 0.0));
    }
}
