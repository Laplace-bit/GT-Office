# Treat Business Designer layout as repairable view state

Business Designer layout coordinates are user-controlled view state, not business design semantics. We decided that layout entries for missing blocks are ignored by validation and may be cleaned during save or layout writes, while blocks without layout receive deterministic fallback coordinates until the user moves them. Orphan layout state is not a diagnostic or a gap.
