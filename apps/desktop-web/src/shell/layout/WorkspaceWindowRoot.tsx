import { ShellRoot } from './ShellRoot'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import './WorkspaceWindowRoot.scss'

interface WorkspaceWindowRootProps {
  workspaceId: string
}

export function WorkspaceWindowRoot({ workspaceId }: WorkspaceWindowRootProps) {
  return (
    <ErrorBoundary>
      <ShellRoot workspaceWindowId={workspaceId} />
    </ErrorBoundary>
  )
}