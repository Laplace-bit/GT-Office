# Treat dangling refs as human-decision gaps

Business Designer can deterministically detect a dangling reference, but resolving it requires choosing between changing the reference or creating the missing block. Because v1 anchored agent patches may only change the host block and must not create neighbors, we decided that `dangling-ref` remains a gap but is not agent-fixable by default. The UI should surface explicit human actions such as creating the missing entity or changing the field type.
