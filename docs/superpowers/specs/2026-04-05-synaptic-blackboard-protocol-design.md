# Synaptic Blackboard Protocol for GT Office Agents

## Summary

This document proposes a new agent-native communication protocol for GT Office called **Synaptic Blackboard Protocol (SBP)**.

SBP is designed for:

- low-friction agent collaboration
- strong operational stability
- reliable task-state transitions
- human-readable thread history
- single-machine-first deployment

It replaces the current mixed model of:

- explicit CLI replies
- observed terminal-extracted replies
- repeated prompt instructions that teach agents how to respond

The core idea is:

- every task becomes a shared thread
- agents append typed events to that thread
- ownership is made explicit through claims
- automatic observation is preserved, but it is treated as secondary evidence rather than canonical intent

## Design Goals

The protocol should optimize for:

1. **Low Friction**  
   Agents should not need repeated prompt instructions to know how to respond.

2. **Stability**  
   The system should not depend on fragile text conventions or repeated behavioral nudges.

3. **Reliability**  
   Each important state transition should be represented by a typed event, not inferred from arbitrary free-form output.

4. **Human Readability**  
   Humans should be able to inspect a thread directly and understand what happened.

5. **Single-Machine Practicality**  
   The first version should work extremely well within one GT Office instance on one machine, while leaving room for future distributed storage or transport.

## Conceptual Inspiration

SBP combines ideas from several domains:

### Blackboard Systems

Like classic blackboard architectures, all participants coordinate through a shared task space rather than ad hoc direct reply chains.

### Neural Signaling

Agents emit short, typed signals instead of repeatedly generating procedural prose about how they intend to communicate.

### Immune-System Claiming

An agent explicitly claims responsibility for a task before it progresses or completes it, making ownership visible and reducing ambiguity.

## Core Model

### Thread-First Collaboration

Each dispatch creates a stable **thread**, identified by a `thread_key`.

This thread becomes the unit of:

- collaboration
- waiting
- ownership
- inspection
- history reconstruction

The protocol should not treat communication as “A sends text to B, then B sends text back to A”.

Instead:

- A creates a thread with a `request`
- B appends structured events to that thread
- other agents or humans can inspect the same shared thread
- the thread itself becomes the canonical collaboration record

### Immutable Event Log

A thread contains an append-only ordered event log.

Each event should include at least:

- `event_id`
- `thread_key`
- `parent_event_id`
- `actor_agent_id`
- `event_type`
- `ts_ms`
- `body`
- `source`

### Why `thread_key` Instead of a Single `msgKey`

A single-key “append replies into one Redis list” model is attractive for simplicity, but it breaks down quickly for:

- multi-step collaboration
- handover
- ownership changes
- clarification loops
- observed vs explicit replies
- future multi-agent branching

So the recommended upgrade is:

- not `msgKey -> plain text list`
- but `thread_key -> typed event log`

## Event Types

The first version should support this minimal typed event model:

### `request`

The initial task or a directed follow-up request.

### `claim`

An agent explicitly takes responsibility for the thread or sub-step.

### `progress`

An interim update that work is underway.

### `needs_input`

A structured request for clarification, permission, or missing context.

### `result`

A completed answer or completed work output.

### `handover`

A structured transfer of responsibility or a completion summary passed to another agent.

### `observed`

A system-generated event derived from terminal/session observation. This is never the canonical replacement for explicit intent.

## Canonical Semantics

### Explicit Events Are Canonical

Canonical agent intent should come from:

- `claim`
- `progress`
- `needs_input`
- `result`
- `handover`

These events represent what the agent deliberately chose to say.

### Observed Events Are Secondary

`observed` exists only as fallback support.

It should be used when:

- the agent did not append an explicit event
- the system still needs a recoverable, inspectable trace of likely reply content

It should not be treated as identical to `result`.

## Claim-Based Ownership

Claiming is the protocol’s main stabilizer.

When an agent receives a request, it may immediately append:

- `claim`

This means:

- “I am taking responsibility for this thread now.”

The active claim should be visible in thread summary and inbox views.

### Why Claims Matter

Claims remove the need to repeatedly tell the target agent:

- how to reply
- when to reply
- whether it is already responsible

Claims also help prevent:

- silent ownership ambiguity
- duplicate work
- handover confusion
- fragile reliance on inferred behavior

## Human-Readable Thread Rendering

The thread should be readable directly by humans.

Each event should render naturally, for example:

- `request`: CEO asked DEV1 to review the API migration
- `claim`: DEV1 claimed the task
- `progress`: DEV1 is validating the migration path
- `needs_input`: DEV1 needs the expected compatibility window
- `result`: DEV1 completed the review: ...
- `handover`: DEV1 handed the task to QA with blockers: ...
- `observed`: System observed a likely terminal reply from DEV1

The UI and CLI should expose both:

- human-readable thread lines
- machine-readable structured event metadata

## Waiting Semantics

### Problem With the Current Model

The current model mixes:

- explicit CLI replies
- observed fallback replies
- interaction prompts
- thread scanning

This works, but it is not protocol-clean.

### New Rule

`gto send --wait` and `gto wait` should wait on **typed events**, not raw text.

Default wait completion should be:

- first `needs_input`
- or first `result`
- or first `handover`

### Observed Fallback

If no explicit event arrives in time, the system may surface an `observed` event as a fallback.

However:

- it must be labeled clearly
- it must not silently masquerade as canonical `result`
- explicit events must always outrank `observed`

## CLI Mapping

The existing `gto` CLI should become the stable user and agent entrypoint for this protocol.

### Recommended Top-Level Commands

- `gto send <from> <to> <text>`
- `gto claim <thread>`
- `gto progress <thread> <text>`
- `gto ask <thread> <text>`
- `gto result <thread> <text>`
- `gto handover <thread> <to> <summary>`
- `gto thread <thread>`
- `gto inbox <agent>`
- `gto wait <thread>`

### Compatibility Layer

For migration, the system may keep aliases such as:

- `gto agent reply-status`
- `gto agent handover`

But these should map internally to the new event model.

## Suggested Thread Summary State

Instead of the current coarse states like:

- open
- replied
- handed_over

the thread summary should include:

- `thread_key`
- `title`
- `active_owner_agent_id`
- `latest_event_type`
- `attention_target_agent_id`
- `state`
- `updated_at_ms`

Recommended states:

- `open`
- `claimed`
- `waiting_input`
- `completed`
- `handed_over`
- `observed_only`

## Inbox Semantics

Inbox should not simply mean “threads mentioning this agent”.

Inbox should mean:

- threads that currently require this agent’s attention

That includes:

- new requests addressed to the agent
- handovers addressed to the agent
- unresolved `needs_input` directed to the agent
- unclaimed threads whose intended target is that agent

## Storage Direction

This protocol should be designed as **store-agnostic**.

The first version should not hard-code Redis as the protocol definition.

Instead:

- define the protocol first
- implement it locally first
- allow future backing stores later

This is important because the current project already constrains Redis usage behind a dedicated cache boundary.

### Practical First Storage

For v1:

- keep storage local to GT Office runtime/task service
- maintain append-only event logs per thread
- expose stable query APIs
- keep Redis as a future implementation option, not a present design dependency

## Why This Is Better Than a Plain `msgKey` Queue

A simple `msgKey` queue would be:

- easy to build
- easy to explain
- easy to prototype

But it would be weak in:

- ownership
- event typing
- handover semantics
- waiting semantics
- future extensibility
- human-readable reconstruction

SBP preserves the simplicity of a shared key while adding the minimum structure needed for long-term stability.

## Migration Strategy

The protocol should evolve from the current system incrementally.

### Phase 1

Introduce the event model conceptually while still mapping to existing task/thread primitives.

### Phase 2

Replace coarse “status/handover only” semantics with full event append APIs.

### Phase 3

Downgrade terminal auto-extraction from “pseudo reply” to explicit `observed` event generation.

### Phase 4

Make `gto wait` operate fully on typed event semantics.

## Acceptance Criteria

The protocol is successful when:

- agents do not need repeated prompt text explaining how to reply
- ownership is explicit and inspectable
- waiting can resolve deterministically from typed thread events
- observed fallback data does not conflict with explicit intent
- humans can inspect a thread and immediately understand what happened
- the system remains practical and stable on a single machine

## Recommended Direction

For GT Office, the recommended direction is:

- **Shared Blackboard**
- **Claim-based ownership**
- **Human-readable event threads**
- **Observed fallback as secondary evidence**
- **Single-machine-first deployment**
- **CLI as the only formal agent communication surface**

This provides the best balance of:

- stability
- reliability
- low friction
- simplicity
- forward extensibility
