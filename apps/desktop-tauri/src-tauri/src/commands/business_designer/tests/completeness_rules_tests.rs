use serde_json::{json, Value};

use super::super::{
    completeness_rules::run_completeness, gap_rules::run_all, DesignerBlock, DesignerDesignGraph,
    DesignerGapLayer,
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
        block(
            "orders",
            "apiContract",
            json!({ "endpoints": [{ "path": "/orders", "method": "GET" }] }),
        ),
        block("brief", "text", json!({ "markdown": "brief" })),
    ]);
    let run = run_all(&g);
    let gaps = run_completeness(&g, &run.derived_edges);
    assert!(codes(&gaps).contains(&"orphan-api-contract".to_string()));
    assert!(gaps
        .iter()
        .all(|g| g.layer == DesignerGapLayer::Completeness));
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
        block(
            "flow-1",
            "businessFlow",
            json!({ "states": [{ "name": "s" }], "transitions": [] }),
        ),
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
        block(
            "order",
            "entityModel",
            json!({ "entityName": "Order", "fields": [{ "name": "id", "type": "string" }] }),
        ),
        block(
            "orders-api",
            "apiContract",
            json!({ "endpoints": [{ "path": "/orders", "method": "GET", "response": "Order" }] }),
        ),
        block(
            "order-flow",
            "businessFlow",
            json!({ "states": [{ "name": "s" }], "transitions": [] }),
        ),
        block(
            "acceptance",
            "acceptanceCriteria",
            json!({ "criteria": ["c"] }),
        ),
        block(
            "instr",
            "agentInstruction",
            json!({ "instructions": "do it" }),
        ),
        block(
            "screen",
            "uiScreen",
            json!({
                "html": "<button data-api=\"orders-api\" data-entity=\"order\" data-flow=\"order-flow\">x</button>"
            }),
        ),
    ]);
    let run = run_all(&g);
    let gaps = run_completeness(&g, &run.derived_edges);
    assert!(
        gaps.is_empty(),
        "expected no completeness gaps, got {:?}",
        codes(&gaps)
    );
}
