use serde_json::{json, Value};

use super::super::{
    gap_rules::{run_all, GapRunResult, DERIVED_EDGE_RELATIONS},
    DesignerBlock, DesignerBlockLink, DesignerDesignGraph, DesignerEdgeRelation, DesignerGapLayer,
    DesignerGapSeverity,
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
        updated_at: "2026-06-17T00:00:00Z".to_string(),
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

fn gap_codes(result: &GapRunResult, block_id: &str) -> Vec<String> {
    result
        .gaps
        .iter()
        .filter(|g| g.block_id == block_id)
        .map(|g| g.code.clone())
        .collect()
}

#[test]
fn derived_edge_relation_vocabulary_is_closed() {
    assert_eq!(
        DERIVED_EDGE_RELATIONS,
        [
            DesignerEdgeRelation::DependsOn,
            DesignerEdgeRelation::Produces,
            DesignerEdgeRelation::Consumes,
            DesignerEdgeRelation::Uses,
            DesignerEdgeRelation::Extends,
        ]
    );
    assert_eq!(
        serde_json::to_value(DERIVED_EDGE_RELATIONS).expect("serialize relation vocabulary"),
        json!(["dependsOn", "produces", "consumes", "uses", "extends"])
    );
}

#[test]
fn gap_layer_and_severity_vocabularies_are_closed() {
    assert_eq!(
        serde_json::to_value([DesignerGapLayer::Intra, DesignerGapLayer::Inter])
            .expect("serialize gap layers"),
        json!(["intra", "inter"])
    );
    assert_eq!(
        serde_json::to_value([DesignerGapSeverity::Warning, DesignerGapSeverity::Error])
            .expect("serialize gap severities"),
        json!(["warning", "error"])
    );
}

#[test]
fn empty_entity_has_no_fields_gap() {
    let g = graph(vec![block(
        "order",
        "entityModel",
        json!({"entityName": "Order", "fields": []}),
    )]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "order").contains(&"no-fields".to_string()));
}

#[test]
fn entity_with_id_field_passes_pk() {
    let g = graph(vec![block(
        "order",
        "entityModel",
        json!({
            "entityName": "Order",
            "fields": [{"name": "id", "type": "string"}, {"name": "amount", "type": "number"}]
        }),
    )]);
    let result = run_all(&g);
    let codes = gap_codes(&result, "order");
    assert!(!codes.contains(&"no-pk".to_string()), "got {:?}", codes);
}

#[test]
fn entity_without_pk_emits_no_pk_gap() {
    let g = graph(vec![block(
        "order",
        "entityModel",
        json!({
            "entityName": "Order",
            "fields": [{"name": "amount", "type": "number"}]
        }),
    )]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "order").contains(&"no-pk".to_string()));
}

#[test]
fn enum_without_values_emits_gap() {
    let g = graph(vec![block(
        "order",
        "entityModel",
        json!({
            "entityName": "Order",
            "fields": [
                {"name": "id", "type": "string"},
                {"name": "status", "type": "enum"}
            ]
        }),
    )]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "order").contains(&"enum-no-values".to_string()));
}

#[test]
fn dangling_ref_to_unknown_entity_is_not_agent_fixable() {
    let g = graph(vec![block(
        "order",
        "entityModel",
        json!({
            "entityName": "Order",
            "fields": [
                {"name": "id", "type": "string"},
                {"name": "customer", "type": "Customer"}
            ]
        }),
    )]);
    let result = run_all(&g);
    let dangling = result
        .gaps
        .iter()
        .find(|gap| gap.block_id == "order" && gap.code == "dangling-ref")
        .expect("dangling-ref gap");
    assert!(!dangling.fixable_by_agent);
}

#[test]
fn dangling_ref_resolves_when_target_exists() {
    let g = graph(vec![
        block(
            "order",
            "entityModel",
            json!({
                "entityName": "Order",
                "fields": [
                    {"name": "id", "type": "string"},
                    {"name": "customer", "type": "Customer"}
                ]
            }),
        ),
        block(
            "customer",
            "entityModel",
            json!({
                "entityName": "Customer",
                "fields": [{"name": "id", "type": "string"}]
            }),
        ),
    ]);
    let result = run_all(&g);
    assert!(!gap_codes(&result, "order").contains(&"dangling-ref".to_string()));
    assert!(result.derived_edges.iter().any(|edge| {
        edge.from_block_id == "order"
            && edge.to_block_id == "customer"
            && edge.relation == DesignerEdgeRelation::Uses
    }));
}

#[test]
fn empty_flow_emits_no_states() {
    let g = graph(vec![block(
        "lifecycle",
        "businessFlow",
        json!({"states": [], "transitions": []}),
    )]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "lifecycle").contains(&"no-states".to_string()));
}

#[test]
fn flow_with_dead_state() {
    let g = graph(vec![block(
        "lifecycle",
        "businessFlow",
        json!({
            "states": [
                {"name": "draft", "initial": true},
                {"name": "submitted"},
                {"name": "approved", "terminal": true}
            ],
            "transitions": [
                {"from": "draft", "to": "submitted"}
            ]
        }),
    )]);
    let result = run_all(&g);
    let codes = gap_codes(&result, "lifecycle");
    assert!(codes.contains(&"dead-state".to_string()), "got {:?}", codes);
    assert!(codes.contains(&"unreachable-state".to_string()));
}

#[test]
fn flow_unknown_state_in_transition() {
    let g = graph(vec![block(
        "lifecycle",
        "businessFlow",
        json!({
            "states": [{"name": "draft"}, {"name": "done", "terminal": true}],
            "transitions": [{"from": "draft", "to": "doneeee"}]
        }),
    )]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "lifecycle").contains(&"transition-unknown-state".to_string()));
}

#[test]
fn empty_api_emits_no_endpoints() {
    let g = graph(vec![block("api", "apiContract", json!({"endpoints": []}))]);
    let result = run_all(&g);
    assert!(gap_codes(&result, "api").contains(&"no-endpoints".to_string()));
}

#[test]
fn api_endpoint_missing_path_method() {
    let g = graph(vec![block(
        "api",
        "apiContract",
        json!({"endpoints": [{"path": "", "method": ""}]}),
    )]);
    let result = run_all(&g);
    let codes = gap_codes(&result, "api");
    assert!(codes.contains(&"endpoint-no-path".to_string()));
    assert!(codes.contains(&"endpoint-no-method".to_string()));
}

#[test]
fn api_without_entity_ref_does_not_emit_orphan_contract() {
    let g = graph(vec![block(
        "api",
        "apiContract",
        json!({"endpoints": [{"path": "/orders", "method": "GET", "response": "string"}]}),
    )]);
    let result = run_all(&g);
    assert!(!gap_codes(&result, "api").contains(&"orphan-contract".to_string()));
}

#[test]
fn api_endpoint_referencing_entity_creates_edge() {
    let g = graph(vec![
        block(
            "api",
            "apiContract",
            json!({
                "endpoints": [{
                    "path": "/orders",
                    "method": "GET",
                    "response": "Order",
                    "errors": ["NOT_FOUND"]
                }]
            }),
        ),
        block(
            "order",
            "entityModel",
            json!({
                "entityName": "Order",
                "fields": [{"name": "id", "type": "string"}]
            }),
        ),
    ]);
    let result = run_all(&g);
    assert!(result.derived_edges.iter().any(|edge| {
        edge.from_block_id == "api"
            && edge.to_block_id == "order"
            && edge.relation == DesignerEdgeRelation::DependsOn
    }));
}

#[test]
fn authored_links_do_not_create_graph_projection_edges() {
    let mut source = block("source", "text", json!({"markdown": "Legacy source"}));
    source.links = vec![DesignerBlockLink {
        target_block_id: "target".to_string(),
        relation: "uses".to_string(),
    }];

    let g = graph(vec![
        source,
        block("target", "text", json!({"markdown": "Legacy target"})),
    ]);
    let result = run_all(&g);

    assert!(
        result.derived_edges.is_empty(),
        "authored links are legacy document data and must not feed graphProjection"
    );
}

#[test]
fn gap_key_is_stable_and_id_is_hash() {
    let g1 = graph(vec![block(
        "order",
        "entityModel",
        json!({"entityName": "Order", "fields": []}),
    )]);
    let g2 = graph(vec![block(
        "order",
        "entityModel",
        json!({"entityName": "Order", "fields": []}),
    )]);
    let r1 = run_all(&g1);
    let r2 = run_all(&g2);
    let gap1 = r1
        .gaps
        .iter()
        .find(|g| g.code == "no-fields")
        .expect("no-fields gap");
    let gap2 = r2
        .gaps
        .iter()
        .find(|g| g.code == "no-fields")
        .expect("no-fields gap");
    assert_eq!(gap1.key, gap2.key);
    assert_eq!(gap1.id, gap2.id);
    assert!(gap1.id.starts_with("gap_"));
}

#[test]
fn rules_run_records_gap_count() {
    let g = graph(vec![block(
        "order",
        "entityModel",
        json!({
            "entityName": "Order",
            "fields": [{"name": "id", "type": "string"}]
        }),
    )]);
    let result = run_all(&g);
    let no_fields = result
        .rules_run
        .iter()
        .find(|r| r.code == "no-fields" && r.block_id == "order")
        .expect("no-fields rule run");
    assert!(no_fields.passed);
    assert_eq!(no_fields.gap_count, 0);
}
