import type { DesignerOperation } from './designer-operation'

export type DesignerCreateKind = 'entityModel' | 'businessFlow' | 'apiContract'

export type DesignerToolbarActionId =
  | 'save'
  | 'createEntity'
  | 'createFlow'
  | 'createApi'
  | 'expandCanvas'
  | 'export'
  | 'checkpoint'
  | 'history'

export interface DesignerToolbarActionState {
  busy: boolean
  disabled: boolean
}

export interface DesignerToolbarStateInput {
  canEdit: boolean
  operation: DesignerOperation | null
  agentRunning?: boolean
}

export const DESIGNER_TOOLBAR_ACTION_ORDER = [
  'save',
  'createEntity',
  'createFlow',
  'createApi',
  'expandCanvas',
  'export',
  'checkpoint',
  'history',
] as const satisfies readonly DesignerToolbarActionId[]

export const DESIGNER_TOOLBAR_MUTATING_ACTIONS = [
  'save',
  'createEntity',
  'createFlow',
  'createApi',
  'expandCanvas',
  'export',
  'checkpoint',
] as const satisfies readonly DesignerToolbarActionId[]

export function isDesignerToolbarBusy(input: DesignerToolbarStateInput): boolean {
  return input.operation !== null || input.agentRunning === true
}

export function resolveDesignerToolbarActionStates(
  input: DesignerToolbarStateInput,
): Record<DesignerToolbarActionId, DesignerToolbarActionState> {
  const documentBusy = input.operation !== null
  const freeformRunning = input.agentRunning === true
  const documentMutationDisabled = !input.canEdit || documentBusy

  return {
    save: {
      busy: input.operation === 'save',
      disabled: documentMutationDisabled,
    },
    createEntity: {
      busy: false,
      disabled: documentMutationDisabled,
    },
    createFlow: {
      busy: false,
      disabled: documentMutationDisabled,
    },
    createApi: {
      busy: false,
      disabled: documentMutationDisabled,
    },
    expandCanvas: {
      busy: input.operation === 'agent' || freeformRunning,
      disabled: documentMutationDisabled,
    },
    export: {
      busy: input.operation === 'export',
      disabled: documentMutationDisabled,
    },
    checkpoint: {
      busy: input.operation === 'checkpoint',
      disabled: documentMutationDisabled,
    },
    history: {
      busy: false,
      disabled: !input.canEdit,
    },
  }
}
