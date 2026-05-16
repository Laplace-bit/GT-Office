use rand::Rng;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct BackoffPolicy {
    pub initial_ms: u64,
    pub max_ms: u64,
    pub factor: f64,
    pub jitter: f64,
    pub max_attempts: u32,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            initial_ms: 5000,
            max_ms: 300000,
            factor: 2.0,
            jitter: 0.1,
            max_attempts: 10,
        }
    }
}

impl BackoffPolicy {
    pub fn delay(&self, attempt: u32) -> Duration {
        let exponent = attempt as f64;
        let delay_ms =
            (self.initial_ms as f64 * self.factor.powf(exponent)).min(self.max_ms as f64);
        Duration::from_millis(delay_ms as u64)
    }

    pub fn delay_with_jitter(&self, attempt: u32) -> Duration {
        let base = self.delay(attempt);
        if self.jitter == 0.0 {
            return base;
        }
        let jitter_range = (base.as_millis() as f64 * self.jitter) as u64;
        let offset = rand::rng().random_range(0..=jitter_range * 2) as i64 - jitter_range as i64;
        let adjusted = (base.as_millis() as i64 + offset).max(0) as u64;
        Duration::from_millis(adjusted)
    }

    pub fn should_retry(&self, attempt: u32) -> bool {
        attempt < self.max_attempts
    }
}

#[cfg(test)]
#[path = "backoff_tests.rs"]
mod tests;
