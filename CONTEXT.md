# GT Office

GT Office is a cross-platform desktop workspace for managing AI agents, project files, terminals, Git state, collaboration windows, tool adapters, change feeds, and channels.

## Language

**Business Designer**:
A workspace tool for shaping a requirement into structured design artifacts that agents and humans can inspect, validate, and refine.
_Avoid_: Business CMS, form editor

**Block**:
A typed unit of business design content in the Business Designer graph. Blocks are the nodes that carry requirement structure.
_Avoid_: Section, card, document part

**Link**:
A derived relationship between blocks in the Business Designer graph. Links are inferred from block content rather than hand-drawn by the user.
_Avoid_: Manual edge, connector

**Derived Link**:
A link whose business meaning is computed from block content by Business Designer validation. Derived links are semantic relationships, not frontend drawing artifacts.
_Avoid_: Frontend edge, visual connector

**Gap**:
A machine-detected missing or inconsistent part of a block or its relationships. A gap is the only valid target for v1 Business Designer agent completion.
_Avoid_: AI suggestion, issue, lint diagnostic

**Gap Fingerprint**:
The semantic identity used to compare a gap across validation runs. A fingerprint combines the host block, gap code, and the most stable available locator.
_Avoid_: Persistent gap id, database id

**Agent-Fixable Gap**:
A gap that deterministic rules classify as safe for an agent to attempt because the missing structure can be supplied without a human product decision.
_Avoid_: Suggested gap, auto-fix

**Diagnostic**:
A finding that the Business Designer document cannot be reliably parsed, validated as a file, or mapped to a host block. Diagnostics are not agent completion targets.
_Avoid_: Gap, business rule failure

**Host Block**:
The block that owns a gap and bounds an agent completion task. A v1 agent task must be anchored to one host block.
_Avoid_: Target node, selected block

**Agent Patch**:
A typed proposed change produced by an agent for user review. In v1 Business Designer, an agent patch must be traceable to a host block and one or more gaps.
_Avoid_: AI rewrite, direct edit
