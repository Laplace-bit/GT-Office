# Separate Business Designer diagnostics from gaps

Business Designer validation reports diagnostics for document problems that prevent reliable parsing, schema validation, or host-block localization, while gaps report incomplete or inconsistent business design structure inside otherwise understandable blocks. We chose this boundary over severity-based classification so an `error` can still be a gap when it is anchored and agent-fixable, and so malformed documents do not become agent tasks.
