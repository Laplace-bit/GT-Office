use super::{configure_std_command, configure_tokio_command};

#[test]
fn configure_std_command_is_safe_to_call_cross_platform() {
    let mut command = std::process::Command::new("echo");
    configure_std_command(&mut command);
}

#[test]
fn configure_tokio_command_is_safe_to_call_cross_platform() {
    let mut command = tokio::process::Command::new("echo");
    configure_tokio_command(&mut command);
}
