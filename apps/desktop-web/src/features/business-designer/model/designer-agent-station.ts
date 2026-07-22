/**
 * Designer agent station types (sub-project B).
 *
 * The designer agent station is a workspace-level persistent agent profile
 * (scope: designer, workdir: .gtoffice/docs) whose terminal session
 * is launched by the frontend via the existing station/terminal infra. These
 * types cover the station profile + scenario prompt used by
 * `useDesignerAgentStation`.
 */

/** The scenario for a designer agent turn. Wire form is snake_case (matches
 *  the backend `DesignerFreeformCompletionScenario` enum). */
export type DesignerScenario =
  | 'brief_to_design'
  | 'complete_entity'
  | 'complete_flow'
  | 'complete_api_contract'
  | 'expand_canvas'

/** Map a block kind to the designer agent scenario that completes it. Pure
 *  helper so the inspector / dock share one mapping and it stays testable. */
export function scenarioForBlockKind(kind: string): DesignerScenario {
  switch (kind) {
    case 'text':
      return 'brief_to_design'
    case 'entityModel':
    case 'objectModel':
    case 'dataContract':
      return 'complete_entity'
    case 'businessFlow':
    case 'uiWorkflow':
      return 'complete_flow'
    case 'apiContract':
      return 'complete_api_contract'
    default:
      return 'expand_canvas'
  }
}

/** The subset of the agent profile the designer UI needs. Mirrors the backend
 *  `AgentProfile` camelCase wire form. */
export interface DesignerAgentStation {
  id: string
  name: string
  roleId: string
  tool: string
  workdir: string | null
  customWorkdir: boolean
  state: string
  launchCommand: string | null
  promptFileName: string | null
  promptFileRelativePath: string | null
  orderIndex: number
}

export interface DesignerAgentStationResult {
  agent: DesignerAgentStation
  created: boolean
}

export interface DesignerScenarioPromptResult {
  prompt: string
}
