export type WorkbenchHeaderActionId =
  | 'float'
  | 'dock'
  | 'search'
  | 'add_agent'
  | 'add_container'
  | 'detach'
  | 'topmost'
  | 'pin'

const WORKBENCH_HEADER_ACTION_PRIORITY: Record<WorkbenchHeaderActionId, number> = {
  float: 65,
  dock: 65,
  search: 20,
  add_agent: 30,
  add_container: 40,
  detach: 50,
  topmost: 60,
  pin: 70,
}

function resolveWorkbenchHeaderActionId<T extends WorkbenchHeaderActionId | { id: WorkbenchHeaderActionId }>(
  action: T,
): WorkbenchHeaderActionId {
  return typeof action === 'string' ? action : action.id
}

export function orderWorkbenchHeaderActions<T extends WorkbenchHeaderActionId | { id: WorkbenchHeaderActionId }>(
  actions: readonly T[],
): T[] {
  return [...actions].sort(
    (left, right) =>
      WORKBENCH_HEADER_ACTION_PRIORITY[resolveWorkbenchHeaderActionId(left)] -
      WORKBENCH_HEADER_ACTION_PRIORITY[resolveWorkbenchHeaderActionId(right)],
  )
}
