import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type RefObject,
} from 'react'
import type { NavItemId } from './navigation-model'
import {
  clampLeftPaneWidth,
  clampRightPaneWidth,
  LEFT_PANE_WIDTH_MAX,
  loadLeftPaneWidthPreference,
  loadRightPaneWidthPreference,
  resolveLeftPaneWidthMax,
  resolveRightPaneWidthMax,
  resolveShellMainContentMinWidth,
  RIGHT_PANE_WIDTH_MAX,
} from './ShellRoot.shared'

interface UseShellPaneLayoutControllerInput {
  shellMainRef: RefObject<HTMLElement | null>
  shellRailRef: RefObject<HTMLDivElement | null>
  shellLeftPaneRef: RefObject<HTMLDivElement | null>
  shellResizerRef: RefObject<HTMLDivElement | null>
  shellContainerRef: RefObject<HTMLDivElement | null>
  activeNavId: NavItemId
  setActiveNavId: (id: NavItemId) => void
}

export interface ShellPaneLayoutController {
  leftPaneWidth: number
  rightPaneWidth: number
  shellMainContentMinWidth: number | null
  leftPaneWidthMax: number
  rightPaneWidthMax: number
  leftPaneVisible: boolean
  setLeftPaneVisible: React.Dispatch<React.SetStateAction<boolean>>
  shellMainStyle: CSSProperties
  handleSelectNav: (id: NavItemId) => void
  handleLeftPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  handleLeftPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  handleRightPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  handleRightPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  updatePaneWidthBounds: () => void
}

export function useShellPaneLayoutController({
  shellMainRef,
  shellRailRef,
  shellLeftPaneRef,
  shellResizerRef,
  shellContainerRef,
  activeNavId,
  setActiveNavId,
}: UseShellPaneLayoutControllerInput): ShellPaneLayoutController {
  const [leftPaneWidth, setLeftPaneWidth] = useState(loadLeftPaneWidthPreference)
  const [rightPaneWidth, setRightPaneWidth] = useState(loadRightPaneWidthPreference)
  const [shellMainContentMinWidth, setShellMainContentMinWidth] = useState<number | null>(null)
  const leftPaneWidthRef = useRef(leftPaneWidth)
  const rightPaneWidthRef = useRef(rightPaneWidth)
  const [leftPaneWidthMax, setLeftPaneWidthMax] = useState(LEFT_PANE_WIDTH_MAX)
  const [rightPaneWidthMax, setRightPaneWidthMax] = useState(RIGHT_PANE_WIDTH_MAX)
  const [leftPaneVisible, setLeftPaneVisible] = useState(true)
  const leftPaneVisibleRef = useRef(leftPaneVisible)
  const leftPaneResizeRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    rafId: number | null
    lastClientX: number
    currentWidth: number
  } | null>(null)
  const rightPaneResizeRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    rafId: number | null
    lastClientX: number
    currentWidth: number
  } | null>(null)

  const updatePaneWidthBounds = useCallback(() => {
    const layoutWidth = shellMainRef.current?.clientWidth ?? window.innerWidth
    const railWidth = shellRailRef.current?.getBoundingClientRect().width ?? 0
    const leftWidth = shellLeftPaneRef.current?.getBoundingClientRect().width ?? 0
    const leftResizerWidth = shellResizerRef.current?.getBoundingClientRect().width ?? 0
    const rightPaneElement = shellMainRef.current?.querySelector<HTMLElement>('.shell-right-pane')
    const rightVisibleWidth = rightPaneElement?.getBoundingClientRect().width ?? 0
    const centerAvailableWidth = Math.max(0, layoutWidth - railWidth - leftWidth - leftResizerWidth)
    const nextMainContentMinWidth = resolveShellMainContentMinWidth(centerAvailableWidth)
    const nextRightMax =
      rightVisibleWidth > 0 ? resolveRightPaneWidthMax(centerAvailableWidth) : RIGHT_PANE_WIDTH_MAX
    const nextRightWidth = clampRightPaneWidth(rightPaneWidthRef.current, nextRightMax)
    const reservedRightWidth = rightVisibleWidth > 0 ? nextRightWidth : 0
    const nextLeftMax = resolveLeftPaneWidthMax(
      layoutWidth,
      railWidth + leftResizerWidth + reservedRightWidth + nextMainContentMinWidth,
    )

    setShellMainContentMinWidth(nextMainContentMinWidth)
    setLeftPaneWidthMax(nextLeftMax)
    setRightPaneWidthMax(nextRightMax)
    leftPaneWidthRef.current = clampLeftPaneWidth(leftPaneWidthRef.current, nextLeftMax)
    rightPaneWidthRef.current = nextRightWidth
    setLeftPaneWidth((prev) => clampLeftPaneWidth(prev, nextLeftMax))
    setRightPaneWidth((prev) => clampRightPaneWidth(prev, nextRightMax))
  }, [])

  useEffect(() => {
    updatePaneWidthBounds()
    window.addEventListener('resize', updatePaneWidthBounds)
    return () => {
      window.removeEventListener('resize', updatePaneWidthBounds)
    }
  }, [updatePaneWidthBounds])

  useEffect(() => {
    leftPaneVisibleRef.current = leftPaneVisible
  }, [leftPaneVisible])

  useEffect(() => {
    leftPaneWidthRef.current = leftPaneWidth
  }, [leftPaneWidth])

  useEffect(() => {
    rightPaneWidthRef.current = rightPaneWidth
  }, [rightPaneWidth])

  const handleSelectNav = useCallback(
    (id: NavItemId) => {
      const isSameTab = id === activeNavId
      setActiveNavId(id)
      if (isSameTab) {
        setLeftPaneVisible((prev) => !prev)
      } else {
        setLeftPaneVisible(true)
      }
    },
    [activeNavId, setActiveNavId],
  )

  const handleLeftPaneResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const pointerId = event.pointerId
      const startWidth = leftPaneWidthRef.current
      const startX = event.clientX

      leftPaneResizeRef.current = {
        pointerId,
        startX,
        startWidth,
        rafId: null,
        lastClientX: startX,
        currentWidth: startWidth,
      }

      const dragHandle = event.currentTarget
      dragHandle.setPointerCapture(pointerId)

      // Toggle visual feedback via DOM classes — zero React renders.
      dragHandle.classList.add('active')
      const shellContainer = shellContainerRef.current
      if (shellContainer) {
        shellContainer.classList.add('shell-pane-resizing')
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const finishResize = (releasedPointerId: number) => {
        const ref = leftPaneResizeRef.current
        if (!ref || ref.pointerId !== releasedPointerId) {
          return
        }
        if (ref.rafId) {
          cancelAnimationFrame(ref.rafId)
        }
        const finalWidth = ref.currentWidth
        leftPaneResizeRef.current = null

        // Restore body styles.
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        // Remove visual feedback classes.
        dragHandle.classList.remove('active')
        if (shellContainer) {
          shellContainer.classList.remove('shell-pane-resizing')
        }

        if (dragHandle.hasPointerCapture(releasedPointerId)) {
          dragHandle.releasePointerCapture(releasedPointerId)
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)

        // Single React commit at the end with the final value.
        leftPaneWidthRef.current = finalWidth
        setLeftPaneWidth(finalWidth)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const ref = leftPaneResizeRef.current
        if (!ref || ref.pointerId !== moveEvent.pointerId) {
          return
        }
        // Always read clientX synchronously (before RAF) so the value isn't stale.
        ref.lastClientX = moveEvent.clientX

        if (ref.rafId === null) {
          ref.rafId = requestAnimationFrame(() => {
            const innerRef = leftPaneResizeRef.current
            if (!innerRef) return

            innerRef.rafId = null
            const delta = innerRef.lastClientX - innerRef.startX
            const newWidth = clampLeftPaneWidth(innerRef.startWidth + delta, leftPaneWidthMax)

            innerRef.currentWidth = newWidth
            // Direct DOM write — bypasses React entirely.
            shellMainRef.current?.style.setProperty('--shell-left-pane-width', `${newWidth}px`)
          })
        }
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        finishResize(upEvent.pointerId)
      }

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        finishResize(cancelEvent.pointerId)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    },
    [leftPaneWidthMax],
  )

  const handleLeftPaneResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev - step, leftPaneWidthMax))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev + step, leftPaneWidthMax))
    }
  }, [leftPaneWidthMax])

  const handleRightPaneResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const pointerId = event.pointerId
      const startWidth = rightPaneWidthRef.current
      const startX = event.clientX

      rightPaneResizeRef.current = {
        pointerId,
        startX,
        startWidth,
        rafId: null,
        lastClientX: startX,
        currentWidth: startWidth,
      }

      const dragHandle = event.currentTarget
      dragHandle.setPointerCapture(pointerId)

      dragHandle.classList.add('active')
      const shellContainer = shellContainerRef.current
      if (shellContainer) {
        shellContainer.classList.add('shell-pane-resizing')
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const finishResize = (releasedPointerId: number) => {
        const ref = rightPaneResizeRef.current
        if (!ref || ref.pointerId !== releasedPointerId) {
          return
        }
        if (ref.rafId) {
          cancelAnimationFrame(ref.rafId)
        }
        const finalWidth = ref.currentWidth
        rightPaneResizeRef.current = null

        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        dragHandle.classList.remove('active')
        if (shellContainer) {
          shellContainer.classList.remove('shell-pane-resizing')
        }

        if (dragHandle.hasPointerCapture(releasedPointerId)) {
          dragHandle.releasePointerCapture(releasedPointerId)
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)

        rightPaneWidthRef.current = finalWidth
        setRightPaneWidth(finalWidth)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const ref = rightPaneResizeRef.current
        if (!ref || ref.pointerId !== moveEvent.pointerId) {
          return
        }
        ref.lastClientX = moveEvent.clientX

        if (ref.rafId === null) {
          ref.rafId = requestAnimationFrame(() => {
            const innerRef = rightPaneResizeRef.current
            if (!innerRef) return

            innerRef.rafId = null
            const delta = innerRef.startX - innerRef.lastClientX
            const newWidth = clampRightPaneWidth(innerRef.startWidth + delta, rightPaneWidthMax)

            innerRef.currentWidth = newWidth
            shellMainRef.current?.style.setProperty('--shell-right-pane-width', `${newWidth}px`)
          })
        }
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        finishResize(upEvent.pointerId)
      }

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        finishResize(cancelEvent.pointerId)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    },
    [rightPaneWidthMax],
  )

  const handleRightPaneResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setRightPaneWidth((prev) => clampRightPaneWidth(prev + step, rightPaneWidthMax))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setRightPaneWidth((prev) => clampRightPaneWidth(prev - step, rightPaneWidthMax))
    }
  }, [rightPaneWidthMax])

  const shellMainStyle = useMemo(
    () =>
      ({
        '--shell-left-pane-width': `${leftPaneWidth}px`,
        '--shell-right-pane-width': `${rightPaneWidth}px`,
        '--shell-main-content-min-width': shellMainContentMinWidth
          ? `${shellMainContentMinWidth}px`
          : '35%',
      }) as CSSProperties,
    [leftPaneWidth, rightPaneWidth, shellMainContentMinWidth],
  )

  return {
    leftPaneWidth,
    rightPaneWidth,
    shellMainContentMinWidth,
    leftPaneWidthMax,
    rightPaneWidthMax,
    leftPaneVisible,
    setLeftPaneVisible,
    shellMainStyle,
    handleSelectNav,
    handleLeftPaneResizePointerDown,
    handleLeftPaneResizeKeyDown,
    handleRightPaneResizePointerDown,
    handleRightPaneResizeKeyDown,
    updatePaneWidthBounds,
  }
}