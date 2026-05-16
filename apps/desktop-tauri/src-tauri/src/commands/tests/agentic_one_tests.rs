use super::*;

#[test]
fn timed_out_install_attempt_terminates_child_tree() {
    let attempt = AgentInstallAttempt {
        id: "timeout-tree".to_string(),
        label: "timeout test".to_string(),
        phase: AgentInstallProgressPhase::Installing,
        program: "bash".to_string(),
        args: vec![
            "-lc".to_string(),
            "sleep 5 & child=$!; wait \"$child\"".to_string(),
        ],
        env: Default::default(),
        timeout_ms: 200,
        retryable_diagnostics: Vec::new(),
    };

    let started_at = Instant::now();
    let result = run_progress_command(&attempt).expect("run timeout command");
    assert!(result.timed_out);
    assert!(started_at.elapsed() < Duration::from_secs(3));
}
