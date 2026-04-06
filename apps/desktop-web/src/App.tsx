import { DetachedWorkbenchWindow, type DetachedWorkbenchWindowPayload } from './features/workspace-hub'
import { ShellRoot } from './shell/layout/ShellRoot'
import { ErrorBoundary } from './components/ErrorBoundary'

function parseDetachedPayload(): DetachedWorkbenchWindowPayload | null {
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
    return JSON.parse(new TextDecoder().decode(bytes)) as DetachedWorkbenchWindowPayload
  } catch {
    return null
  }
}

function App() {
  const detachedPayload = parseDetachedPayload()
  if (detachedPayload) {
    return (
      <ErrorBoundary>
        <DetachedWorkbenchWindow payload={detachedPayload} />
      </ErrorBoundary>
    )
  }
  return (
    <ErrorBoundary>
      <ShellRoot />
    </ErrorBoundary>
  )
}

export default App
