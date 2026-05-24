import { useEffect } from 'react'
import './ShellStartupFrame.scss'

function signalUiReadyWhenPainted() {
  if (typeof window === 'undefined') {
    return
  }

  const notify = () => {
    void import('../integration/desktop-api')
      .then(({ desktopApi }) => {
        if (desktopApi.isTauriRuntime()) {
          void desktopApi.signalUiReady()
        }
      })
      .catch(() => {
        // Backend notification must not block first paint.
      })
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(notify)
  })
}

export function ShellStartupFrame() {
  useEffect(() => {
    signalUiReadyWhenPainted()
  }, [])

  return (
    <div className="shell-startup-frame" role="status" aria-live="polite" aria-busy="true">
      <div className="shell-startup-frame-rail" aria-hidden="true" />
      <div className="shell-startup-frame-main">
        <div className="shell-startup-frame-topbar" aria-hidden="true" />
        <div className="shell-startup-frame-content" aria-hidden="true" />
      </div>
    </div>
  )
}
