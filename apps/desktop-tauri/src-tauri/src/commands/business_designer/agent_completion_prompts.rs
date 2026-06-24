use serde_json::to_string_pretty;

use super::{DesignerBlock, DesignerDocumentDetail, DesignerFreeformCompletionScenario};

pub(crate) struct FreeformPromptInput<'a> {
    pub detail: &'a DesignerDocumentDetail,
    pub scenario: DesignerFreeformCompletionScenario,
    pub host_block: Option<&'a DesignerBlock>,
    pub document_root: &'a str,
    pub document_file: &'a str,
    pub validation_summary: &'a str,
    pub user_prompt: Option<&'a str>,
}

pub(crate) fn render_freeform_completion_prompt(input: FreeformPromptInput<'_>) -> String {
    let scenario_instruction = scenario_instruction(input.scenario);
    let host_block_text = input
        .host_block
        .map(render_host_block)
        .unwrap_or_else(|| "No host block is selected for this run.".to_string());
    let user_prompt = input
        .user_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("No additional user requirements.");

    format!(
        r#"# Business Designer Freeform Completion

You are running inside GT Office Business Designer. Complete the design document for the current scenario.

## Scenario
{scenario}

## Document
- documentId: {document_id}
- title: {title}
- documentRoot: {document_root}
- documentFile: {document_file}

## Current Host Block
{host_block}

## Current Validation Summary
{validation_summary}

## Operating Rules
- Edit files that belong to this Business Designer document.
- Do not edit application source code, tests, build scripts, dependencies, or repository configuration unless the user explicitly asks for that.
- You may create, update, or delete design document blocks when that is the right design move.
- Keep JSON and Markdown files valid and readable.
- Do not run full repository validation commands by default. GT Office will reload and validate the document after file changes.
- When done, summarize changed files, deleted files, design choices, and anything that still needs human review.

## User Additional Requirements
{user_prompt}
"#,
        scenario = scenario_instruction,
        document_id = input.detail.manifest.document_id,
        title = input.detail.manifest.title,
        document_root = input.document_root,
        document_file = input.document_file,
        host_block = host_block_text,
        validation_summary = input.validation_summary,
        user_prompt = user_prompt,
    )
}

fn scenario_instruction(scenario: DesignerFreeformCompletionScenario) -> &'static str {
    match scenario {
        DesignerFreeformCompletionScenario::BriefToDesign => {
            "brief_to_design: turn the brief/root requirement into initial entity, flow, and API design blocks."
        }
        DesignerFreeformCompletionScenario::CompleteEntity => {
            "complete_entity: complete the selected entity model fields, keys, constraints, and relationships. Create adjacent design blocks if needed."
        }
        DesignerFreeformCompletionScenario::CompleteFlow => {
            "complete_flow: complete the selected business flow states, transitions, terminal states, and exception paths. Create adjacent design blocks if needed."
        }
        DesignerFreeformCompletionScenario::CompleteApiContract => {
            "complete_api_contract: complete endpoints, request/response shapes, and error cases. Create missing entity blocks if needed."
        }
        DesignerFreeformCompletionScenario::ExpandCanvas => {
            "expand_canvas: extend the current graph with useful related entities, flows, and API contracts."
        }
    }
}

fn render_host_block(block: &DesignerBlock) -> String {
    let payload = to_string_pretty(&block.payload).unwrap_or_else(|_| "{}".to_string());
    format!(
        "- id: {id}\n- kind: {kind}\n- title: {title}\n- payload:\n```json\n{payload}\n```",
        id = block.id,
        kind = block.kind,
        title = block.title,
        payload = payload,
    )
}
