//! Designer agent station — workspace-level persistent station that replaces
//! the headless single-shot freeform completion (sub-project B).
//!
//! The station is a real agent profile (role: `business-designer`, workdir:
//! `.gtoffice/docs`) whose terminal session is launched by the frontend via
//! the existing station/terminal infra (`tool_launch` / `StationXtermTerminal`).
//! Scenario prompts and annotation captures are injected into the terminal as
//! text; the agent edits `design.json` directly; `watch_document` reloads +
//! revalidates. Static design context lives in `CLAUDE.md`/`AGENTS.md` at the
//! docs root (written by B7); this module composes only the dynamic, per-turn
//! intent (which document, which scenario, what the user wants).

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::{
    app_state::AppState,
    commands::agent::{
        agent_create_with_repo, resolve_agent_repository, seed_agent_defaults, AgentCreateRequest,
    },
};
use gt_agent::AgentRepository;

use super::{
    create_checkpoint_at, read_document_at, resolve_workspace_root, DesignerBlock,
    DesignerDocumentDetail, DesignerFreeformCompletionScenario,
};

const DESIGNER_ROLE_KEY: &str = "business-designer";
const DESIGNER_AGENT_NAME: &str = "Business Designer";
const DESIGNER_AGENT_WORKDIR: &str = ".gtoffice/docs";

/// Ensure a designer-scoped agent station exists for the workspace (create if
/// missing). Returns the agent profile + a `created` flag. Idempotent.
#[tauri::command]
pub fn business_designer_ensure_agent_station(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_agent_station_at(&workspace_id, state.inner(), &app)
}

pub(crate) fn ensure_agent_station_at(
    workspace_id: &str,
    state: &AppState,
    app: &AppHandle,
) -> Result<Value, String> {
    let workspace_root = resolve_workspace_root(state, workspace_id)?;
    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema().map_err(|error| error.to_string())?;
    seed_agent_defaults(&repo, workspace_id)?;

    let roles = repo
        .list_roles(workspace_id)
        .map_err(|error| error.to_string())?;
    let designer_role = roles
        .iter()
        .find(|role| role.role_key == DESIGNER_ROLE_KEY)
        .ok_or_else(|| {
            format!("BUSINESS_DESIGNER_ROLE_MISSING: role '{DESIGNER_ROLE_KEY}' not seeded")
        })?;

    let agents = repo
        .list_agents(workspace_id)
        .map_err(|error| error.to_string())?;
    if let Some(existing) = agents.iter().find(|agent| agent.role_id == designer_role.id) {
        return Ok(json!({ "agent": existing, "created": false }));
    }

    // Create the designer station profile. prompt_enabled=false: B7 writes the
    // CLAUDE.md/AGENTS.md with full designer context (block schema, gap rules,
    // data-* conventions). Claude Code/Codex auto-load the prompt file from cwd.
    let request = AgentCreateRequest {
        workspace_id: workspace_id.to_string(),
        agent_id: None,
        name: DESIGNER_AGENT_NAME.to_string(),
        role_id: designer_role.id.clone(),
        tool: Some("codex".to_string()),
        workdir: Some(DESIGNER_AGENT_WORKDIR.to_string()),
        custom_workdir: Some(true),
        employee_no: None,
        state: None,
        prompt_enabled: Some(false),
        prompt_file_name: None,
        prompt_content: None,
        launch_command: None,
    };
    let mut created = agent_create_with_repo(request, &repo, &workspace_root)?;
    if let Some(obj) = created.as_object_mut() {
        obj.insert("created".to_string(), json!(true));
    }
    Ok(created)
}

/// Compose a short scenario prompt to inject into the designer station
/// terminal. Static context (block schema, rules, conventions) is in
/// CLAUDE.md; this carries only the dynamic intent.
#[tauri::command]
pub fn business_designer_render_scenario_prompt(
    workspace_id: String,
    document_id: String,
    scenario: DesignerFreeformCompletionScenario,
    host_block_id: Option<String>,
    user_prompt: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    let detail = read_document_at(&workspace_id, &workspace_root, &document_id)?;
    let host_block = host_block_id
        .as_deref()
        .and_then(|id| detail.design.blocks.iter().find(|block| block.id == id));
    let prompt = render_scenario_prompt(&detail, scenario, host_block, user_prompt.as_deref());
    Ok(json!({ "prompt": prompt }))
}

pub(crate) fn render_scenario_prompt(
    detail: &DesignerDocumentDetail,
    scenario: DesignerFreeformCompletionScenario,
    host_block: Option<&DesignerBlock>,
    user_prompt: Option<&str>,
) -> String {
    let scenario_instruction = scenario_instruction(scenario);
    let host = host_block
        .map(|block| {
            format!(
                "- hostBlockId: {}\n- kind: {}\n- title: {}",
                block.id, block.kind, block.title
            )
        })
        .unwrap_or_else(|| "- hostBlock: (none — apply to the whole document)".to_string());
    let user = user_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("(no additional requirements)");
    format!(
        "{scenario_instruction}\n\n\
         Document: {doc_id} ({title}).\n\
         Edit `.gtoffice/docs/documents/{doc_id}/design.json` directly, following the CLAUDE.md conventions. \
         Preserve block ids; use data-nav/data-entity/data-api/data-flow for cross-block links; keep JSON valid.\n\n\
         {host}\n\n\
         Additional requirements:\n{user}",
        doc_id = detail.manifest.document_id,
        title = detail.manifest.title,
    )
}

fn scenario_instruction(scenario: DesignerFreeformCompletionScenario) -> &'static str {
    match scenario {
        DesignerFreeformCompletionScenario::BriefToDesign => {
            "brief_to_design: turn the brief into initial entityModel, businessFlow, apiContract, and uiScreen blocks."
        }
        DesignerFreeformCompletionScenario::CompleteEntity => {
            "complete_entity: complete the selected entityModel's fields, keys, and relationships."
        }
        DesignerFreeformCompletionScenario::CompleteFlow => {
            "complete_flow: complete the selected businessFlow's states, transitions, and terminal states."
        }
        DesignerFreeformCompletionScenario::CompleteApiContract => {
            "complete_api_contract: complete the selected apiContract's endpoints, request/response shapes, and errors."
        }
        DesignerFreeformCompletionScenario::ExpandCanvas => {
            "expand_canvas: extend the design with useful related entities, flows, API contracts, and UI screens."
        }
    }
}

/// Create a git checkpoint for a designer agent turn, so the user can revert
/// any turn via the history sheet. Reuses `create_checkpoint_at`.
#[tauri::command]
pub fn business_designer_checkpoint_turn(
    workspace_id: String,
    document_id: String,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    let message = message.as_deref().unwrap_or("designer agent turn");
    let checkpoint = create_checkpoint_at(&workspace_id, &workspace_root, &document_id, message)?;
    Ok(json!({ "checkpoint": checkpoint }))
}
