export interface EntityField {
  name?: string
  type?: string
  description?: string
  isPrimaryKey?: boolean
}

export interface EntityModelPayload {
  entityName?: string
  fields?: EntityField[]
  [key: string]: unknown
}

export interface FlowState {
  name?: string
  entity?: string
  target?: string
  initial?: boolean
  terminal?: boolean
}

export interface FlowTransition {
  from?: string
  to?: string
}

export interface BusinessFlowPayload {
  states?: FlowState[]
  transitions?: FlowTransition[]
  [key: string]: unknown
}

export interface ApiEndpoint {
  method?: string
  path?: string
  request?: string
  response?: string
  description?: string
  errorCodes?: string[]
  errors?: string[]
}

export interface ApiContractPayload {
  endpoints?: ApiEndpoint[]
  [key: string]: unknown
}

export function renameEntityModel(payload: EntityModelPayload, entityName: string): EntityModelPayload {
  return { ...payload, entityName }
}

export function addEntityField(payload: EntityModelPayload): EntityModelPayload {
  return { ...payload, fields: [...(payload.fields ?? []), { name: '', type: 'string' }] }
}

export function updateEntityField(
  payload: EntityModelPayload,
  index: number,
  patch: Partial<EntityField>,
): EntityModelPayload {
  return {
    ...payload,
    fields: (payload.fields ?? []).map((field, i) => (i === index ? { ...field, ...patch } : field)),
  }
}

export function removeEntityField(payload: EntityModelPayload, index: number): EntityModelPayload {
  return { ...payload, fields: (payload.fields ?? []).filter((_, i) => i !== index) }
}

export function addFlowState(payload: BusinessFlowPayload): BusinessFlowPayload {
  return { ...payload, states: [...(payload.states ?? []), { name: nextFlowStateName(payload.states ?? []) }] }
}

export function nextFlowStateName(states: FlowState[]): string {
  const usedNames = new Set(states.map((state) => state.name).filter(Boolean))
  for (let index = states.length + 1; index < 10000; index += 1) {
    const candidate = `state${index}`
    if (!usedNames.has(candidate)) {
      return candidate
    }
  }
  return `state${Date.now()}`
}

export function renameFlowState(
  payload: BusinessFlowPayload,
  index: number,
  nextName: string,
): BusinessFlowPayload {
  const states = payload.states ?? []
  const previousName = states[index]?.name
  const nextStates = states.map((state, i) => (i === index ? { ...state, name: nextName } : state))
  const nextTransitions =
    previousName && previousName !== nextName
      ? (payload.transitions ?? []).map((transition) => ({
          ...transition,
          from: transition.from === previousName ? nextName : transition.from,
          to: transition.to === previousName ? nextName : transition.to,
        }))
      : payload.transitions
  return { ...payload, states: nextStates, transitions: nextTransitions }
}

export function updateFlowState(
  payload: BusinessFlowPayload,
  index: number,
  patch: Partial<FlowState>,
): BusinessFlowPayload {
  return {
    ...payload,
    states: (payload.states ?? []).map((state, i) => (i === index ? { ...state, ...patch } : state)),
  }
}

export function updateFlowStateEntity(
  payload: BusinessFlowPayload,
  index: number,
  entity: string,
): BusinessFlowPayload {
  return updateFlowState(payload, index, { entity, target: undefined })
}

export function removeFlowState(payload: BusinessFlowPayload, index: number): BusinessFlowPayload {
  const states = payload.states ?? []
  const removedName = states[index]?.name
  const nextStates = states.filter((_, i) => i !== index)
  const nextTransitions = removedName
    ? (payload.transitions ?? []).filter(
        (transition) => transition.from !== removedName && transition.to !== removedName,
      )
    : payload.transitions
  return { ...payload, states: nextStates, transitions: nextTransitions }
}

export function addFlowTransition(payload: BusinessFlowPayload): BusinessFlowPayload {
  return { ...payload, transitions: [...(payload.transitions ?? []), { from: '', to: '' }] }
}

export function updateFlowTransition(
  payload: BusinessFlowPayload,
  index: number,
  patch: Partial<FlowTransition>,
): BusinessFlowPayload {
  return {
    ...payload,
    transitions: (payload.transitions ?? []).map((transition, i) =>
      i === index ? { ...transition, ...patch } : transition,
    ),
  }
}

export function removeFlowTransition(payload: BusinessFlowPayload, index: number): BusinessFlowPayload {
  return { ...payload, transitions: (payload.transitions ?? []).filter((_, i) => i !== index) }
}

export function addApiEndpoint(payload: ApiContractPayload): ApiContractPayload {
  return {
    ...payload,
    endpoints: [
      ...(payload.endpoints ?? []),
      { method: 'GET', path: '', request: '', response: '', errorCodes: [] },
    ],
  }
}

export function updateApiEndpoint(
  payload: ApiContractPayload,
  index: number,
  patch: Partial<ApiEndpoint>,
): ApiContractPayload {
  return {
    ...payload,
    endpoints: (payload.endpoints ?? []).map((endpoint, i) =>
      i === index ? { ...endpoint, ...patch } : endpoint,
    ),
  }
}

export function updateApiEndpointErrors(
  payload: ApiContractPayload,
  index: number,
  value: string,
): ApiContractPayload {
  return updateApiEndpoint(payload, index, {
    errorCodes: parseList(value),
    errors: undefined,
  })
}

export function removeApiEndpoint(payload: ApiContractPayload, index: number): ApiContractPayload {
  return { ...payload, endpoints: (payload.endpoints ?? []).filter((_, i) => i !== index) }
}

export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function formatList(value: string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : ''
}

export function formatEndpointErrors(endpoint: ApiEndpoint): string {
  if (endpoint.errorCodes && endpoint.errorCodes.length > 0) {
    return formatList(endpoint.errorCodes)
  }
  return formatList(endpoint.errors)
}
