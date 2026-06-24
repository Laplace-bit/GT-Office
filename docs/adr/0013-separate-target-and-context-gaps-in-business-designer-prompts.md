# Separate target and context gaps in Business Designer prompts

Business Designer block-scope completion may need awareness of gaps that are not safe for an agent to resolve. We decided that prompts can include non-agent-fixable gaps as read-only context, while `targetGaps` contain only agent-fixable gaps and patch validation still enforces the target set. This lets agents avoid worsening human-decision gaps without treating them as completion targets.
