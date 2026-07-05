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
