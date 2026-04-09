use bytes::Bytes;

use crate::{
    error::{DaemonError, DaemonResult},
    protocol::{ClientFrame, ServerFrame},
};

pub fn encode_server_frame(frame: &ServerFrame) -> DaemonResult<Bytes> {
    let payload = bincode::serialize(frame)?;
    Ok(Bytes::from(payload))
}

pub fn decode_client_frame(bytes: &[u8]) -> DaemonResult<ClientFrame> {
    let frame = bincode::deserialize::<ClientFrame>(bytes).map_err(DaemonError::Codec)?;
    Ok(frame)
}
