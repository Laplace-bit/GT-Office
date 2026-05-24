import { lazy, Suspense, type ReactNode } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShellStartupFrame } from './shell/layout/ShellStartupFrame'
const ShellRoot = lazy(() =>
  import('./shell/layout/ShellRoot').then((module) => ({ default: module.ShellRoot })),
)
const WorkspaceWindowRoot = lazy(() =>
  import('./shell/layout/WorkspaceWindowRoot').then((module) => ({
    default: module.WorkspaceWindowRoot,
  })),
)
const DetachedWorkbenchWindow = lazy(() =>
  import('./features/workspace-hub/DetachedWorkbenchWindow').then((module) => ({
    default: module.DetachedWorkbenchWindow,
  })),
)

function parseDetachedPayload(): Record<string, unknown> | null {
  if (typeof window === 'undefined') {
    return null
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('surface') !== 'detached') {
    return null
  }
  const rawPayload = params.get('payload')
  if (!rawPayload) {
    return null
  }
  try {
    const normalized = rawPayload.replace(/-/g, '+').replace(/_/g, '/')
    const paddingLength = (4 - (normalized.length % 4)) % 4
    const binary = window.atob(`${normalized}${'='.repeat(paddingLength)}`)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseWorkspaceWindowId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  const params = new URLSearchParams(window.location.search)
  const workspaceId = params.get('workspace')
  const normalized = workspaceId?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function AppSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ShellStartupFrame />}>{children}</Suspense>
}

function App() {
  const detachedPayload = parseDetachedPayload()
  if (detachedPayload) {
    return (
      <ErrorBoundary>
        <AppSuspense>
          <DetachedWorkbenchWindow payload={detachedPayload as never} />
        </AppSuspense>
      </ErrorBoundary>
    )
  }
  const workspaceWindowId = parseWorkspaceWindowId()
  if (workspaceWindowId) {
    return (
      <ErrorBoundary>
        <AppSuspense>
          <WorkspaceWindowRoot workspaceId={workspaceWindowId} />
        </AppSuspense>
      </ErrorBoundary>
    )
  }
  return (
    <ErrorBoundary>
      <AppSuspense>
        <ShellRoot />
      </AppSuspense>
    </ErrorBoundary>
  )
}

export default App
