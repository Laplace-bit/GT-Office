import { lazy, Suspense } from 'react'
import { ShellStartupFrame } from './ShellStartupFrame'

const ShellRootLoaded = lazy(() => import('./ShellRoot.loaded'))

interface ShellRootProps {
  workspaceWindowId?: string
}

export function ShellRoot({ workspaceWindowId }: ShellRootProps = {}) {
  return (
    <Suspense fallback={<ShellStartupFrame />}>
      <ShellRootLoaded workspaceWindowId={workspaceWindowId} />
    </Suspense>
  )
}
