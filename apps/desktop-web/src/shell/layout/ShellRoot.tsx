import { StationActionCommandSheet } from '@features/workspace-hub'
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
  } = useShellRootController({ workspaceWindowId })

  return (
    <>
      <ShellRootView {...shellRootViewProps} />
      <StationActionCommandSheet {...stationActionCommandSheetProps} />
      <WorkspaceCloseDialog {...workspaceCloseDialogProps} />
    </>
  )
}
