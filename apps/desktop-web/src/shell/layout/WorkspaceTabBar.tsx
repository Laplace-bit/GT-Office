import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
import { t, type Locale } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import type { WorkspaceTabInfo } from '../state/workspace-tab-model'
import type { WorkspaceSwitchAnimation } from '../state/ui-preferences'
import { desktopApi } from '../integration/desktop-api'
import './WorkspaceTabBar.scss'

const TAB_BAR_CHANNEL = 'gto-workspace-tab-bar'
const TEAR_OFF_GUTTER_PX = 24
const WORKSPACE_TAB_DRAG_MIME = 'application/x-gto-workspace-tab'
const WORKSPACE_TAB_DROP_ACTIVE_CLASS = 'workspace-tab-drop-active'

export interface WorkspaceTearOffRequest {
  workspaceId: string
  screenX: number
  screenY: number
}

interface WorkspaceTabDropTarget {
  windowLabel: string
  acceptsExternalTabs: boolean
  rect: {
    left: number
    top: number
    right: number
    bottom: number
  }
}

type WorkspaceTabChannelMessage =
  | {
      type: 'register-target'
      target: WorkspaceTabDropTarget
    }
  | {
      type: 'unregister-target'
      windowLabel: string
    }
  | {
      type: 'merge-request'
      targetWindowLabel: string
      workspaceId: string
    }
  | {
      type: 'merge-complete'
      sourceWindowLabel: string
      targetWindowLabel: string
      workspaceId: string
    }
  | {
      type: 'drag-start'
      payload: WorkspaceTabDragPayload
    }
  | {
      type: 'drag-end'
    }

interface WorkspaceTabBarProps {
  locale: Locale
  tabs: WorkspaceTabInfo[]
  activeTabId?: string | null
  pendingTabId?: string | null
  closingTabId?: string | null
  workspaceSwitching?: boolean
  workspaceSwitchAnimation?: WorkspaceSwitchAnimation
  onSwitchTab: (workspaceId: string) => void
  onCloseTab: (workspaceId: string) => void
  onAddTab?: () => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  onTearOffTab?: (request: WorkspaceTearOffRequest) => void
  onMergeTabIntoWindow?: (workspaceId: string, targetWindowLabel: string) => void
  onReceiveMergedTab?: (workspaceId: string) => void
}

interface WorkspaceTabDragPayload {
  workspaceId: string
  sourceWindowLabel: string | null
}

function isPointInsideRect(
  point: { screenX: number; screenY: number },
  rect: WorkspaceTabDropTarget['rect'],
): boolean {
  return (
    point.screenX >= rect.left &&
    point.screenX <= rect.right &&
    point.screenY >= rect.top &&
    point.screenY <= rect.bottom
  )
}

function isTearOffDrop(
  point: { screenX: number; screenY: number },
  rect: WorkspaceTabDropTarget['rect'],
): boolean {
  return (
    point.screenX < rect.left - TEAR_OFF_GUTTER_PX ||
    point.screenX > rect.right + TEAR_OFF_GUTTER_PX ||
    point.screenY < rect.top - TEAR_OFF_GUTTER_PX ||
    point.screenY > rect.bottom + TEAR_OFF_GUTTER_PX
  )
}

function parseWorkspaceTabDragPayload(dataTransfer: DataTransfer | null): WorkspaceTabDragPayload | null {
  if (!dataTransfer) {
    return null
  }
  const raw =
    dataTransfer.getData(WORKSPACE_TAB_DRAG_MIME) ||
    dataTransfer.getData('text/plain') ||
    ''
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceTabDragPayload>
    const workspaceId = parsed.workspaceId?.trim() ?? ''
    if (!workspaceId) {
      return null
    }
    return {
      workspaceId,
      sourceWindowLabel: parsed.sourceWindowLabel?.trim() || null,
    }
  } catch {
    return null
  }
}

function hasWorkspaceTabDragPayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false
  }
  const types = Array.from(dataTransfer.types ?? [])
  return types.includes(WORKSPACE_TAB_DRAG_MIME) || types.includes('text/plain')
}

export function WorkspaceTabBar({
  locale,
  tabs,
  activeTabId,
  pendingTabId = null,
  closingTabId = null,
  workspaceSwitching = false,
  workspaceSwitchAnimation = 'crossfade',
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onReorderTabs,
  onTearOffTab,
  onMergeTabIntoWindow,
  onReceiveMergedTab,
}: WorkspaceTabBarProps) {
  const tabBarRef = useRef<HTMLDivElement | null>(null)
  const tabNodeMapRef = useRef<Record<string, HTMLDivElement | null>>({})
  const topControlBarRef = useRef<HTMLElement | null>(null)
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
  const mergeTargetsRef = useRef<Map<string, WorkspaceTabDropTarget>>(new Map())
  const dragSourceIndexRef = useRef<number | null>(null)
  const sameWindowDropHandledRef = useRef(false)
  const sameWindowHoverActiveRef = useRef(false)
  const lastKnownScreenPointRef = useRef<{ screenX: number; screenY: number } | null>(null)
  const externalMergeCompletedRef = useRef(false)
  const externalDragPayloadRef = useRef<WorkspaceTabDragPayload | null>(null)
  const [currentWindowLabel, setCurrentWindowLabel] = useState<string | null>(null)
  const [draggingWorkspaceId, setDraggingWorkspaceId] = useState<string | null>(null)
  const [externalDropActive, setExternalDropActive] = useState(false)

  const acceptsExternalTabs = !onMergeTabIntoWindow

  useEffect(() => {
    let cancelled = false
    void desktopApi.getCurrentWindowLabel().then((label) => {
      if (!cancelled) {
        setCurrentWindowLabel(label)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    topControlBarRef.current =
      tabBarRef.current?.closest('.vb-top-control-bar') instanceof HTMLElement
        ? (tabBarRef.current.closest('.vb-top-control-bar') as HTMLElement)
        : null
  }, [tabs.length])

  useEffect(() => {
    const topBar = topControlBarRef.current
    if (!topBar) {
      return
    }
    topBar.classList.toggle(WORKSPACE_TAB_DROP_ACTIVE_CLASS, externalDropActive)
    tabBarRef.current?.classList.toggle(WORKSPACE_TAB_DROP_ACTIVE_CLASS, externalDropActive)
    return () => {
      topBar.classList.remove(WORKSPACE_TAB_DROP_ACTIVE_CLASS)
      tabBarRef.current?.classList.remove(WORKSPACE_TAB_DROP_ACTIVE_CLASS)
    }
  }, [externalDropActive])

  const postChannelMessage = useCallback((message: WorkspaceTabChannelMessage) => {
    broadcastChannelRef.current?.postMessage(message)
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return
    }
    const channel = new BroadcastChannel(TAB_BAR_CHANNEL)
    broadcastChannelRef.current = channel
    channel.onmessage = (event: MessageEvent<WorkspaceTabChannelMessage>) => {
      const payload = event.data
      if (!payload) {
        return
      }
      if (payload.type === 'register-target') {
        mergeTargetsRef.current.set(payload.target.windowLabel, payload.target)
        return
      }
      if (payload.type === 'unregister-target') {
        mergeTargetsRef.current.delete(payload.windowLabel)
        return
      }
      if (payload.type === 'drag-start') {
        if (currentWindowLabel && payload.payload.sourceWindowLabel !== currentWindowLabel) {
          externalDragPayloadRef.current = payload.payload
        }
        return
      }
      if (payload.type === 'drag-end') {
        externalDragPayloadRef.current = null
        return
      }
      if (
        payload.type === 'merge-request' &&
        currentWindowLabel &&
        payload.targetWindowLabel === currentWindowLabel
      ) {
        onSwitchTab(payload.workspaceId)
        return
      }
      if (
        payload.type === 'merge-complete' &&
        currentWindowLabel &&
        payload.sourceWindowLabel === currentWindowLabel
      ) {
        externalMergeCompletedRef.current = true
      }
    }
    return () => {
      broadcastChannelRef.current = null
      channel.close()
    }
  }, [currentWindowLabel, onSwitchTab])

  const publishDropTarget = useCallback(() => {
    if (!currentWindowLabel || !tabBarRef.current) {
      return
    }
    const rect = tabBarRef.current.getBoundingClientRect()
    const target = {
      windowLabel: currentWindowLabel,
      acceptsExternalTabs,
      rect: {
        left: window.screenX + rect.left,
        top: window.screenY + rect.top,
        right: window.screenX + rect.right,
        bottom: window.screenY + rect.bottom,
      },
    }
    mergeTargetsRef.current.set(currentWindowLabel, target)
    postChannelMessage({
      type: 'register-target',
      target,
    })
  }, [acceptsExternalTabs, currentWindowLabel, postChannelMessage])

  useEffect(() => {
    if (!currentWindowLabel) {
      return
    }
    publishDropTarget()
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && tabBarRef.current
        ? new ResizeObserver(() => publishDropTarget())
        : null
    if (resizeObserver && tabBarRef.current) {
      resizeObserver.observe(tabBarRef.current)
    }
    const handleWindowChange = () => publishDropTarget()
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
      mergeTargetsRef.current.delete(currentWindowLabel)
      postChannelMessage({
        type: 'unregister-target',
        windowLabel: currentWindowLabel,
      })
    }
  }, [currentWindowLabel, postChannelMessage, publishDropTarget, tabs.length])

  const registerTabNode = useCallback((workspaceId: string, node: HTMLDivElement | null) => {
    tabNodeMapRef.current[workspaceId] = node
  }, [])

  useEffect(() => {
    const topBar = topControlBarRef.current
    if (!topBar) {
      return
    }

    const handleTopBarDragOver = (event: DragEvent) => {
      const payload = parseWorkspaceTabDragPayload(event.dataTransfer)
      const hasWorkspacePayload = hasWorkspaceTabDragPayload(event.dataTransfer)
      const isLocalDrag = Boolean(draggingWorkspaceId)

      if (!hasWorkspacePayload && !isLocalDrag) {
        return
      }
      lastKnownScreenPointRef.current = {
        screenX: event.screenX,
        screenY: event.screenY,
      }

      if (isLocalDrag || payload?.sourceWindowLabel === currentWindowLabel) {
        event.preventDefault()
        sameWindowHoverActiveRef.current = true
        setExternalDropActive(false)
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move'
        }
        return
      }

      if (!acceptsExternalTabs || !hasWorkspacePayload) {
        setExternalDropActive(false)
        return
      }

      event.preventDefault()
      setExternalDropActive(true)
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    }

    const handleTopBarDragLeave = (event: DragEvent) => {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && topBar.contains(relatedTarget)) {
        return
      }
      sameWindowHoverActiveRef.current = false
      setExternalDropActive(false)
    }

    const handleTopBarDrop = (event: DragEvent) => {
      let payload = parseWorkspaceTabDragPayload(event.dataTransfer)
      if (!payload) {
        payload = externalDragPayloadRef.current
      }
      sameWindowHoverActiveRef.current = false
      setExternalDropActive(false)
      if (!payload) {
        return
      }
      setDraggingWorkspaceId(null)

      const droppedOnTabBar = event.target instanceof Node && tabBarRef.current?.contains(event.target)
      if (droppedOnTabBar) {
        if (payload.sourceWindowLabel === currentWindowLabel) {
          sameWindowDropHandledRef.current = true
        }
        return
      }

      event.preventDefault()
      if (payload.sourceWindowLabel === currentWindowLabel) {
        sameWindowDropHandledRef.current = true
        return
      }

      if (
        payload.sourceWindowLabel &&
        payload.sourceWindowLabel !== currentWindowLabel &&
        currentWindowLabel &&
        acceptsExternalTabs
      ) {
        externalDragPayloadRef.current = null
        onReceiveMergedTab?.(payload.workspaceId)
        postChannelMessage({
          type: 'merge-complete',
          sourceWindowLabel: payload.sourceWindowLabel,
          targetWindowLabel: currentWindowLabel,
          workspaceId: payload.workspaceId,
        })
        onSwitchTab(payload.workspaceId)
        void desktopApi.surfaceCloseWindow(payload.sourceWindowLabel).catch(() => {})
      }
    }

    topBar.addEventListener('dragover', handleTopBarDragOver)
    topBar.addEventListener('dragleave', handleTopBarDragLeave)
    topBar.addEventListener('drop', handleTopBarDrop)
    return () => {
      topBar.removeEventListener('dragover', handleTopBarDragOver)
      topBar.removeEventListener('dragleave', handleTopBarDragLeave)
      topBar.removeEventListener('drop', handleTopBarDrop)
    }
  }, [acceptsExternalTabs, currentWindowLabel, draggingWorkspaceId, onReceiveMergedTab, onSwitchTab, postChannelMessage])

  const resolveInsertionIndex = useCallback(
    (clientX: number) => {
      const orderedTabs = tabs.filter((tab) => tab.workspaceId !== draggingWorkspaceId)
      if (orderedTabs.length === 0) {
        return 0
      }
      for (let index = 0; index < orderedTabs.length; index += 1) {
        const node = tabNodeMapRef.current[orderedTabs[index].workspaceId]
        if (!node) {
          continue
        }
        const rect = node.getBoundingClientRect()
        if (clientX < rect.left + rect.width / 2) {
          return index
        }
      }
      return orderedTabs.length
    },
    [draggingWorkspaceId, tabs],
  )

  const finalizeCrossWindowDrop = useCallback(
    (workspaceId: string, point: { screenX: number; screenY: number }) => {
      const currentRect = currentWindowLabel
        ? mergeTargetsRef.current.get(currentWindowLabel)?.rect ?? null
        : null

      if (currentRect && isPointInsideRect(point, currentRect)) {
        return
      }

      const mergeTarget = [...mergeTargetsRef.current.values()].find(
        (target) =>
          target.acceptsExternalTabs &&
          target.windowLabel !== currentWindowLabel &&
          isPointInsideRect(point, target.rect),
      )

      if (mergeTarget && onMergeTabIntoWindow) {
        postChannelMessage({
          type: 'merge-request',
          targetWindowLabel: mergeTarget.windowLabel,
          workspaceId,
        })
        onMergeTabIntoWindow(workspaceId, mergeTarget.windowLabel)
        return
      }

      if (onTearOffTab && currentRect && isTearOffDrop(point, currentRect)) {
        onTearOffTab({
          workspaceId,
          screenX: point.screenX,
          screenY: point.screenY,
        })
      }
    },
    [currentWindowLabel, onMergeTabIntoWindow, onTearOffTab, postChannelMessage],
  )

  const handleTabDragStart = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, workspaceId: string) => {
      if (!event.dataTransfer) {
        return
      }
      const payload: WorkspaceTabDragPayload = {
        workspaceId,
        sourceWindowLabel: currentWindowLabel,
      }
      dragSourceIndexRef.current = tabs.findIndex((tab) => tab.workspaceId === workspaceId)
      sameWindowDropHandledRef.current = false
      sameWindowHoverActiveRef.current = false
      lastKnownScreenPointRef.current = null
      externalMergeCompletedRef.current = false
      setDraggingWorkspaceId(workspaceId)
      const serialized = JSON.stringify(payload)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(WORKSPACE_TAB_DRAG_MIME, serialized)
      event.dataTransfer.setData('text/plain', serialized)
      postChannelMessage({ type: 'drag-start', payload })
    },
    [currentWindowLabel, postChannelMessage, tabs],
  )

  const handleTabDragEnd = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, workspaceId: string) => {
      const point = lastKnownScreenPointRef.current ?? {
        screenX: event.screenX,
        screenY: event.screenY,
      }
      const sourceIndex = dragSourceIndexRef.current
      dragSourceIndexRef.current = null
      setDraggingWorkspaceId(null)
      setExternalDropActive(false)

      if (
        !sameWindowDropHandledRef.current &&
        !sameWindowHoverActiveRef.current &&
        !externalMergeCompletedRef.current
      ) {
        finalizeCrossWindowDrop(workspaceId, point)
      }
      sameWindowDropHandledRef.current = false
      sameWindowHoverActiveRef.current = false
      lastKnownScreenPointRef.current = null
      externalMergeCompletedRef.current = false
      externalDragPayloadRef.current = null
      postChannelMessage({ type: 'drag-end' })

      if (sourceIndex === null) {
        return
      }
    },
    [finalizeCrossWindowDrop, postChannelMessage],
  )

  const handleBarDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const payload = parseWorkspaceTabDragPayload(event.dataTransfer)
      const hasWorkspacePayload = hasWorkspaceTabDragPayload(event.dataTransfer)
      const isLocalDrag = Boolean(draggingWorkspaceId)

      if (!hasWorkspacePayload && !isLocalDrag) {
        return
      }

      if (isLocalDrag || payload?.sourceWindowLabel === currentWindowLabel) {
        event.preventDefault()
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move'
        }
        sameWindowHoverActiveRef.current = true
        lastKnownScreenPointRef.current = {
          screenX: event.screenX,
          screenY: event.screenY,
        }
        setExternalDropActive(false)
        return
      }

      if (!acceptsExternalTabs || !hasWorkspacePayload) {
        setExternalDropActive(false)
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      lastKnownScreenPointRef.current = {
        screenX: event.screenX,
        screenY: event.screenY,
      }
      setExternalDropActive(true)
    },
    [acceptsExternalTabs, currentWindowLabel, draggingWorkspaceId],
  )

  const handleBarDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return
    }
    sameWindowHoverActiveRef.current = false
    setExternalDropActive(false)
  }, [])

  const handleBarDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      let payload = parseWorkspaceTabDragPayload(event.dataTransfer)
      if (!payload) {
        payload = externalDragPayloadRef.current
      }
      externalDragPayloadRef.current = null
      setExternalDropActive(false)
      if (!payload) {
        return
      }
      setDraggingWorkspaceId(null)

      event.preventDefault()
      if (
        payload.sourceWindowLabel &&
        payload.sourceWindowLabel !== currentWindowLabel &&
        currentWindowLabel &&
        acceptsExternalTabs
      ) {
        onReceiveMergedTab?.(payload.workspaceId)
        postChannelMessage({
          type: 'merge-complete',
          sourceWindowLabel: payload.sourceWindowLabel,
          targetWindowLabel: currentWindowLabel,
          workspaceId: payload.workspaceId,
        })
        onSwitchTab(payload.workspaceId)
        void desktopApi.surfaceCloseWindow(payload.sourceWindowLabel).catch(() => {})
        return
      }

      if (payload.sourceWindowLabel !== currentWindowLabel) {
        return
      }

      sameWindowDropHandledRef.current = true
      sameWindowHoverActiveRef.current = false
      const fromIndex = tabs.findIndex((tab) => tab.workspaceId === payload.workspaceId)
      const toIndex = resolveInsertionIndex(event.clientX)
      if (fromIndex < 0 || toIndex < 0) {
        return
      }
      const normalizedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex
      if (normalizedToIndex !== fromIndex) {
        onReorderTabs(fromIndex, normalizedToIndex)
      }
    },
    [acceptsExternalTabs, currentWindowLabel, onReceiveMergedTab, onReorderTabs, onSwitchTab, postChannelMessage, resolveInsertionIndex, tabs],
  )

  const switchingClass = useMemo(
    () =>
      workspaceSwitching && workspaceSwitchAnimation !== 'none'
        ? ` workspace-switching workspace-switching--${workspaceSwitchAnimation}`
        : '',
    [workspaceSwitchAnimation, workspaceSwitching],
  )

  return (
    <div
      className={`vb-workspace-tab-bar${switchingClass}`}
      data-switch-anim={workspaceSwitchAnimation !== 'none' ? workspaceSwitchAnimation : undefined}
      ref={tabBarRef}
      onDragOver={handleBarDragOver}
      onDragLeave={handleBarDragLeave}
      onDrop={handleBarDrop}
    >
      {tabs.map((tab) => {
        const tabName = tab.name || tab.root.split('/').pop() || tab.workspaceId
        return (
          <div
            key={tab.workspaceId}
            ref={(node) => {
              registerTabNode(tab.workspaceId, node)
            }}
            className={`vb-workspace-tab${tab.workspaceId === activeTabId ? ' active' : ''}${
              tab.workspaceId === pendingTabId && tab.workspaceId !== activeTabId ? ' pending' : ''
            }${tab.workspaceId === closingTabId ? ' closing' : ''}${
              tab.workspaceId === draggingWorkspaceId ? ' dragging' : ''
            }`}
            onClick={() => onSwitchTab(tab.workspaceId)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault()
                onCloseTab(tab.workspaceId)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSwitchTab(tab.workspaceId)
              } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault()
                onCloseTab(tab.workspaceId)
              }
            }}
            draggable={!tab.workspaceId.startsWith('pending:') && tab.workspaceId !== closingTabId}
            onDragStart={(event) => handleTabDragStart(event, tab.workspaceId)}
            onDragEnd={(event) => handleTabDragEnd(event, tab.workspaceId)}
            role="tab"
            tabIndex={tab.workspaceId === activeTabId ? 0 : -1}
            aria-selected={tab.workspaceId === activeTabId}
            aria-busy={tab.workspaceId === pendingTabId || undefined}
            title={tab.root}
          >
            <AppIcon name="folder-open" className="vb-workspace-tab-icon" aria-hidden="true" />
            <span className="vb-workspace-tab-label">{tabName}</span>
            <button
              className="vb-workspace-tab-close"
              onClick={(event) => {
                event.stopPropagation()
                onCloseTab(tab.workspaceId)
              }}
              title={t(locale, 'topControlBar.closeWorkspaceTab')}
              type="button"
              aria-label={t(locale, 'topControlBar.closeWorkspaceTab')}
            >
              <AppIcon name="close" />
            </button>
          </div>
        )
      })}
      {onAddTab ? (
        <button
          className="vb-workspace-tab-add"
          onClick={onAddTab}
          title={t(locale, 'topControlBar.addWorkspaceTab')}
          type="button"
          aria-label={t(locale, 'topControlBar.addWorkspaceTab')}
        >
          <AppIcon name="plus" />
        </button>
      ) : null}
    </div>
  )
}
