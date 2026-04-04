//! Scrollback storage (ring buffer)
//!
//! Ring buffer implementation for terminal scrollback storage.

/// Ring buffer for terminal scrollback storage
pub struct ScrollbackStore {
    buffer: Vec<u8>,
    write_pos: usize,
    total_bytes_written: usize,
    total_lines: usize,
    max_bytes: usize,
}

impl ScrollbackStore {
    /// Create a new scrollback store with specified byte capacity
    pub fn new(max_bytes: usize) -> Self {
        Self {
            buffer: vec![0; max_bytes],
            write_pos: 0,
            total_bytes_written: 0,
            total_lines: 0,
            max_bytes,
        }
    }

    /// Push a chunk of bytes into the buffer
    pub fn push(&mut self, chunk: &[u8]) {
        for &byte in chunk {
            self.buffer[self.write_pos] = byte;
            self.write_pos = (self.write_pos + 1) % self.max_bytes;
        }
        self.total_bytes_written += chunk.len();
        self.total_lines += chunk.iter().filter(|&&b| b == b'\n').count();
    }

    /// Extract all content from the ring buffer
    /// Returns bytes in chronological order
    pub fn extract_all(&self) -> Vec<u8> {
        let total = self.total_bytes_written.min(self.max_bytes);
        if self.total_bytes_written <= self.max_bytes {
            // Buffer not wrapped - data starts at 0
            self.buffer[..total].to_vec()
        } else {
            // Buffer wrapped - oldest data is at write_pos
            let mut result = Vec::with_capacity(self.max_bytes);
            result.extend_from_slice(&self.buffer[self.write_pos..]);
            result.extend_from_slice(&self.buffer[..self.write_pos]);
            result
        }
    }

    /// Get total line count
    pub fn total_lines(&self) -> usize {
        self.total_lines
    }

    /// Get buffer capacity
    pub fn capacity(&self) -> usize {
        self.max_bytes
    }

    /// Clear the buffer
    pub fn clear(&mut self) {
        self.buffer.fill(0);
        self.write_pos = 0;
        self.total_bytes_written = 0;
        self.total_lines = 0;
    }
}