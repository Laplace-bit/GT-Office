//! Gap engine for the business designer.
//!
//! Each block kind has a set of *machine-checkable* sanity rules; an unmet
//! rule produces a [`DesignerGap`] anchored to its host block. The Agent's
//! only job is to fill named gaps — it cannot invent gap codes, and it cannot
//! self-evaluate, because [`run_all`] is rerun after every patch and the
//! resolved/unresolved/introduced verdict comes from rule output, not from
//! the model.
//!
//! v1 covers three gap-rule kinds: `entityModel`, `businessFlow`,
//! `apiContract`. The other 13 kinds run *no* rules (they participate in the
//! graph as reference targets or as the brief root, but the Agent is never
//! dispatched to fill them).
//!
//! This module is pure: no IO, no Tauri state, no global. All inputs are
//! `&DesignerDesignGraph` slices and the output is a [`GapRunResult`].
//! Edge derivation runs first because some inter-layer rules
//! (e.g. `dangling-ref`) consult derived edges.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;

use super::{
    DesignerBlock, DesignerDerivedEdge, DesignerDesignGraph, DesignerEdgeRelation, DesignerGap,
    DesignerGapLayer, DesignerGapSeverity, DesignerRuleRun,
};

// ---- public API -----------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub(crate) struct GapRunResult {
    pub gaps: Vec<DesignerGap>,
    pub rules_run: Vec<DesignerRuleRun>,
    pub derived_edges: Vec<DesignerDerivedEdge>,
}

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
            _ => {} // other kinds: no consistency gaps.
        }
    }

    result
}

// ---- edge derivation (§5.7) ----------------------------------------------

/// Derive directed edges from payload references. v1 does *not* let users
/// hand-draw edges — broken references surface as `dangling-ref` gaps.
fn derive_edges(graph: &DesignerDesignGraph) -> Vec<DesignerDerivedEdge> {
    let entity_name_to_id = build_entity_name_to_id(graph);
    let mut edges: Vec<DesignerDerivedEdge> = Vec::new();
    let mut seen: HashSet<(String, String, DesignerEdgeRelation)> = HashSet::new();

    let block_ids: HashSet<String> = graph.blocks.iter().map(|b| b.id.clone()).collect();

    let push_edge = |edges: &mut Vec<DesignerDerivedEdge>,
                     seen: &mut HashSet<(String, String, DesignerEdgeRelation)>,
                     from: &str,
                     to: &str,
                     relation: DesignerEdgeRelation,
                     source_field: Option<String>| {
        let key = (from.to_string(), to.to_string(), relation);
        if !seen.insert(key) {
            return;
        }
        edges.push(DesignerDerivedEdge {
            from_block_id: from.to_string(),
            to_block_id: to.to_string(),
            relation,
            source_field,
        });
    };

    for block in &graph.blocks {
        match block.kind.as_str() {
            // entityModel A: field type → entityModel B (uses)
            "entityModel" => {
                if let Some(fields) = block.payload.get("fields").and_then(Value::as_array) {
                    for field in fields {
                        let Some(target_name) = field.get("type").and_then(Value::as_str) else {
                            continue;
                        };
                        if let Some(target_block_id) =
                            resolve_entity_ref(target_name, &entity_name_to_id)
                        {
                            if target_block_id != block.id {
                                let field_name = field
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .map(str::to_string);
                                push_edge(
                                    &mut edges,
                                    &mut seen,
                                    &block.id,
                                    &target_block_id,
                                    DesignerEdgeRelation::Uses,
                                    field_name,
                                );
                            }
                        }
                    }
                }
            }

            // apiContract: endpoint request/response references entity → dependsOn
            "apiContract" => {
                let endpoints = block
                    .payload
                    .get("endpoints")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for endpoint in endpoints {
                    for slot in ["request", "response", "requestShape", "responseShape"] {
                        if let Some(target_name) = endpoint.get(slot).and_then(Value::as_str) {
                            if let Some(target_block_id) =
                                resolve_entity_ref(target_name, &entity_name_to_id)
                            {
                                push_edge(
                                    &mut edges,
                                    &mut seen,
                                    &block.id,
                                    &target_block_id,
                                    DesignerEdgeRelation::DependsOn,
                                    Some(slot.to_string()),
                                );
                            }
                        }
                    }
                }
            }

            // businessFlow: state's `entity` or `target` fields → consumes
            "businessFlow" => {
                let states = block
                    .payload
                    .get("states")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for state in states {
                    let relation_target = state
                        .get("entity")
                        .and_then(Value::as_str)
                        .map(|target_name| ("entity", target_name))
                        .or_else(|| {
                            state
                                .get("target")
                                .and_then(Value::as_str)
                                .map(|target_name| ("target", target_name))
                        });
                    if let Some((slot, target_name)) = relation_target {
                        if let Some(target_block_id) =
                            resolve_entity_ref(target_name, &entity_name_to_id)
                        {
                            push_edge(
                                &mut edges,
                                &mut seen,
                                &block.id,
                                &target_block_id,
                                DesignerEdgeRelation::Consumes,
                                Some(slot.to_string()),
                            );
                        }
                    }
                }
            }
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
            _ => {}
        }
    }

    edges
}

/// Build a map from `entityName → block.id` for forward lookup.
/// Entity name match is case-insensitive after trim. Falls back to
/// `block.title` when payload has no `entityName` (so users who just edited
/// titles still get edges derived).
fn build_entity_name_to_id(graph: &DesignerDesignGraph) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for block in &graph.blocks {
        if block.kind != "entityModel" {
            continue;
        }
        if let Some(name) = block
            .payload
            .get("entityName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            map.entry(name.to_lowercase()).or_insert(block.id.clone());
        }
        let title = block.title.trim();
        if !title.is_empty() {
            map.entry(title.to_lowercase()).or_insert(block.id.clone());
        }
        // also map by id, helps when references are written using the id
        map.entry(block.id.to_lowercase())
            .or_insert(block.id.clone());
    }
    map
}

fn resolve_entity_ref(reference: &str, index: &HashMap<String, String>) -> Option<String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Skip primitive type names — they are not entity references.
    let lowered = trimmed.to_lowercase();
    if matches!(
        lowered.as_str(),
        "string"
            | "number"
            | "integer"
            | "int"
            | "float"
            | "decimal"
            | "boolean"
            | "bool"
            | "date"
            | "datetime"
            | "timestamp"
            | "uuid"
            | "json"
            | "object"
            | "any"
            | "void"
            | "null"
            | "enum"
    ) {
        return None;
    }
    index.get(&lowered).cloned()
}

/// Build a reverse index of `entityModel` blocks by id, used by entity rules
/// that need to check whether a referenced entity exists.
fn build_entity_index(graph: &DesignerDesignGraph) -> HashMap<String, String> {
    build_entity_name_to_id(graph)
}

// ---- rule helpers ---------------------------------------------------------

fn record(result: &mut GapRunResult, kind: &str, code: &str, block_id: &str, gap_count: usize) {
    result.rules_run.push(DesignerRuleRun {
        kind: kind.to_string(),
        code: code.to_string(),
        block_id: block_id.to_string(),
        passed: gap_count == 0,
        gap_count,
    });
}

#[allow(clippy::too_many_arguments)]
fn fail(
    result: &mut GapRunResult,
    block_id: &str,
    code: &str,
    layer: DesignerGapLayer,
    severity: DesignerGapSeverity,
    message: impl Into<String>,
    fixable: bool,
    locator: Option<BTreeMap<String, String>>,
) {
    let key = stable_gap_key(block_id, code, locator.as_ref());
    let id = stable_gap_id(&key);
    let locator_map = locator.map(|map| map.into_iter().collect::<HashMap<String, String>>());
    result.gaps.push(DesignerGap {
        id,
        key,
        code: code.to_string(),
        block_id: block_id.to_string(),
        layer,
        severity,
        message: message.into(),
        fixable_by_agent: fixable,
        locator: locator_map,
    });
}

/// Semantic gap fingerprint: blockId + code + sorted locator. Stable while the
/// business locator stays stable; block-local ordinals are allowed fallbacks.
fn stable_gap_key(
    block_id: &str,
    code: &str,
    locator: Option<&BTreeMap<String, String>>,
) -> String {
    let mut key = format!("{block_id}:{code}");
    if let Some(locator) = locator {
        for (k, v) in locator {
            key.push(':');
            key.push_str(k);
            key.push('=');
            key.push_str(v);
        }
    }
    key
}

/// Snapshot id: hash(key). Stable enough for one validation snapshot and UI
/// references, but callers compare long-term identity using `key`.
fn stable_gap_id(key: &str) -> String {
    let mut hasher = SimpleHasher::new();
    hasher.write(key.as_bytes());
    let hash = hasher.finish();
    format!("gap_{:016x}", hash)
}

/// Tiny FNV-1a 64-bit hasher. We don't use std::collections::hash::DefaultHasher
/// because it's not guaranteed to be stable across rust versions; gap ids cross
/// process boundaries (recorded in archived patches), so stability matters.
struct SimpleHasher {
    state: u64,
}

impl SimpleHasher {
    fn new() -> Self {
        Self {
            state: 0xcbf29ce484222325,
        }
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.state ^= u64::from(b);
            self.state = self.state.wrapping_mul(0x100000001b3);
        }
    }
    fn finish(&self) -> u64 {
        self.state
    }
}

// ---- entityModel rules ---------------------------------------------------

fn check_entity_model(
    block: &DesignerBlock,
    entity_index: &HashMap<String, String>,
    result: &mut GapRunResult,
) {
    let payload = &block.payload;
    let kind = "entityModel";

    let fields = payload
        .get("fields")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    // no-fields
    let has_fields = !fields.is_empty();
    record(
        result,
        kind,
        "no-fields",
        &block.id,
        usize::from(!has_fields),
    );
    if !has_fields {
        fail(
            result,
            &block.id,
            "no-fields",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Error,
            "实体没有字段，至少补一个字段。",
            true,
            None,
        );
    }

    // field-level checks
    let mut field_no_name_count = 0usize;
    let mut field_no_type_count = 0usize;
    let mut enum_no_values_count = 0usize;
    let mut dangling_ref_count = 0usize;

    for (index, field) in fields.iter().enumerate() {
        let locator = || {
            let mut m = BTreeMap::new();
            m.insert("fieldIndex".to_string(), index.to_string());
            if let Some(name) = field.get("name").and_then(Value::as_str) {
                m.insert("fieldName".to_string(), name.to_string());
            }
            m
        };

        let has_name = field
            .get("name")
            .and_then(Value::as_str)
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        if !has_name {
            field_no_name_count += 1;
            fail(
                result,
                &block.id,
                "field-no-name",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Error,
                format!("字段 #{} 缺少名称。", index + 1),
                false,
                Some(locator()),
            );
        }

        let type_str = field
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty());

        if type_str.is_none() {
            field_no_type_count += 1;
            let label = field
                .get("name")
                .and_then(Value::as_str)
                .map(|s| format!("字段 “{}”", s))
                .unwrap_or_else(|| format!("字段 #{}", index + 1));
            fail(
                result,
                &block.id,
                "field-no-type",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Error,
                format!("{} 缺少 type。", label),
                true,
                Some(locator()),
            );
        }

        // enum-no-values
        if let Some(t) = type_str {
            if t.eq_ignore_ascii_case("enum") {
                let values_ok = field
                    .get("values")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .any(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
                    })
                    .unwrap_or(false);
                if !values_ok {
                    enum_no_values_count += 1;
                    let label = field
                        .get("name")
                        .and_then(Value::as_str)
                        .map(|s| format!("枚举字段 “{}”", s))
                        .unwrap_or_else(|| format!("枚举字段 #{}", index + 1));
                    fail(
                        result,
                        &block.id,
                        "enum-no-values",
                        DesignerGapLayer::Intra,
                        DesignerGapSeverity::Error,
                        format!("{} 没有任何枚举值。", label),
                        true,
                        Some(locator()),
                    );
                }
            } else if !is_primitive_type(t) {
                // dangling-ref: type points to another entity by name but no such block.
                if resolve_entity_ref(t, entity_index).is_none() {
                    dangling_ref_count += 1;
                    let label = field
                        .get("name")
                        .and_then(Value::as_str)
                        .map(|s| format!("字段 “{}”", s))
                        .unwrap_or_else(|| format!("字段 #{}", index + 1));
                    let mut loc = locator();
                    loc.insert("ref".to_string(), t.to_string());
                    fail(
                        result,
                        &block.id,
                        "dangling-ref",
                        DesignerGapLayer::Inter,
                        DesignerGapSeverity::Warning,
                        format!("{} 引用了不存在的实体 “{}”。", label, t),
                        false,
                        Some(loc),
                    );
                }
            }
        }
    }
    record(
        result,
        kind,
        "field-no-name",
        &block.id,
        field_no_name_count,
    );
    record(
        result,
        kind,
        "field-no-type",
        &block.id,
        field_no_type_count,
    );
    record(
        result,
        kind,
        "enum-no-values",
        &block.id,
        enum_no_values_count,
    );
    record(result, kind, "dangling-ref", &block.id, dangling_ref_count);

    // no-pk
    let pk_ok = if has_fields {
        let entity_name = payload
            .get("entityName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(block.title.trim());
        let entity_id_aliases = entity_id_aliases(entity_name);
        fields.iter().any(|field| {
            let pk_flag = field
                .get("isPrimaryKey")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let name = field
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_lowercase();
            pk_flag || entity_id_aliases.iter().any(|alias| alias == &name)
        })
    } else {
        false
    };
    record(
        result,
        kind,
        "no-pk",
        &block.id,
        usize::from(has_fields && !pk_ok),
    );
    if has_fields && !pk_ok {
        fail(
            result,
            &block.id,
            "no-pk",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Warning,
            "实体没有主键字段（isPrimaryKey 或 id / <entity>Id）。",
            true,
            None,
        );
    }
}

fn entity_id_aliases(entity_name: &str) -> Vec<String> {
    let lower = entity_name.trim().to_lowercase();
    let mut aliases = vec!["id".to_string()];
    if !lower.is_empty() {
        aliases.push(format!("{}id", lower));
        aliases.push(format!("{}_id", lower));
    }
    aliases
}

fn is_primitive_type(value: &str) -> bool {
    matches!(
        value.to_lowercase().as_str(),
        "string"
            | "number"
            | "integer"
            | "int"
            | "float"
            | "decimal"
            | "boolean"
            | "bool"
            | "date"
            | "datetime"
            | "timestamp"
            | "uuid"
            | "json"
            | "object"
            | "any"
            | "void"
            | "null"
    )
}

// ---- businessFlow rules --------------------------------------------------

fn check_business_flow(block: &DesignerBlock, result: &mut GapRunResult) {
    let payload = &block.payload;
    let kind = "businessFlow";

    let states = payload
        .get("states")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let transitions = payload
        .get("transitions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_states = !states.is_empty();
    record(
        result,
        kind,
        "no-states",
        &block.id,
        usize::from(!has_states),
    );
    if !has_states {
        fail(
            result,
            &block.id,
            "no-states",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Error,
            "流程没有状态，至少补一个状态。",
            true,
            None,
        );
    }

    let has_transitions = !transitions.is_empty();
    record(
        result,
        kind,
        "no-transitions",
        &block.id,
        usize::from(has_states && !has_transitions),
    );
    if !has_transitions && has_states {
        fail(
            result,
            &block.id,
            "no-transitions",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Error,
            "流程没有任何状态迁移。",
            true,
            None,
        );
    }

    let state_names: HashSet<String> = states
        .iter()
        .filter_map(|s| s.get("name").and_then(Value::as_str).map(str::to_string))
        .collect();

    // transition-unknown-state
    let mut unknown_count = 0usize;
    for (index, t) in transitions.iter().enumerate() {
        let from = t.get("from").and_then(Value::as_str).unwrap_or("");
        let to = t.get("to").and_then(Value::as_str).unwrap_or("");
        let from_ok = !from.is_empty() && state_names.contains(from);
        let to_ok = !to.is_empty() && state_names.contains(to);
        if !from_ok || !to_ok {
            unknown_count += 1;
            let mut loc = BTreeMap::new();
            loc.insert("transitionIndex".to_string(), index.to_string());
            loc.insert("from".to_string(), from.to_string());
            loc.insert("to".to_string(), to.to_string());
            fail(
                result,
                &block.id,
                "transition-unknown-state",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Error,
                format!(
                    "迁移 #{} 引用了未知状态：from='{}', to='{}'。",
                    index + 1,
                    from,
                    to
                ),
                true,
                Some(loc),
            );
        }
    }
    record(
        result,
        kind,
        "transition-unknown-state",
        &block.id,
        unknown_count,
    );

    // Build adjacency for dead/unreachable detection.
    let mut outgoing: HashSet<String> = HashSet::new();
    let mut incoming: HashSet<String> = HashSet::new();
    for t in &transitions {
        if let Some(from) = t.get("from").and_then(Value::as_str) {
            outgoing.insert(from.to_string());
        }
        if let Some(to) = t.get("to").and_then(Value::as_str) {
            incoming.insert(to.to_string());
        }
    }

    // dead-state
    let mut dead_count = 0usize;
    for state in &states {
        let name = state.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let terminal = state
            .get("terminal")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !terminal && !outgoing.contains(name) {
            dead_count += 1;
            let mut loc = BTreeMap::new();
            loc.insert("state".to_string(), name.to_string());
            fail(
                result,
                &block.id,
                "dead-state",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Warning,
                format!("状态 “{}” 没有出迁，且未标记为 terminal。", name),
                true,
                Some(loc),
            );
        }
    }
    record(result, kind, "dead-state", &block.id, dead_count);

    // unreachable-state
    let mut unreachable_count = 0usize;
    for state in &states {
        let name = state.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let initial = state
            .get("initial")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !initial && !incoming.contains(name) {
            unreachable_count += 1;
            let mut loc = BTreeMap::new();
            loc.insert("state".to_string(), name.to_string());
            fail(
                result,
                &block.id,
                "unreachable-state",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Warning,
                format!("状态 “{}” 无入迁，且未标记为 initial。", name),
                true,
                Some(loc),
            );
        }
    }
    record(
        result,
        kind,
        "unreachable-state",
        &block.id,
        unreachable_count,
    );

    // no-terminal
    let any_terminal = states
        .iter()
        .any(|s| s.get("terminal").and_then(Value::as_bool).unwrap_or(false));
    record(
        result,
        kind,
        "no-terminal",
        &block.id,
        usize::from(has_states && !any_terminal),
    );
    if has_states && !any_terminal {
        fail(
            result,
            &block.id,
            "no-terminal",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Warning,
            "流程没有 terminal 状态。",
            true,
            None,
        );
    }
}

// ---- apiContract rules ---------------------------------------------------

fn check_api_contract(
    block: &DesignerBlock,
    _derived_edges: &[DesignerDerivedEdge],
    result: &mut GapRunResult,
) {
    let payload = &block.payload;
    let kind = "apiContract";

    let endpoints = payload
        .get("endpoints")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_endpoints = !endpoints.is_empty();
    record(
        result,
        kind,
        "no-endpoints",
        &block.id,
        usize::from(!has_endpoints),
    );
    if !has_endpoints {
        fail(
            result,
            &block.id,
            "no-endpoints",
            DesignerGapLayer::Intra,
            DesignerGapSeverity::Error,
            "契约没有端点，至少补一个端点。",
            true,
            None,
        );
    }

    let mut endpoint_no_path_count = 0usize;
    let mut endpoint_no_method_count = 0usize;
    let mut no_response_count = 0usize;
    let mut no_errors_count = 0usize;

    for (index, endpoint) in endpoints.iter().enumerate() {
        let mut loc = BTreeMap::new();
        loc.insert("endpointIndex".to_string(), index.to_string());
        let path = endpoint
            .get("path")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        let method = endpoint
            .get("method")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if !path.is_empty() {
            loc.insert("path".to_string(), path.to_string());
        }
        if !method.is_empty() {
            loc.insert("method".to_string(), method.to_string());
        }

        if path.is_empty() {
            endpoint_no_path_count += 1;
            fail(
                result,
                &block.id,
                "endpoint-no-path",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Error,
                format!("端点 #{} 缺少 path。", index + 1),
                true,
                Some(loc.clone()),
            );
        }
        if method.is_empty() {
            endpoint_no_method_count += 1;
            fail(
                result,
                &block.id,
                "endpoint-no-method",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Error,
                format!("端点 #{} 缺少 method。", index + 1),
                true,
                Some(loc.clone()),
            );
        }

        let has_response = endpoint
            .get("response")
            .map(|v| !is_empty_value(v))
            .unwrap_or(false)
            || endpoint
                .get("responseShape")
                .map(|v| !is_empty_value(v))
                .unwrap_or(false);
        if !has_response {
            no_response_count += 1;
            fail(
                result,
                &block.id,
                "no-response",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Warning,
                format!("端点 #{} 没有响应（response/responseShape）。", index + 1),
                true,
                Some(loc.clone()),
            );
        }

        let has_errors = endpoint
            .get("errors")
            .and_then(Value::as_array)
            .map(|arr| !arr.is_empty())
            .unwrap_or(false)
            || endpoint
                .get("errorCodes")
                .and_then(Value::as_array)
                .map(|arr| !arr.is_empty())
                .unwrap_or(false);
        if !has_errors {
            no_errors_count += 1;
            fail(
                result,
                &block.id,
                "no-errors",
                DesignerGapLayer::Intra,
                DesignerGapSeverity::Warning,
                format!("端点 #{} 没有错误码。", index + 1),
                true,
                Some(loc),
            );
        }
    }
    record(
        result,
        kind,
        "endpoint-no-path",
        &block.id,
        endpoint_no_path_count,
    );
    record(
        result,
        kind,
        "endpoint-no-method",
        &block.id,
        endpoint_no_method_count,
    );
    record(result, kind, "no-response", &block.id, no_response_count);
    record(result, kind, "no-errors", &block.id, no_errors_count);
}

fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        _ => false,
    }
}

// ---- uiScreen rules ---------------------------------------------------

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
