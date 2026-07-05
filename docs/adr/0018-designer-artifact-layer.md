# ADR 0018: Designer Artifact Layer — code-gen-ready prompt asset

- Date: 2026-07-05
- Status: Accepted
- Supersedes: none (extends ADR 0001-0017 which covered anchored completion only)

## Context

The business designer was a "structured requirement package with design-completion loops" (outputContract: DesignerAgentPatch). Sub-project A reorients it toward code generation: the spec must double as a prompt asset a code agent consumes.

## Decision

1. UI pillar = HTML. `uiScreen` block payload is raw HTML; `data-*` attributes (data-nav/data-entity/data-api/data-flow) encode cross-block links. HTML is the single source of truth (design doc + renderable preview + code-gen asset).
2. `dataContract` upgraded to validated JSON Schema (object or legacy string). `entityModel` derives JSON Schema at compile time.
3. Compile emits `code-gen-prompt.md` (outputContract: code, in prose) alongside the existing `designerPatch` outputs. Two agent tracks, two contracts.
4. New `completeness_rules` soft layer (Info/Warning, non-blocking) detects orphan blocks / missing acceptance / uncovered flows.
5. Consumption deferred to existing Agent Station sessions (no new C subsystem).

## Consequences

- `scraper` crate added (HTML parsing) — compile time increases slightly.
- `DesignerGeneratedPaths.code_gen_prompt` is `#[serde(default)]` for backward compat with existing manifests.
- Automated code-gen→spec feedback loop is out of scope (v1: manual via B).
- `uiWorkflow` remains a placeholder (interaction flow carried by HTML data-*).
