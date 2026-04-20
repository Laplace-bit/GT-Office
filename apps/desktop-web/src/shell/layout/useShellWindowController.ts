import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { desktopApi } from '../integration/desktop-api'
import type { WindowPerformancePolicy } from './window-performance-policy'

interface UseShellWindowControllerInput {
  nativeWindowTop: boolean
  nativeWindowTopWindows: boolean
  windowPerformancePolicy: WindowPerformancePolicy
  shellTopRef: RefObject<HTMLDivElement | null>
}

export interface ShellWindowController {
  windowMaximized: boolean
  handleWindowMinimize: () => void
  handleWindowToggleMaximize: () => void
  handleWindowClose: () => void
}

export function useShellWindowController({
  nativeWindowTop,
  nativeWindowTopWindows,
  windowPerformancePolicy,
  shellTopRef,
}: UseShellWindowControllerInput): ShellWindowController {
  const [windowMaximized, setWindowMaximized] = useState(false)
  const windowResizeSyncTimerRef = useRef<number | null>(null)

  const syncWindowFrameState = useCallback(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    void desktopApi.windowIsMaximized().then((maximized) => {
      setWindowMaximized((prev) => (prev === maximized ? prev : maximized))
    })
  }, [])

  useEffect(() => {
    if (!nativeWindowTop) {
      return
    }
    let disposed = false
    let cleanup: (() => void) | null = null

    const syncMaximized = async () => {
      if (disposed) {
        return
      }
      const maximized = await desktopApi.windowIsMaximized()
      if (!disposed) {
        setWindowMaximized((prev) => (prev === maximized ? prev : maximized))
      }
    }

    void desktopApi.windowSetDecorations(windowPerformancePolicy.shouldUseNativeDecorations)
    void syncMaximized()
    void desktopApi.subscribeWindowResized(() => {
      const timerId = windowResizeSyncTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      windowResizeSyncTimerRef.current = window.setTimeout(() => {
        windowResizeSyncTimerRef.current = null
        void syncMaximized()
      }, 120)
    }).then((unlisten) => {
      cleanup = unlisten
    })

    return () => {
      disposed = true
      const timerId = windowResizeSyncTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      windowResizeSyncTimerRef.current = null
      if (cleanup) {
        cleanup()
      }
    }
  }, [nativeWindowTop, windowPerformancePolicy.shouldUseNativeDecorations])

  useEffect(() => {
    const draggingClassName = 'vb-window-dragging'
    if (!nativeWindowTopWindows) {
      document.body.classList.remove(draggingClassName)
      return
    }

    const topContainer = shellTopRef.current
    if (!topContainer) {
      return
    }

    const dragRegionSelector = '[data-tauri-drag-region]'
    const interactiveSelector =
      "button,input,textarea,select,a,[role='button'],[contenteditable='true'],label"

    const clearDraggingClass = () => {
      document.body.classList.remove(draggingClassName)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const dragRegion = target.closest(dragRegionSelector)
      if (!dragRegion) {
        return
      }
      if (target.closest(interactiveSelector)) {
        return
      }
      document.body.classList.add(draggingClassName)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        clearDraggingClass()
      }
    }

    topContainer.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointerup', clearDraggingClass)
    window.addEventListener('pointercancel', clearDraggingClass)
    window.addEventListener('blur', clearDraggingClass)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      topContainer.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointerup', clearDraggingClass)
      window.removeEventListener('pointercancel', clearDraggingClass)
      window.removeEventListener('blur', clearDraggingClass)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearDraggingClass()
    }
  }, [nativeWindowTopWindows, shellTopRef])

  useEffect(() => {
    const root = document.documentElement
    const platform = windowPerformancePolicy.platform

    root.setAttribute('data-vb-platform', platform)

    return () => {
      if (root.getAttribute('data-vb-platform') === platform) {
        root.removeAttribute('data-vb-platform')
      }
    }
  }, [windowPerformancePolicy.platform])

  const handleWindowMinimize = useCallback(() => {
    void desktopApi.windowMinimize()
  }, [])

  const handleWindowToggleMaximize = useCallback(() => {
    void desktopApi.windowToggleMaximize().then((success) => {
      if (!success) {
        return
      }
      syncWindowFrameState()
    })
  }, [syncWindowFrameState])

  const handleWindowClose = useCallback(() => {
    void desktopApi.windowClose()
  }, [])

  return {
    windowMaximized,
    handleWindowMinimize,
    handleWindowToggleMaximize,
    handleWindowClose,
  }
}