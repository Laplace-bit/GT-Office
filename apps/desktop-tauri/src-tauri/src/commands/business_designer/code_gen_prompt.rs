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
    out.push_str(&format!(
        "- Module: {}\n",
        detail.manifest.module.as_deref().unwrap_or("(unspecified)")
    ));
    out.push_str(&format!("- Document ID: {}\n", detail.manifest.document_id));
    out.push_str(&format!("- Revision: {}\n", detail.design.revision));
    let tech = sorted_blocks(&detail.design.blocks)
        .into_iter()
        .filter(|b| b.kind == "technicalStack");
    for b in tech {
        out.push_str(&format!(
            "- Tech stack: {}\n",
            render_block_markdown_inline(b)
        ));
    }
    out.push('\n');
    out.push_str("## Requirements\n\n");

    out.push_str("### Brief\n\n");
    for b in blocks_of_kind(detail, "text") {
        out.push_str(&super::render_block_markdown(b));
        out.push('\n');
    }

    out.push_str("### Data Schemas\n\n");
    for b in blocks_of_kind(detail, "entityModel") {
        out.push_str(&super::render_block_markdown(b));
        out.push('\n');
    }
    for b in blocks_of_kind(detail, "dataContract") {
        out.push_str(&super::render_block_markdown(b));
        out.push('\n');
    }

    out.push_str("### Business Flows\n\n");
    for b in blocks_of_kind(detail, "businessFlow") {
        out.push_str(&super::render_block_markdown(b));
        out.push('\n');
    }

    out.push_str("### UI\n\n");
    for b in blocks_of_kind(detail, "uiScreen") {
        out.push_str(&super::render_block_markdown(b));
        out.push('\n');
    }

    out.push_str("## Acceptance Criteria\n\n");
    for b in blocks_of_kind(detail, "acceptanceCriteria") {
        out.push_str(&super::render_block_markdown(b));
        out.push('\n');
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

fn render_block_markdown_inline(block: &DesignerBlock) -> String {
    let md = super::render_block_markdown(block);
    let trimmed = md.trim();
    if trimmed.contains('\n') {
        trimmed.lines().next().unwrap_or("").to_string()
    } else {
        trimmed.to_string()
    }
}
