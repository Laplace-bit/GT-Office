# Return no-op preview when Business Designer has no agent-fixable gaps

Business Designer block-scope completion only targets agent-fixable gaps. We decided that preview returns a typed no-op result when a block has no agent-fixable target gaps, optionally including human-decision context gaps for display, and dispatch remains unavailable. This prevents the UI from falling back to freeform agent advice when the gap-driven contract has no valid target.
