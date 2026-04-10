#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// GUI-subsystem builds should not allocate a separate console for background child processes.
pub fn configure_std_command(command: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

// Tokio commands wrap std::process::Command, so the same Windows flag must be applied via as_std_mut().
#[allow(dead_code)]
pub fn configure_tokio_command(command: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}
