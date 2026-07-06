//! Completeness rules: soft (non-blocking) gaps that mark a spec as "not yet
//! complete enough for accurate code generation." Distinct from `gap_rules`
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
                    "实体没有被任何 API 契约、UI 屏幕或其他实体引用。");
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
