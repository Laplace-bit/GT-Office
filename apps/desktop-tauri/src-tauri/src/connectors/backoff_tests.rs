use super::BackoffPolicy;
use std::time::Duration;

#[test]
fn backoff_initial_delay() {
    let policy = BackoffPolicy::default();
    assert_eq!(policy.delay(0), Duration::from_millis(5000));
}

#[test]
fn backoff_doubles_each_attempt() {
    let policy = BackoffPolicy::default();
    assert_eq!(policy.delay(1), Duration::from_millis(10000));
    assert_eq!(policy.delay(2), Duration::from_millis(20000));
    assert_eq!(policy.delay(3), Duration::from_millis(40000));
}

#[test]
fn backoff_caps_at_max() {
    let policy = BackoffPolicy::default();
    let max_delay = policy.delay(100);
    assert!(max_delay <= Duration::from_millis(300000));
}

#[test]
fn backoff_with_jitter_stays_within_bounds() {
    let policy = BackoffPolicy::default();
    let base = policy.delay(2);
    for _ in 0..100 {
        let jittered = policy.delay_with_jitter(2);
        let jitter_range = (base.as_millis() as f64 * policy.jitter) as u64;
        assert!(jittered >= base - Duration::from_millis(jitter_range));
        assert!(jittered <= base + Duration::from_millis(jitter_range));
    }
}

#[test]
fn backoff_max_attempts_exceeded() {
    let policy = BackoffPolicy::default();
    assert!(policy.should_retry(0));
    assert!(policy.should_retry(9));
    assert!(!policy.should_retry(10));
    assert!(!policy.should_retry(11));
}

#[test]
fn backoff_custom_policy() {
    let policy = BackoffPolicy {
        initial_ms: 1000,
        max_ms: 60000,
        factor: 3.0,
        jitter: 0.0,
        max_attempts: 5,
    };
    assert_eq!(policy.delay(0), Duration::from_millis(1000));
    assert_eq!(policy.delay(1), Duration::from_millis(3000));
    assert_eq!(policy.delay(2), Duration::from_millis(9000));
    assert!(policy.delay(10) <= Duration::from_millis(60000));
    assert!(!policy.should_retry(5));
}

#[test]
fn backoff_jitter_is_zero_when_jitter_is_zero() {
    let policy = BackoffPolicy {
        initial_ms: 5000,
        max_ms: 300000,
        factor: 2.0,
        jitter: 0.0,
        max_attempts: 10,
    };
    for attempt in 0..5 {
        assert_eq!(policy.delay_with_jitter(attempt), policy.delay(attempt));
    }
}

#[test]
fn backoff_delay_never_negative() {
    let policy = BackoffPolicy::default();
    for attempt in 0..20 {
        assert!(policy.delay_with_jitter(attempt).as_millis() > 0);
    }
}
