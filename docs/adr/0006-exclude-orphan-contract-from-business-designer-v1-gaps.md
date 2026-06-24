# Exclude orphan-contract from Business Designer v1 gaps

Business Designer v1 gap rules only represent facts the system can determine from the document. We decided not to include `orphan-contract` as a v1 gap, because an API contract without an entity-model dependency may be a valid design choice rather than a missing structure. The v1 rules keep `dangling-ref` for explicit broken references, but do not force every API contract to depend on an entity model.
