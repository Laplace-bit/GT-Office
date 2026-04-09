use gt_daemon::protocol::codec::decode_client_frame;
use gt_daemon::protocol::{ClientFrame, Request};

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
