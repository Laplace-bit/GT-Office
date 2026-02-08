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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ClientFrame, Request};

    #[test]
    fn client_frame_round_trip() {
        let frame = ClientFrame {
            id: 42,
            request: Request::Ping,
        };

        let encoded = bincode::serialize(&frame).expect("serialize");
        let decoded = decode_client_frame(&encoded).expect("decode");
        assert_eq!(decoded.id, 42);
        assert!(matches!(decoded.request, Request::Ping));
    }
}
