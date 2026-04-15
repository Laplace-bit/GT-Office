export interface WorkspaceTabInfo {
  workspaceId: string
  name: string
  root: string
  active: boolean
  windowLabel?: string
  detached?: boolean
}