# Reject stale Business Designer agent patches

Business Designer agent patches are generated against a specific document revision. We decided that v1 does not automatically rebase or field-merge stale patches: `apply_agent_patch` must reject a patch when its `baseRevision` does not match the current revision, and the user must rerun preview or dispatch against the latest block state. This prevents old agent output from overwriting human edits made after the patch was generated.
