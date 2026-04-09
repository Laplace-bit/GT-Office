use gt_daemon::util::ring_buffer::RingBuffer;

#[test]
fn ring_buffer_overwrites_oldest() {
    let mut ring = RingBuffer::new(2);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    assert_eq!(ring.drain_all(), vec![2, 3]);
}
