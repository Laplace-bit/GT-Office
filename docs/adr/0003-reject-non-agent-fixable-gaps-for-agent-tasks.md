# Reject non-agent-fixable gaps for agent tasks

Business Designer gaps can require either mechanical completion or human product judgment. We decided that v1 agent preview and dispatch must reject gaps marked non-agent-fixable, while block-scope completion only includes agent-fixable gaps on the host block. This keeps agents from making product decisions under the appearance of deterministic gap resolution.
