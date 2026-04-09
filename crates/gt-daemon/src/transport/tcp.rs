use tokio::net::TcpListener;

use crate::error::DaemonResult;

pub async fn bind(addr: std::net::SocketAddr) -> DaemonResult<TcpListener> {
    let listener = TcpListener::bind(addr).await?;
    Ok(listener)
}
