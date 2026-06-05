import { StationActionCommandSheet, StationForceCloseConfirmDialog } from '@features/workspace-hub'
import { ShellRootView } from './ShellRootView'
import { useShellRootController } from './useShellRootController'
import { WorkspaceCloseDialog } from './WorkspaceCloseDialog'

import './ShellRoot.scss'

interface ShellRootProps {
  workspaceWindowId?: string
}

export function ShellRoot({ workspaceWindowId }: ShellRootProps = {}) {
  const {
    shellRootViewProps,
    stationActionCommandSheetProps,
    workspaceCloseDialogProps,
    stationForceCloseConfirmDialogProps,
  } = useShellRootController({ workspaceWindowId })

  return (
    <>
      <ShellRootView {...shellRootViewProps} />
      <StationActionCommandSheet {...stationActionCommandSheetProps} />
      <WorkspaceCloseDialog {...workspaceCloseDialogProps} />
      <StationForceCloseConfirmDialog {...stationForceCloseConfirmDialogProps} />
    </>
  )
}
