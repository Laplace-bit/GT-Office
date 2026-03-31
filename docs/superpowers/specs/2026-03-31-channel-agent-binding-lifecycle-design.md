# Channel Agent Binding Lifecycle Design

## Summary

Repair the external channel routing lifecycle so channel-to-agent bindings remain correct when agents are edited, disabled, or deleted. The new design makes binding state explicit, prevents silent stale routes, and adds a guided cleanup flow when deleting an agent that is still referenced by channel bindings.

This work is intentionally scoped to the channel binding lifecycle around agents inside one workspace. It does not redesign connector auth, external message rendering, or agent runtime bootstrapping.

## Problem Statement

The current implementation stores `ChannelRouteBinding` records independently from the agent repository. Deleting an agent removes the agent record but leaves any matching channel bindings untouched. Those stale bindings can still match inbound external messages, so the channel appears to receive traffic, but dispatch later fails because the target agent no longer exists or no longer has a usable runtime.

This creates three product problems:

- silent configuration drift between channel bindings and the workspace agent list
- a broken deletion experience because users can remove an agent without seeing that it is still routing external traffic
- no first-class concept of "temporarily disable this binding without deleting it"

## Goals

- Prevent stale direct-agent bindings from surviving agent deletion without an explicit cleanup decision.
- Allow users to handle dependent bindings during agent deletion by rebinding, disabling, or deleting them.
- Add a first-class enabled/disabled state to channel bindings so users can temporarily stop routing without losing configuration.
- Keep direct-agent binding edits and delete flows inside the existing channel management experience.
- Reject invalid routing targets at dispatch time so historical dirty data no longer creates misleading "message received but not delivered" behavior.
- Keep the implementation modular instead of expanding `commands/agent.rs` or `commands/tool_adapter/mod.rs`.

## Non-goals

- no redesign of connector onboarding or auth flows
- no changes to channel access policy semantics
- no cross-workspace agent rebinding
- no role-target deletion policy beyond existing role resolution behavior
- no migration of channel state from JSON into the SQLite agent database in this iteration

## Existing Facts

### Workspace identity

`workspace_id` is stable for the same canonical workspace root. It is derived from the canonical root path hash, so channel bindings are scoped by workspace root identity rather than by any agent terminal `cwd` or custom workdir.

Implications:

- the same workspace root resolves to the same `workspace_id`
- changing an agent workdir must not change channel binding ownership
- stale route recovery should continue to use workspace-root fallback only as a repair path, not as a primary binding key

### Current root cause

- `ChannelRouteBinding` only models route fields plus target selector and has no enabled/disabled state.
- `agent_delete` deletes the agent record but does not inspect or mutate route bindings.
- route resolution can still return a stale direct-agent target from persisted binding state.
- dispatch failure happens too late in the pipeline, after the route has already been treated as matched.

## Usage Scenarios To Support

### 1. Delete an unbound agent

Expected behavior:

- delete succeeds immediately
- no channel binding changes are required

### 2. Delete a directly bound agent and keep the route intent

Expected behavior:

- the system finds all bindings targeting that agent in the same workspace
- the delete flow offers a replacement agent
- bindings are atomically rebound before the agent record is removed

### 3. Delete a directly bound agent but temporarily stop routing

Expected behavior:

- the system finds all bindings targeting that agent in the same workspace
- the user chooses "disable bindings"
- bindings remain visible in channel management but are no longer routable

### 4. Delete a directly bound agent and remove its routes entirely

Expected behavior:

- the system deletes the dependent bindings and then deletes the agent

### 5. Edit an existing binding to a different agent

Expected behavior:

- existing editing UI continues to work
- target changes are treated as a normal binding update

### 6. Temporarily close and later reopen a binding

Expected behavior:

- users can toggle a binding between enabled and disabled
- disabled bindings stay editable and visible
- disabled bindings do not participate in route matching

### 7. Historical dirty data references a deleted agent

Expected behavior:

- route resolution or target validation rejects the stale target before dispatch
- the user sees a clear configuration error instead of a fake successful route

## Approach Evaluation

### Option A: Always block deletion while bindings exist

Pros:

- safest default
- simple mental model

Cons:

- forces users into a second screen to resolve bindings
- poor batch-operation ergonomics

### Option B: Always auto-delete bindings with the agent

Pros:

- fastest delete path

Cons:

- destructive by default
- easy to lose external routing unintentionally

### Option C: Block by default, allow explicit cleanup strategy

Pros:

- safe default
- flexible for real workspace maintenance
- covers rebind, disable, and delete without hidden data loss

Cons:

- more implementation surface

## Chosen Direction

Use Option C.

Deletion remains safe by default, but users can explicitly choose one of three cleanup strategies when the agent is still referenced by direct channel bindings:

- `rebind`
- `disable`
- `delete`

In addition, bindings gain an `enabled` flag so "temporarily close this route" is a first-class state instead of an implicit delete/recreate workflow.

## Data Model Changes

### `ChannelRouteBinding`

Add:

- `enabled: bool` with default `true`
- optional normalization behavior that preserves backward compatibility for persisted records missing the field

Behavior:

- disabled bindings remain stored, editable, and listable
- disabled bindings are excluded from route matching

### Deletion request model

Extend agent deletion so the request can carry an optional binding cleanup policy:

- `cleanupMode?: "reject" | "rebind" | "disable" | "delete"`
- `replacementAgentId?: string | null`

Default behavior without an explicit cleanup mode:

- reject deletion if dependent direct bindings exist

### Deletion response model

Return structured cleanup information:

- `deleted: bool`
- `bindingCleanup?: { matchedCount, mode, updatedCount, deletedCount, disabledCount, reboundToAgentId? }`
- `blockingBindings?: ChannelRouteBinding[]` when deletion is rejected due to dependencies

## Binding Semantics

### Which bindings are considered dependent on an agent delete

Only direct-agent targets that exactly reference the deleted agent in the same workspace are considered deletion dependencies.

This includes:

- `targetAgentId = "<agent-id>"`

This does not include:

- `targetAgentId = "role:<role-key>"`

Reason:

- role-target bindings are intentionally indirect and should continue to resolve through role membership rules
- deleting one agent does not invalidate a role selector if other eligible agents remain

### Enabled vs deleted

Use `enabled = false` when the user wants to pause routing while preserving connector/account/peer targeting metadata.

Use delete when the user wants the route removed entirely.

## Backend Architecture

### New responsibility split

The implementation should not continue expanding large command modules. Split responsibilities into focused feature files.

Suggested Tauri command structure:

- `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_store.rs`
  - load/save persisted channel binding state
  - list bindings
  - upsert/delete/toggle bindings
  - route-binding lookup helpers
- `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_target_validation.rs`
  - determine whether a binding target selector is currently valid in a workspace
  - validate direct-agent targets against repository/runtime state
  - resolve role selectors to valid dispatch targets
- `apps/desktop-tauri/src-tauri/src/commands/agent/binding_cleanup.rs`
  - collect bindings referencing a direct agent target
  - execute cleanup strategies for delete flows
  - format structured delete rejection payloads

Existing command entry files remain thin:

- `commands/agent.rs` only parses request/returns response and delegates cleanup logic
- `commands/tool_adapter/mod.rs` only binds public commands and delegates binding service logic

### Binding target validation

Validation must happen in two places:

1. Write-time validation
   - direct-agent targets must reference an existing agent in the same workspace
   - replacement agent for delete cleanup must exist in the same workspace

2. Dispatch-time validation
   - even if dirty historical data exists, direct-agent targets must be checked before dispatch
   - invalid direct-agent targets should produce an explicit failure such as `CHANNEL_TARGET_NOT_AVAILABLE`

This dual validation closes both the "new bad write" path and the "old stale data still persisted" path.

### Route resolution pipeline

Revised behavior:

1. Match only `enabled` bindings.
2. Resolve the route candidate as today.
3. Before dispatch, validate the selected target selector in the resolved workspace.
4. If invalid:
   - emit structured error event
   - return failed/route-invalid response
   - do not attempt terminal dispatch

### Persistence compatibility

Persisted channel state remains in `channel/state.json` for this iteration.

Backward compatibility rules:

- missing `enabled` in older records defaults to `true`
- persisted records continue to store `workspace_root` for stale workspace recovery
- cleanup mutations must re-persist state immediately after binding changes

## Frontend UX

### Channel management

Add first-class binding state controls to the existing channel management surface:

- show enabled/disabled status in route cards
- allow quick toggle without opening the full wizard
- keep edit and delete actions

Edit flow remains:

- change target agent
- change role target
- change peer scope/pattern
- change priority

### Agent delete flow

When deleting a station/agent:

- if no dependent direct bindings exist, delete immediately
- if dependent bindings exist, open a cleanup dialog instead of blindly deleting

Dialog requirements:

- list affected bindings with channel/account/peer summary
- show three explicit strategies:
  - rebind to another agent
  - disable bindings
  - delete bindings
- only enable confirm when required inputs are valid
- use clear destructive messaging for delete strategy

### Close/disable semantics

Language should distinguish:

- `Disable binding`
- `Enable binding`
- `Delete binding`

This avoids overloading "close" with ambiguous meaning.

## API Surface Changes

### Channel binding commands

Keep:

- `channel_binding_upsert`
- `channel_binding_list`
- `channel_binding_delete`

Add:

- `channel_binding_toggle` or extend `channel_binding_upsert` to persist `enabled`

Preferred direction:

- keep `upsert` as the general write path and include `enabled`
- optionally add a dedicated toggle command only if the frontend benefits from a lighter write contract

### Agent delete command

Extend `agent_delete` request/response instead of inventing a second delete API.

The command should support:

- preview-like rejection with blocking bindings when no cleanup mode is provided
- one-shot cleanup + delete when cleanup mode is provided and valid

## Error Semantics

Introduce explicit, user-facing error categories:

- `AGENT_DELETE_BLOCKED_BY_CHANNEL_BINDINGS`
- `CHANNEL_TARGET_NOT_AVAILABLE`
- `CHANNEL_BINDING_TARGET_INVALID`
- `CHANNEL_BINDING_REPLACEMENT_AGENT_INVALID`

These should be propagated in a structured way so the frontend can render a proper delete dialog or inline form error instead of only showing a generic string.

## Verification Strategy

### Backend tests

Add coverage for:

- same workspace root yields stable workspace id
- disabled bindings are skipped during route matching
- agent delete rejects when dependent bindings exist and no cleanup mode is supplied
- agent delete with `rebind` updates bindings and deletes agent
- agent delete with `disable` disables bindings and deletes agent
- agent delete with `delete` removes bindings and deletes agent
- direct-agent write validation rejects unknown agent ids
- dispatch-time validation rejects stale direct-agent targets

### Frontend tests

Add coverage for:

- delete dialog appears when backend reports blocking bindings
- rebind strategy requires replacement agent
- disable strategy keeps bindings but marks them disabled
- toggle control reflects enabled/disabled state and submits the correct update

### Minimal product verification

- create a binding to a live agent, delete the agent, confirm the cleanup dialog appears
- choose each cleanup strategy once and verify final binding state
- send an external message against a disabled binding and verify it is not routed
- seed a stale direct-agent binding manually and verify inbound dispatch fails clearly instead of silently routing

## Open Decisions Resolved In This Design

- Binding ownership remains scoped by `workspace_id`, which is stable per workspace root.
- Direct-agent bindings are deletion dependencies; role bindings are not.
- Disabled bindings remain persisted and editable.
- Invalid historical direct-agent targets must fail before dispatch, not after route success reporting.
- The implementation must be modularized into focused helper files rather than enlarging existing command barrels.

## Implementation Notes

Keep the diff intentionally local:

- no unrelated refactors
- no new storage backend
- no cross-feature abstraction for hypothetical future channel systems

The success bar for this iteration is practical correctness:

- users cannot silently break channel routing by deleting an agent
- users can intentionally rebind or pause routes
- stale direct-agent bindings no longer create misleading inbound behavior
