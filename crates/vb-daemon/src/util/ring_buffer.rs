use std::collections::VecDeque;

#[derive(Debug)]
pub struct RingBuffer<T> {
    cap: usize,
    inner: VecDeque<T>,
}

impl<T> RingBuffer<T> {
    pub fn new(cap: usize) -> Self {
        Self {
            cap,
            inner: VecDeque::with_capacity(cap.max(1)),
        }
    }

    pub fn push(&mut self, value: T) {
        if self.cap == 0 {
            return;
        }
        if self.inner.len() == self.cap {
            let _ = self.inner.pop_front();
        }
        self.inner.push_back(value);
    }

    pub fn drain_all(&mut self) -> Vec<T> {
        self.inner.drain(..).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }
}

#[cfg(test)]
mod tests {
    use super::RingBuffer;

    #[test]
    fn ring_buffer_overwrites_oldest() {
        let mut ring = RingBuffer::new(2);
        ring.push(1);
        ring.push(2);
        ring.push(3);
        assert_eq!(ring.drain_all(), vec![2, 3]);
    }
}
