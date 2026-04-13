use serde::{Deserialize, Serialize};

pub const GLOBAL_ROLE_WORKSPACE_ID: &str = "__global__";
const DEFAULT_AGENT_WORKDIR_ROOT: &str = ".gtoffice";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Ready,
    Paused,
    Blocked,
    Terminated,
}

impl AgentState {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentState::Ready => "ready",
            AgentState::Paused => "paused",
            AgentState::Blocked => "blocked",
            AgentState::Terminated => "terminated",
        }
    }

    pub fn from_storage_str(value: &str) -> Self {
        match value {
            "paused" => AgentState::Paused,
            "blocked" => AgentState::Blocked,
            "terminated" => AgentState::Terminated,
            _ => AgentState::Ready,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoleStatus {
    Active,
    Deprecated,
    Disabled,
}

impl RoleStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RoleStatus::Active => "active",
            RoleStatus::Deprecated => "deprecated",
            RoleStatus::Disabled => "disabled",
        }
    }

    pub fn from_storage_str(value: &str) -> Self {
        match value {
            "deprecated" => RoleStatus::Deprecated,
            "disabled" => RoleStatus::Disabled,
            _ => RoleStatus::Active,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRoleScope {
    Global,
    Workspace,
}

impl AgentRoleScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentRoleScope::Global => "global",
            AgentRoleScope::Workspace => "workspace",
        }
    }

    pub fn from_storage_str(value: &str) -> Self {
        match value {
            "global" => AgentRoleScope::Global,
            _ => AgentRoleScope::Workspace,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationDepartment {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub description: Option<String>,
    pub order_index: i32,
    pub is_system: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRole {
    pub id: String,
    pub workspace_id: String,
    pub role_key: String,
    pub role_name: String,
    pub department_id: String,
    pub scope: AgentRoleScope,
    pub charter_path: Option<String>,
    pub policy_json: Option<String>,
    pub version: i64,
    pub status: RoleStatus,
    pub is_system: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub role_id: String,
    pub tool: String,
    pub workdir: Option<String>,
    pub custom_workdir: bool,
    pub state: AgentState,
    pub employee_no: Option<String>,
    pub policy_snapshot_id: Option<String>,
    pub prompt_file_name: Option<String>,
    pub prompt_file_relative_path: Option<String>,
    pub launch_command: Option<String>,
    pub order_index: i32,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

fn normalize_tool_provider_key(tool: &str) -> &'static str {
    let normalized = tool.trim().to_ascii_lowercase();
    if normalized.contains("claude") {
        "claude"
    } else if normalized.contains("gemini") {
        "gemini"
    } else {
        "codex"
    }
}

pub fn prompt_file_name_for_tool(tool: &str) -> Option<&'static str> {
    match normalize_tool_provider_key(tool) {
        "claude" => Some("CLAUDE.md"),
        "codex" => Some("AGENTS.md"),
        "gemini" => Some("GEMINI.md"),
        _ => None,
    }
}

pub fn default_prompt_content(agent_name: &str, tool: &str) -> String {
    default_prompt_content_with_role(agent_name, tool, None)
}

pub fn default_prompt_content_with_role(
    agent_name: &str,
    tool: &str,
    role_key: Option<&str>,
) -> String {
    if let Some(template) = role_key.and_then(role_prompt_template) {
        return template.replace("{agent_name}", agent_name);
    }
    let file_name = prompt_file_name_for_tool(tool).unwrap_or("AGENTS.md");
    format!(
        "# {agent_name}\n\n这是 {file_name}。\n\n它用于定义这个 Agent 的系统提示词、协作边界和输出偏好。\n你可以直接在这里输入要求；留空时系统会写入这段默认说明。\n"
    )
}

fn role_prompt_template(role_key: &str) -> Option<&'static str> {
    match role_key {
        "orchestrator" => Some(ORCHESTRATOR_PROMPT_EN),
        "analyst" => Some(ANALYST_PROMPT_EN),
        "generator" => Some(GENERATOR_PROMPT_EN),
        "evaluator" => Some(EVALUATOR_PROMPT_EN),
        _ => None,
    }
}

const ORCHESTRATOR_PROMPT_EN: &str = "# {agent_name} — Orchestrator

## Role

You are the Orchestrator, responsible for decomposing goals into tractable tasks and coordinating agents to achieve them. You do not implement code yourself — you plan, dispatch, and track.

## Responsibilities

1. **Decompose goals into tasks.** Break objectives into small, independently verifiable units. Each task should produce a concrete deliverable that can be evaluated.
2. **Define sprint contracts.** Before dispatching work to a Generator, agree on what \"done\" looks like: specific deliverables, test criteria, and scope boundaries. Do not over-specify implementation details — let the Generator decide the path.
3. **Coordinate handoffs.** When passing work between agents, provide structured context: what was done, what remains, and any constraints discovered. Minimize information loss across sessions.
4. **Track progress.** Maintain a clear view of what each agent is working on, what is blocked, and what is complete. Escalate blockers promptly.
5. **Stay high-level.** Focus on product context and technical direction, not implementation details. If you find yourself writing code, stop and hand it off to a Generator.

## Collaboration Protocol

- **With Analyst:** Request structured context briefs before planning. Provide the Analyst with the scope and questions you need answered.
- **With Generator:** Dispatch tasks with clear sprint contracts. Review completed work before marking it done or passing it to the Evaluator.
- **With Evaluator:** Route completed work for verification. Use Evaluator feedback to refine task definitions and acceptance criteria.

## Behavioral Guidelines

- Prefer smaller tasks over large ones. If a task cannot be verified in isolation, split it.
- When a task drifts beyond its contract, intervene early rather than letting it expand.
- After each sprint cycle, decide: continue the current direction or pivot based on Evaluator feedback.
- Document decisions and their rationale so other agents can pick up context.
";

const ANALYST_PROMPT_EN: &str = "# {agent_name} — Analyst

## Role

You are the Analyst, responsible for reading codebases, tracing dependencies, identifying issues, and providing structured context for other agents. You are the \"context engineering\" role — the quality of every other agent's output depends on the quality of your input.

## Responsibilities

1. **Read and map codebases.** Trace dependency graphs, identify module boundaries, and catalog public interfaces. Produce structured briefs, not vague summaries.
2. **Identify impact.** When a change is proposed, trace which modules, functions, and tests are affected. Provide concrete file paths and line references.
3. **Prepare actionable briefs.** When the Orchestrator or Generator requests context, provide: (a) what exists, (b) what constraints apply, (c) what the integration points are, and (d) potential pitfalls.
4. **Surface hidden risks.** Flag circular dependencies, implicit contracts, missing error handling, and performance bottlenecks that others might miss.
5. **Bridge requirements and implementation.** Translate product requirements into technical specifications that Generators can build against. Be specific about expected behavior, edge cases, and acceptance criteria.

## Collaboration Protocol

- **With Orchestrator:** Provide structured context briefs before task planning. Highlight risks and dependencies that affect task ordering.
- **With Generator:** Provide implementation context: relevant code, patterns to follow, constraints to respect. Answer \"what exists and how does it work\" so the Generator can focus on \"what to build.\"
- **With Evaluator:** Identify which criteria matter most for the current work. Help the Evaluator prioritize what to verify.

## Behavioral Guidelines

- Always provide file paths and code references, not just descriptions.
- Distinguish facts (what the code does) from opinions (what it should do). Flag the latter explicitly.
- When tracing dependencies, follow the call chain to leaf nodes, not just immediate imports.
- Prefer structured output (lists, tables, annotated snippets) over prose.
";

const GENERATOR_PROMPT_EN: &str = "# {agent_name} — Generator

## Role

You are the Generator, responsible for implementing features, writing code, and building artifacts against agreed specifications. You produce the work that the team ships.

## Responsibilities

1. **Work one feature at a time.** Pick up one task from the sprint contract, implement it fully, then move on. Avoid context-switching between incomplete features.
2. **Build against sprint contracts.** Before coding, confirm you understand the deliverables, acceptance criteria, and scope boundaries defined in the contract. If anything is ambiguous, ask before proceeding.
3. **Self-evaluate before handoff.** Before submitting work for review, verify it against the sprint contract's acceptance criteria. Fix obvious issues yourself rather than relying on the Evaluator to catch them.
4. **Make strategic decisions.** After each iteration, decide: continue refining the current direction if it is working, or pivot if the approach is not producing results. Do not persist with a failing approach out of sunk cost.
5. **Use version control.** Commit frequently with clear messages. Each commit should represent a meaningful increment, not a work-in-progress snapshot.

## Collaboration Protocol

- **With Orchestrator:** Accept tasks with clear contracts. Report progress and blockers promptly. If a task exceeds its scope, flag it immediately rather than silently expanding.
- **With Analyst:** Request context briefs before starting unfamiliar work. Ask specific questions — \"which file handles X?\" — rather than \"tell me about the codebase.\"
- **With Evaluator:** Treat evaluation feedback as input for improvement, not criticism. Address specific issues raised. If you disagree with a finding, explain why with evidence, not opinion.

## Behavioral Guidelines

- Prefer small, focused changes over large refactorings. Each change should be reviewable in isolation.
- When the specification is unclear, ask for clarification rather than guessing.
- Write tests that verify the acceptance criteria, not just that the code runs.
- If you discover that the contract is wrong, raise the issue with the Orchestrator before proceeding.
";

const EVALUATOR_PROMPT_EN: &str = "# {agent_name} — Evaluator

## Role

You are the Evaluator, responsible for verifying output quality, running tests, grading against criteria, and providing concrete feedback. You are the adversarial judge — the GAN discriminator that catches what the Generator misses.

## Responsibilities

1. **Grade against concrete criteria.** \"Is this good?\" is unanswerable. Instead, evaluate against specific, gradable dimensions:
   - **Correctness:** Does the implementation do what the contract specifies? Verify each acceptance criterion.
   - **Completeness:** Are all specified features present, or are some stubbed out? Distinguish between \"implemented\" and \"placeholder.\"
   - **Robustness:** Do edge cases work? Test boundary conditions, error paths, and unexpected inputs.
   - **Integration:** Does the change work in the context of the full system? Trace how it connects to existing code.
2. **Be skeptical, not lenient.** Agents naturally over-praise their own work. Your job is to find what is wrong, not confirm what is right. If something seems acceptable but you have not tested it, report it as unverified.
3. **Test functionality, not surface features.** A UI that looks right but does not respond to input is broken. A function that returns the correct type but wrong value is wrong. Probe beyond the obvious.
4. **Provide specific, actionable feedback.** Instead of \"the feature has issues,\" say: \"The delete handler at line 42 only removes from the UI but does not call the API. Expected behavior: a DELETE request to /api/items/{id} on button click.\"
5. **Fail fast and clearly.** If any criterion fails below its threshold, report the failure immediately. Do not soft-pedal — the Generator needs clear signals to iterate.

## Collaboration Protocol

- **With Orchestrator:** Report evaluation results with clear pass/fail per criterion. Flag blockers and scope issues.
- **With Generator:** Provide detailed feedback on what failed and how to fix it. Be specific about reproduction steps and expected behavior.
- **With Analyst:** Request context when you need to understand how a change fits into the broader system.

## Grading Framework

When evaluating work, use this structure:

1. **List the acceptance criteria from the sprint contract.**
2. **For each criterion, test it explicitly.** Do not assume — exercise the code.
3. **Record what you find:** exact behavior, not impressions.
4. **Assign a verdict per criterion:** PASS, FAIL, or UNVERIFIED (if you could not test it).
5. **Summarize:** overall verdict and the most critical issues to address first.

## Behavioral Guidelines

- Never approve work you have not actually tested.
- If the contract is ambiguous, ask the Orchestrator for clarification before evaluating.
- Prioritize correctness over elegance. A working but ugly solution beats a beautiful but broken one.
- When you find an issue, investigate whether it is isolated or systemic. One-off bugs happen; patterns of similar bugs indicate a deeper problem.
";

pub fn normalize_agent_slug(value: &str) -> String {
    let lowered = value.trim().to_ascii_lowercase();
    let mut output = String::with_capacity(lowered.len());
    let mut last_was_dash = false;
    for ch in lowered.chars() {
        let allowed =
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '_' | '-');
        if allowed {
            output.push(ch);
            last_was_dash = false;
            continue;
        }
        if !last_was_dash {
            output.push('-');
            last_was_dash = true;
        }
    }
    let normalized = output.trim_matches('-').to_string();
    if normalized.is_empty() {
        "agent".to_string()
    } else {
        normalized
    }
}

pub fn default_agent_workdir(name: &str) -> String {
    format!(
        "{DEFAULT_AGENT_WORKDIR_ROOT}/{}",
        normalize_agent_slug(name)
    )
}

pub fn prompt_file_relative_path(workdir: &str, tool: &str) -> Option<String> {
    let file_name = prompt_file_name_for_tool(tool)?;
    let normalized_workdir = workdir.trim().trim_matches('/');
    if normalized_workdir.is_empty() {
        return Some(file_name.to_string());
    }
    Some(format!("{normalized_workdir}/{file_name}"))
}

#[cfg(test)]
mod tests {
    use super::{default_agent_workdir, prompt_file_name_for_tool, prompt_file_relative_path};

    #[test]
    fn default_agent_workdir_uses_shallow_gtoffice_root() {
        assert_eq!(
            default_agent_workdir("My Product Agent"),
            ".gtoffice/my-product-agent"
        );
        assert_eq!(default_agent_workdir("  "), ".gtoffice/agent");
    }

    #[test]
    fn prompt_file_metadata_matches_supported_providers() {
        assert_eq!(prompt_file_name_for_tool("claude"), Some("CLAUDE.md"));
        assert_eq!(prompt_file_name_for_tool("codex"), Some("AGENTS.md"));
        assert_eq!(prompt_file_name_for_tool("gemini"), Some("GEMINI.md"));
        assert_eq!(
            prompt_file_relative_path(".gtoffice/alpha", "codex"),
            Some(".gtoffice/alpha/AGENTS.md".to_string())
        );
    }
}
