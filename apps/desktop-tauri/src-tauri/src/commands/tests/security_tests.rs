use super::security_health;

#[test]
fn security_health_reports_workspace_scoped_policy() {
    let payload = security_health().expect("security health");

    assert_eq!(payload["ok"], true);
    assert_eq!(payload["policy"], "workspace_scoped");
}
