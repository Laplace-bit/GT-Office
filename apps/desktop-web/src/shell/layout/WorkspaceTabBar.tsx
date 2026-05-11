import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { t, type Locale } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import type { WorkspaceTabInfo } from '../state/workspace-tab-model'
import type { WorkspaceSwitchAnimation } from '../state/ui-preferences'
import { desktopApi } from '../integration/desktop-api'
import './WorkspaceTabBar.scss'

const TAB_BAR_CHANNEL = 'gto-workspace-tab-bar'
const TEAR_OFF_GUTTER_PX = 24

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
}

interface SortableWorkspaceTabProps {
  locale: Locale
  tab: WorkspaceTabInfo
  active: boolean
  pending: boolean
  closing: boolean
  onSwitchTab: (workspaceId: string) => void
  onCloseTab: (workspaceId: string) => void
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

function SortableWorkspaceTab({
  locale,
  tab,
  active,
  pending,
  closing,
  onSwitchTab,
  onCloseTab,
}: SortableWorkspaceTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.workspaceId,
    disabled: closing,
  })
  const tabName = tab.name || tab.root.split('/').pop() || tab.workspaceId
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`vb-workspace-tab${active ? ' active' : ''}${pending ? ' pending' : ''}${
        closing ? ' closing' : ''
      }${isDragging ? ' dragging' : ''}`}
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
      aria-selected={active}
      aria-busy={pending || undefined}
      title={tab.root}
      {...attributes}
      {...listeners}
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
}

function WorkspaceTabGhost({ tab }: { tab: WorkspaceTabInfo | null }) {
  if (!tab) {
    return null
  }
  const tabName = tab.name || tab.root.split('/').pop() || tab.workspaceId
  return (
    <div className="vb-workspace-tab vb-workspace-tab-ghost active" aria-hidden="true">
      <AppIcon name="folder-open" className="vb-workspace-tab-icon" aria-hidden="true" />
      <span className="vb-workspace-tab-label">{tabName}</span>
    </div>
  )
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
}: WorkspaceTabBarProps) {
  const tabBarRef = useRef<HTMLDivElement | null>(null)
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
  const mergeTargetsRef = useRef<Map<string, WorkspaceTabDropTarget>>(new Map())
  const pointerRef = useRef<{ screenX: number; screenY: number } | null>(null)
  const [currentWindowLabel, setCurrentWindowLabel] = useState<string | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const activeDragIdRef = useRef<string | null>(null)

  const acceptsExternalTabs = !onMergeTabIntoWindow
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.workspaceId === activeDragId) ?? null,
    [activeDragId, tabs],
  )

  const sensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: 4,
    },
  })
  const sensors = useSensors(sensor)

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
      if (
        payload.type === 'merge-request' &&
        currentWindowLabel &&
        payload.targetWindowLabel === currentWindowLabel
      ) {
        onSwitchTab(payload.workspaceId)
      }
    }
    return () => {
      channel.close()
      broadcastChannelRef.current = null
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

  useEffect(() => {
    if (!activeDragId) {
      return
    }
    const handlePointerMove = (event: PointerEvent) => {
      pointerRef.current = {
        screenX: event.screenX,
        screenY: event.screenY,
      }
    }
    window.addEventListener('pointermove', handlePointerMove)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [activeDragId])

  const resetDragState = useCallback(() => {
    pointerRef.current = null
    activeDragIdRef.current = null
    setActiveDragId(null)
  }, [])

  const finalizeDetachedDrop = useCallback(() => {
    const workspaceId = activeDragIdRef.current
    const point = pointerRef.current
    const currentRect = currentWindowLabel
      ? mergeTargetsRef.current.get(currentWindowLabel)?.rect ?? null
      : null
    if (!workspaceId || !point) {
      resetDragState()
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
      resetDragState()
      return
    }

    if (onTearOffTab && currentRect && isTearOffDrop(point, currentRect)) {
      onTearOffTab({
        workspaceId,
        screenX: point.screenX,
        screenY: point.screenY,
      })
    }

    resetDragState()
  }, [currentWindowLabel, onMergeTabIntoWindow, onTearOffTab, postChannelMessage, resetDragState])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const workspaceId = String(event.active.id)
    activeDragIdRef.current = workspaceId
    setActiveDragId(workspaceId)
    const activator = event.activatorEvent
    if (activator instanceof PointerEvent || activator instanceof MouseEvent) {
      pointerRef.current = {
        screenX: activator.screenX,
        screenY: activator.screenY,
      }
    }
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        const currentIds = tabs.map((tab) => tab.workspaceId)
        const oldIndex = currentIds.indexOf(String(active.id))
        const newIndex = currentIds.indexOf(String(over.id))
        if (oldIndex >= 0 && newIndex >= 0) {
          onReorderTabs(oldIndex, newIndex)
        }
      }
      finalizeDetachedDrop()
    },
    [finalizeDetachedDrop, onReorderTabs, tabs],
  )

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      finalizeDetachedDrop()
    },
    [finalizeDetachedDrop],
  )

  const switchingClass =
    workspaceSwitching && workspaceSwitchAnimation !== 'none'
      ? ` workspace-switching workspace-switching--${workspaceSwitchAnimation}`
      : ''

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={tabs.map((tab) => tab.workspaceId)} strategy={horizontalListSortingStrategy}>
        <div
          className={`vb-workspace-tab-bar${switchingClass}`}
          data-switch-anim={workspaceSwitchAnimation !== 'none' ? workspaceSwitchAnimation : undefined}
          ref={tabBarRef}
        >
          {tabs.map((tab) => (
            <SortableWorkspaceTab
              key={tab.workspaceId}
              locale={locale}
              tab={tab}
              active={tab.workspaceId === activeTabId}
              pending={tab.workspaceId === pendingTabId && tab.workspaceId !== activeTabId}
              closing={tab.workspaceId === closingTabId}
              onSwitchTab={onSwitchTab}
              onCloseTab={onCloseTab}
            />
          ))}
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
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        <WorkspaceTabGhost tab={activeTab} />
      </DragOverlay>
    </DndContext>
  )
}
