use std::net::SocketAddr;

use gt_daemon::daemon::Daemon;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "gt_daemon=info,gt-daemon=info,info".to_string()),
        )
        .with_target(true)
        .compact()
        .init();

    let addr: SocketAddr = std::env::var("VB_DAEMON_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:7878".to_string())
        .parse()?;

    let daemon = Daemon::new();
    daemon.serve(addr).await?;
    Ok(())
}
