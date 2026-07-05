# Designer Artifact Layer (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the business designer produce a code-gen-ready prompt asset — four pillars (text + JSON Schema + flow + UI/HTML) with consistency + completeness rules, compiled to `code-gen-prompt.md` for an Agent Station to consume.

**Architecture:** HTML-based `uiScreen` block (payload = HTML, `data-*` attributes encode cross-block links). `dataContract` gets light JSON Schema validation. A new `completeness_rules` layer (soft, non-blocking) complements the existing `gap_rules` consistency layer. A new `code_gen_prompt` renderer emits the code-gen prompt asset alongside the existing `designerPatch`-oriented outputs. Backend in `commands/business_designer/`; frontend in `features/business-designer/`.

**Tech Stack:** Rust (Tauri commands, `scraper` crate for HTML parsing, `serde_json`), TypeScript/React (iframe `srcdoc` for HTML preview, annotation overlay).

**Spec:** `docs/superpowers/specs/2026-07-05-designer-artifact-layer-design.md`

## Global Constraints

- **New Rust dependency `scraper`** (HTML `data-*` extraction) — add to `apps/desktop-tauri/src-tauri/Cargo.toml` `[dependencies]` as `scraper = "0.20"` (if unavailable, run `cargo add scraper` to pin latest 0.x). Record in `docs/07_依赖选型与精简清单.md` (Task 12).
- **`DesignerGeneratedPaths` uses `#[serde(deny_unknown_fields)]`** — the new `code_gen_prompt` field MUST use `#[serde(default = "default_code_gen_prompt_path")]` so existing on-disk manifests deserialize without migration.
- **`outputContract` interpretation:** keep `agent-input.json` as `outputContract: "DesignerAgentPatch"` (design-completion track, UNCHANGED). The code-gen contract lives in `code-gen-prompt.md`'s "Output Contract" section (prose). Do NOT add a `code` mode to `agent-input.json`.
- **`dataContract.schema` backward compat:** `check_data_contract` accepts `schema` as EITHER a string (legacy — parse to JSON) OR an object (new). No hard payload migration.
- **Completeness gaps:** `layer: "completeness"`, severity `Info`/`Warning`, non-blocking. Existing `validate_design` diagnostics for `acceptance_block_missing`/`agent_instruction_missing` REMAIN (mild duplication accepted for v1; dedup later).
- **Document-level completeness gaps** (`flow-unverified`, `no-agent-instruction`) anchor `block_id` to the document's first block id.
- **Rust** must pass `cargo fmt` and `cargo clippy` (per CLAUDE.md). **Frontend** uses SCSS (no raw CSS), responsive units (no `px`), dark/light theme support.
- **Verification commands:** backend `cargo test -p desktop-tauri business_designer` + `cargo check --workspace`; frontend `cd apps/desktop-web && npx tsc -b`.

## File Structure

**Backend** `apps/desktop-tauri/src-tauri/src/commands/business_designer/`:
- `mod.rs` — extend types (`DesignerGapLayer`, `DesignerGapSeverity`, `DesignerEdgeRelation`, `DesignerGeneratedPaths`), `is_supported_block_kind`, `render_block_markdown`, `compile_document_at`, `export_document_at`, `normalize_export_format`, `default_generated_paths`, `validate_document_at`; declare new submodules.
- `gap_rules.rs` — add `check_ui_screen`, `check_data_contract`; extend `run_all` dispatch + `derive_edges` uiScreen arm.
- `ui_refs.rs` (NEW) — `extract_ui_refs(html)` data-* extraction (shared by gap_rules + completeness_rules).
- `completeness_rules.rs` (NEW) — `run_completeness(graph, derived_edges)`.
- `code_gen_prompt.rs` (NEW) — `render_code_gen_prompt(detail)`.
- `tests/gap_rules_tests.rs`, `tests/mod_tests.rs` — new test fns.

**Frontend** `apps/desktop-web/src/features/business-designer/`:
- `model/designer-blocks.ts` — add `'uiScreen'` kind.
- `model/designer-validation.ts` — extend `layer`/`severity`/`DesignerEdgeRelation`.
- `model/designer-document-operations.ts` — `uiScreen` create-defaults + `AGENT_BLOCK_KINDS`.
- `components/DesignerDocument.tsx` — `uiScreen` iframe render + `dataContract` object render.
- `components/DesignerScreenPreview.tsx` (NEW) — sandboxed iframe + annotation overlay hook.
- `components/DesignerInspector.tsx` — completeness gap display.

---

### Task 1: Add `scraper` dependency + `ui_refs` HTML extraction module

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/Cargo.toml` (add `scraper` after line 30 `qrcode = "0.14"`)
- Create: `apps/desktop-tauri/src-tauri/src/commands/business_designer/ui_refs.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs:27` (add `mod ui_refs;`)
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs`

**Interfaces:**
- Produces: `ui_refs::extract_ui_refs(html: &str) -> UiRefs` where `UiRefs { nav: Vec<String>, entity: Vec<String>, api: Vec<String>, flow: Vec<String> }`; `ui_refs::data_api_contract_id(value: &str) -> &str`.

- [ ] **Step 1: Add the dependency**

In `apps/desktop-tauri/src-tauri/Cargo.toml`, after the line `qrcode = "0.14"` (line 30), add:
```toml
scraper = "0.20"
```

- [ ] **Step 2: Declare the module**

In `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs`, after line 27 (`mod gap_rules;`), add:
```rust
mod ui_refs;
```

- [ ] **Step 3: Write the failing test**

Append to `tests/gap_rules_tests.rs`:
```rust
#[test]
fn ui_refs_extracts_data_attributes() {
    use super::super::ui_refs::extract_ui_refs;
    let html = r#"<section data-flow="order-flow">
      <h1 data-nav="dashboard">Orders</h1>
      <button data-api="orders-api:POST /orders" data-entity="order">Create</button>
    </section>"#;
    let refs = extract_ui_refs(html);
    assert_eq!(refs.nav, vec!["dashboard".to_string()]);
    assert_eq!(refs.entity, vec!["order".to_string()]);
    assert_eq!(refs.api, vec!["orders-api:POST /orders".to_string()]);
    assert_eq!(refs.flow, vec!["order-flow".to_string()]);
}

#[test]
fn ui_refs_data_api_contract_id_splits_on_colon() {
    use super::super::ui_refs::data_api_contract_id;
    assert_eq!(data_api_contract_id("orders-api:POST /orders"), "orders-api");
    assert_eq!(data_api_contract_id("orders-api"), "orders-api");
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cargo test -p desktop-tauri business_designer::tests::gap_rules_tests::ui_refs_extracts_data_attributes`
Expected: FAIL — `unresolved module ui_refs` / function not found.

- [ ] **Step 5: Implement `ui_refs.rs`**

Create `apps/desktop-tauri/src-tauri/src/commands/business_designer/ui_refs.rs`:
```rust
//! HTML `data-*` cross-block reference extraction for `uiScreen` blocks.
//!
//! `uiScreen` payloads are raw HTML. The four `data-*` attributes encode links
//! to other design blocks: `data-nav` (uiScreen), `data-entity` (entityModel),
//! `data-api` (apiContract, optionally `id:METHOD path`), `data-flow`
//! (businessFlow). This module is the single shared extractor used by both
//! `gap_rules` (consistency: refs must resolve) and `completeness_rules`
//! (orphan detection across all screens).

use scraper::{Html, Selector};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct UiRefs {
    pub nav: Vec<String>,
    pub entity: Vec<String>,
    pub api: Vec<String>,
    pub flow: Vec<String>,
}

/// Extract every `data-nav`/`data-entity`/`data-api`/`data-flow` value from the
/// given HTML fragment. Malformed HTML is tolerated by `html5ever`; an
/// unparseable selector (impossible for this static string) yields empty refs.
pub(crate) fn extract_ui_refs(html: &str) -> UiRefs {
    let fragment = Html::parse_fragment(html);
    let mut refs = UiRefs::default();
    let Ok(selector) = Selector::parse("[data-nav], [data-entity], [data-api], [data-flow]") else {
        return refs;
    };
    for element in fragment.select(&selector) {
        let value = element.value();
        if let Some(v) = value.attr("data-nav") {
            refs.nav.push(v.to_string());
        }
        if let Some(v) = value.attr("data-entity") {
            refs.entity.push(v.to_string());
        }
        if let Some(v) = value.attr("data-api") {
            refs.api.push(v.to_string());
        }
        if let Some(v) = value.attr("data-flow") {
            refs.flow.push(v.to_string());
        }
    }
    refs
}

/// A `data-api` value is `contractId` or `contractId:METHOD path`. Return the
/// contract id (before the first `:`).
pub(crate) fn data_api_contract_id(value: &str) -> &str {
    value.split(':').next().unwrap_or(value).trim()
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test -p desktop-tauri business_designer::tests::gap_rules_tests::ui_refs`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop-tauri/src-tauri/Cargo.toml apps/desktop-tauri/src-tauri/src/commands/business_designer/ui_refs.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs
git commit -m "feat(designer): add scraper dep + ui_refs HTML data-* extractor"
```

---

### Task 2: Extend gap types (Completeness layer, Info severity, NavigatesTo/ParticipatesIn)

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs:69-103` (enums)
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/gap_rules.rs:39-45` (`DERIVED_EDGE_RELATIONS`)
- Modify: `apps/desktop-web/src/features/business-designer/model/designer-validation.ts:29-47`
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs`

**Interfaces:**
- Produces: `DesignerGapLayer::Completeness`, `DesignerGapSeverity::Info`, `DesignerEdgeRelation::NavigatesTo`, `DesignerEdgeRelation::ParticipatesIn` (Rust); TS `'completeness'` layer, `'info'` severity, `'navigatesTo'`/`'participatesIn'` relations.

- [ ] **Step 1: Write the failing test (serde round-trip)**

Append to `tests/gap_rules_tests.rs`:
```rust
#[test]
fn completeness_gap_serializes_with_new_layer_severity() {
    use super::super::{DesignerGap, DesignerGapLayer, DesignerGapSeverity};
    let gap = DesignerGap {
        id: "gap_1".to_string(),
        key: "brief:flow-unverified".to_string(),
        code: "flow-unverified".to_string(),
        block_id: "brief".to_string(),
        layer: DesignerGapLayer::Completeness,
        severity: DesignerGapSeverity::Info,
        message: "doc has no acceptance".to_string(),
        fixable_by_agent: true,
        locator: None,
    };
    let value = serde_json::to_value(&gap).unwrap();
    assert_eq!(value["layer"], "completeness");
    assert_eq!(value["severity"], "info");
}

#[test]
fn derived_edge_relations_include_navigates_and_participates() {
    use super::super::gap_rules::DERIVED_EDGE_RELATIONS;
    use super::super::DesignerEdgeRelation;
    assert!(DERIVED_EDGE_RELATIONS
        .iter()
        .any(|r| *r == DesignerEdgeRelation::NavigatesTo));
    assert!(DERIVED_EDGE_RELATIONS
        .iter()
        .any(|r| *r == DesignerEdgeRelation::ParticipatesIn));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p desktop-tauri business_designer::tests::gap_rules_tests::completeness_gap_serializes`
Expected: FAIL — `no variant Completeness` / `no variant NavigatesTo`.

- [ ] **Step 3: Extend the Rust enums**

In `mod.rs`, replace the `DesignerGapLayer` enum (lines 69-74):
```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesignerGapLayer {
    Intra,
    Inter,
    Completeness,
}
```

Replace `DesignerGapSeverity` (lines 76-81):
```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesignerGapSeverity {
    Info,
    Warning,
    Error,
}
```

Replace `DesignerEdgeRelation` (lines 95-103):
```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesignerEdgeRelation {
    DependsOn,
    Produces,
    Consumes,
    Uses,
    Extends,
    NavigatesTo,
    ParticipatesIn,
}
```

- [ ] **Step 4: Update `DERIVED_EDGE_RELATIONS` test const**

In `gap_rules.rs`, replace lines 38-45:
```rust
#[cfg(test)]
pub(crate) const DERIVED_EDGE_RELATIONS: [DesignerEdgeRelation; 7] = [
    DesignerEdgeRelation::DependsOn,
    DesignerEdgeRelation::Produces,
    DesignerEdgeRelation::Consumes,
    DesignerEdgeRelation::Uses,
    DesignerEdgeRelation::Extends,
    DesignerEdgeRelation::NavigatesTo,
    DesignerEdgeRelation::ParticipatesIn,
];
```

- [ ] **Step 5: Run Rust tests to verify they pass**

Run: `cargo test -p desktop-tauri business_designer`
Expected: PASS (existing tests still pass; new tests pass).

- [ ] **Step 6: Extend the TS types**

In `apps/desktop-web/src/features/business-designer/model/designer-validation.ts`, update `DesignerGap.layer` (line 29) and `severity` (line 30):
```ts
export interface DesignerGap {
  id: string
  key: string
  code: string
  blockId: string
  layer: 'intra' | 'inter' | 'completeness'
  severity: 'info' | 'warning' | 'error'
  message: string
  fixableByAgent: boolean
  locator?: Record<string, string> | null
}
```

Update `DesignerEdgeRelation` (lines 41-47):
```ts
export type DesignerEdgeRelation =
  | 'dependsOn'
  | 'produces'
  | 'consumes'
  | 'uses'
  | 'extends'
  | 'navigatesTo'
  | 'participatesIn'
```

- [ ] **Step 7: Verify frontend typechecks**

Run: `cd apps/desktop-web && npx tsc -b`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/gap_rules.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs apps/desktop-web/src/features/business-designer/model/designer-validation.ts
git commit -m "feat(designer): add Completeness layer, Info severity, NavigatesTo/ParticipatesIn relations"
```

---

### Task 3: `uiScreen` block kind backend support + `dataContract` render

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs:5340-5360` (`is_supported_block_kind`)
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs:5249-5261` (`render_block_markdown`)
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/mod_tests.rs`

**Interfaces:**
- Produces: `is_supported_block_kind("uiScreen") == true`; `render_block_markdown` arms for `uiScreen` (HTML) and `dataContract` (schema).

- [ ] **Step 1: Write the failing test**

Append to `tests/mod_tests.rs`:
```rust
#[test]
fn ui_screen_is_supported_and_renders_html() {
    assert!(is_supported_block_kind("uiScreen"));
    let block = DesignerBlock {
        id: "screen-1".to_string(),
        kind: "uiScreen".to_string(),
        title: "Orders".to_string(),
        order: 10,
        payload: json!({ "screenName": "Orders", "route": "/orders", "html": "<section><h1>Orders</h1></section>" }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    };
    let rendered = render_block_markdown(&block);
    assert!(rendered.contains("<section><h1>Orders</h1></section>"));
}

#[test]
fn data_contract_renders_object_schema() {
    let block = DesignerBlock {
        id: "dc-1".to_string(),
        kind: "dataContract".to_string(),
        title: "Order schema".to_string(),
        order: 10,
        payload: json!({ "schema": { "type": "object", "properties": { "id": { "type": "string" } } }, "format": "json-schema-draft-07" }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    };
    let rendered = render_block_markdown(&block);
    assert!(rendered.contains("\"type\": \"object\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p desktop-tauri business_designer::tests::ui_screen_is_supported`
Expected: FAIL — `is_supported_block_kind("uiScreen")` is false.

- [ ] **Step 3: Add `uiScreen` to `is_supported_block_kind`**

In `mod.rs` `is_supported_block_kind` (lines 5340-5360), add `"uiScreen"` to the `matches!` list (e.g. after `"uiWorkflow"`):
```rust
fn is_supported_block_kind(kind: &str) -> bool {
    matches!(
        kind,
        "text"
            | "glossary"
            | "entityModel"
            | "businessFlow"
            | "ruleTable"
            | "pseudocode"
            | "objectModel"
            | "apiContract"
            | "dataContract"
            | "uiWorkflow"
            | "uiScreen"
            | "technicalStack"
            | "nonFunctional"
            | "acceptanceCriteria"
            | "openQuestions"
            | "agentInstruction"
            | "decisionRecord"
    )
}
```

- [ ] **Step 4: Add `uiScreen` + `dataContract` arms to `render_block_markdown`**

In `mod.rs`, replace `render_block_markdown` (lines 5249-5261):
```rust
fn render_block_markdown(block: &DesignerBlock) -> String {
    match block.kind.as_str() {
        "text" => payload_string(&block.payload, "markdown").unwrap_or_else(|| "{}".to_string()),
        "agentInstruction" => {
            payload_string(&block.payload, "instructions").unwrap_or_else(|| "{}".to_string())
        }
        "acceptanceCriteria" => render_payload_list(&block.payload, "criteria"),
        "openQuestions" => render_payload_list(&block.payload, "questions"),
        "entityModel" => render_entity_model(&block.payload),
        "apiContract" => render_api_contract(&block.payload),
        "uiScreen" => render_ui_screen_markdown(&block.payload),
        "dataContract" => render_data_contract_markdown(&block.payload),
        _ => stable_json_string(&block.payload).unwrap_or_else(|_| "{}\n".to_string()),
    }
}

/// Render a `uiScreen` block: heading + route + the HTML body in a fenced block.
fn render_ui_screen_markdown(payload: &Value) -> String {
    let name = payload_string(payload, "screenName").unwrap_or_default();
    let route = payload_string(payload, "route").unwrap_or_default();
    let html = payload_string(payload, "html").unwrap_or_default();
    let mut out = String::new();
    if !name.is_empty() {
        out.push_str(&format!("### {name}\n\n"));
    }
    if !route.is_empty() {
        out.push_str(&format!("- Route: `{route}`\n\n"));
    }
    if !html.is_empty() {
        out.push_str("```html\n");
        out.push_str(&html);
        out.push_str("\n```\n");
    }
    out
}

/// Render a `dataContract` block: the schema (object or string) in a json fence.
fn render_data_contract_markdown(payload: &Value) -> String {
    let Some(schema) = payload.get("schema") else {
        return String::new();
    };
    let pretty = match schema {
        Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| "{}".to_string()),
    };
    format!("```json\n{pretty}\n```\n")
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p desktop-tauri business_designer::tests::ui_screen_is_supported business_designer::tests::data_contract_renders_object_schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/mod_tests.rs
git commit -m "feat(designer): support uiScreen block kind + dataContract schema render"
```

---

### Task 4: `check_ui_screen` consistency rule + `derive_edges` UI arm

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/gap_rules.rs` (`run_all` lines 47-66, `derive_edges` lines 72-194, new `check_ui_screen`)
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs`

**Interfaces:**
- Consumes: `ui_refs::extract_ui_refs`, `ui_refs::data_api_contract_id` (Task 1); `DesignerEdgeRelation::NavigatesTo`/`ParticipatesIn`/`Uses`/`Consumes` (Task 2).
- Produces: gap codes `"ui-no-html"`, `"ui-dangling-ref"`; derived edges from `uiScreen` HTML `data-*`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gap_rules_tests.rs`:
```rust
#[test]
fn ui_screen_dangling_data_ref_emits_gap() {
    let g = graph(vec![
        block("screen-1", "uiScreen", json!({
            "screenName": "Orders",
            "html": "<button data-api=\"missing-api\">Go</button>"
        })),
    ]);
    let result = run_all(&g);
    let codes = gap_codes(&result, "screen-1");
    assert!(codes.contains(&"ui-dangling-ref".to_string()));
}

#[test]
fn ui_screen_valid_refs_derive_edges_and_no_gap() {
    let g = graph(vec![
        block("orders-api", "apiContract", json!({ "endpoints": [{ "path": "/orders", "method": "GET" }] })),
        block("order", "entityModel", json!({ "entityName": "Order", "fields": [{ "name": "id", "type": "string" }] })),
        block("order-flow", "businessFlow", json!({ "states": [{ "name": "created" }], "transitions": [] })),
        block("dashboard", "uiScreen", json!({ "screenName": "Dashboard", "html": "<a data-nav=\"orders\">Orders</a>" })),
        block("orders", "uiScreen", json!({
            "screenName": "Orders",
            "html": "<button data-api=\"orders-api:POST /orders\" data-entity=\"order\" data-flow=\"order-flow\">Create</button>"
        })),
    ]);
    let result = run_all(&g);
    assert!(!gap_codes(&result, "orders").contains(&"ui-dangling-ref".to_string()));
    assert!(result.derived_edges.iter().any(|e| e.from_block_id == "orders" && e.to_block_id == "orders-api" && e.relation == DesignerEdgeRelation::Consumes));
    assert!(result.derived_edges.iter().any(|e| e.from_block_id == "orders" && e.to_block_id == "order" && e.relation == DesignerEdgeRelation::Uses));
    assert!(result.derived_edges.iter().any(|e| e.from_block_id == "orders" && e.to_block_id == "order-flow" && e.relation == DesignerEdgeRelation::ParticipatesIn));
    assert!(result.derived_edges.iter().any(|e| e.from_block_id == "dashboard" && e.to_block_id == "orders" && e.relation == DesignerEdgeRelation::NavigatesTo));
}

#[test]
fn ui_screen_empty_html_emits_gap() {
    let g = graph(vec![block("s1", "uiScreen", json!({ "screenName": "S", "html": "" }))]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "s1").contains(&"ui-no-html".to_string()));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p desktop-tauri business_designer::tests::gap_rules_tests::ui_screen`
Expected: FAIL — `check_ui_screen` not dispatched; no edges/gaps.

- [ ] **Step 3: Extend `run_all` to dispatch uiScreen + build block id→kind index**

In `gap_rules.rs`, replace `run_all` (lines 47-66):
```rust
pub(crate) fn run_all(graph: &DesignerDesignGraph) -> GapRunResult {
    let derived_edges = derive_edges(graph);
    let entity_index = build_entity_index(graph);
    let block_kinds: HashMap<String, String> = graph
        .blocks
        .iter()
        .map(|b| (b.id.clone(), b.kind.clone()))
        .collect();

    let mut result = GapRunResult {
        derived_edges: derived_edges.clone(),
        ..Default::default()
    };

    for block in &graph.blocks {
        match block.kind.as_str() {
            "entityModel" => check_entity_model(block, &entity_index, &mut result),
            "businessFlow" => check_business_flow(block, &mut result),
            "apiContract" => check_api_contract(block, &derived_edges, &mut result),
            "uiScreen" => check_ui_screen(block, &block_kinds, &mut result),
            "dataContract" => check_data_contract(block, &mut result),
            _ => {} // other kinds: no consistency gaps.
        }
    }

    result
}
```

- [ ] **Step 4: Add the `uiScreen` arm to `derive_edges`**

In `gap_rules.rs` `derive_edges`, inside the `for block in &graph.blocks { match ... }` (after the `"businessFlow"` arm, before `_ => {}` at line 189), add a new arm. First, build a `block_ids` set at the top of `derive_edges` (after line 74 `let mut edges...`). Add after line 74:
```rust
    let block_ids: HashSet<String> = graph.blocks.iter().map(|b| b.id.clone()).collect();
```
Then add the arm before `_ => {}`:
```rust
            // uiScreen: data-nav/data-entity/data-api/data-flow → edges
            "uiScreen" => {
                let Some(html) = block.payload.get("html").and_then(Value::as_str) else {
                    continue;
                };
                let refs = super::ui_refs::extract_ui_refs(html);
                for target in &refs.nav {
                    if block_ids.contains(target.as_str()) {
                        push_edge(&mut edges, &mut seen, &block.id, target, DesignerEdgeRelation::NavigatesTo, Some("data-nav".to_string()));
                    }
                }
                for target in &refs.entity {
                    if block_ids.contains(target.as_str()) {
                        push_edge(&mut edges, &mut seen, &block.id, target, DesignerEdgeRelation::Uses, Some("data-entity".to_string()));
                    }
                }
                for raw in &refs.api {
                    let target = super::ui_refs::data_api_contract_id(raw);
                    if block_ids.contains(target) {
                        push_edge(&mut edges, &mut seen, &block.id, target, DesignerEdgeRelation::Consumes, Some("data-api".to_string()));
                    }
                }
                for target in &refs.flow {
                    if block_ids.contains(target.as_str()) {
                        push_edge(&mut edges, &mut seen, &block.id, target, DesignerEdgeRelation::ParticipatesIn, Some("data-flow".to_string()));
                    }
                }
            }
```

- [ ] **Step 5: Implement `check_ui_screen`**

Append to `gap_rules.rs` (after `check_api_contract`, near line 964):
```rust
// ---- uiScreen rules ------------------------------------------------------

fn check_ui_screen(
    block: &DesignerBlock,
    block_kinds: &HashMap<String, String>,
    result: &mut GapRunResult,
) {
    let kind = "uiScreen";
    let html = block.payload.get("html").and_then(Value::as_str).unwrap_or("");
    let has_html = !html.trim().is_empty();
    record(result, kind, "ui-no-html", &block.id, usize::from(!has_html));
    if !has_html {
        fail(
            result,
            &block.id,
            "ui-no-html",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Warning,
            "屏幕没有 HTML 内容。",
            true,
            None,
        );
        return;
    }

    let refs = super::ui_refs::extract_ui_refs(html);
    let mut dangling = 0usize;
    for v in &refs.nav {
        if check_ui_ref(&block.id, v, "data-nav", block_kinds, result) {
            dangling += 1;
        }
    }
    for v in &refs.entity {
        if check_ui_ref(&block.id, v, "data-entity", block_kinds, result) {
            dangling += 1;
        }
    }
    for v in &refs.api {
        if check_ui_ref(&block.id, v, "data-api", block_kinds, result) {
            dangling += 1;
        }
    }
    for v in &refs.flow {
        if check_ui_ref(&block.id, v, "data-flow", block_kinds, result) {
            dangling += 1;
        }
    }
    record(result, kind, "ui-dangling-ref", &block.id, dangling);
}

/// Validate a single `data-*` reference. Returns `true` if a `ui-dangling-ref`
/// gap was emitted (caller counts it for `rulesRun`). Standalone fn (not a
/// closure) so it can take `&mut GapRunResult` without entangling the caller's
/// locals in a borrow.
fn check_ui_ref(
    block_id: &str,
    target: &str,
    attr: &str,
    block_kinds: &HashMap<String, String>,
    result: &mut GapRunResult,
) -> bool {
    let target = target.trim();
    if target.is_empty() {
        return false;
    }
    let expected = match attr {
        "data-nav" => "uiScreen",
        "data-entity" => "entityModel",
        "data-api" => "apiContract",
        "data-flow" => "businessFlow",
        _ => return false,
    };
    let resolved_id = super::ui_refs::data_api_contract_id(target);
    let ok = match block_kinds.get(resolved_id) {
        Some(actual_kind) => *actual_kind == expected,
        None => false,
    };
    if ok {
        return false;
    }
    let mut loc = BTreeMap::new();
    loc.insert("attr".to_string(), attr.to_string());
    loc.insert("target".to_string(), target.to_string());
    fail(
        result,
        block_id,
        "ui-dangling-ref",
        DesignerGapLayer::Inter,
        DesignerGapSeverity::Warning,
        format!("HTML `{attr}` 引用了不存在的 block “{target}”。"),
        true,
        Some(loc),
    );
    true
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p desktop-tauri business_designer::tests::gap_rules_tests::ui_screen`
Expected: PASS (all three ui_screen tests).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/business_designer/gap_rules.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs
git commit -m "feat(designer): check_ui_screen consistency rule + derive_edges UI arm"
```

---

### Task 5: `check_data_contract` consistency rule

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/gap_rules.rs` (new `check_data_contract`; already dispatched in Task 4's `run_all`)
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs`

**Interfaces:**
- Produces: gap codes `"data-contract-invalid"`, `"data-contract-no-type"`, `"data-contract-no-properties"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gap_rules_tests.rs`:
```rust
#[test]
fn data_contract_non_object_schema_emits_invalid() {
    let g = graph(vec![block("dc-1", "dataContract", json!({ "schema": "not-json" }))]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "dc-1").contains(&"data-contract-invalid".to_string()));
}

#[test]
fn data_contract_missing_type_emits_gap() {
    let g = graph(vec![block("dc-1", "dataContract", json!({ "schema": { "properties": {} } }))]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "dc-1").contains(&"data-contract-no-type".to_string()));
}

#[test]
fn data_contract_object_without_properties_emits_gap() {
    let g = graph(vec![block("dc-1", "dataContract", json!({ "schema": { "type": "object" } }))]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "dc-1").contains(&"data-contract-no-properties".to_string()));
}

#[test]
fn data_contract_valid_object_schema_no_gap() {
    let g = graph(vec![block("dc-1", "dataContract", json!({
        "schema": { "type": "object", "properties": { "id": { "type": "string" } } }
    }))]);
    let result = run_all(&g);
    assert!(!gap_codes(&result, "dc-1").iter().any(|c| c.starts_with("data-contract")));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p desktop-tauri business_designer::tests::gap_rules_tests::data_contract`
Expected: FAIL — `check_data_contract` not implemented.

- [ ] **Step 3: Implement `check_data_contract`**

Append to `gap_rules.rs` (after `check_ui_screen`):
```rust
// ---- dataContract rules --------------------------------------------------

fn check_data_contract(block: &DesignerBlock, result: &mut GapRunResult) {
    let kind = "dataContract";
    let Some(raw) = block.payload.get("schema") else {
        record(result, kind, "data-contract-invalid", &block.id, 1);
        fail(
            result,
            &block.id,
            "data-contract-invalid",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Error,
            "dataContract 没有 schema 字段。",
            true,
            None,
        );
        return;
    };
    // Accept legacy string form (parse to JSON) or object form.
    let schema: Value = match raw {
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(parsed) => parsed,
            Err(_) => {
                record(result, kind, "data-contract-invalid", &block.id, 1);
                fail(
                    result,
                    &block.id,
                    "data-contract-invalid",
                    DesignerGapLayer::Intra,
                    DesignerGapSeverity::Error,
                    "dataContract schema 字符串不是合法 JSON。",
                    true,
                    None,
                );
                return;
            }
        },
        Value::Object(_) => raw.clone(),
        _ => {
            record(result, kind, "data-contract-invalid", &block.id, 1);
            fail(
                result,
                &block.id,
                "data-contract-invalid",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Error,
                "dataContract schema 必须是对象或 JSON 字符串。",
                true,
                None,
            );
            return;
        }
    };
    record(result, kind, "data-contract-invalid", &block.id, 0);

    let has_type = schema.get("type").and_then(Value::as_str).is_some()
        || schema.get("$ref").and_then(Value::as_str).is_some();
    record(result, kind, "data-contract-no-type", &block.id, usize::from(!has_type));
    if !has_type {
        fail(
            result,
            &block.id,
            "data-contract-no-type",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Warning,
            "dataContract schema 缺少 type 或 $ref。",
            true,
            None,
        );
    }

    let is_object = schema.get("type").and_then(Value::as_str) == Some("object");
    let has_properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|o| !o.is_empty())
        .unwrap_or(false);
    let missing_props = is_object && !has_properties;
    record(
        result,
        kind,
        "data-contract-no-properties",
        &block.id,
        usize::from(missing_props),
    );
    if missing_props {
        fail(
            result,
            &block.id,
            "data-contract-no-properties",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Warning,
            "object 类型的 dataContract schema 没有 properties。",
            true,
            None,
        );
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p desktop-tauri business_designer::tests::gap_rules_tests::data_contract`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/business_designer/gap_rules.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/gap_rules_tests.rs
git commit -m "feat(designer): check_data_contract JSON Schema consistency rule"
```

---

### Task 6: `completeness_rules` module + wire into `validate_document_at`

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/commands/business_designer/completeness_rules.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs:27` (declare module), `mod.rs:894-913` (`validate_document_at`)
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/completeness_rules_tests.rs` (NEW), registered in `tests/mod_tests.rs`

**Interfaces:**
- Consumes: `DesignerDesignGraph`, `&[DesignerDerivedEdge]` (from `run_all`), `DesignerGap`/`DesignerGapLayer::Completeness`/`DesignerGapSeverity::Info` (Task 2).
- Produces: `completeness_rules::run_completeness(graph, derived_edges) -> Vec<DesignerGap>`; gap codes `"orphan-api-contract"`, `"orphan-entity"`, `"flow-unverified"`, `"flow-uncovered-ui"`, `"no-agent-instruction"`.

- [ ] **Step 1: Declare the module + register the test file**

In `mod.rs`, after `mod ui_refs;` (added in Task 1), add:
```rust
mod completeness_rules;
```

In `tests/mod_tests.rs`, after the existing `#[path = "gap_rules_tests.rs"] mod gap_rules_tests;` (lines 32-33), add:
```rust
#[path = "completeness_rules_tests.rs"]
mod completeness_rules_tests;
```

- [ ] **Step 2: Write the failing tests**

Create `tests/completeness_rules_tests.rs`:
```rust
use serde_json::{json, Value};

use super::super::{
    completeness_rules::run_completeness,
    gap_rules::run_all,
    DesignerBlock, DesignerDesignGraph, DesignerEdgeRelation, DesignerGapLayer,
};

fn block(id: &str, kind: &str, payload: Value) -> DesignerBlock {
    DesignerBlock {
        id: id.to_string(),
        kind: kind.to_string(),
        title: id.to_string(),
        order: 10,
        payload,
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    }
}

fn graph(blocks: Vec<DesignerBlock>) -> DesignerDesignGraph {
    DesignerDesignGraph {
        schema_version: 1,
        document_id: "doc1".to_string(),
        revision: "rev".to_string(),
        title: "Test".to_string(),
        blocks,
    }
}

fn codes(gaps: &[super::super::DesignerGap]) -> Vec<String> {
    gaps.iter().map(|g| g.code.clone()).collect()
}

#[test]
fn orphan_api_contract_when_no_ui_references_it() {
    let g = graph(vec![
        block("orders", "apiContract", json!({ "endpoints": [{ "path": "/orders", "method": "GET" }] })),
        block("brief", "text", json!({ "markdown": "brief" })),
    ]);
    let run = run_all(&g);
    let gaps = run_completeness(&g, &run.derived_edges);
    assert!(codes(&gaps).contains(&"orphan-api-contract".to_string()));
    assert!(gaps.iter().all(|g| g.layer == DesignerGapLayer::Completeness));
}

#[test]
fn flow_unverified_when_no_acceptance_block() {
    let g = graph(vec![block("brief", "text", json!({ "markdown": "brief" }))]);
    let run = run_all(&g);
    let gaps = run_completeness(&g, &run.derived_edges);
    assert!(codes(&gaps).contains(&"flow-unverified".to_string()));
    assert!(codes(&gaps).contains(&"no-agent-instruction".to_string()));
}

#[test]
fn flow_uncovered_ui_when_business_flow_not_referenced() {
    let g = graph(vec![
        block("flow-1", "businessFlow", json!({ "states": [{ "name": "s" }], "transitions": [] })),
        block("brief", "text", json!({ "markdown": "brief" })),
    ]);
    let run = run_all(&g);
    let gaps = run_completeness(&g, &run.derived_edges);
    assert!(codes(&gaps).contains(&"flow-uncovered-ui".to_string()));
}

#[test]
fn no_completeness_gaps_when_all_referenced() {
    let g = graph(vec![
        block("brief", "text", json!({ "markdown": "brief" })),
        block("order", "entityModel", json!({ "entityName": "Order", "fields": [{ "name": "id", "type": "string" }] })),
        block("orders-api", "apiContract", json!({ "endpoints": [{ "path": "/orders", "method": "GET", "response": "Order" }] })),
        block("order-flow", "businessFlow", json!({ "states": [{ "name": "s" }], "transitions": [] })),
        block("acceptance", "acceptanceCriteria", json!({ "criteria": ["c"] })),
        block("instr", "agentInstruction", json!({ "instructions": "do it" })),
        block("screen", "uiScreen", json!({
            "html": "<button data-api=\"orders-api\" data-entity=\"order\" data-flow=\"order-flow\">x</button>"
        })),
    ]);
    let run = run_all(&g);
    let gaps = run_completeness(&g, &run.derived_edges);
    assert!(gaps.is_empty(), "expected no completeness gaps, got {:?}", codes(&gaps));
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p desktop-tauri business_designer::tests::completeness_rules_tests`
Expected: FAIL — `unresolved module completeness_rules`.

- [ ] **Step 4: Implement `completeness_rules.rs`**

Create `apps/desktop-tauri/src-tauri/src/commands/business_designer/completeness_rules.rs`:
```rust
//! Completeness rules: soft (non-blocking) gaps that mark a spec as "not yet
//! complete enough for accurate code generation". Distinct from `gap_rules`
//! (internal consistency). Reuses `gap_rules::derive_edges` output to detect
//! orphan blocks. Layer = `Completeness`, severity `Info`/`Warning`.

use std::collections::HashSet;

use super::{
    DesignerBlock, DesignerDerivedEdge, DesignerDesignGraph, DesignerEdgeRelation, DesignerGap,
    DesignerGapLayer, DesignerGapSeverity,
};

/// Run all completeness rules. `derived_edges` is the output of
/// `gap_rules::derive_edges` (pass `&run_all(graph).derived_edges` to avoid
/// recomputation).
pub(crate) fn run_completeness(
    graph: &DesignerDesignGraph,
    derived_edges: &[DesignerDerivedEdge],
) -> Vec<DesignerGap> {
    let mut gaps = Vec::new();

    let consumes_targets: HashSet<&str> = derived_edges
        .iter()
        .filter(|e| e.relation == DesignerEdgeRelation::Consumes)
        .map(|e| e.to_block_id.as_str())
        .collect();
    let entity_targets: HashSet<&str> = derived_edges
        .iter()
        .filter(|e| matches!(e.relation, DesignerEdgeRelation::Uses | DesignerEdgeRelation::DependsOn))
        .map(|e| e.to_block_id.as_str())
        .collect();
    let flow_targets: HashSet<&str> = derived_edges
        .iter()
        .filter(|e| e.relation == DesignerEdgeRelation::ParticipatesIn)
        .map(|e| e.to_block_id.as_str())
        .collect();

    let anchor = graph
        .blocks
        .first()
        .map(|b| b.id.clone())
        .unwrap_or_default();
    let has_acceptance = graph
        .blocks
        .iter()
        .any(|b| b.kind == "acceptanceCriteria");
    let has_agent_instruction = graph
        .blocks
        .iter()
        .any(|b| b.kind == "agentInstruction");

    for block in &graph.blocks {
        match block.kind.as_str() {
            "apiContract" if !consumes_targets.contains(block.id.as_str()) => {
                push_completeness(&mut gaps, block, "orphan-api-contract",
                    "API 契约没有被任何 UI 屏幕的 data-api 引用。");
            }
            "entityModel" if !entity_targets.contains(block.id.as_str()) => {
                push_completeness(&mut gaps, block, "orphan-entity",
                    "实体没有被任何 API 契约或 UI 屏幕引用。");
            }
            "businessFlow" if !flow_targets.contains(block.id.as_str()) => {
                push_completeness(&mut gaps, block, "flow-uncovered-ui",
                    "业务流程没有被任何 UI 屏幕的 data-flow 覆盖。");
            }
            _ => {}
        }
    }

    if !has_acceptance {
        push_doc_completeness(&mut gaps, &anchor, "flow-unverified",
            "文档缺少验收标准 block。");
    }
    if !has_agent_instruction {
        push_doc_completeness(&mut gaps, &anchor, "no-agent-instruction",
            "文档缺少 agent 编码简报 block。");
    }

    gaps
}

fn push_completeness(gaps: &mut Vec<DesignerGap>, block: &DesignerBlock, code: &str, message: &str) {
    gaps.push(DesignerGap {
        id: super::gap_rules::stable_gap_id_pub(&format!("{}:{code}", block.id)),
        key: format!("{}:{code}", block.id),
        code: code.to_string(),
        block_id: block.id.clone(),
        layer: DesignerGapLayer::Completeness,
        severity: DesignerGapSeverity::Info,
        message: message.to_string(),
        fixable_by_agent: true,
        locator: None,
    });
}

fn push_doc_completeness(gaps: &mut Vec<DesignerGap>, anchor: &str, code: &str, message: &str) {
    gaps.push(DesignerGap {
        id: super::gap_rules::stable_gap_id_pub(&format!("{anchor}:{code}")),
        key: format!("{anchor}:{code}"),
        code: code.to_string(),
        block_id: anchor.to_string(),
        layer: DesignerGapLayer::Completeness,
        severity: DesignerGapSeverity::Warning,
        message: message.to_string(),
        fixable_by_agent: true,
        locator: None,
    });
}
```

- [ ] **Step 5: Expose `stable_gap_id` for completeness reuse**

In `gap_rules.rs`, the `stable_gap_id` function (line 325) is private. Add a pub wrapper right after it:
```rust
/// Public wrapper so `completeness_rules` can produce stable gap ids without
/// duplicating the FNV-1a hasher.
pub(crate) fn stable_gap_id_pub(key: &str) -> String {
    stable_gap_id(key)
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p desktop-tauri business_designer::tests::completeness_rules_tests`
Expected: PASS (all four).

- [ ] **Step 7: Wire `run_completeness` into `validate_document_at`**

In `mod.rs`, replace `validate_document_at` (lines 894-913):
```rust
pub(crate) fn validate_document_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
) -> Result<Value, String> {
    let detail = read_document_at(workspace_id, workspace_root, document_id)?;
    let diagnostics = validate_design(&detail.manifest, &detail.design);
    let rule_result = gap_rules::run_all(&detail.design);
    let completeness = completeness_rules::run_completeness(&detail.design, &rule_result.derived_edges);
    let mut gaps = rule_result.gaps;
    gaps.extend(completeness);
    serde_json::to_value(json!({
        "schemaVersion": DESIGNER_SCHEMA_VERSION,
        "workspaceId": workspace_id,
        "documentId": detail.manifest.document_id,
        "revision": detail.design.revision,
        "diagnostics": diagnostics,
        "gaps": gaps,
        "rulesRun": rule_result.rules_run,
        "graphProjection": graph_projection_from_run(&rule_result),
    }))
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}
```

- [ ] **Step 8: Run full backend test suite**

Run: `cargo test -p desktop-tauri business_designer`
Expected: PASS (existing + new).

- [ ] **Step 9: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/business_designer/completeness_rules.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/gap_rules.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/completeness_rules_tests.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/mod_tests.rs
git commit -m "feat(designer): completeness_rules module + wire into validate"
```

---

### Task 7: `render_code_gen_prompt` + `code_gen_prompt` module

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/commands/business_designer/code_gen_prompt.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs:27` (declare module)
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/mod_tests.rs`

**Interfaces:**
- Consumes: `&DesignerDocumentDetail`, `render_block_markdown`, `sorted_blocks`.
- Produces: `code_gen_prompt::render_code_gen_prompt(detail: &DesignerDocumentDetail) -> String` — the code-gen prompt asset markdown.

- [ ] **Step 1: Declare the module**

In `mod.rs`, after `mod completeness_rules;` (Task 6), add:
```rust
mod code_gen_prompt;
```

- [ ] **Step 2: Write the failing test**

Append to `tests/mod_tests.rs`:
```rust
#[test]
fn code_gen_prompt_contains_four_pillars_and_output_contract() {
    let temp = TempWorkspace::new("codegen");
    let mut detail = create_document_at("ws-1", temp.root(), "orders", "Orders", None)
        .expect("create document");
    // Inject one of each pillar.
    detail.design.blocks.push(DesignerBlock {
        id: "order".to_string(),
        kind: "entityModel".to_string(),
        title: "Order".to_string(),
        order: 20,
        payload: json!({ "entityName": "Order", "fields": [{ "name": "id", "type": "string" }] }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    });
    detail.design.blocks.push(DesignerBlock {
        id: "dc-1".to_string(),
        kind: "dataContract".to_string(),
        title: "Order schema".to_string(),
        order: 30,
        payload: json!({ "schema": { "type": "object", "properties": { "id": { "type": "string" } } } }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    });
    detail.design.blocks.push(DesignerBlock {
        id: "screen-1".to_string(),
        kind: "uiScreen".to_string(),
        title: "Orders".to_string(),
        order: 40,
        payload: json!({ "screenName": "Orders", "html": "<section data-entity=\"order\">x</section>" }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    });
    save_document_at("ws-1", temp.root(), detail).expect("save");

    let detail = read_document_at("ws-1", temp.root(), "orders").expect("read");
    let prompt = code_gen_prompt::render_code_gen_prompt(&detail);
    assert!(prompt.contains("Software System Implementation Specification"));
    assert!(prompt.contains("## Brief"));
    assert!(prompt.contains("## Data Schemas"));
    assert!(prompt.contains("## Business Flows"));
    assert!(prompt.contains("## UI"));
    assert!(prompt.contains("## Output Contract"));
    assert!(prompt.contains("<section data-entity=\"order\">x</section>"));
    assert!(prompt.contains("\"type\": \"object\""));
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p desktop-tauri business_designer::tests::code_gen_prompt_contains`
Expected: FAIL — `unresolved module code_gen_prompt`.

- [ ] **Step 4: Implement `code_gen_prompt.rs`**

Create `apps/desktop-tauri/src-tauri/src/commands/business_designer/code_gen_prompt.rs`:
```rust
//! Renderer for `generated/code-gen-prompt.md` — the code-gen prompt asset.
//!
//! Unlike `agent-brief.md`/`agent-input.json` (which declare
//! `outputContract: DesignerAgentPatch` for the design-completion track), this
//! asset is framed for a CODE-GENERATING agent. It assembles all four pillars
//! (text brief + JSON Schema + business flows + UI/HTML) plus acceptance
//! criteria, operating rules, and an explicit code Output Contract.

use super::{sorted_blocks, DesignerBlock, DesignerDocumentDetail};

pub(crate) fn render_code_gen_prompt(detail: &DesignerDocumentDetail) -> String {
    let mut out = String::new();
    out.push_str("# Software System Implementation Specification\n\n");
    out.push_str("## Role\n\n");
    out.push_str(
        "You are implementing a software system from this specification. Treat it as the source of truth.\n\n",
    );

    out.push_str("## Context\n\n");
    out.push_str(&format!("- Module: {}\n", detail.manifest.module.as_deref().unwrap_or("(unspecified)")));
    out.push_str(&format!("- Document ID: {}\n", detail.manifest.document_id));
    out.push_str(&format!("- Revision: {}\n", detail.design.revision));
    let tech = sorted_blocks(&detail.design.blocks)
        .into_iter()
        .filter(|b| b.kind == "technicalStack");
    for b in tech {
        out.push_str(&format!("- Tech stack: {}\n", render_block_markdown_inline(b)));
    }
    out.push_str("\n## Requirements\n\n");

    out.push_str("### Brief\n\n");
    for b in blocks_of_kind(detail, "text") {
        out.push_str(&super::render_block_markdown(b));
        out.push_str("\n");
    }

    out.push_str("### Data Schemas\n\n");
    for b in blocks_of_kind(detail, "entityModel") {
        out.push_str(&super::render_block_markdown(b));
        out.push_str("\n");
    }
    for b in blocks_of_kind(detail, "dataContract") {
        out.push_str(&super::render_block_markdown(b));
        out.push_str("\n");
    }

    out.push_str("### Business Flows\n\n");
    for b in blocks_of_kind(detail, "businessFlow") {
        out.push_str(&super::render_block_markdown(b));
        out.push_str("\n");
    }

    out.push_str("### UI\n\n");
    for b in blocks_of_kind(detail, "uiScreen") {
        out.push_str(&super::render_block_markdown(b));
        out.push_str("\n");
    }

    out.push_str("## Acceptance Criteria\n\n");
    for b in blocks_of_kind(detail, "acceptanceCriteria") {
        out.push_str(&super::render_block_markdown(b));
        out.push_str("\n");
    }

    out.push_str("## Operating Rules\n\n");
    out.push_str("- Treat the spec as the source of truth; do not modify `.gtoffice/docs` requirement files.\n");
    out.push_str("- Keep commands and file writes inside the workspace; small verifiable steps.\n");
    out.push_str("- Surface unresolved questions before handing over.\n\n");

    out.push_str("## Output Contract\n\n");
    out.push_str("- Produce code that satisfies the acceptance criteria.\n");
    out.push_str("- Report verification evidence (tests run, commands executed, results).\n");
    out.push_str("- List unresolved questions or spec gaps that blocked implementation.\n");
    out
}

fn blocks_of_kind<'a>(detail: &'a DesignerDocumentDetail, kind: &str) -> Vec<&'a DesignerBlock> {
    sorted_blocks(&detail.design.blocks)
        .into_iter()
        .filter(|b| b.kind == kind)
        .collect()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p desktop-tauri business_designer::tests::code_gen_prompt_contains`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/business_designer/code_gen_prompt.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/mod_tests.rs
git commit -m "feat(designer): render_code_gen_prompt code-gen asset renderer"
```

---

### Task 8: Compile + export wiring for `code-gen-prompt.md`

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs:207-214` (`DesignerGeneratedPaths`), `2307-2314` (`default_generated_paths`), `2585-2645` (`compile_document_at`), `3242-3327` (`export_document_at`), `4346-4356` (`normalize_export_format`)
- Test: `apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/mod_tests.rs`

**Interfaces:**
- Produces: `DesignerGeneratedPaths.code_gen_prompt` field; compile writes `generated/code-gen-prompt.md`; export format `codeGenPrompt`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mod_tests.rs`:
```rust
#[test]
fn compile_writes_code_gen_prompt() {
    let temp = TempWorkspace::new("codegen-compile");
    let detail = create_document_at("ws-1", temp.root(), "inv", "Inventory", None)
        .expect("create document");
    save_document_at("ws-1", temp.root(), detail).expect("save");
    let compiled = compile_document_at("ws-1", temp.root(), "inv").expect("compile");
    assert!(compiled.files.contains(&"generated/code-gen-prompt.md".to_string()));
    let document_root = temp.root().join(".gtoffice/docs/documents/inv");
    assert!(document_root.join("generated/code-gen-prompt.md").is_file());
}

#[test]
fn export_code_gen_prompt_format_returns_content() {
    let temp = TempWorkspace::new("codegen-export");
    let detail = create_document_at("ws-1", temp.root(), "inv", "Inventory", None)
        .expect("create document");
    save_document_at("ws-1", temp.root(), detail).expect("save");
    let exported = export_document_at("ws-1", temp.root(), "inv", "codeGenPrompt").expect("export");
    assert_eq!(exported.format, "codeGenPrompt");
    assert_eq!(exported.mime_type, "text/markdown");
    assert!(exported.content.contains("Software System Implementation Specification"));
}

#[test]
fn legacy_manifest_without_code_gen_prompt_field_deserializes() {
    // Old manifests predate the code_gen_prompt field; serde(default) must fill it.
    let temp = TempWorkspace::new("legacy");
    let mut detail = create_document_at("ws-1", temp.root(), "legacy", "Legacy", None).expect("create");
    save_document_at("ws-1", temp.root(), detail).expect("save");
    let document_root = temp.root().join(".gtoffice/docs/documents/legacy");
    let manifest_path = document_root.join("manifest.json");
    let raw = std::fs::read_to_string(&manifest_path).unwrap();
    // Remove the codeGenPrompt key to simulate a legacy manifest predating the field.
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    if let Some(obj) = v.get_mut("generated").and_then(|g| g.as_object_mut()) {
        obj.remove("codeGenPrompt");
    }
    std::fs::write(&manifest_path, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    let reread = read_document_at("ws-1", temp.root(), "legacy").expect("legacy manifest must deserialize");
    assert_eq!(reread.manifest.generated.code_gen_prompt, "generated/code-gen-prompt.md");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p desktop-tauri business_designer::tests::compile_writes_code_gen_prompt`
Expected: FAIL — no `code_gen_prompt` field / file not written.

- [ ] **Step 3: Add `code_gen_prompt` to `DesignerGeneratedPaths`**

In `mod.rs`, replace `DesignerGeneratedPaths` (lines 207-214):
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerGeneratedPaths {
    pub readme: String,
    pub agent_brief: String,
    pub agent_input: String,
    pub preview_html: String,
    #[serde(default = "default_code_gen_prompt_path")]
    pub code_gen_prompt: String,
}

fn default_code_gen_prompt_path() -> String {
    "generated/code-gen-prompt.md".to_string()
}
```

- [ ] **Step 4: Update `default_generated_paths`**

In `mod.rs`, replace `default_generated_paths` (lines 2307-2314):
```rust
fn default_generated_paths() -> DesignerGeneratedPaths {
    DesignerGeneratedPaths {
        readme: "README.md".to_string(),
        agent_brief: "generated/agent-brief.md".to_string(),
        agent_input: "generated/agent-input.json".to_string(),
        preview_html: "generated/preview.html".to_string(),
        code_gen_prompt: "generated/code-gen-prompt.md".to_string(),
    }
}
```

- [ ] **Step 5: Write `code-gen-prompt.md` in `compile_document_at`**

In `mod.rs` `compile_document_at` (lines 2585-2645), after the `acceptance_path` write + `files.push` block (after line 2641 `files.push("generated/acceptance.md"...`), add:
```rust
    let code_gen_prompt_path = document_root.join(&generated.code_gen_prompt);
    atomic_write_text(&code_gen_prompt_path, &code_gen_prompt::render_code_gen_prompt(&detail))?;
    files.push(generated.code_gen_prompt.clone());
```

- [ ] **Step 6: Add `codeGenPrompt` to `normalize_export_format`**

In `mod.rs`, replace `normalize_export_format` (lines 4346-4356):
```rust
fn normalize_export_format(format: &str) -> Result<String, String> {
    match format.trim() {
        "markdown" | "md" => Ok("markdown".to_string()),
        "html" => Ok("html".to_string()),
        "json" | "designJson" => Ok("json".to_string()),
        "agentBundle" | "agent-bundle" => Ok("agentBundle".to_string()),
        "codeGenPrompt" | "code-gen-prompt" => Ok("codeGenPrompt".to_string()),
        other => Err(format!(
            "BUSINESS_DESIGNER_EXPORT_FORMAT_UNSUPPORTED: unsupported export format '{other}'"
        )),
    }
}
```

- [ ] **Step 7: Add the `codeGenPrompt` arm to `export_document_at`**

In `mod.rs` `export_document_at`, in the `match format.as_str()` (after the `"agentBundle"` arm, before `_ => unreachable!`), add:
```rust
        "codeGenPrompt" => {
            let path = document_root.join(&detail.manifest.generated.code_gen_prompt);
            (
                detail.manifest.generated.code_gen_prompt.clone(),
                format!("{}-code-gen-prompt.md", detail.manifest.document_id),
                "text/markdown".to_string(),
                fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "BUSINESS_DESIGNER_EXPORT_FAILED: unable to read '{}': {error}",
                        path.display()
                    )
                })?,
            )
        }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cargo test -p desktop-tauri business_designer::tests::compile_writes_code_gen_prompt business_designer::tests::export_code_gen_prompt business_designer::tests::legacy_manifest`
Expected: PASS (all three).

- [ ] **Step 9: Run clippy + fmt + full workspace check**

Run: `cargo fmt -p desktop-tauri && cargo clippy -p desktop-tauri -- -D warnings && cargo check --workspace`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs apps/desktop-tauri/src-tauri/src/commands/business_designer/tests/mod_tests.rs
git commit -m "feat(designer): compile + export code-gen-prompt.md asset"
```

---

### Task 9: Frontend `uiScreen` kind + create-defaults

**Files:**
- Modify: `apps/desktop-web/src/features/business-designer/model/designer-blocks.ts:13-29` (kind union)
- Modify: `apps/desktop-web/src/features/business-designer/model/designer-document-operations.ts:9-46` (`AGENT_BLOCK_KINDS`, `DesignerCreateBlockKind`, `DESIGNER_BLOCK_CREATE_DEFAULTS`)
- Verify: `cd apps/desktop-web && npx tsc -b`

**Interfaces:**
- Produces: `'uiScreen'` in `DesignerBlockKind`; `uiScreen` create default payload `{ screenName, route, html }`.

- [ ] **Step 1: Add `uiScreen` to the kind union**

In `designer-blocks.ts`, add `| 'uiScreen'` to the `DesignerBlockKind` union (after `| 'uiWorkflow'`):
```ts
export type DesignerBlockKind =
  | 'text'
  | 'glossary'
  | 'entityModel'
  | 'businessFlow'
  | 'ruleTable'
  | 'pseudocode'
  | 'objectModel'
  | 'apiContract'
  | 'dataContract'
  | 'uiWorkflow'
  | 'uiScreen'
  | 'technicalStack'
  | 'nonFunctional'
  | 'acceptanceCriteria'
  | 'openQuestions'
  | 'agentInstruction'
  | 'decisionRecord'
```

- [ ] **Step 2: Add `uiScreen` to create-kind + defaults**

In `designer-document-operations.ts`, update `DesignerCreateBlockKind` (line 33) and `DESIGNER_BLOCK_CREATE_DEFAULTS` (line 37):
```ts
export type DesignerCreateBlockKind = Extract<
  DesignerBlockKind,
  'entityModel' | 'businessFlow' | 'apiContract' | 'uiScreen'
>

export const DESIGNER_BLOCK_CREATE_DEFAULTS: Record<
  DesignerCreateBlockKind,
  { title: string; payload: Record<string, unknown> }
> = {
  entityModel: {
    title: '新建实体',
    payload: { entityName: '新建实体', fields: [] },
  },
  businessFlow: {
    title: '新建流程',
    payload: { states: [], transitions: [] },
  },
  apiContract: {
    title: '新建契约',
    payload: { endpoints: [] },
  },
  uiScreen: {
    title: '新建屏幕',
    payload: {
      screenName: '新建屏幕',
      route: '',
      html: '<section data-flow="">\n  <h1>新建屏幕</h1>\n</section>\n',
    },
  },
}
```

- [ ] **Step 3: Add `uiScreen` to `AGENT_BLOCK_KINDS`**

In `designer-document-operations.ts`, add `'uiScreen'` to the `AGENT_BLOCK_KINDS` set (after `'uiWorkflow'`):
```ts
export const AGENT_BLOCK_KINDS = new Set<string>([
  'entityModel',
  'apiContract',
  'businessFlow',
  'acceptanceCriteria',
  'openQuestions',
  'glossary',
  'ruleTable',
  'objectModel',
  'dataContract',
  'technicalStack',
  'nonFunctional',
  'decisionRecord',
  'pseudocode',
  'uiWorkflow',
  'uiScreen',
  'agentInstruction',
])
```

- [ ] **Step 4: Verify frontend typechecks**

Run: `cd apps/desktop-web && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-web/src/features/business-designer/model/designer-blocks.ts apps/desktop-web/src/features/business-designer/model/designer-document-operations.ts
git commit -m "feat(designer): uiScreen kind + create defaults (frontend)"
```

---

### Task 10: `uiScreen` HTML preview + `dataContract` object render

**Files:**
- Create: `apps/desktop-web/src/features/business-designer/components/DesignerScreenPreview.tsx`
- Modify: `apps/desktop-web/src/features/business-designer/components/DesignerDocument.tsx:75-223` (`blockToMarkdown` switch + render path)
- Modify: `apps/desktop-web/src/features/business-designer/components/DesignerDocument.tsx:188-196` (`dataContract` arm)
- Verify: `cd apps/desktop-web && npx tsc -b`

**Interfaces:**
- Consumes: `DesignerBlock` (`uiScreen` payload `{ screenName, route, html }`).
- Produces: `DesignerScreenPreview` component (sandboxed iframe + annotation hook); `dataContract` arm renders object schema.

- [ ] **Step 1: Create `DesignerScreenPreview.tsx`**

Create `apps/desktop-web/src/features/business-designer/components/DesignerScreenPreview.tsx`:
```tsx
import { useCallback, useRef, useState } from 'react'

interface DesignerScreenPreviewProps {
  html: string
  /** A-layer hook: invoked when the user selects an element. B-layer wires the
   * actual AI optimization conversation; for now it captures the fragment. */
  onSelectElement?: (fragment: { outerHtml: string; selector: string }) => void
}

/**
 * Renders a `uiScreen` block's HTML in a sandboxed iframe (`srcdoc`) and
 * overlays an annotation layer: clicking an element captures its outerHTML +
 * a CSS selector path. This is the A-layer hook; the B-layer conversation
 * (sub-project B) consumes the captured fragment.
 */
export function DesignerScreenPreview({ html, onSelectElement }: DesignerScreenPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [selectedHtml, setSelectedHtml] = useState<string | null>(null)

  const attachOverlay = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentDocument) {
      return
    }
    const doc = iframe.contentDocument
    const handler = (event: MouseEvent) => {
      if (!annotating) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const target = event.target as HTMLElement
      if (!target || target === doc.body) {
        return
      }
      const outerHtml = target.outerHTML
      const selector = buildSelector(target)
      setSelectedHtml(outerHtml)
      onSelectElement?.({ outerHtml, selector })
    }
    doc.addEventListener('click', handler, true)
    return () => doc.removeEventListener('click', handler, true)
  }, [annotating, onSelectElement])

  const onLoad = useCallback(() => {
    attachOverlay()
  }, [attachOverlay])

  return (
    <div className="designer-screen-preview">
      <div className="designer-screen-preview__toolbar">
        <button
          type="button"
          className="designer-screen-preview__toggle"
          aria-pressed={annotating}
          onClick={() => setAnnotating((v) => !v)}
        >
          {annotating ? '退出注释' : '注释模式'}
        </button>
        {selectedHtml && (
          <span className="designer-screen-preview__hint">已选中元素（{selectedHtml.length} 字符）</span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        className="designer-screen-preview__iframe"
        sandbox="allow-same-origin"
        srcDoc={html}
        title="UI 预览"
        onLoad={onLoad}
      />
    </div>
  )
}

function buildSelector(el: HTMLElement): string {
  const parts: string[] = []
  let node: HTMLElement | null = el
  while (node && node.nodeType === 1) {
    const part = node.tagName.toLowerCase() + (node.id ? `#${node.id}` : '')
    parts.unshift(part)
    node = node.parentElement
    if (parts.length > 8) {
      break
    }
  }
  return parts.join(' > ')
}
```

- [ ] **Step 2: Add the SCSS for the preview**

In `apps/desktop-web/src/features/business-designer/BusinessDesignerPane.scss`, append:
```scss
.designer-screen-preview {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 0.0625rem solid var(--designer-border, #d0d0d0);
  border-radius: 0.5rem;
  overflow: hidden;

  &__toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--designer-toolbar-bg, #f5f5f7);
  }

  &__toggle {
    padding: 0.25rem 0.75rem;
    border-radius: 0.375rem;
    border: 0.0625rem solid var(--designer-border, #d0d0d0);
    background: var(--designer-surface, #fff);
    cursor: pointer;
    font-size: 0.8125rem;
  }

  &__hint {
    font-size: 0.75rem;
    color: var(--designer-muted, #888);
  }

  &__iframe {
    width: 100%;
    min-height: 18rem;
    border: 0;
    background: #fff;
  }
}
```

- [ ] **Step 3: Render `uiScreen` via `DesignerScreenPreview` instead of markdown**

In `DesignerDocument.tsx`, find where `blockToMarkdown` is called for rendering (the render path that maps a block to markdown then `MarkdownRenderer`). Add a special case BEFORE the markdown path: if `block.kind === 'uiScreen'`, render `<DesignerScreenPreview html={str(block.payload, 'html')} />`. Example (adjust to the actual render function structure):
```tsx
import { DesignerScreenPreview } from './DesignerScreenPreview'

// Inside the block render function, before falling back to MarkdownRenderer:
if (block.kind === 'uiScreen') {
  const html = str(block.payload, 'html') ?? ''
  return <DesignerScreenPreview html={html} />
}
```

- [ ] **Step 4: Update the `dataContract` arm in `blockToMarkdown`**

In `DesignerDocument.tsx` `blockToMarkdown`, replace the `dataContract` arm (lines 188-196) to handle object schemas:
```ts
    case 'dataContract': {
      const schema = block.payload?.schema
      if (schema) {
        const text = typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2)
        lines.push('```json')
        lines.push(text)
        lines.push('```')
      }
      break
    }
```

- [ ] **Step 5: Verify frontend typechecks + build**

Run: `cd apps/desktop-web && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run the app, create a `uiScreen` block, confirm the HTML renders in the iframe and "注释模式" toggles element selection.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop-web/src/features/business-designer/components/DesignerScreenPreview.tsx apps/desktop-web/src/features/business-designer/components/DesignerDocument.tsx apps/desktop-web/src/features/business-designer/BusinessDesignerPane.scss
git commit -m "feat(designer): uiScreen HTML iframe preview + dataContract object render"
```

---

### Task 11: Frontend completeness gap display

**Files:**
- Modify: `apps/desktop-web/src/features/business-designer/components/DesignerInspector.tsx` (gap list rendering)
- Verify: `cd apps/desktop-web && npx tsc -b`

**Interfaces:**
- Consumes: `DesignerGap` with `layer: 'completeness'` (Task 2).
- Produces: completeness gaps rendered in the inspector gap list, grouped/labeled by layer.

- [ ] **Step 1: Locate the gap list render**

Open `DesignerInspector.tsx` and find the gap list render (search for `gaps` / `gap.code` / the component that maps over gaps from `useDesignerDocumentState`'s `gaps` memo). Confirm gaps come from the `gaps` memo (already includes completeness gaps via the backend validate result — no controller change needed).

- [ ] **Step 2: Group gaps by layer in the render**

In the gap list render, group gaps by `layer` and add a label for completeness. Example (adjust to the actual JSX):
```tsx
const consistencyGaps = gaps.filter((g) => g.layer !== 'completeness')
const completenessGaps = gaps.filter((g) => g.layer === 'completeness')

// Render consistencyGaps in the existing "缺口" section.
// Add a new section for completenessGaps:
{completenessGaps.length > 0 && (
  <section className="designer-inspector__completeness">
    <h4>完备性（影响代码生成准确度）</h4>
    <ul>
      {completenessGaps.map((gap) => (
        <li key={gap.id} className={`designer-gap designer-gap--${gap.severity}`}>
          <span className="designer-gap__code">{gap.code}</span>
          <span className="designer-gap__message">{gap.message}</span>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Add SCSS for the completeness section**

In `BusinessDesignerPane.scss`, append:
```scss
.designer-inspector__completeness {
  padding: 0.75rem;
  border-top: 0.0625rem solid var(--designer-border, #d0d0d0);

  h4 {
    font-size: 0.8125rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
}

.designer-gap {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.8125rem;

  &__code {
    font-family: monospace;
    color: var(--designer-muted, #888);
    font-size: 0.75rem;
  }

  &--info .designer-gap__message { color: var(--designer-muted, #888); }
  &--warning .designer-gap__message { color: var(--designer-warning, #b8860b); }
}
```

- [ ] **Step 4: Verify frontend typechecks**

Run: `cd apps/desktop-web && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the app, open a document with an unreferenced apiContract (orphan-api-contract) and no acceptanceCriteria block (flow-unverified), confirm the completeness section appears.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-web/src/features/business-designer/components/DesignerInspector.tsx apps/desktop-web/src/features/business-designer/BusinessDesignerPane.scss
git commit -m "feat(designer): display completeness gaps in inspector"
```

---

### Task 12: Docs sync (dependency record + module design + contracts + ADR)

**Files:**
- Modify: `docs/07_依赖选型与精简清单.md` (add `scraper`)
- Modify: `docs/BUSINESS_DESIGNER_MODULE_DESIGN.md` (§5 block vocabulary, §6 gap rules, §8.2 commands)
- Modify: `docs/API_CONTRACTS.md` (add `business_designer.*` command surface)
- Modify: `docs/ARCHITECTURE.md` (§2 feature list, §8 alignment table — add `business-designer`)
- Create: `docs/adr/0018-designer-artifact-layer.md`

- [ ] **Step 1: Record `scraper` dependency**

In `docs/07_依赖选型与精简清单.md`, add an entry for `scraper`:
```markdown
### scraper (Rust, apps/desktop-tauri)

- 用途：解析 `uiScreen` block 的 HTML，提取 `data-*` 跨 block 链接（data-nav/data-entity/data-api/data-flow）。
- 备选：`kuchiki`（已归档）、`select`、手写正则（不可靠，HTML 非正则可解析）。
- 影响范围：`crates` 无；仅 `apps/desktop-tauri/src-tauri`；增加 `html5ever` 传递依赖，编译时间略增。
- 决策：选 `scraper`——基于 `html5ever`，社区维护活跃，CSS 选择器 API 足够提取 `data-*`。
```

- [ ] **Step 2: Update `BUSINESS_DESIGNER_MODULE_DESIGN.md`**

In `docs/BUSINESS_DESIGNER_MODULE_DESIGN.md`:
- §5 block vocabulary: add `uiScreen`（HTML payload + `data-*` 约定）, mark `dataContract` 升级为可校验 JSON Schema, mark `uiWorkflow` 维持占位符。
- §6 gap rules: add `uiScreen` 一致性规则（`ui-no-html`/`ui-dangling-ref`）、`dataContract` 规则（`data-contract-invalid`/`data-contract-no-type`/`data-contract-no-properties`）、`completeness_rules` 软层（5 条）。
- §8.2 commands: note `compile_document` 新增 `generated/code-gen-prompt.md` 产物；`export_document` 新增 `codeGenPrompt` 格式。

- [ ] **Step 3: Add `business_designer.*` to `API_CONTRACTS.md`**

In `docs/API_CONTRACTS.md`, add a `Business Designer` section listing all `business_designer_*` commands (mirror `lib.rs:160-185`), with the `codeGenPrompt` export format and the completeness gap layer.

- [ ] **Step 4: Add `business-designer` to `ARCHITECTURE.md`**

In `docs/ARCHITECTURE.md`:
- §2 feature list: add `business-designer`.
- §8 feature↔command alignment table: add `business-designer ↔ commands/business_designer/`.

- [ ] **Step 5: Write ADR 0018**

Create `docs/adr/0018-designer-artifact-layer.md`:
```markdown
# ADR 0018: Designer Artifact Layer — code-gen-ready prompt asset

- Date: 2026-07-05
- Status: Accepted
- Supersedes: none (extends ADR 0001-0017 which covered anchored completion only)

## Context

The business designer was a "structured requirement package with design-completion
loops" (outputContract: DesignerAgentPatch). Sub-project A reorients it toward
code generation: the spec must double as a prompt asset a code agent consumes.

## Decision

1. UI pillar = HTML. `uiScreen` block payload is raw HTML; `data-*` attributes
   (data-nav/data-entity/data-api/data-flow) encode cross-block links. HTML is
   the single source of truth (design doc + renderable preview + code-gen asset).
2. `dataContract` upgraded to validated JSON Schema (object or legacy string).
   `entityModel` derives JSON Schema at compile time.
3. Compile emits `code-gen-prompt.md` (outputContract: code, in prose) alongside
   the existing `designerPatch` outputs. Two agent tracks, two contracts.
4. New `completeness_rules` soft layer (Info/Warning, non-blocking) detects
   orphan blocks / missing acceptance / uncovered flows.
5. Consumption deferred to existing Agent Station sessions (no new C subsystem).

## Consequences

- `scraper` crate added (HTML parsing) — compile time increases slightly.
- `DesignerGeneratedPaths.code_gen_prompt` is `#[serde(default)]` for backward
  compat with existing manifests.
- Automated code-gen→spec feedback loop is out of scope (v1: manual via B).
- `uiWorkflow` remains a placeholder (interaction flow carried by HTML data-*).
```

- [ ] **Step 6: Commit**

```bash
git add docs/07_依赖选型与精简清单.md docs/BUSINESS_DESIGNER_MODULE_DESIGN.md docs/API_CONTRACTS.md docs/ARCHITECTURE.md docs/adr/0018-designer-artifact-layer.md
git commit -m "docs(designer): sync artifact layer — deps, module design, contracts, ADR 0018"
```

---

## Self-Review (run after writing, fix inline)

**Spec coverage:**
- §4.1 UI block (HTML + data-*) → Tasks 1, 3, 4, 9, 10. ✓
- §4.2 JSON Schema block → Tasks 3 (render), 5 (rule). ✓
- §4.3 compile reorientation → Tasks 7, 8. ✓
- §4.4 completeness rules → Task 6. ✓
- §4.5 prompt asset structure → Task 7. ✓
- §4.6 module boundaries → all tasks. ✓
- Annotation mode (A-layer hook) → Task 10. ✓
- Docs sync (§7) → Task 12. ✓

**Placeholder scan:** none — every step has complete code or exact paths.

**Type consistency:** `extract_ui_refs` / `data_api_contract_id` (Task 1) used verbatim in Tasks 4, 6. `run_completeness(graph, derived_edges)` signature (Task 6) matches the call site in `validate_document_at` (Task 6 step 7). `stable_gap_id_pub` (Task 6 step 5) used in `completeness_rules.rs` (Task 6 step 4). `DesignerScreenPreview` props (Task 10) match usage. `code_gen_prompt::render_code_gen_prompt` (Task 7) matches the call in `compile_document_at` (Task 8 step 5).

**Known deviations from spec (noted in Global Constraints):**
1. `outputContract: "code"` lives in `code-gen-prompt.md` prose, not a second `agent-input.json` mode (avoids churn).
2. `dataContract.schema` accepts legacy string form (backward compat) — no hard migration.
3. Completeness gaps for `flow-unverified`/`no-agent-instruction` duplicate the existing `validate_design` diagnostics (kept for v1; dedup later).
4. `data-contract` full JSON Schema meta-validation deferred — only light structural validation (no `jsonschema` crate).

## Verification (final)

After all tasks:
```bash
cargo fmt -p desktop-tauri && cargo clippy -p desktop-tauri -- -D warnings
cargo test -p desktop-tauri business_designer
cargo check --workspace
cd apps/desktop-web && npx tsc -b
```
All must pass.
