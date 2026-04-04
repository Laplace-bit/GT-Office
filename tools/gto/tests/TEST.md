# GTO CLI Tests

## Test Inventory Plan
- `test_core.ts`: 12 unit tests planned
- `test_e2e.ts`: 8 integration tests planned

## Unit Test Plan
- Contract normalization: bridge error envelopes, JSON parsing, required workspace id checks
- Agent command merge logic: `agent get`, `agent update` merge, `role update` merge
- Output formatting: JSON envelope and human-readable summaries

## E2E Test Plan
- agent list
- agent create -> update -> delete
- role create -> update -> delete
- channel send -> channel list-messages
- default REPL entry and one command execution

## Test Results
```text
TAP version 13
1..336
# tests 336
# suites 0
# pass 336
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 92.327333
```

## Summary Statistics
- Total tests: 336
- Pass rate: 100%

## Coverage Notes
- v1 uses fake bridge backends for CLI command tests.
- Bridge-side contract verification now includes focused Rust tests for stable MCP response envelopes, structured command-error preservation, bootstrap role-key propagation, bootstrap rejection when role-key resolution fails, and fresh-db default-role seeding visibility (`mcp_bridge::tests::bridge_response_serializes_stable_*`, `mcp_bridge::tests::map_command_error_*`, `mcp_bridge::tests::resolve_bootstrap_role_key_*`, `mcp_bridge::tests::require_bootstrap_role_key_*`, `mcp_bridge::tests::build_agent_terminal_env_*`, `mcp_bridge::tests::seed_agent_defaults_*`).
- Live desktop bridge smoke verification is still required manually.
