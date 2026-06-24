# Keep Business Designer links derived, not persisted

Business Designer links are semantic projections of persisted block payload, while layout is user-controlled view state. We decided that semantic links are not written to the document or manifest; validation returns them as a graph projection for the frontend to render, and only block payload plus layout coordinates are persisted. This prevents stale links from surviving payload edits and keeps persisted design files focused on source content rather than derived relationships.
