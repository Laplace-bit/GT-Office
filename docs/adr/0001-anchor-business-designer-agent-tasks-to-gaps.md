# Anchor Business Designer agent tasks to gaps

Business Designer v1 treats gaps as machine-detected missing structure, not as optional suggestions. We decided that v1 agent completion requests must include a host block and one or more gap codes, and that legacy freeform completion must stay behind an explicit legacy path rather than making v1 anchoring fields optional. This preserves the design rule that agents patch named gaps while deterministic rules judge whether the gap was resolved.
