import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerBlock } from '../model/designer-blocks'
import { designerBlockKindLabel } from '../model/designer-block-labels'
import type { DesignerLayoutPosition } from '../model/designer-document'
import {
  buildGraphView,
  NODE_HEIGHT,
  NODE_WIDTH,
  normalizeDesignerNodePosition,
  type DesignerGraphEdge,
  type DesignerGraphNode,
} from '../model/designer-graph'
import type { DesignerDerivedEdge, DesignerGap } from '../model/designer-validation'

interface DesignerGraphCanvasProps {
  locale: Locale
  blocks: DesignerBlock[]
  gaps: DesignerGap[]
  edges: DesignerDerivedEdge[]
  layout: Record<string, DesignerLayoutPosition> | null | undefined
  selectedBlockId: string | null
  drillBlockId: string | null
  onSelectBlock: (blockId: string | null) => void
  onOpenDrill: (blockId: string) => void
  onCloseDrill: () => void
  onMoveBlock: (blockId: string, position: DesignerLayoutPosition) => void
  onDeleteBlock: (block: DesignerBlock) => void
  onCreateBlock: (kind: DesignerCanvasCreateKind, position?: DesignerLayoutPosition) => void
}

export type DesignerCanvasCreateKind = 'entityModel' | 'businessFlow' | 'apiContract'

const CREATE_KINDS: DesignerCanvasCreateKind[] = ['entityModel', 'businessFlow', 'apiContract']

// Drag state for a single node. Lives in a ref because pointermove must not
// touch React state. The hot path writes only transform; pointerup commits the
// final coordinate to document layout.
interface DragState {
  blockId: string
  startPointerX: number
  startPointerY: number
  startPosition: DesignerLayoutPosition
}

interface PanState {
  pointerId: number
  startPointerX: number
  startPointerY: number
  startScrollLeft: number
  startScrollTop: number
}

interface CanvasViewportWindow {
  x: number
  y: number
  width: number
  height: number
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const VIEWPORT_CULLING_NODE_THRESHOLD = 50

export const DesignerGraphCanvas = memo(function DesignerGraphCanvas({
  locale,
  blocks,
  gaps,
  edges,
  layout,
  selectedBlockId,
  drillBlockId,
  onSelectBlock,
  onOpenDrill,
  onCloseDrill,
  onMoveBlock,
  onDeleteBlock,
  onCreateBlock,
}: DesignerGraphCanvasProps) {
  const view = useMemo(() => buildGraphView(blocks, gaps, edges, layout), [
    blocks,
    gaps,
    edges,
    layout,
  ])

  const [zoom, setZoom] = useState(1)
  const [createMenu, setCreateMenu] = useState<{
    clientX: number
    clientY: number
    canvasX: number
    canvasY: number
  } | null>(null)
  const [spacePanArmed, setSpacePanArmed] = useState(false)
  const createMenuRef = useRef<HTMLDivElement | null>(null)
  const setZoomClamped = useCallback((next: number) => {
    setZoom(Math.min(2, Math.max(0.4, Number.isFinite(next) ? next : 1)))
  }, [])

  // ZOOM keyboard shortcuts.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      // Only when no input is focused — otherwise let the browser handle.
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        setZoom(1)
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        setZoomClamped(zoom + 0.1)
      } else if (event.key === '-') {
        event.preventDefault()
        setZoomClamped(zoom - 0.1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, setZoomClamped])

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<PanState | null>(null)
  const [viewportWindow, setViewportWindow] = useState<CanvasViewportWindow | null>(null)

  const openCreateMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      if (!viewport) return
      const rect = viewport.getBoundingClientRect()
      setCreateMenu({
        clientX,
        clientY,
        canvasX: (clientX - rect.left + viewport.scrollLeft) / zoom,
        canvasY: (clientY - rect.top + viewport.scrollTop) / zoom,
      })
    },
    [zoom],
  )

  useEffect(() => {
    if (!createMenu) return
    createMenuRef.current
      ?.querySelector<HTMLButtonElement>('.designer-canvas-create-menu-item')
      ?.focus()
  }, [createMenu])

  const handleCreateMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End' &&
      event.key !== 'Escape'
    ) {
      return
    }
    event.preventDefault()
    if (event.key === 'Escape') {
      setCreateMenu(null)
      viewportRef.current?.focus({ preventScroll: true })
      return
    }
    const buttons = Array.from(
      createMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '.designer-canvas-create-menu-item',
      ) ?? [],
    )
    if (buttons.length === 0) return
    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowDown'
            ? (Math.max(0, currentIndex) + 1) % buttons.length
            : (currentIndex <= 0 ? buttons.length : currentIndex) - 1
    buttons[nextIndex]?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.key.toLowerCase() !== 'n') {
        return
      }
      const target = event.target as HTMLElement | null
      const viewport = viewportRef.current
      if (!viewport) return
      if (
        target &&
        (!viewport.contains(target) ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const rect = viewport.getBoundingClientRect()
      event.preventDefault()
      openCreateMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
    }

    function onDismiss(event: MouseEvent) {
      if (!createMenu) return
      const target = event.target as HTMLElement | null
      if (target?.closest('.designer-canvas-create-menu')) return
      setCreateMenu(null)
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setCreateMenu(null)
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('mousedown', onDismiss)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('mousedown', onDismiss)
    }
  }, [createMenu, openCreateMenuAt])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Backspace' && event.key !== 'Delete') {
        return
      }
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (!selectedBlockId || selectedBlockId === 'brief') {
        return
      }
      const selectedBlock = blocks.find((block) => block.id === selectedBlockId)
      if (!selectedBlock) {
        return
      }
      event.preventDefault()
      onDeleteBlock(selectedBlock)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocks, selectedBlockId, onDeleteBlock])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const activeViewport = viewport
    let frame = 0

    function updateViewportWindow() {
      frame = 0
      setViewportWindow({
        x: activeViewport.scrollLeft / zoom,
        y: activeViewport.scrollTop / zoom,
        width: activeViewport.clientWidth / zoom,
        height: activeViewport.clientHeight / zoom,
      })
    }

    function scheduleViewportWindowUpdate() {
      if (frame) return
      frame = window.requestAnimationFrame(updateViewportWindow)
    }

    updateViewportWindow()
    activeViewport.addEventListener('scroll', scheduleViewportWindowUpdate, { passive: true })
    const resizeObserver = new ResizeObserver(scheduleViewportWindowUpdate)
    resizeObserver.observe(activeViewport)
    window.addEventListener('resize', scheduleViewportWindowUpdate)
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      activeViewport.removeEventListener('scroll', scheduleViewportWindowUpdate)
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleViewportWindowUpdate)
    }
  }, [zoom, view.bounds.width, view.bounds.height])

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null
      return Boolean(
        element &&
          (element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.tagName === 'SELECT' ||
            element.isContentEditable),
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        event.code !== 'Space' ||
        event.repeat ||
        isEditableTarget(event.target) ||
        target?.closest('.designer-node-shell')
      ) {
        return
      }
      event.preventDefault()
      setSpacePanArmed(true)
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code !== 'Space') {
        return
      }
      setSpacePanArmed(false)
      panStateRef.current = null
      viewportRef.current?.classList.remove('is-panning')
    }

    function onBlur() {
      setSpacePanArmed(false)
      panStateRef.current = null
      viewportRef.current?.classList.remove('is-panning')
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Wheel-zoom — modifier required so plain wheel still scrolls the canvas.
  // Mac trackpad pinch arrives as wheel + ctrlKey natively, so this also
  // handles "pinch to zoom" without a separate gesture handler.
  // Attached via native listener (React onWheel is passive, preventDefault
  // is silently ignored there).
  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    function onWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return
      }
      event.preventDefault()
      // deltaY > 0 → wheel down → zoom out; <0 → zoom in. Trackpad pinch
      // delivers fractional deltas, so scale step proportional to magnitude.
      const factor = Math.exp(-event.deltaY * 0.0015)
      setZoom((prev) => {
        const next = Math.min(2, Math.max(0.4, prev * factor))
        return Number.isFinite(next) ? next : prev
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const dragStateRef = useRef<DragState | null>(null)
  // Per-node DOM refs so drag can mutate position directly (no react state).
  const nodeRefs = useRef(new Map<string, HTMLDivElement | null>())

  const handleNodePointerDown = useCallback(
    (block: DesignerBlock, position: DesignerLayoutPosition) =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        // Don't capture clicks inside form-like children (none yet, but future-proof).
        const target = event.target as HTMLElement
        if (target.closest('[data-no-drag]')) return
        dragStateRef.current = {
          blockId: block.id,
          startPointerX: event.clientX,
          startPointerY: event.clientY,
          startPosition: position,
        }
        const node = nodeRefs.current.get(block.id)
        node?.classList.add('is-dragging')
        event.currentTarget.setPointerCapture?.(event.pointerId)
      },
    [],
  )

  const handleNodePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state) return
      const node = nodeRefs.current.get(state.blockId)
      if (!node) return
      const dx = (event.clientX - state.startPointerX) / zoom
      const dy = (event.clientY - state.startPointerY) / zoom
      node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    },
    [zoom],
  )

  const handleNodePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state) return
      const node = nodeRefs.current.get(state.blockId)
      const dx = (event.clientX - state.startPointerX) / zoom
      const dy = (event.clientY - state.startPointerY) / zoom
      const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1
      const finalPosition = {
        x: state.startPosition.x + dx,
        y: state.startPosition.y + dy,
      }
      node?.classList.remove('is-dragging')
      if (node) {
        node.style.transform = ''
      }
      dragStateRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }
      if (moved) {
        // Single IPC for the whole drag (§12.5 contract).
        onMoveBlock(state.blockId, normalizeDesignerNodePosition(finalPosition))
      } else {
        // Treat as click — select the block.
        onSelectBlock(state.blockId)
      }
    },
    [zoom, onMoveBlock, onSelectBlock],
  )

  const handleNodePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state) return
    const node = nodeRefs.current.get(state.blockId)
    node?.classList.remove('is-dragging')
    if (node) {
      node.style.transform = ''
    }
    dragStateRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }, [])

  const handleNodeDoubleClick = useCallback(
    (blockId: string) => () => {
      onOpenDrill(blockId)
    },
    [onOpenDrill],
  )

  const handleCanvasClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // Click on background deselects.
      if (event.target === event.currentTarget) {
        onSelectBlock(null)
        onCloseDrill()
      }
    },
    [onSelectBlock, onCloseDrill],
  )

  const handleCanvasContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const nodeShell = (event.target as HTMLElement).closest<HTMLElement>('.designer-node-shell')
      event.preventDefault()
      if (nodeShell) {
        const blockId = nodeShell.dataset.blockId
        if (blockId) {
          onSelectBlock(blockId)
        }
        setCreateMenu(null)
        return
      }
      onSelectBlock(null)
      openCreateMenuAt(event.clientX, event.clientY)
    },
    [onSelectBlock, openCreateMenuAt],
  )

  const handleViewportPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      const isCanvasChrome = target.closest(
        '.designer-node-shell, .designer-canvas-controls, .designer-canvas-create-menu',
      )
      const isEditableTarget = target.closest('input, textarea, select, [contenteditable="true"]')
      if (!isCanvasChrome && !isEditableTarget) {
        viewportRef.current?.focus({ preventScroll: true })
      }
      if (
        !spacePanArmed ||
        event.button !== 0 ||
        isCanvasChrome
      ) {
        return
      }
      const viewport = viewportRef.current
      if (!viewport) return
      event.preventDefault()
      setCreateMenu(null)
      panStateRef.current = {
        pointerId: event.pointerId,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
      }
      viewport.classList.add('is-panning')
      viewport.setPointerCapture?.(event.pointerId)
    },
    [spacePanArmed],
  )

  const handleViewportPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panStateRef.current
    const viewport = viewportRef.current
    if (!state || !viewport || state.pointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
    viewport.scrollLeft = state.startScrollLeft - (event.clientX - state.startPointerX)
    viewport.scrollTop = state.startScrollTop - (event.clientY - state.startPointerY)
  }, [])

  const handleViewportPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panStateRef.current
    const viewport = viewportRef.current
    if (!state || state.pointerId !== event.pointerId) {
      return
    }
    panStateRef.current = null
    viewport?.classList.remove('is-panning')
    viewport?.releasePointerCapture?.(event.pointerId)
  }, [])

  const arrowMarkerId = useId()
  const arrowUrl = `url(#${arrowMarkerId})`
  const visibleGraph = useMemo(() => {
    if (view.nodes.length <= VIEWPORT_CULLING_NODE_THRESHOLD || !viewportWindow) {
      return view
    }
    const bufferX = viewportWindow.width
    const bufferY = viewportWindow.height
    const left = viewportWindow.x - bufferX
    const top = viewportWindow.y - bufferY
    const right = viewportWindow.x + viewportWindow.width + bufferX
    const bottom = viewportWindow.y + viewportWindow.height + bufferY
    const pinnedNodeIds = new Set([selectedBlockId, drillBlockId].filter(Boolean))
    const nodes = view.nodes.filter((node) => {
      if (pinnedNodeIds.has(node.block.id)) {
        return true
      }
      const nodeLeft = node.position.x
      const nodeTop = node.position.y
      const nodeRight = nodeLeft + NODE_WIDTH
      const nodeBottom = nodeTop + NODE_HEIGHT
      return nodeRight >= left && nodeLeft <= right && nodeBottom >= top && nodeTop <= bottom
    })
    const visibleNodeIds = new Set(nodes.map((node) => node.block.id))
    const edges = view.edges.filter(
      (edge) => visibleNodeIds.has(edge.from.id) && visibleNodeIds.has(edge.to.id),
    )
    return { ...view, nodes, edges }
  }, [drillBlockId, selectedBlockId, view, viewportWindow])

  if (blocks.length === 0) {
    return (
      <div className="designer-canvas">
        <div className="designer-canvas-empty">
          <AppIcon name="designer" aria-hidden="true" />
          <p>{t(locale, 'designer.canvas.empty')}</p>
        </div>
      </div>
    )
  }

  const wrapperStyle: CSSProperties = {
    width: view.bounds.width,
    height: view.bounds.height,
    transformOrigin: '0 0',
  }
  if (zoom !== 1) {
    wrapperStyle.transform = `scale(${zoom})`
  }

  return (
    <div className="designer-canvas">
      <div
        className={`designer-canvas-viewport${spacePanArmed ? ' is-space-pan-armed' : ''}`}
        ref={viewportRef}
        tabIndex={-1}
        onClick={handleCanvasClick}
        onContextMenu={handleCanvasContextMenu}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
      >
        <div style={wrapperStyle}>
          <svg
            className="designer-canvas-svg"
            width={view.bounds.width}
            height={view.bounds.height}
            viewBox={`0 0 ${view.bounds.width} ${view.bounds.height}`}
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={arrowMarkerId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {visibleGraph.edges.map((edge, index) => (
              <EdgeSvg key={`${edge.from.id}-${edge.to.id}-${edge.relation}-${index}`} edge={edge} arrowUrl={arrowUrl} />
            ))}
          </svg>

          <div className="designer-canvas-nodes">
            {visibleGraph.nodes.map((node) => (
              <NodeView
                key={node.block.id}
                node={node}
                locale={locale}
                selected={selectedBlockId === node.block.id || drillBlockId === node.block.id}
                onPointerDown={handleNodePointerDown(node.block, node.position)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
                onPointerCancel={handleNodePointerCancel}
                onFocus={() => onSelectBlock(node.block.id)}
                onDoubleClick={handleNodeDoubleClick(node.block.id)}
                onDeleteBlock={onDeleteBlock}
                registerRef={(el) => nodeRefs.current.set(node.block.id, el)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="designer-canvas-controls">
        <button
          type="button"
          className="designer-icon-button"
          onClick={() => {
            const idx = ZOOM_LEVELS.findIndex((z) => z > zoom)
            if (idx === -1) return
            setZoomClamped(ZOOM_LEVELS[idx])
          }}
          title={t(locale, 'designer.canvas.zoomIn')}
          aria-label={t(locale, 'designer.canvas.zoomIn')}
        >
          <AppIcon name="plus" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="designer-icon-button"
          onClick={() => setZoomClamped(1)}
          title={t(locale, 'designer.canvas.zoomReset')}
          aria-label={t(locale, 'designer.canvas.zoomReset')}
        >
          <span className="designer-canvas-zoom-label">
            {Math.round(zoom * 100)}%
          </span>
        </button>
        <button
          type="button"
          className="designer-icon-button"
          onClick={() => {
            const reversed = [...ZOOM_LEVELS].reverse()
            const idx = reversed.findIndex((z) => z < zoom)
            if (idx === -1) return
            setZoomClamped(reversed[idx])
          }}
          title={t(locale, 'designer.canvas.zoomOut')}
          aria-label={t(locale, 'designer.canvas.zoomOut')}
        >
          <AppIcon name="minus" aria-hidden="true" />
        </button>
      </div>

      {createMenu ? (
        <div
          className="designer-canvas-create-menu"
          role="menu"
          ref={createMenuRef}
          onKeyDown={handleCreateMenuKeyDown}
          style={{ left: createMenu.clientX, top: createMenu.clientY }}
        >
          <div className="designer-canvas-create-menu-title">
            {t(locale, 'designer.canvas.createMenu')}
          </div>
          {CREATE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className="designer-canvas-create-menu-item"
              onClick={() => {
                onCreateBlock(kind, { x: createMenu.canvasX, y: createMenu.canvasY })
                setCreateMenu(null)
              }}
            >
              {designerBlockKindLabel(locale, kind)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
})

interface NodeViewProps {
  node: DesignerGraphNode
  locale: Locale
  selected: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
  onFocus: (event: ReactFocusEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  onDeleteBlock: (block: DesignerBlock) => void
  registerRef: (el: HTMLDivElement | null) => void
}

function NodeView({
  node,
  locale,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onFocus,
  onDoubleClick,
  onDeleteBlock,
  registerRef,
}: NodeViewProps) {
  const stateClassName = [
    selected ? 'is-selected' : '',
    node.hasError ? 'has-error' : node.gapCount > 0 ? 'has-warning' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const shellClassName = ['designer-node-shell', stateClassName].filter(Boolean).join(' ')
  const nodeClassName = ['designer-node', stateClassName].filter(Boolean).join(' ')
  const kindLabel = designerBlockKindLabel(locale, node.block.kind)
  const nodeTitle = node.block.title || node.block.id
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return
    }
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    onDoubleClick()
  }

  return (
    <div
      ref={registerRef}
      className={shellClassName}
      data-block-id={node.block.id}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={t(locale, 'designer.canvas.nodeLabel', {
        kind: kindLabel,
        title: nodeTitle,
      })}
    >
      <div className={nodeClassName}>
        <div className="designer-node-header">
          <span className="designer-node-kind">{kindLabel}</span>
          <span className="designer-node-title">{nodeTitle}</span>
          {node.block.id !== 'brief' ? (
            <button
              type="button"
              className="designer-node-delete-btn"
              data-no-drag
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onDeleteBlock(node.block)
              }}
              title={t(locale, 'designer.canvas.deleteBlock')}
              aria-label={t(locale, 'designer.canvas.deleteBlock')}
            >
              <AppIcon name="trash" aria-hidden="true" />
            </button>
          ) : null}
          {node.gapCount > 0 ? (
            <span
              className={`designer-node-gap-badge${node.hasError ? ' is-error' : ''}`}
              aria-label={t(locale, 'designer.canvas.gapCount', {
                count: node.gapCount,
                plural: node.gapCount === 1 ? '' : 's',
              })}
            >
              <AppIcon name="alert-triangle" aria-hidden="true" />
              {node.gapCount}
            </span>
          ) : null}
        </div>
        <div className="designer-node-meta">{nodeFingerprint(node.block)}</div>
      </div>
    </div>
  )
}

/** A short summary of the block's payload, e.g. "3 fields" / "2 endpoints". */
function nodeFingerprint(block: DesignerBlock): string {
  const payload = block.payload as Record<string, unknown> | undefined
  if (!payload || typeof payload !== 'object') return block.id
  switch (block.kind) {
    case 'entityModel': {
      const fields = Array.isArray(payload.fields) ? payload.fields.length : 0
      return `${fields} field${fields === 1 ? '' : 's'}`
    }
    case 'businessFlow': {
      const states = Array.isArray(payload.states) ? payload.states.length : 0
      const transitions = Array.isArray(payload.transitions) ? payload.transitions.length : 0
      return `${states} state · ${transitions} ↦`
    }
    case 'apiContract': {
      const endpoints = Array.isArray(payload.endpoints) ? payload.endpoints.length : 0
      return `${endpoints} endpoint${endpoints === 1 ? '' : 's'}`
    }
    case 'text': {
      const md = typeof payload.markdown === 'string' ? payload.markdown : ''
      return md ? truncate(md, 40) : block.id
    }
    default:
      return block.id
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + '…'
}

interface EdgeSvgProps {
  edge: DesignerGraphEdge
  arrowUrl: string
}

function EdgeSvg({ edge, arrowUrl }: EdgeSvgProps) {
  // Edge endpoints — connect right-edge of source to left-edge of target when
  // they are roughly horizontal; otherwise top-bottom. Simple heuristic, no
  // routing engine.
  const fromX = edge.from.position.x + NODE_WIDTH / 2
  const fromY = edge.from.position.y + NODE_HEIGHT / 2
  const toX = edge.to.position.x + NODE_WIDTH / 2
  const toY = edge.to.position.y + NODE_HEIGHT / 2
  const dx = toX - fromX
  const dy = toY - fromY
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const start = horizontal
    ? {
        x: edge.from.position.x + (dx > 0 ? NODE_WIDTH : 0),
        y: fromY,
      }
    : { x: fromX, y: edge.from.position.y + (dy > 0 ? NODE_HEIGHT : 0) }
  const end = horizontal
    ? {
        x: edge.to.position.x + (dx > 0 ? 0 : NODE_WIDTH),
        y: toY,
      }
    : { x: toX, y: edge.to.position.y + (dy > 0 ? 0 : NODE_HEIGHT) }

  // Quadratic curve for visual softness.
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const offset = Math.min(40, Math.max(16, Math.abs(horizontal ? dy : dx) / 4))
  const ctrlX = horizontal ? midX : midX + offset
  const ctrlY = horizontal ? midY + offset : midY
  const path = `M ${start.x} ${start.y} Q ${ctrlX} ${ctrlY} ${end.x} ${end.y}`

  const className = `designer-canvas-edge designer-canvas-edge--${edge.relation}`

  return (
    <g pointerEvents="none">
      <path d={path} className={className} markerEnd={arrowUrl} />
      <text
        className="designer-canvas-edge-label"
        x={ctrlX}
        y={ctrlY - 4}
        textAnchor="middle"
      >
        {edge.relation}
      </text>
    </g>
  )
}
