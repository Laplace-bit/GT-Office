import { useEffect } from 'react'
import { StationActionCommandSheet, StationForceCloseConfirmDialog } from '@features/workspace-hub'
import { ShellRootView } from './ShellRootView'
import { useShellRootController } from './useShellRootController'
import { WorkspaceCloseDialog } from './WorkspaceCloseDialog'

import './ShellRoot.scss'

function markShellInteractive() {
  if (typeof performance === 'undefined') {
    return
  }
  performance.mark('gtoffice:shell-interactive')
  performance.measure('gtoffice:startup-to-shell', 'gtoffice:main-module-loaded', 'gtoffice:shell-interactive')
}

interface ShellRootProps {
  workspaceWindowId?: string
}

export default function ShellRootLoaded({ workspaceWindowId }: ShellRootProps = {}) {
  const {
    shellRootViewProps,
    stationActionCommandSheetProps,
    workspaceCloseDialogProps,
    stationForceCloseConfirmDialogProps,
  } = useShellRootController({ workspaceWindowId })

  useEffect(() => {
    markShellInteractive()
  }, [])

  return (
    <>
      <ShellRootView {...shellRootViewProps} />
      <StationActionCommandSheet {...stationActionCommandSheetProps} />
      <WorkspaceCloseDialog {...workspaceCloseDialogProps} />
      <StationForceCloseConfirmDialog {...stationForceCloseConfirmDialogProps} />
    </>
  )
}
